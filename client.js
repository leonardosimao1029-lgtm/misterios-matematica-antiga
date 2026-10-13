'use strict';
const $=id=>document.getElementById(id);
const CHAPTERS=['Egito','Babilônia','Grécia'];
const SLUGS=['egito','babilonia','grecia'];
const MISSIONS=['A altura do marco','O mistério da pirâmide','Os campos agrícolas','O enigma das terras','A distância desconhecida','A altura da torre'];
let session=null,snap=null,events=null,activeChapter=-1,activeRound=-1,finishPending=false,networkUrls=[],cutsceneTimer=null;
const CRED_KEY='mma_multiplayer_access_v1';
// Música ambiente original; cada notebook tem seu próprio controle de som.
const MUSIC_KEY='mma_musica_preferencia_v1';
const musicAudio=$('backgroundMusic');
const musicToggle=$('musicToggle');
const musicVolume=$('musicVolume');
let musicEnabled=true;
try{
 const p=JSON.parse(localStorage.getItem(MUSIC_KEY)||'null');
 if(p && typeof p.enabled==='boolean')musicEnabled=p.enabled;
 if(p && Number.isFinite(p.volume))musicVolume.value=String(Math.min(100,Math.max(0,p.volume)));
}catch(e){}
musicAudio.volume=Number(musicVolume.value)/100;
function saveMusic(){try{localStorage.setItem(MUSIC_KEY,JSON.stringify({enabled:musicEnabled,volume:Number(musicVolume.value)}))}catch(e){}}
function refreshMusicButton(){
 const playing=!musicAudio.paused;
 musicToggle.textContent=playing?'♫ Pausar música':musicEnabled?'▶ Música':'♪ Música desligada';
 musicToggle.setAttribute('aria-pressed',String(playing));
 musicToggle.title=playing?'Pausar trilha sonora':'Iniciar trilha sonora';
}
function beginMusic(){
 if(!musicEnabled || !musicAudio.paused)return;
 const p=musicAudio.play();
 if(p && typeof p.then==='function')p.then(refreshMusicButton).catch(()=>{refreshMusicButton()});
}
musicToggle.addEventListener('click',()=>{
 if(!musicAudio.paused){musicEnabled=false;musicAudio.pause();}
 else{musicEnabled=true;beginMusic();}
 saveMusic();refreshMusicButton();
});
musicVolume.addEventListener('input',()=>{
 musicAudio.volume=Number(musicVolume.value)/100;
 saveMusic();
});
musicAudio.addEventListener('play',refreshMusicButton);
musicAudio.addEventListener('pause',refreshMusicButton);
// O clique de entrada na sala desbloqueia o som conforme as regras dos navegadores.
for(const id of ['createRoom','joinRoom'])$(id).addEventListener('click',beginMusic,{capture:true});
refreshMusicButton();

function clearSavedInvestigations(){for(const k of ['mma_egito_2_missoes_2026_v1','mma_v4_babilonia','mma_v4_grecia'])try{localStorage.removeItem(k)}catch{}}
function setHidden(id,hide){$(id).classList.toggle('hidden',hide)}
function showOnly(id){for(const x of ['welcome','lobby','teacher','playing','ending'])setHidden(x,x!==id)}
let toastTimer;
function notify(t){$('notice').textContent=t; $('notice').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('notice').classList.remove('show'),4200)}
function safe(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function setError(t){$('welcomeError').textContent=t;setHidden('welcomeError',!t)}
async function request(endpoint,payload={}){
 const res=await fetch('/api/'+endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
 let data=await res.json().catch(()=>({ok:false,error:'Resposta inválida do servidor.'}));
 if(!res.ok||!data.ok)throw Error(data.error||'Não foi possível realizar a operação.');return data;
}
async function action(endpoint,other={}){
 if(!session)return;
 try{const data=await request(endpoint,{room:session.room,credential:session.credential,...other}); if(data.stage)applyState(data)}catch(e){notify(e.message)}
}
function remember(x){session=x;sessionStorage.setItem(CRED_KEY,JSON.stringify(x));}
function leaveLocal(){clearTimeout(cutsceneTimer);setHidden('cutscene',true);if(events)events.close();events=null;sessionStorage.removeItem(CRED_KEY);session=null;snap=null;activeChapter=-1;activeRound=-1;finishPending=false;$('chapterFrame').src='about:blank';setHidden('roomHeader',true);setHidden('leaveButton',true);showOnly('welcome');}
function startConnection(){
 if(events)events.close();if(!session)return;
 const q=new URLSearchParams({room:session.room,credential:session.credential});
 events=new EventSource('/api/events?'+q);
 events.addEventListener('state',e=>{try{const o=JSON.parse(e.data);if(o.error){notify(o.error);leaveLocal()}else applyState(o)}catch(err){console.error(err)}});
 events.onerror=()=>{if(session)notify('Tentando reconectar. Verifique a internet e se a sala ainda existe.');};
}
function showCutscene(chapterIndex){
 clearTimeout(cutsceneTimer);
 $('cinemaEyebrow').textContent='CAPÍTULO '+(chapterIndex+1)+' DE 3';
 $('cinemaTitle').textContent=CHAPTERS[chapterIndex];
 $('cinemaCaption').textContent=['Descubra alturas por meio de sombras e proporções.','Reconstrua as terras com geometria e álgebra.','Investigue distâncias e ângulos com raciocínio geométrico.'][chapterIndex];
 setHidden('cutscene',false);
 cutsceneTimer=setTimeout(()=>setHidden('cutscene',true),2600);
}
function roomLink(){let base=location.origin;if((location.hostname==='localhost'||location.hostname==='127.0.0.1')&&networkUrls.length){base=networkUrls[0]};return base+'/?s='+session.room;}
async function copy(t){try{await navigator.clipboard.writeText(t);notify('Copiado!')}catch{prompt('Copie este endereço:',t)}}
async function getNetwork(){try{let a=await fetch('/api/network').then(r=>r.json());networkUrls=a.urls||[]}catch{}}
function applyState(s){
 if(!session||s.room!==session.room)return;
 const before=snap;
 snap=s;
 $('roomHeader').textContent='SALA '+s.room;
 setHidden('roomHeader',false);setHidden('leaveButton',false);
 if(s.stage==='lobby'&&before?.stage==='playing'&&session.role==='team'){clearSavedInvestigations();activeChapter=-1;activeRound=-1;$('chapterFrame').src='about:blank';}
 if(s.stage==='lobby'){renderLobby();return}
 if(s.stage==='finished'){showOnly('ending');return}
 if(s.stage==='playing'){
   if(session.role==='host'){renderTeacher();return}
   renderPlayer();return;
 }
}
function renderTeams(target,host,atLobby=false){
 $(target).innerHTML=snap.teams.map((t,i)=>{
 let label=atLobby?(t.ready?'Pronta':'Preparando'):(t.finished?(t.assisted?'Liberada pelo professor':'Concluiu'):'Investigando');
 let sub=t.online?'Conectada':'Sem conexão';
 let glyph=atLobby?(t.ready?'✓':'⌛'):(t.finished?'✓':'✎');
 let extras='';
 if(host&&atLobby)extras=`<button class="tinybtn" data-remove="${t.id}" title="Retirar equipe">Retirar</button>`;
 if(host&&!atLobby&&!t.finished)extras=`<button class="tinybtn" data-assist="${t.id}" title="Liberar uma equipe que ficou presa">Liberar</button>`;
 return `<div class="team"><div class="flex"><span class="mark">${glyph}</span><div><div class="name">${safe(t.name)}</div><div class="desc">${sub}</div></div></div><div class="flex"><span class="tag ${t.ready&&atLobby||t.finished&&!atLobby?'ok':'wait'}">${label}</span>${extras}</div></div>`;
 }).join('')+Array.from({length:Math.max(0,3-snap.teams.length)},(_,i)=>`<div class="team"><span class="muted">⌛ Aguardando a equipe ${snap.teams.length+i+1}</span></div>`).join('');
 for(const el of $(target).querySelectorAll('[data-remove]'))el.onclick=()=>{if(confirm('Retirar esta equipe da sala?'))action('host/remove',{teamId:el.dataset.remove})};
 for(const el of $(target).querySelectorAll('[data-assist]'))el.onclick=()=>{if(confirm('Marcar esta equipe como liberada nesta missão? Use apenas quando necessário para não atrasar a atividade.'))action('host/assist',{teamId:el.dataset.assist})};
}
function renderLobby(){
 showOnly('lobby');const isHost=session.role==='host';
 $('lobbyTitle').textContent=isHost?'Sala preparada para três equipes':'Aguardando o professor';
 $('lobbyDesc').textContent=isHost?'Compartilhe o código com as três equipes. Assim que todas estiverem prontas, inicie a investigação.':'Sua equipe participa das mesmas seis missões que as outras duas. Confirme que está pronta.';
 renderTeams('lobbyTeams',isHost,true);
 $('bigCode').textContent=session.room;
 $('linkText').textContent=roomLink();
 const self=snap.teams.find(t=>t.id===snap.yourId);
 const actions=[];
 if(isHost){actions.push(`<button class="btn" id="startSession" ${!snap.canStart?'disabled':''}>▶ Iniciar investigação</button>`)}
 else{actions.push(`<button class="btn ${self?.ready?'alt':''}" id="readyButton">${self?.ready?'✓ Pronto! (alterar)':'Estou pronto ✓'}</button>`)}
 $('lobbyActions').innerHTML=actions.join('');
 if(isHost){$('startSession').onclick=()=>action('host/start');}else{$('readyButton').onclick=()=>action('ready',{ready:!self?.ready})}
}
function progressHTML(n){return Array.from({length:6},(_,i)=>`<span class="step ${i<n?'done':i===n?'current':''}" title="Missão ${i+1}"></span>`).join('')}
function renderTeacher(){
 showOnly('teacher');
 $('teacherTitle').textContent=`Missão ${snap.round+1} de 6 — ${MISSIONS[snap.round]}`;
 $('teacherProgress').innerHTML=progressHTML(snap.round);
 $('teacherDesc').textContent=`Capítulo ${Math.floor(snap.round/2)+1}/3: ${CHAPTERS[Math.floor(snap.round/2)]}. Todas as equipes resolvem a mesma questão no próprio notebook.`;
 renderTeams('teacherTeams',true,false);
 $('teacherActions').innerHTML=`<button id="advanceRound" class="btn" ${snap.canNext?'':'disabled'}>${snap.round===5?'✨ Restaurar o mundo':'Avançar para a próxima missão →'}</button>`;
 $('advanceRound').onclick=()=>action('host/next');
 $('teacherHint').textContent=snap.canNext?'As três equipes concluíram. Você já pode liberar a próxima fase.':'O avanço ficará disponível quando todas as equipes concluírem. Use Liberar apenas se necessário.';
 $('worldPhoto').src='/assets/mapa_caos.webp';
 $('mapCaption').textContent=`${CHAPTERS[Math.floor(snap.round/2)]} • ${snap.round+1}/6 missões`;
}
function chapterUrl(idx){return `/chapters/${SLUGS[idx]}.html`}
function renderPlayer(){
 showOnly('playing');
 const my=snap.teams.find(t=>t.id===snap.yourId);
 const chapterIndex=Math.floor(snap.round/2),missionIndex=snap.round%2;
 $('playerChapter').textContent=`CAPÍTULO ${chapterIndex+1}/3 — ${CHAPTERS[chapterIndex]} • MISSÃO ${snap.round+1} DE 6`;
 $('playerMission').textContent=MISSIONS[snap.round];
 $('playerStatus').textContent=my?.finished?'Concluída — aguardando':'Investigando';
 $('playerStatus').className='tag '+(my?.finished?'ok':'');
 let newChapter=activeChapter!==chapterIndex;
 let newMission=activeRound!==snap.round;
 activeChapter=chapterIndex;activeRound=snap.round;
 if(newChapter){
   showCutscene(chapterIndex);
   const frame=$('chapterFrame');
   frame.onload=()=>{
      if(snap?.stage==='playing'&&Math.floor(snap.round/2)===chapterIndex){
        frame.contentWindow.postMessage({type:'mma:sync-mission',mission:snap.round%2},location.origin);
      }
   };
   frame.src=chapterUrl(chapterIndex);
 }else if(newMission){
   const frame=$('chapterFrame');
   frame.contentWindow?.postMessage({type:'mma:sync-mission',mission:missionIndex},location.origin);
 }
 setHidden('waitveil',!my?.finished);
 $('waitTeams').innerHTML=snap.teams.map(t=>`<span>${t.finished?'✓':'⌛'} ${safe(t.name)}</span>`).join('');
}
window.addEventListener('message',e=>{
 if(e.origin!==location.origin||e.source!==$('chapterFrame').contentWindow)return;
 if(!e.data||e.data.type!=='mma:mission-complete'||!session||session.role!=='team'||!snap||snap.stage!=='playing')return;
 let mission=Number(e.data.mission),chapter=SLUGS[Math.floor(snap.round/2)];
 if(mission!==snap.round%2||e.data.chapter!==chapter||finishPending)return;
 const my=snap.teams.find(t=>t.id===snap.yourId);if(my?.finished)return;
 finishPending=true;
 action('complete',{round:snap.round}).finally(()=>{finishPending=false});
});
async function boot(){
 await getNetwork();
 const query=new URLSearchParams(location.search),room=(query.get('s')||'').toUpperCase();if(room)$('roomInput').value=room;
 try{const stored=JSON.parse(sessionStorage.getItem(CRED_KEY)||'null');if(stored?.room&&stored?.credential&&stored?.role){remember(stored);const url='/api/status?'+new URLSearchParams({room:session.room,credential:session.credential});const s=await fetch(url).then(r=>r.json());if(!s.ok)throw Error(s.error||'Sua sessão expirou.');applyState(s);startConnection();}else showOnly('welcome');}
 catch(e){leaveLocal();notify('A sessão anterior não está mais disponível. Entre na sala novamente.');}
}
$('createRoom').onclick=async()=>{setError('');try{let r=await request('create');clearSavedInvestigations();remember({role:'host',room:r.room,credential:r.credential});applyState(r.snapshot);startConnection()}catch(e){setError(e.message)}};
$('joinRoom').onclick=async()=>{setError('');const room=$('roomInput').value.trim().toUpperCase();const name=$('teamInput').value.trim();if(room.length!==6)return setError('Digite o código de seis caracteres.');if(name.length<2)return setError('Informe o nome da equipe.');try{let r=await request('join',{room,name});clearSavedInvestigations();remember({role:'team',room:r.room,credential:r.credential});applyState(r.snapshot);startConnection()}catch(e){setError(e.message)}};
$('copyCode').onclick=()=>session&&copy(session.room);
$('copyLink').onclick=()=>session&&copy(roomLink());
$('leaveButton').onclick=()=>{if(confirm('Deseja sair desta tela? Se a sala estiver em andamento, sua equipe continuará registrada e poderá retornar recarregando esta página somente enquanto sua sessão estiver disponível.'))leaveLocal()};
$('endingLeave').onclick=()=>leaveLocal();
$('fullscreen').onclick=()=>document.fullscreenElement?document.exitFullscreen?.():document.documentElement.requestFullscreen?.();
boot();
