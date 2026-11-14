import {t,getLocale,formatInstruction,initializeLocalization,localizeTree} from './map-i18n.js';
import {mountStoreReviews,openStoreReview,resetStoreReviewSession} from './store-reviews.js';
import {getBrand,brandImageUrl,loadBrandLogos} from './brand-logos.js';
// Módulos da experiência carregados de forma isolada: se algum falhar, o mapa continua funcionando.
let KIOSK=new URLSearchParams(location.search).get('modo')==='totem',attractVisible=()=>false,foundMascot=()=>{};
try{const kiosk=await import('./kiosk.js');KIOSK=kiosk.isKiosk();kiosk.initAttract();attractVisible=kiosk.attractVisible;}catch(error){console.warn('Tela inicial indisponível',error);}
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state = {serviceFilter:null,data:null, selected:null, route:null, scene:null, floor:null, view:'3d', limit:8, request:0, reduced:matchMedia('(prefers-reduced-motion: reduce)').matches, arrival:false, lastActivity:Date.now(), idleStart:null, positionSource:'manual'};
const eventIds = {'Praça A':'musica','Praça B':'criativa','Praça C':'sabores'};
function status(message=''){ $('status').textContent=message; }
function floorName(id){const f=state.data.floors.find(x=>x.id===id);return f?.name||f?.label||id;}
function node(id){return state.data.nodes.find(x=>x.id===id);}
const serviceGroups={toilets:['toilet','accessible_toilet'],family:['family_room'],elevators:['elevator'],stairs:['stairs','escalator','moving_walkway','ramp']};
const facilityIcon=s=>({toilet:'WC',accessible_toilet:'♿',family_room:'FAM',elevator:'↕',stairs:'↗',escalator:'↗',moving_walkway:'↗',ramp:'↗'}[s.service_type]||'◎');
function destinations(){return [...state.data.stores,...(state.data.places||[]).map(p=>({...p,category:'Experiências',description:'Espaço demonstrativo para descobrir eventos, participar e avaliar a experiência.',...{x:node(p.node_id)?.x||0,z:node(p.node_id)?.z||0},width:5,depth:4,color:'#d9f57c',hours:'Consulte a agenda',event_id:eventIds[p.event_location],review_count:0}))];}
function originNode(){return node($('origin').value);}
function updatePosition(){
 const label=state.data.anchors.find(a=>a.node_id===$('origin').value)?.label||'Origem';
 $('position-label').textContent=state.positionSource==='qr' ? `Ponto recebido no link: ${label}. Confirme sua origem; não há rastreamento.` : state.positionSource==='confirmed' ? `Último ponto confirmado: ${label}, às ${state.confirmedAt}. Sem acompanhamento contínuo.` : `Local selecionado: ${label}. Não é uma posição detectada.`;
 $('confirm-origin').hidden=state.positionSource!=='qr';
 state.scene?.setOrigin(originNode()); render2d();
}
function renderList(){
 const query=$('search').value.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
 const all=destinations().filter(s=>(!state.serviceFilter||serviceGroups[state.serviceFilter]?.includes(s.service_type))&&(!$('category').value||s.category===$('category').value)&&`${s.name} ${s.category} ${t(s.name)} ${t(s.category)}`.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').includes(query));
 if(state.serviceFilter){all.sort((a,b)=>distOf(a)-distOf(b)||a.name.localeCompare(b.name,'pt-BR'));fetchServiceDistances(all);}
 $('count').textContent=`${all.length} ${all.length===1?'destino':'destinos'} para explorar`;
 $('store-list').innerHTML=all.slice(0,state.limit).map(s=>`<button class="store-card ${s.id===state.selected?.id?'selected':''}" data-store="${esc(s.id)}" aria-pressed="${s.id===state.selected?.id}"><span class="store-icon" aria-hidden="true">${getBrand(s.name)?`<img src="${esc(brandImageUrl(s.name))}" alt="">`:s.unit_type==='facility'?facilityIcon(s):s.event_id?'✳':esc(s.name.charAt(0))}</span><span class="store-text"><strong>${esc(s.name)}</strong><small>${esc(s.category)} · ${esc(floorName(s.floor_id))}</small>${state.serviceFilter?distBadge(s):''}</span><span class="store-arrow" aria-hidden="true">↗</span></button>`).join('') || '<p class="fine">Nenhum destino encontrado. Tente outro nome ou categoria.</p>';
 $('store-list').querySelectorAll('[data-store]').forEach(b=>b.addEventListener('click',()=>selectStore(b.dataset.store)));
 $('load-more').hidden=all.length<=state.limit;
}
// Distância a pé até serviços (WC, elevadores, escadas, família), calculada pela mesma rota do servidor.
const distCache=new Map();
const distKey=s=>`${$('origin').value}|${$('accessible').checked}|${s.node_id}`;
function distOf(s){const v=s.node_id?distCache.get(distKey(s)):null;return typeof v==='number'?v:Infinity;}
function distBadge(s){const v=s.node_id?distCache.get(distKey(s)):null;
 if(typeof v==='number')return `<small class="store-dist">≈ ${Math.round(v)} m · ${Math.max(1,Math.round(v/70))} min</small>`;
 if(v==='pending')return `<small class="store-dist muted">${esc(t('Calculando distância…'))}</small>`;
 return `<small class="store-dist muted">${esc(t('Sem percurso confirmado'))}</small>`;}
let distTicket=0;
async function fetchServiceDistances(items){
 if(!state.data||!$('origin').value)return;
 const todo=items.filter(s=>s.node_id&&!distCache.has(distKey(s))).slice(0,24);if(!todo.length)return;
 const ticket=++distTicket;todo.forEach(s=>distCache.set(distKey(s),'pending'));
 await Promise.all(todo.map(async s=>{const key=distKey(s);try{
  const res=await fetch('/api/routes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({origin:$('origin').value,destination:s.node_id,accessible:$('accessible').checked,map_version:state.data.version})});
  const out=await res.json();distCache.set(key,res.ok&&typeof out.distance==='number'?out.distance:null);
 }catch{distCache.set(key,null);}}));
 if(ticket===distTicket&&state.serviceFilter)renderList();
}
function changeFloor(id){state.floor=id;$('floor').value=id;state.scene?.setFloor(id);render2d();if(state.route)renderRoute();}
// "Como chegar" a partir de um cartão: usa o motor de rotas existente e a preferência de rota acessível atual.
function routeToStore(id){selectStore(id);if(!state.selected||state.selected.id!==id)return;if(document.body.classList.contains('totem'))document.body.classList.add('totem-detail');calculateRoute();}
function selectStore(id){
 const item=destinations().find(s=>s.id===id);if(!item)return;
 state.request++;state.selected=item;state.route=null;state.arrival=false;document.body.classList.remove('arrival-mode');status();state.scene?.setRoute([]);changeFloor(item.floor_id);state.scene?.selectStore(id);renderList();renderDetail();render2d();const heading=$('destination').querySelector('h2');heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});
}
function renderDetail(){
 const s=state.selected;if(!s)return;
 if(s.unit_type!=='facility'&&s.unit_type!=='structure') $('destination').innerHTML=`<div class="detail-head"><div class="facade ${getBrand(s.name)?'brand-facade':''}" aria-label="Ilustração conceitual, fotografia de fachada indisponível"><span class="facade-mark" aria-hidden="true">${getBrand(s.name)?`<img src="${esc(brandImageUrl(s.name))}" alt="Logomarca ${esc(s.name)}">`:s.event_id?'✳':esc(s.name)}</span><span class="facade-glass" aria-hidden="true"><i></i><i></i><i></i></span><small>FACHADA ILUSTRATIVA</small></div><div class="detail-title"><p class="eyebrow">${esc(s.category)} · ${esc(floorName(s.floor_id))}</p><h2>${esc(s.name)}</h2><p>${esc(s.hours||'Horário não informado')}</p></div></div><p class="detail-description">${esc(s.description||'Posição reconstruída da planta enviada. Cadastro comercial não verificado.')}</p><div class="detail-meta"><span>Site: ${s.website?'disponível no cadastro':'não informado'}</span><span>Telefone: ${esc(s.phone||'não informado')}</span><span>${esc(s.source_label||'Conteúdo demonstrativo')}</span>${s.external?'<span>Acesso externo</span>':''}</div><div class="detail-actions"><button id="route-button" class="primary">Traçar percurso <span aria-hidden="true">↗</span></button><button id="share-button" class="quiet">Continuar no celular</button>${s.event_id?`<a class="quiet" href="/?event=${esc(s.event_id)}">Ver evento e avaliar ↗</a>`:''}</div><div id="route-result"></div>`;
 else $('destination').innerHTML=`<div class="detail-head"><div class="facility-symbol" aria-hidden="true">${facilityIcon(s)}</div><div class="detail-title"><p class="eyebrow">${esc(s.category)} · ${esc(floorName(s.floor_id))}</p><h2>${esc(s.name)}</h2><p>Serviço e orientação no shopping</p></div></div><p class="detail-description">${esc(s.description)}</p><div class="detail-meta"><span>${esc(s.source_label)}</span>${['stairs','escalator','elevator','moving_walkway'].includes(s.service_type)?(s.connection_status==='documented_plan'?'<span>Conexão entre pisos documentada na planta</span>':'<span>Conexão entre pisos a confirmar</span>'):''}</div><div class="detail-actions"><button id="route-button" class="primary">Traçar percurso até o acesso ↗</button><button id="share-button" class="quiet">Continuar no celular</button></div><div id="route-result"></div>`;
 if(!s.node_id){$('route-button').disabled=true;$('route-button').textContent=s.external?'Acesso externo · trajeto a mapear':'Entrada a conferir';$('share-button').disabled=true;} $('route-button').addEventListener('click',calculateRoute);$('share-button').addEventListener('click',share);
 const canReview=!s.event_id&&!['facility','structure'].includes(s.unit_type);$('rate-selected').disabled=!canReview;
 if(canReview){const host=document.createElement('div');host.id='store-review-host';$('destination').append(host);mountStoreReviews(host,s);}else mountStoreReviews(null,null);
 if(state.route)renderRoute();
}
async function calculateRoute(){
 if(!state.selected)return;if(!state.selected.node_id){status('Entrada pública ainda não confirmada no desenho. Consulte a posição da loja; percurso indisponível.');return;}if(state.positionSource==='qr'){status('Confirme o ponto de partida recebido no link ou selecione outra origem antes de traçar o percurso.');$('confirm-origin').focus();return;}const ticket=++state.request;status();$('route-button').disabled=true;$('route-button').textContent='Calculando percurso…';state.route=null;state.scene?.setRoute([]);$('route-result').replaceChildren();render2d();
 try{
  const response=await fetch('/api/routes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({origin:$('origin').value,destination:state.selected.node_id,accessible:$('accessible').checked,map_version:state.data.version})});
  const result=await response.json();if(ticket!==state.request)return;if(!response.ok)throw new Error(result.error||'Não foi possível calcular o percurso.');
  state.route=result;state.arrival=true;document.body.classList.add('arrival-mode');state.scene?.setRoute(result.path);changeFloor(originNode().floor_id);renderRoute();render2d();status('Percurso calculado sobre a planta. A linha indica o caminho, não sua posição em movimento.');
 }catch(error){if(ticket===state.request)status(error.message==='Failed to fetch'?'Sem conexão com o servidor. Nenhum percurso foi confirmado.':error.message);}
 finally{if(ticket===state.request&&$('route-button')){$('route-button').disabled=false;$('route-button').innerHTML='Recalcular percurso <span aria-hidden="true">↗</span>';}}
}
function renderRoute(){
 const r=state.route;if(!r||!$('route-result'))return;
 const steps=r.floor_steps||[];
 $('route-result').innerHTML=`<div class="route-box"><div class="route-summary"><strong>Percurso · ${steps.length} ${steps.length===1?'piso':'pisos'}</strong><button id="arrival-toggle" class="quiet">${state.arrival?'Voltar a explorar':'Modo chegar'}</button></div><div class="route-floors" aria-label="Etapas do percurso">${steps.map((s,i)=>`<button class="quiet" data-route-floor="${esc(s.floor_id)}" aria-pressed="${s.floor_id===state.floor}">${i+1}. ${esc(s.name)}${s.transfer?` · ${esc(s.transfer.label)} → ${esc(s.transfer.to_name)}`:''}</button>`).join('')}</div><ol>${r.instruction_tokens?r.instruction_tokens.map(token=>`<li data-map-no-translate>${esc(formatInstruction(token))}</li>`).join(''):r.instructions.map(i=>`<li>${esc(i)}</li>`).join('')}</ol><p class="fine">Distâncias aproximadas da planta. Transições usam custo estimado, não altura medida. Origem selecionada, sem acompanhamento contínuo. ${r.accessible_requested?'Rota sem escadas neste grafo; acessibilidade física sujeita à validação local.':''} Toque nas etapas para acompanhar o percurso em cada piso.</p></div>`;
 $('route-result').querySelectorAll('[data-route-floor]').forEach(b=>b.addEventListener('click',()=>changeFloor(b.dataset.routeFloor)));
 $('arrival-toggle').addEventListener('click',()=>{state.arrival=!state.arrival;document.body.classList.toggle('arrival-mode',state.arrival);renderRoute();});
}
function render2d(){
 if(!state.data)return;
 const ns='http://www.w3.org/2000/svg',svg=$('map2d'),f=state.data.floors.find(f=>f.id===state.floor),b=f.bounds||{minX:-34,maxX:34,minZ:-23,maxZ:23};
 svg.setAttribute('viewBox',`${b.minX-3} ${b.minZ-3} ${b.maxX-b.minX+6} ${b.maxZ-b.minZ+6}`);svg.replaceChildren();
 const add=(tag,attrs,text)=>{const e=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v));if(text!==undefined)e.textContent=text;svg.append(e);return e;};
 if(f.floorplate)add('polygon',{points:f.floorplate.map(p=>p.join(',')).join(' '),fill:'#fafbf3',stroke:'#c8d3be','stroke-width':.3});
 state.data.edges.forEach(e=>{const a=node(e.from),n=node(e.to);if(a?.floor_id===state.floor&&n?.floor_id===state.floor)add('line',{x1:a.x,y1:a.z,x2:n.x,y2:n.z,stroke:'#dce4ce','stroke-width':1.6,'stroke-linecap':'round'});});
 destinations().filter(s=>s.floor_id===state.floor).forEach(s=>{
  const sel=s.id===state.selected?.id,poly=s.polygon||[[s.x-s.width/2,s.z-s.depth/2],[s.x+s.width/2,s.z-s.depth/2],[s.x+s.width/2,s.z+s.depth/2],[s.x-s.width/2,s.z+s.depth/2]];
  const attrs={fill:sel?'#d6ef89':s.color||'#c4d3b0',stroke:sel?'#345c24':'#829279','stroke-width':sel?.65:.2,tabindex:0,role:'button','aria-label':s.name,class:'map-store'};
  const e=state.data.geometry_source&&!s.polygon?.length ? add('circle',{...attrs,cx:s.x,cy:s.z,r:.8,fill:'#bd8a46'}) : add('polygon',{...attrs,points:poly.map(p=>p.join(',')).join(' ')});
  e.addEventListener('click',()=>selectStore(s.id));e.addEventListener('keydown',ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();selectStore(s.id);}});
  if(sel||s.featured||!state.data.geometry_source)add('text',{x:s.x,y:s.z,'text-anchor':'middle','font-size':Math.max(1,Math.min(3,s.width/8)),fill:'#183c2e','pointer-events':'none'},s.name);
 });
 if(state.route){const p=state.route.path;for(let i=1;i<p.length;i++){const a=p[i-1],n=p[i];if(a.floor_id===state.floor&&n.floor_id===state.floor)add('line',{x1:a.x,y1:a.z,x2:n.x,y2:n.z,stroke:'#426820','stroke-width':.65,'stroke-linecap':'round'});}}
 const o=originNode();if(o?.floor_id===state.floor){add('circle',{cx:o.x,cy:o.z,r:1.3,fill:'#fff'});add('circle',{cx:o.x,cy:o.z,r:.8,fill:'#376df4'});}
}
async function setView(view){
 state.view=view;$('view3d').setAttribute('aria-pressed',view==='3d');$('view2d').setAttribute('aria-pressed',view==='2d');$('scene3d').hidden=view!=='3d';$('map2d').toggleAttribute('hidden',view!=='2d');
 if(view==='2d'){$('map-state').textContent='Planta reconstruída · 2D';return;}
 try{if(!state.scene){$('map-state').textContent='Carregando cena 3D…';if(!state.scenePromise)state.scenePromise=import('/map3d.js').then(module=>module.createMallScene($('scene3d'),state.data,selectStore,{mascots:true,onMascot:id=>foundMascot(id)}));state.scene=await state.scenePromise;state.scene.setReducedMotion(state.reduced);state.scene.setFloor(state.floor);state.scene.setOrigin(originNode());if(state.selected)state.scene.selectStore(state.selected.id);if(state.route)state.scene.setRoute(state.route.path);}if(state.view==='3d')$('map-state').textContent='Planta reconstruída · 3D';}
 catch(error){state.scene=null;state.scenePromise=null;await setView('2d');status('O mapa 3D não está disponível neste dispositivo. Continue pela versão 2D ou pela lista.');}
}
function share(){
 if(!state.selected||!state.selected.node_id){status('Percurso indisponível até conferir a entrada desta loja.');return;}const url=new URL('/explorar.html',location.origin);url.searchParams.set('origin',$('origin').value);url.searchParams.set('destination',state.selected.id);url.searchParams.set('version',state.data.version);$('share-url').value=url.href;$('qrcode').replaceChildren();$('copy-link').textContent='Copiar link';
 const local=['127.0.0.1','localhost','[::1]'].includes(location.hostname);
 $('share-warning').textContent=local?'Demonstração local: este endereço não abre em outro celular. O QR permite testar o formato; acesso externo exige hospedagem HTTPS.':'Ao abrir, confirme seu ponto de partida. O link não acompanha o deslocamento.';
 if(window.QRCode)new window.QRCode($('qrcode'),{text:url.href,width:180,height:180,colorDark:'#173c32',colorLight:'#fffef9',correctLevel:window.QRCode.CorrectLevel.M});else $('qrcode').textContent='QR indisponível. Use o link abaixo.';
 $('share-dialog').showModal();
}
function reset(){
 const reloadForPrivacy=Boolean(document.getElementById('vlibras-script')||window.VLibrasWidget);
 window.dispatchEvent(new Event('viva:map-reset'));
 resetStoreReviewSession();mountStoreReviews(null,null);$('rate-selected').disabled=true;
 state.request++;state.selected=null;state.route=null;state.arrival=false;state.positionSource='manual';state.serviceFilter=null;document.querySelectorAll('[data-service-filter]').forEach(b=>b.setAttribute('aria-pressed','false'));state.limit=8;state.lastActivity=Date.now();state.idleStart=null;document.body.classList.remove('arrival-mode');$('search').value='';$('category').value='';$('accessible').checked=false;$('origin').selectedIndex=0;state.scene?.setRoute([]);state.scene?.selectStore(null);changeFloor(state.data.floors[0].id);updatePosition();renderList();
 $('destination').innerHTML='<div class="empty-detail"><span aria-hidden="true">↗</span><div><p class="eyebrow">UM NOVO COMEÇO</p><h2>Escolha seu próximo destino.</h2><p>O atendimento anterior foi limpo deste mapa.</p></div></div>';
 for(const dialog of [$('share-dialog'),$('idle-dialog')])if(dialog.open)dialog.close();$('qrcode').replaceChildren();$('share-url').value='';history.replaceState(null,'','/explorar.html');window.speechSynthesis?.cancel();status('Mapa reiniciado. Nenhum registro de avaliação foi apagado.');
 if(reloadForPrivacy)location.reload();
}
function activity(){if(!$('idle-dialog').open)state.lastActivity=Date.now();}
['pointerdown','keydown'].forEach(name=>document.addEventListener(name,activity,{passive:true}));
setInterval(()=>{if(!state.data)return;if(attractVisible()){state.lastActivity=Date.now();return;}if(!state.idleStart&&Date.now()-state.lastActivity>=90000){state.idleStart=Date.now();$('idle-seconds').textContent='30';if($('share-dialog').open)$('share-dialog').close();$('idle-dialog').showModal();}if(state.idleStart){const left=Math.max(0,30-Math.floor((Date.now()-state.idleStart)/1000));$('idle-seconds').textContent=left;if(left===0)reset();}},1000);
$('continue-session').addEventListener('click',()=>{state.idleStart=null;state.lastActivity=Date.now();$('idle-dialog').close();});$('idle-dialog').addEventListener('cancel',e=>{e.preventDefault();$('continue-session').click();});$('end-session').addEventListener('click',reset);$('reset').addEventListener('click',()=>state.data&&reset());
$('close-share').addEventListener('click',()=>{$('share-dialog').close();state.lastActivity=Date.now();});$('copy-link').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('share-url').value);$('copy-link').textContent='Link copiado';}catch{$('share-url').select();$('copy-link').textContent='Selecione e copie o link acima';}});
$('search').addEventListener('input',()=>{state.limit=8;renderList();});$('category').addEventListener('change',()=>{state.serviceFilter=null;document.querySelectorAll('[data-service-filter]').forEach(b=>b.setAttribute('aria-pressed','false'));state.limit=8;renderList();});$('load-more').addEventListener('click',()=>{state.limit+=8;renderList();});$('floor').addEventListener('change',()=>changeFloor($('floor').value));
$('origin').addEventListener('change',()=>{state.positionSource='manual';state.request++;updatePosition();if(state.selected)calculateRoute();});$('accessible').addEventListener('change',()=>{state.request++;if(state.selected)calculateRoute();});$('view3d').addEventListener('click',()=>setView('3d'));$('view2d').addEventListener('click',()=>setView('2d'));
$('confirm-origin').addEventListener('click',()=>{state.positionSource='confirmed';state.confirmedAt=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});updatePosition();status('Ponto de partida confirmado por você. O mapa não acompanha seu deslocamento.');});
function motion(){document.body.classList.toggle('reduced-motion',state.reduced);$('reduce-motion').setAttribute('aria-pressed',state.reduced);$('reduce-motion').textContent=state.reduced?'Movimento reduzido':'Reduzir movimento';state.scene?.setReducedMotion(state.reduced);}
$('reduce-motion').addEventListener('click',()=>{state.reduced=!state.reduced;motion();});motion();
async function init(){
 await initializeLocalization();
 import('./cards.js').then(m=>m.initCards({kiosk:KIOSK,onRoute:routeToStore})).catch(error=>console.warn('Cartões indisponíveis',error));
 import('./trio.js').then(m=>{foundMascot=m.foundMascot;m.initTrio({mount:KIOSK?document.body:document.querySelector('.map-toolbar')});}).catch(error=>console.warn('Easter egg indisponível',error));
 try{const response=await fetch('/api/navigation');if(!response.ok)throw new Error('Catálogo indisponível.');state.data=await response.json();await loadBrandLogos();state.data.stores.sort((a,b)=>Number(b.featured)-Number(a.featured)||a.name.localeCompare(b.name));state.floor=state.data.floors[0].id;
 $('floor').innerHTML=state.data.floors.map(f=>`<option value="${esc(f.id)}">${esc(f.name||f.label||f.id)}</option>`).join('');
 $('origin').innerHTML=state.data.anchors.map(a=>`<option value="${esc(a.node_id)}">${esc(a.label)}</option>`).join('');
 $('category').innerHTML='<option value="">Todas as categorias</option>'+[...new Set(destinations().map(s=>s.category))].map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
 const params=new URLSearchParams(location.search),origin=params.get('origin'),destination=params.get('destination');if(origin&&state.data.anchors.some(a=>a.node_id===origin)){$('origin').value=origin;state.positionSource='qr';}else if(origin)status('Origem do link não reconhecida. Selecione um ponto de partida.');
 if(Object.hasOwn(serviceGroups,params.get('service')))state.serviceFilter=params.get('service');
 renderList();updatePosition();if(destination){if(destinations().some(s=>s.id===destination))selectStore(destination);else status('Destino do link não encontrado. Escolha um destino na lista.');}if(params.get('version')&&params.get('version')!==state.data.version)status('O link usa uma versão anterior do mapa. O catálogo atual foi carregado; confirme a origem e solicite um novo percurso.');await setView('3d');
 }catch(error){status('Não foi possível carregar o catálogo. Verifique se o servidor está ativo e recarregue a página.');$('count').textContent='Catálogo indisponível';$('map-state').textContent='Sem conexão';}
}
window.addEventListener('viva:map-language',()=>{if(!state.data)return;renderList();updatePosition();if(state.route)renderRoute();localizeTree();});
init();


document.querySelectorAll('[data-service-filter]').forEach(b=>b.addEventListener('click',()=>{state.serviceFilter=b.dataset.serviceFilter||null;state.limit=8;$('search').value='';$('category').value='';document.querySelectorAll('[data-service-filter]').forEach(el=>el.setAttribute('aria-pressed',String(el===b)));renderList();}));

$('rate-selected').addEventListener('click',()=>{const host=$('store-review-host');if(openStoreReview(host))host.scrollIntoView({behavior:state.reduced?'instant':'smooth',block:'start'});});

// ===== Modo totem (/explorar.html?modo=totem) =====
// Só a moldura muda. Mapa 3D/2D, rotas (/api/routes), dados e avaliações seguem o fluxo normal acima.
// Observa o painel #destination em vez de alterar as funções do mapa.
if(KIOSK){
 document.body.classList.add('totem');
 const catalog=$('catalog'),dest=$('destination'),emptyDetail=dest.innerHTML;
 const callout=document.createElement('div');callout.className='totem-callout';callout.hidden=true;callout.setAttribute('role','group');
 callout.innerHTML='<button type="button" class="totem-x">×</button><div class="totem-name"><b></b><small></small></div><button type="button" class="totem-more"></button>';
 const closeBtn=document.createElement('button');closeBtn.type='button';closeBtn.className='totem-close';closeBtn.textContent='×';
 document.body.append(callout,closeBtn);
 const labels=()=>{callout.querySelector('.totem-x').setAttribute('aria-label',t('Fechar'));callout.querySelector('.totem-more').textContent=t('Toque aqui para ver mais detalhes');closeBtn.setAttribute('aria-label',t('Fechar detalhes'));};
 const openCatalog=()=>catalog.classList.add('totem-open'),closeCatalog=()=>catalog.classList.remove('totem-open');
 const showDetail=on=>{document.body.classList.toggle('totem-detail',on);if(on)dest.scrollTop=0;};
 $('search').addEventListener('focus',openCatalog);$('search').addEventListener('input',openCatalog);
 document.querySelectorAll('[data-service-filter]').forEach(b=>b.addEventListener('click',openCatalog));
 callout.querySelector('.totem-x').addEventListener('click',()=>{callout.hidden=true;});
 callout.querySelector('.totem-more').addEventListener('click',()=>{showDetail(true);dest.querySelector('h2')?.focus({preventScroll:true});});
 closeBtn.addEventListener('click',()=>{showDetail(false);if(dest.querySelector('.detail-title'))callout.hidden=false;});
 new MutationObserver(()=>{
  const title=dest.querySelector('.detail-title h2');
  if(!title){callout.hidden=true;showDetail(false);closeCatalog();return;}
  if(!document.body.classList.contains('totem-detail')){callout.querySelector('b').textContent=title.textContent;callout.querySelector('small').textContent=dest.querySelector('.detail-title .eyebrow')?.textContent||'';callout.hidden=false;closeCatalog();}
 }).observe(dest,{childList:true});
 // Zoom + / − do 2D (no 3D os controles ficam no próprio motor: zoomBy/rotateBy).
 const zoom=document.createElement('div');zoom.className='totem-zoom';zoom.setAttribute('role','group');
 zoom.innerHTML='<button type="button" data-z="in">+</button><button type="button" data-z="out">−</button>';
 document.body.append(zoom);
 let zoom2d=1;
 const step=dir=>{
  if(!$('map2d').hidden){zoom2d=Math.min(4,Math.max(1,zoom2d*(dir>0?1.35:1/1.35)));$('map2d').style.transform=`scale(${zoom2d})`;return;}
  state.scene?.zoomBy?.(dir>0?1/1.45:1.45);
 };
 zoom.addEventListener('click',e=>{const b=e.target.closest('[data-z]');if(b)step(b.dataset.z==='in'?1:-1);});
 const zoomLabels=()=>{zoom.setAttribute('aria-label',t('Zoom do mapa'));zoom.children[0].setAttribute('aria-label',t('Aproximar'));zoom.children[1].setAttribute('aria-label',t('Afastar'));};
 new MutationObserver(()=>{zoom2d=1;$('map2d').style.transform='';}).observe($('map2d'),{attributes:true,attributeFilter:['hidden']});
 const back=document.createElement('button');back.type='button';back.className='totem-back';back.hidden=true;
 back.innerHTML='<span aria-hidden="true">←</span> <span class="totem-back-label"></span>';document.body.append(back);
 const canGoBack=()=>document.body.classList.contains('totem-detail')||catalog.classList.contains('totem-open')||!!state.selected;
 const syncBack=()=>{back.hidden=!canGoBack();};
 back.addEventListener('click',()=>{
  if(document.body.classList.contains('totem-detail')){showDetail(false);if(dest.querySelector('.detail-title'))callout.hidden=false;}
  else if(catalog.classList.contains('totem-open')){closeCatalog();$('search').blur();}
  else if(state.selected){state.request++;state.selected=null;state.route=null;state.arrival=false;document.body.classList.remove('arrival-mode');state.scene?.setRoute([]);state.scene?.selectStore(null);mountStoreReviews(null,null);$('rate-selected').disabled=true;dest.innerHTML=emptyDetail;renderList();render2d();}
  syncBack();
 });
 new MutationObserver(syncBack).observe(document.body,{attributes:true,attributeFilter:['class']});
 new MutationObserver(syncBack).observe(catalog,{attributes:true,attributeFilter:['class']});
 new MutationObserver(syncBack).observe(dest,{childList:true});
 // Depois de "Como chegar": QR do percurso logo abaixo de "Avaliar esta loja" (mesmo link do botão Continuar no celular).
 let qrFor='',qrWanted=null;
 // QR só quando a pessoa toca em "Continuar no celular" (não junto com "Como chegar").
 dest.addEventListener('click',e=>{if(!e.target.closest('#share-button'))return;e.preventDefault();e.stopPropagation();const s=state.selected;if(!s?.node_id)return;qrWanted=qrWanted===s.id?null:s.id;qrFor='';syncQr();dest.querySelector('.totem-qr')?.scrollIntoView({behavior:state.reduced?'instant':'smooth',block:'nearest'});},true);
 const syncQr=()=>{
  const old=dest.querySelector('.totem-qr'),s=state.selected,ready=!!(s&&s.node_id&&qrWanted===s.id);
  if(!ready){if(old)old.remove();qrFor='';return;}
  const url=new URL('/explorar.html',location.origin);url.searchParams.set('origin',$('origin').value);url.searchParams.set('destination',s.id);url.searchParams.set('version',state.data.version);
  if(old&&qrFor===url.href)return;
  if(old)old.remove();qrFor=url.href;
  const box=document.createElement('section');box.className='totem-qr';box.setAttribute('aria-label',t('QR code do percurso'));
  box.innerHTML='<div class="totem-qr-code"></div><div><p class="eyebrow"></p><strong></strong><p class="fine"></p></div>';
  box.querySelector('.eyebrow').textContent=t('LEVE O CAMINHO COM VOCÊ');box.querySelector('strong').textContent=t('Continue no celular.');
  box.querySelector('.fine').textContent=t('O link não transfere sua sessão nem acompanha seus passos. Confirme a origem ao abrir.');
  const code=box.querySelector('.totem-qr-code');
  if(window.QRCode)new window.QRCode(code,{text:url.href,width:168,height:168,colorDark:'#173c32',colorLight:'#fffef9',correctLevel:window.QRCode.CorrectLevel.M});else code.textContent=t('QR indisponível. Use o link abaixo.');
  // Ordem pedida: Avaliar esta loja → QR → bloco do percurso.
  const rr=$('route-result'),host=$('store-review-host');
  if(rr){if(host&&(host.compareDocumentPosition(rr)&Node.DOCUMENT_POSITION_PRECEDING))rr.before(host);rr.before(box);}else if(host)host.after(box);else dest.append(box);
 };
 new MutationObserver(()=>{if(!dest.querySelector('.totem-qr')||qrFor)syncQr();}).observe(dest,{childList:true,subtree:true});
 const backLabel=()=>{back.querySelector('.totem-back-label').textContent=t('Voltar');qrFor='';syncQr();};
 window.addEventListener('viva:map-language',()=>{labels();zoomLabels();backLabel();});labels();zoomLabels();backLabel();
}

$('origin').addEventListener('change',()=>{if(state.serviceFilter)renderList();});
$('accessible').addEventListener('change',()=>{if(state.serviceFilter)renderList();});
