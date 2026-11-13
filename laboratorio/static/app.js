'use strict';
const $=s=>document.querySelector(s);
let events=[],current=null,adminToken='',token=sessionStorage.getItem('viva-session')||'';
const fmt=v=>new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'America/Araguaina'}).format(new Date(v));
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,6500);}
async function api(path,method='GET',body,admin=false){const headers={};if(body!==undefined)headers['Content-Type']='application/json';if(token)headers['X-Session-Token']=token;if(admin)headers['X-Admin-Token']=adminToken;const r=await fetch(path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||'Não foi possível concluir.');return d;}
function show(view){if('speechSynthesis'in window)speechSynthesis.cancel();document.querySelectorAll('.view').forEach(n=>n.hidden=n.id!==view);document.querySelectorAll('.nav').forEach(n=>{const active=n.dataset.view===view;n.classList.toggle('active',active);if(active)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current');});window.scrollTo({top:0,behavior:motionPaused()?'auto':'smooth'});const heading=$('#'+view+' h1');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}}
document.addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b)show(b.dataset.view);});
// Progressive rendering uses the real demo catalog; it never loops duplicate cards.
let filteredEvents=[],visibleCount=0,selectedCategory='',renderVersion=0;
const PAGE_SIZE=6;
const motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
let manuallyPaused=false;
function motionPaused(){return manuallyPaused||motionPreference.matches;}
function syncMotion(){document.documentElement.dataset.motion=motionPaused()?'paused':'running';const b=$('#motion-toggle');b.disabled=motionPreference.matches;b.textContent=motionPreference.matches?'Movimento reduzido':manuallyPaused?'Ativar movimento':'Pausar movimento';b.setAttribute('aria-pressed',String(motionPaused()));}
$('#motion-toggle').onclick=()=>{manuallyPaused=!manuallyPaused;syncMotion();};
motionPreference.addEventListener('change',syncMotion);syncMotion();
function themeFor(e){return ({'Música':'lime','Oficina':'clay','Gastronomia':'sand','Cultura':'lilac','Bem-estar':'mint','Encontros':'blue'})[e.category]||'lime';}
function buildCard(e){
 const card=el('article','card event-card theme-'+themeFor(e)),art=el('div','card-art'),body=el('div','card-body');
 card.dataset.eventId=e.id;art.append(el('span','chip',e.category),el('span','card-symbol','✳'));art.querySelector('.card-symbol').setAttribute('aria-hidden','true');
 const date=new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',timeZone:'America/Araguaina'}).format(new Date(e.starts));
 art.append(el('span','card-date',date));
 body.append(el('p','meta',fmt(e.starts)+' · '+e.location),el('h3','',e.title),el('p','card-description',e.description.replace('Evento fictício para demonstração.','').trim()));
 const b=el('button','card-link','Quero conhecer');b.append(el('span','','↗'));b.lastChild.setAttribute('aria-hidden','true');b.onclick=()=>details(e.id);body.append(b);card.append(art,body);return card;
}
function appendBatch(manual=false){
 const previous=visibleCount,batch=filteredEvents.slice(visibleCount,visibleCount+PAGE_SIZE);if(!batch.length)return;
 const fragment=document.createDocumentFragment();for(const e of batch)fragment.append(buildCard(e));$('#event-list').append(fragment);visibleCount+=batch.length;
 const hasMore=visibleCount<filteredEvents.length;$('#load-more').hidden=!hasMore;
 $('#feed-status').textContent=hasMore?visibleCount+' de '+filteredEvents.length+' experiências · continue explorando':visibleCount+' experiências. Você chegou ao fim desta programação.';
 if(manual){const first=$('#event-list').children[previous]?.querySelector('button');first?.focus({preventScroll:true});}
}
function renderEvents(){
 renderVersion++;const q=$('#search').value.toLocaleLowerCase('pt-BR').trim();
 filteredEvents=events.filter(e=>(!selectedCategory||e.category===selectedCategory)&&(e.title+' '+e.category+' '+e.location).toLocaleLowerCase('pt-BR').includes(q));
 visibleCount=0;$('#event-list').replaceChildren();$('#load-more').hidden=true;
 $('#catalog-count').textContent=filteredEvents.length+' experiências demonstrativas';
 if(!filteredEvents.length){const empty=el('div','empty-state');empty.append(el('h3','','Nada por aqui. Ainda.'),el('p','','Tente outra busca ou escolha uma categoria diferente.'));$('#event-list').append(empty);$('#feed-status').textContent='Nenhuma experiência encontrada.';}else appendBatch();
 $('#map-events').replaceChildren();for(const e of events){const b=el('button','map-event');b.append(el('strong','',e.location+' · '+e.title),el('small','',fmt(e.starts)));b.onclick=()=>details(e.id);$('#map-events').append(b);}
}
function renderCategories(){
 const categories=['',...new Set(events.map(e=>e.category))];if(!categories.includes(selectedCategory))selectedCategory='';$('#category-filters').replaceChildren();
 for(const category of categories){const b=el('button','filter-chip',category||'Tudo para viver');b.type='button';b.setAttribute('aria-pressed',String(category===selectedCategory));b.onclick=()=>{selectedCategory=category;document.querySelectorAll('.filter-chip').forEach(n=>n.setAttribute('aria-pressed',String(n===b)));renderEvents();};$('#category-filters').append(b);}
}
async function load(){
 $('#retry-events').hidden=true;$('#feed-status').textContent='Carregando a programação…';
 try{events=(await api('/api/events')).events;renderCategories();renderEvents();const featured=events.find(e=>e.id==='musica')||events[0];$('#featured-open').disabled=!featured;if(featured){$('#featured-title').textContent=featured.title;$('#featured-meta').textContent=fmt(featured.starts)+' · '+featured.location;$('#featured-open').onclick=()=>details(featured.id);}else{$('#featured-title').textContent='Novos encontros em breve';$('#featured-meta').textContent='Acompanhe a programação';}}
 catch(error){$('#retry-events').hidden=false;$('#feed-status').textContent='Não foi possível atualizar a programação. Tente novamente.';throw error;}
}
$('#load-more').onclick=()=>appendBatch(true);
$('#retry-events').onclick=()=>load().catch(e=>toast(e.message));
if('IntersectionObserver'in window){const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&!$('#agenda').hidden&&visibleCount<filteredEvents.length)appendBatch();},{rootMargin:'0px 0px 120px 0px'});observer.observe($('#feed-sentinel'));}
function details(id){current=events.find(e=>e.id===id);if(!current){toast('Evento não encontrado.');return;}$('#detail-category').textContent=current.category.toUpperCase()+' • DEMONSTRAÇÃO';$('#detail-title').textContent=current.title;$('#detail-description').textContent=current.description;$('#detail-date').textContent=fmt(current.starts)+' — '+fmt(current.ends);$('#detail-location').textContent=current.location+' · posição ilustrativa';$('#event-link').value=location.origin+'/?event='+encodeURIComponent(id);$('#receipt').textContent='';$('#review-form').reset();$('#consent-area').hidden=!!token;$('#checkin').disabled=false;$('#checkin').textContent='Confirmar participação';show('detalhe');}
$('#search').addEventListener('input',renderEvents);
$('#show-location').onclick=()=>{const places={'Praça A':'praca-a','Praça B':'praca-b','Praça C':'praca-c'};location.href='/explorar.html?destination='+encodeURIComponent(places[current?.location]||'');};
const stopSpeech=el('button','secondary','Parar leitura');stopSpeech.onclick=()=>{if('speechSynthesis'in window)speechSynthesis.cancel();};$('#read-aloud').after(stopSpeech);
$('#copy-link').onclick=async()=>{try{await navigator.clipboard.writeText($('#event-link').value);toast('Link copiado. Gere um QR ou grave essa URL em uma tag NFC.');}catch{$('#event-link').select();toast('Selecione e copie o link exibido.');}};
$('#read-aloud').onclick=()=>{if(!('speechSynthesis'in window)){toast('Leitura em voz não disponível neste navegador.');return;}speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(current.title+'. '+current.description+'. '+fmt(current.starts)+'. '+current.location+'. Local ilustrativo.');u.lang='pt-BR';const localVoice=speechSynthesis.getVoices().find(v=>v.lang.startsWith('pt')&&v.localService);if(!localVoice){toast('Nenhuma voz local em português disponível. Leia a descrição na tela.');return;}u.voice=localVoice;speechSynthesis.speak(u);};
$('#checkin').onclick=async()=>{try{if(!token){if(!$('#consent').checked)throw Error('A participação é opcional. Marque o aceite para iniciar.');const d=await api('/api/session','POST',{consent:true,notice:'demo-v1'});token=d.token;sessionStorage.setItem('viva-session',token);$('#consent-area').hidden=true;}await api('/api/checkins','POST',{event_id:current.id});$('#checkin').textContent='Participação registrada ✓';$('#checkin').disabled=true;toast('Participação registrada. Agora você pode avaliar.');}catch(e){toast(e.message);}};
$('#review-form').onsubmit=async e=>{e.preventDefault();try{const f=new FormData(e.target);const d=await api('/api/reviews','POST',{event_id:current.id,score:Number(f.get('score')),reason:f.get('reason')});$('#receipt').textContent='Avaliação recebida. Comprovante: '+d.receipt+'. Obrigado por ajudar a planejar os próximos encontros.';toast('Avaliação enviada. Sua opinião importa.');}catch(err){toast(err.message);}};
$('#export').onclick=async()=>{try{const data=await api('/api/me');const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='viva-capim-minha-participacao.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('#privacy-status').textContent='Exportação preparada com os registros desta sessão.';}catch(e){toast(e.message);}};
$('#delete').onclick=async()=>{if(!token){toast('Não há sessão ativa nesta aba.');return;}if(!confirm('Excluir definitivamente a sessão, os check-ins e as avaliações desta base local?'))return;try{await api('/api/me','DELETE');token='';sessionStorage.removeItem('viva-session');$('#consent').checked=false;$('#consent-area').hidden=false;$('#privacy-status').textContent='Sessão e registros excluídos. Você pode continuar explorando sem cadastro.';toast('Exclusão concluída.');}catch(e){toast(e.message);}};
async function metrics(){const d=await api('/api/admin/metrics','GET',undefined,true);$('#metrics').replaceChildren();for(const e of d.events){const card=el('article','card metric');card.append(el('h3','',e.title),el('div','metric-value',e.average===null?'—':String(e.average)),el('p','',e.average===null?'Amostra insuficiente para exibir resultados':'Nota média de '+e.reviews+' avaliações'),el('p','',e.checkins===null?'Participações: amostra inferior a 5':e.checkins+' sessões com participação'),el('p','fine','Unidade: sessões por evento. Não comprova presença ou pessoas únicas.'));$('#metrics').append(card);}}
$('#admin-login').onsubmit=async e=>{e.preventDefault();adminToken=new FormData(e.target).get('token');try{await metrics();$('#admin-content').hidden=false;e.target.reset();toast('Painel liberado nesta aba.');}catch(err){adminToken='';$('#admin-content').hidden=true;toast(err.message);}};
$('#refresh-metrics').onclick=()=>metrics().catch(e=>toast(e.message));
$('#event-form').onsubmit=async e=>{e.preventDefault();try{const data=Object.fromEntries(new FormData(e.target));data.starts+=':00-03:00';data.ends+=':00-03:00';await api('/api/admin/events','POST',data,true);e.target.reset();await load();await metrics();toast('Evento demonstrativo criado e agenda atualizada.');}catch(err){toast(err.message);}};
load().then(()=>{const params=new URLSearchParams(location.search);const id=params.get('event');if(id)details(id);else if(params.get('view')==='privacidade')show('privacidade');}).catch(e=>toast('Não foi possível carregar a agenda. '+e.message));
