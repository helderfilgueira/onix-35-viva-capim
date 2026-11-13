const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state = {data:null, selected:null, route:null, scene:null, floor:null, view:'3d', limit:8, request:0, reduced:matchMedia('(prefers-reduced-motion: reduce)').matches, arrival:false, lastActivity:Date.now(), idleStart:null, positionSource:'manual'};
const eventIds = {'Praça A':'musica','Praça B':'criativa','Praça C':'sabores'};
function status(message=''){ $('status').textContent=message; }
function floorName(id){const f=state.data.floors.find(x=>x.id===id);return f?.name||f?.label||id;}
function node(id){return state.data.nodes.find(x=>x.id===id);}
function destinations(){return [...state.data.stores,...(state.data.places||[]).map(p=>({...p,category:'Experiências',description:'Espaço demonstrativo para descobrir eventos, participar e avaliar a experiência.',...{x:node(p.node_id)?.x||0,z:node(p.node_id)?.z||0},width:5,depth:4,color:'#d9f57c',hours:'Consulte a agenda',event_id:eventIds[p.event_location],review_count:0}))];}
function originNode(){return node($('origin').value);}
function updatePosition(){
 const label=$('origin').selectedOptions[0]?.textContent||'Origem';
 $('position-label').textContent=state.positionSource==='qr' ? `Ponto recebido no link: ${label}. Confirme sua origem; não há rastreamento.` : state.positionSource==='confirmed' ? `Último ponto confirmado: ${label}, às ${state.confirmedAt}. Sem acompanhamento contínuo.` : `Local selecionado: ${label}. Não é uma posição detectada.`;
 $('confirm-origin').hidden=state.positionSource!=='qr';
 state.scene?.setOrigin(originNode()); render2d();
}
function renderList(){
 const query=$('search').value.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
 const all=destinations().filter(s=>(!$('category').value||s.category===$('category').value)&&`${s.name} ${s.category}`.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').includes(query));
 $('count').textContent=`${all.length} ${all.length===1?'destino':'destinos'} para explorar`;
 $('store-list').innerHTML=all.slice(0,state.limit).map(s=>`<button class="store-card ${s.id===state.selected?.id?'selected':''}" data-store="${esc(s.id)}" aria-pressed="${s.id===state.selected?.id}"><span class="store-icon" aria-hidden="true">${s.event_id?'✳':esc(s.name.charAt(0))}</span><span class="store-text"><strong>${esc(s.name)}</strong><small>${esc(s.category)} · ${esc(floorName(s.floor_id))}</small></span><span class="store-arrow" aria-hidden="true">↗</span></button>`).join('') || '<p class="fine">Nenhum destino encontrado. Tente outro nome ou categoria.</p>';
 $('store-list').querySelectorAll('[data-store]').forEach(b=>b.addEventListener('click',()=>selectStore(b.dataset.store)));
 $('load-more').hidden=all.length<=state.limit;
}
function changeFloor(id){state.floor=id;$('floor').value=id;state.scene?.setFloor(id);render2d();}
function selectStore(id){
 const item=destinations().find(s=>s.id===id);if(!item)return;
 state.request++;state.selected=item;state.route=null;state.arrival=false;document.body.classList.remove('arrival-mode');status();state.scene?.setRoute([]);changeFloor(item.floor_id);state.scene?.selectStore(id);renderList();renderDetail();render2d();const heading=$('destination').querySelector('h2');heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});
}
function renderDetail(){
 const s=state.selected;if(!s)return;
 $('destination').innerHTML=`<div class="detail-head"><div class="facade" aria-label="Ilustração conceitual, fotografia de fachada indisponível"><span class="facade-mark" aria-hidden="true">${s.event_id?'✳':esc(s.name.charAt(0))}</span><span>VIVA CAPIM</span><small>ILUSTRAÇÃO · NÃO É FOTO</small></div><div class="detail-title"><p class="eyebrow">${esc(s.category)} · ${esc(floorName(s.floor_id))}</p><h2>${esc(s.name)}</h2><p>${esc(s.hours||'Horário não informado')}</p><p>Sem avaliações publicadas</p></div></div><p class="detail-description">${esc(s.description||'Posição reconstruída da planta enviada. Cadastro comercial não verificado.')}</p><div class="detail-meta"><span>Site: ${s.website?'disponível no cadastro':'não informado'}</span><span>Telefone: ${esc(s.phone||'não informado')}</span><span>${esc(s.source_label||'Conteúdo demonstrativo')}</span></div><div class="detail-actions"><button id="route-button" class="primary">Traçar percurso <span aria-hidden="true">↗</span></button><button id="share-button" class="quiet">Continuar no celular</button>${s.event_id?`<a class="quiet" href="/?event=${esc(s.event_id)}">Ver evento e avaliar ↗</a>`:''}</div><div id="route-result"></div>`;
 if(!s.node_id){$('route-button').disabled=true;$('route-button').textContent='Entrada a conferir';$('share-button').disabled=true;} $('route-button').addEventListener('click',calculateRoute);$('share-button').addEventListener('click',share);
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
 $('route-result').innerHTML=`<div class="route-box"><div class="route-summary"><strong>${esc(Math.round(r.distance))} m · estimativa da planta</strong><button id="arrival-toggle" class="quiet">${state.arrival?'Voltar a explorar':'Modo chegar'}</button></div><ol>${r.instructions.map(i=>`<li>${esc(i)}</li>`).join('')}</ol><p class="fine">Origem selecionada, sem acompanhamento contínuo. ${$('accessible').checked?'Sem escadas neste grafo; acessibilidade física não validada.':''} Use o seletor de pavimento para acompanhar todos os trechos.</p></div>`;
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
 try{if(!state.scene){$('map-state').textContent='Carregando cena 3D…';if(!state.scenePromise)state.scenePromise=import('/map3d.js').then(module=>module.createMallScene($('scene3d'),state.data,selectStore));state.scene=await state.scenePromise;state.scene.setReducedMotion(state.reduced);state.scene.setFloor(state.floor);state.scene.setOrigin(originNode());if(state.selected)state.scene.selectStore(state.selected.id);if(state.route)state.scene.setRoute(state.route.path);}if(state.view==='3d')$('map-state').textContent='Planta reconstruída · 3D';}
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
 state.request++;state.selected=null;state.route=null;state.arrival=false;state.positionSource='manual';state.limit=8;state.lastActivity=Date.now();state.idleStart=null;document.body.classList.remove('arrival-mode');$('search').value='';$('category').value='';$('accessible').checked=false;$('origin').selectedIndex=0;state.scene?.setRoute([]);state.scene?.selectStore(null);changeFloor(state.data.floors[0].id);updatePosition();renderList();
 $('destination').innerHTML='<div class="empty-detail"><span aria-hidden="true">↗</span><div><p class="eyebrow">UM NOVO COMEÇO</p><h2>Escolha seu próximo destino.</h2><p>O atendimento anterior foi limpo deste mapa.</p></div></div>';
 for(const dialog of [$('share-dialog'),$('idle-dialog')])if(dialog.open)dialog.close();$('qrcode').replaceChildren();$('share-url').value='';history.replaceState(null,'','/explorar.html');window.speechSynthesis?.cancel();status('Mapa reiniciado. Nenhum registro de avaliação foi apagado.');
}
function activity(){if(!$('idle-dialog').open)state.lastActivity=Date.now();}
['pointerdown','keydown'].forEach(name=>document.addEventListener(name,activity,{passive:true}));
setInterval(()=>{if(!state.data)return;if(!state.idleStart&&Date.now()-state.lastActivity>=90000){state.idleStart=Date.now();$('idle-seconds').textContent='30';if($('share-dialog').open)$('share-dialog').close();$('idle-dialog').showModal();}if(state.idleStart){const left=Math.max(0,30-Math.floor((Date.now()-state.idleStart)/1000));$('idle-seconds').textContent=left;if(left===0)reset();}},1000);
$('continue-session').addEventListener('click',()=>{state.idleStart=null;state.lastActivity=Date.now();$('idle-dialog').close();});$('idle-dialog').addEventListener('cancel',e=>{e.preventDefault();$('continue-session').click();});$('end-session').addEventListener('click',reset);$('reset').addEventListener('click',()=>state.data&&reset());
$('close-share').addEventListener('click',()=>{$('share-dialog').close();state.lastActivity=Date.now();});$('copy-link').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('share-url').value);$('copy-link').textContent='Link copiado';}catch{$('share-url').select();$('copy-link').textContent='Selecione e copie o link acima';}});
$('search').addEventListener('input',()=>{state.limit=8;renderList();});$('category').addEventListener('change',()=>{state.limit=8;renderList();});$('load-more').addEventListener('click',()=>{state.limit+=8;renderList();});$('floor').addEventListener('change',()=>changeFloor($('floor').value));
$('origin').addEventListener('change',()=>{state.positionSource='manual';state.request++;updatePosition();if(state.selected)calculateRoute();});$('accessible').addEventListener('change',()=>{state.request++;if(state.selected)calculateRoute();});$('view3d').addEventListener('click',()=>setView('3d'));$('view2d').addEventListener('click',()=>setView('2d'));
$('confirm-origin').addEventListener('click',()=>{state.positionSource='confirmed';state.confirmedAt=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});updatePosition();status('Ponto de partida confirmado por você. O mapa não acompanha seu deslocamento.');});
function motion(){document.body.classList.toggle('reduced-motion',state.reduced);$('reduce-motion').setAttribute('aria-pressed',state.reduced);$('reduce-motion').textContent=state.reduced?'Movimento reduzido':'Reduzir movimento';state.scene?.setReducedMotion(state.reduced);}
$('reduce-motion').addEventListener('click',()=>{state.reduced=!state.reduced;motion();});motion();
async function init(){
 try{const response=await fetch('/api/navigation');if(!response.ok)throw new Error('Catálogo indisponível.');state.data=await response.json();state.data.stores.sort((a,b)=>Number(b.featured)-Number(a.featured)||a.name.localeCompare(b.name));state.floor=state.data.floors[0].id;
 $('floor').innerHTML=state.data.floors.map(f=>`<option value="${esc(f.id)}">${esc(f.name||f.label||f.id)}</option>`).join('');
 $('origin').innerHTML=state.data.anchors.map(a=>`<option value="${esc(a.node_id)}">${esc(a.label)}</option>`).join('');
 $('category').innerHTML='<option value="">Todas as categorias</option>'+[...new Set(destinations().map(s=>s.category))].map(c=>`<option>${esc(c)}</option>`).join('');
 const params=new URLSearchParams(location.search),origin=params.get('origin'),destination=params.get('destination');if(origin&&state.data.anchors.some(a=>a.node_id===origin)){$('origin').value=origin;state.positionSource='qr';}else if(origin)status('Origem do link não reconhecida. Selecione um ponto de partida.');
 renderList();updatePosition();if(destination){if(destinations().some(s=>s.id===destination))selectStore(destination);else status('Destino do link não encontrado. Escolha um destino na lista.');}if(params.get('version')&&params.get('version')!==state.data.version)status('O link usa uma versão anterior do mapa. O catálogo atual foi carregado; confirme a origem e solicite um novo percurso.');await setView('3d');
 }catch(error){status('Não foi possível carregar o catálogo. Verifique se o servidor está ativo e recarregue a página.');$('count').textContent='Catálogo indisponível';$('map-state').textContent='Sem conexão';}
}
init();

