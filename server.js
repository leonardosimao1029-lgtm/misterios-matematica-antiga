'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const ROOT = __dirname;
const rooms = new Map();
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webp':'image/webp','.png':'image/png','.mp3':'audio/mpeg','.json':'application/json; charset=utf-8','.ico':'image/x-icon'};
function token(){return crypto.randomBytes(24).toString('base64url');}
function makeCode(){const abc='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let c;do{c=Array.from(crypto.randomBytes(6),v=>abc[v%abc.length]).join('')}while(rooms.has(c));return c;}
function respond(res,code,body){res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));}
function fail(res,code,msg){respond(res,code,{ok:false,error:msg})}
function getRoom(code){const r=rooms.get(String(code||'').trim().toUpperCase());if(!r)throw {status:404,message:'Sala não encontrada. Confira o código.'};r.touched=Date.now();return r;}
function auth(r,cred,host=false){const t=String(cred||'');if(host){if(t!==r.hostToken)throw {status:403,message:'Acesso reservado ao professor.'};return {role:'host'};}
  const team=r.teams.find(x=>x.token===t);if(!team)throw {status:403,message:'Equipe não reconhecida. Entre novamente.'};return {role:'team',team};}
function snapshot(r,access){return {ok:true,room:r.code,stage:r.stage,round:r.round,maxTeams:3,totalRounds:6,teams:r.teams.map(t=>({id:t.id,name:t.name,ready:t.ready,finished:t.finished,assisted:t.assisted,online:t.connections>0})),yourRole:access.role,yourId:access.team?.id||null,canNext:r.stage==='playing'&&r.teams.length===3&&r.teams.every(t=>t.finished),canStart:r.stage==='lobby'&&r.teams.length===3&&r.teams.every(t=>t.ready)};}
function sendTo(res,obj){try{res.write('event: state\ndata: '+JSON.stringify(obj)+'\n\n');}catch(e){}}
function broadcast(r){for(const c of Array.from(r.clients)){try{sendTo(c.res,snapshot(r,c.access));}catch(e){r.clients.delete(c)}}}
function getString(v,max){return typeof v==='string'?v.trim().slice(0,max):''}
function joinUniqueName(r,want){let name=want||`Equipe ${r.teams.length+1}`;if(r.teams.some(t=>t.name.toLowerCase()===name.toLowerCase()))throw {status:409,message:'Já existe uma equipe com esse nome na sala.'};return name;}
async function body(req){let data='';for await(const c of req){data+=c;if(data.length>8192)throw {status:413,message:'Solicitação muito grande.'};}try{return JSON.parse(data||'{}')}catch(e){throw {status:400,message:'Dados inválidos.'}}}
async function api(req,res,u){
 if(req.method==='POST'){
 const b=await body(req);
 if(u.pathname==='/api/create'){
  const code=makeCode();const r={code,hostToken:token(),stage:'lobby',round:0,teams:[],clients:new Set(),touched:Date.now()};rooms.set(code,r);
  return respond(res,200,{ok:true,room:code,credential:r.hostToken,role:'host',snapshot:snapshot(r,{role:'host'})});
 }
 if(u.pathname==='/api/join'){
  const r=getRoom(b.room);if(r.stage!=='lobby')throw {status:409,message:'A investigação já começou. Peça ao professor para iniciar uma nova sala.'};
  if(r.teams.length>=3)throw {status:409,message:'A sala já tem três equipes.'};
  const name=joinUniqueName(r,getString(b.name,28)); const t={id:crypto.randomUUID(),token:token(),name,ready:false,finished:false,assisted:false,connections:0};
  r.teams.push(t);broadcast(r);return respond(res,200,{ok:true,room:r.code,credential:t.token,role:'team',id:t.id,snapshot:snapshot(r,{role:'team',team:t})});
 }
 const r=getRoom(b.room);const access=auth(r,b.credential,u.pathname.startsWith('/api/host/'));
 if(u.pathname==='/api/ready'){
   if(access.role!=='team'||r.stage!=='lobby')throw {status:409,message:'A etapa de preparação já foi encerrada.'};
   access.team.ready=!!b.ready;broadcast(r);return respond(res,200,snapshot(r,access));
 }
 if(u.pathname==='/api/complete'){
   if(access.role!=='team'||r.stage!=='playing')throw {status:409,message:'A sala não está numa missão ativa.'};
   if(Number(b.round)!==r.round)throw {status:409,message:'Esta missão já mudou. Atualize a tela.'};
   access.team.finished=true;access.team.assisted=false;broadcast(r);return respond(res,200,snapshot(r,access));
 }
 if(u.pathname==='/api/host/start'){
   if(r.stage!=='lobby'||r.teams.length!==3||!r.teams.every(t=>t.ready))throw {status:409,message:'São necessárias três equipes prontas para iniciar.'};
   r.stage='playing';r.round=0;r.teams.forEach(t=>{t.finished=false;t.assisted=false});broadcast(r);return respond(res,200,snapshot(r,access));
 }
 if(u.pathname==='/api/host/next'){
   if(r.stage!=='playing'||r.teams.length!==3||!r.teams.every(t=>t.finished))throw {status:409,message:'Aguarde as três equipes concluírem a missão.'};
   if(r.round===5){r.stage='finished';}else{r.round++;r.teams.forEach(t=>{t.finished=false;t.assisted=false});}
   broadcast(r);return respond(res,200,snapshot(r,access));
 }
 if(u.pathname==='/api/host/assist'){
   if(r.stage!=='playing')throw {status:409,message:'A investigação não está em andamento.'};
   const team=r.teams.find(t=>t.id===b.teamId);if(!team)throw {status:404,message:'Equipe não encontrada.'};
   team.finished=true;team.assisted=true;broadcast(r);return respond(res,200,snapshot(r,access));
 }
 if(u.pathname==='/api/host/remove'){
   if(r.stage!=='lobby')throw {status:409,message:'Só é possível retirar equipes antes do início.'};
   const team=r.teams.find(t=>t.id===b.teamId);if(!team)throw {status:404,message:'Equipe não encontrada.'};
   r.teams=r.teams.filter(t=>t.id!==b.teamId);for(const client of Array.from(r.clients)){if(client.access.team?.id===b.teamId){sendTo(client.res,{error:'Você foi retirado da sala pelo professor.'});client.res.end();r.clients.delete(client)}}
   broadcast(r);return respond(res,200,snapshot(r,access));
 }
 if(u.pathname==='/api/host/reset'){
   r.stage='lobby';r.round=0;r.teams.forEach(t=>{t.ready=false;t.finished=false;t.assisted=false});broadcast(r);return respond(res,200,snapshot(r,access));
 }
 throw {status:404,message:'Ação desconhecida.'};
 }
 if(req.method==='GET'&&u.pathname==='/api/network'){const ips=[];for(const value of Object.values(os.networkInterfaces()))for(const i of value)if(i.family==='IPv4'&&!i.internal)ips.push(i.address);return respond(res,200,{ok:true,urls:ips.map(ip=>'http://'+ip+':'+PORT)});}
 if(req.method==='GET'&&u.pathname==='/api/status'){
  const r=getRoom(u.searchParams.get('room'));const credential=u.searchParams.get('credential');let access=credential===r.hostToken?{role:'host'}:auth(r,credential);return respond(res,200,snapshot(r,access));
 }
 if(req.method==='GET'&&u.pathname==='/api/events'){
  const r=getRoom(u.searchParams.get('room'));const credential=u.searchParams.get('credential');const access=credential===r.hostToken?{role:'host'}:auth(r,credential);
  res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','connection':'keep-alive','x-accel-buffering':'no','x-content-type-options':'nosniff'});
  res.write('retry: 2500\n\n');const c={res,access};r.clients.add(c);if(access.team)access.team.connections++;sendTo(res,snapshot(r,access));broadcast(r);
  const ping=setInterval(()=>{try{res.write(': ping\n\n');}catch(e){}},20000);
  req.on('close',()=>{clearInterval(ping);if(!r.clients.has(c))return;r.clients.delete(c);if(access.team)access.team.connections=Math.max(0,access.team.connections-1);broadcast(r)});return;
 }
 throw {status:404,message:'Rota não encontrada.'};
}
const srv=http.createServer(async(req,res)=>{
 try{
  const u=new URL(req.url||'/', 'http://localhost');
  if(req.method==='GET'&&u.pathname==='/health')return respond(res,200,{ok:true,status:'online'});
  if(u.pathname.startsWith('/api/'))return await api(req,res,u);
  if(req.method!=='GET'&&req.method!=='HEAD')return fail(res,405,'Método não permitido.');
  let p=decodeURIComponent(u.pathname); if(p==='/'||p==='/index.html')p='/index.html';
  const allowed=p==='/index.html'||p==='/client.js'||p.startsWith('/assets/')||p.startsWith('/chapters/');
  if(!allowed)return fail(res,404,'Arquivo não encontrado.');
  const full=path.resolve(ROOT,'.'+p);if(!full.startsWith(ROOT+path.sep)||!fs.existsSync(full)||!fs.statSync(full).isFile())return fail(res,404,'Arquivo não encontrado.');
  res.writeHead(200,{'content-type':mime[path.extname(full)]||'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff','content-length':fs.statSync(full).size});
  if(req.method==='HEAD')return res.end();fs.createReadStream(full).pipe(res);
 }catch(e){if(!res.headersSent)fail(res,e.status||500,e.status?e.message:'Erro interno do servidor.');else try{res.end()}catch{}}
});
srv.listen(PORT,HOST,()=>{
  console.log('\nMISTÉRIOS DA MATEMÁTICA ANTIGA — SALA MULTIEQUIPE');
  if(process.env.RENDER_EXTERNAL_URL)console.log('Endereço público: '+process.env.RENDER_EXTERNAL_URL);
  else console.log('Neste computador: http://localhost:'+PORT);
  if(!process.env.RENDER_EXTERNAL_URL)for(const name of Object.keys(os.networkInterfaces()))for(const i of os.networkInterfaces()[name])if(i.family==='IPv4'&&!i.internal)console.log('Outros notebooks (mesma rede): http://'+i.address+':'+PORT);
  console.log('\nMantenha esta janela aberta durante a apresentação.\n');
});
setInterval(()=>{const now=Date.now();for(const [code,r] of rooms)if(now-r.touched>8*60*60*1000){for(const c of r.clients)c.res.end();rooms.delete(code)}},60*60*1000).unref();
