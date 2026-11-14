let active=null;
const texts={
 'pt-BR':{title:'Avaliações e fidelidade',insufficient:'Ainda não há cinco avaliações para publicar a média.',action:'Avaliar esta loja ★',note:'Avaliação opcional. Pontos somente para adesões ativas, conforme regras do programa. Saldo e resgate no balcão.',failure:'Não foi possível carregar as avaliações.',average:'Média',count:'avaliações'},
 en:{title:'Reviews and rewards',insufficient:'At least five reviews are needed to publish an average.',action:'Review this store ★',note:'Reviews are optional. Points are available for active memberships under program rules. Balance and redemption at the counter.',failure:'Reviews could not be loaded.',average:'Average',count:'reviews'},
 es:{title:'Opiniones y puntos',insufficient:'Se necesitan cinco opiniones para publicar la media.',action:'Valorar esta tienda ★',note:'La valoración es opcional. Puntos para miembros activos según las reglas. Saldo y canje en el mostrador.',failure:'No se pudieron cargar las opiniones.',average:'Media',count:'opiniones'}
};
function locale(){const lang=document.documentElement.lang;return ['en','es'].includes(lang)?lang:'pt-BR'}
function element(tag,text,cls){const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e}
function target(store){const u=new URL('/public/review.html',location.origin);u.searchParams.set('target_type','store');u.searchParams.set('target_id',store.id);u.searchParams.set('lang',locale());return u.href}
export function mountStoreReviews(host,store){
 if(active){active.abort.abort();active.host.replaceChildren();active=null}
 if(!host||!store||store.event_id||['facility','structure'].includes(store.unit_type))return null;
 const t=texts[locale()]||texts['pt-BR'],abort=new AbortController(),inst={host,store,abort};active=inst;
 const box=element('section','','route-box'),h=element('h3',t.title),summary=element('p',t.insufficient),link=element('a',t.action,'primary'),note=element('p',t.note,'fine');link.href=target(store);summary.setAttribute('aria-live','polite');box.append(h,summary,link,note);host.append(box);
 fetch('/api/v2/public/ratings?target_type=store&target_id='+encodeURIComponent(store.id),{signal:abort.signal,cache:'no-store'}).then(async r=>{if(!r.ok)throw Error();return r.json()}).then(d=>{if(active!==inst)return;const v=d.items?.find(x=>x.target_id===store.id)||d;if(Number.isFinite(v.average)&&v.count>=5)summary.textContent=`★ ${t.average}: ${new Intl.NumberFormat(locale(),{minimumFractionDigits:1,maximumFractionDigits:1}).format(v.average)} / 5 · ${v.count} ${t.count}`}).catch(e=>{if(active===inst&&e.name!=='AbortError')summary.textContent=t.failure});
 return{open:()=>openStoreReview(host),destroy:()=>mountStoreReviews(null,null)}
}
export function openStoreReview(host){if(!active||(host&&host!==active.host))return false;location.assign(target(active.store));return true}
export function resetStoreReviewSession(){try{sessionStorage.removeItem('viva-store-session');sessionStorage.removeItem('viva-session')}catch{}}

window.addEventListener('viva:map-language',()=>{if(active){const {host,store}=active;mountStoreReviews(host,store)}});
