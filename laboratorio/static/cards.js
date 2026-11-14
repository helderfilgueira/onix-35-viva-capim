/*
 * Cartões de anúncios/eventos: pilha compacta e diálogo de detalhe acessível.
 * Conteúdo vem de /api/v2/public/cards (piloto). Se a API não existir, falhar ou estiver vazia,
 * o módulo simplesmente não aparece: o mapa nunca depende dele.
 * Sem troca automática de cartões. Nenhum dado pessoal: o QR leva só à página pública do evento.
 */
import { t, getLocale } from './map-i18n.js';

const API = '/api/v2/public/cards';
const TZ = 'America/Araguaina';
let root, stackEl, dialog, items = [], active = 0, opener = null, options = {}, loadSeq = 0, collapsed = false;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('reduced-motion');

function when(ev) {
  if (!ev) return '';
  const loc = getLocale(), s = new Date(ev.starts), e = new Date(ev.ends);
  if (ev.all_day) {
    const d = new Intl.DateTimeFormat(loc, { timeZone: TZ, day: 'numeric', month: 'long' }).format(s);
    return `${d} · ${t('dia inteiro')}`;
  }
  const day = new Intl.DateTimeFormat(loc, { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(s);
  const hm = x => new Intl.DateTimeFormat(loc, { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(x);
  return `${day} · ${hm(s)}–${hm(e)}`;
}
const stateLabel = s => ({ ongoing: t('Acontecendo agora'), ended: t('Encerrado'), cancelled: t('Cancelado') }[s] || '');

function build() {
  root = document.createElement('section');
  root.className = 'cards-dock'; root.setAttribute('aria-labelledby', 'cards-title'); root.dataset.mapNoTranslate = ''; root.hidden = true;
  root.innerHTML = `<header class="cards-head"><h2 id="cards-title"></h2><span class="cards-count" aria-live="polite"></span>
    <button type="button" class="cards-toggle" aria-expanded="true" aria-controls="cards-body"></button></header>
    <div class="cards-body" id="cards-body"><div class="cards-stack" role="list"></div>
    <div class="cards-nav"><button type="button" class="cards-prev"><span aria-hidden="true">‹</span></button><button type="button" class="cards-next"><span aria-hidden="true">›</span></button></div></div>`;
  stackEl = root.querySelector('.cards-stack');
  root.querySelector('.cards-prev').addEventListener('click', () => go(-1));
  root.querySelector('.cards-next').addEventListener('click', () => go(1));
  root.querySelector('.cards-toggle').addEventListener('click', () => { collapsed = !collapsed; paintChrome(); });
  stackEl.addEventListener('keydown', e => { if (e.key === 'ArrowRight') { e.preventDefault(); go(1); } if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); } });
  const mount = options.kiosk ? document.body : (document.querySelector('.event-strip') || document.querySelector('main'));
  if (options.kiosk) mount.append(root); else mount.after(root);
  dialog = document.createElement('dialog');
  dialog.className = 'card-dialog'; dialog.dataset.mapNoTranslate = ''; dialog.setAttribute('aria-labelledby', 'card-dialog-title');
  document.body.append(dialog);
  dialog.addEventListener('close', () => { dialog.replaceChildren(); opener?.focus({ preventScroll: true }); opener = null; });
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
}
function paintChrome() {
  root.querySelector('#cards-title').textContent = t('Acontece no Capim');
  root.querySelector('.cards-count').textContent = items.length > 1 ? `${active + 1}/${items.length}` : '';
  const tg = root.querySelector('.cards-toggle'); tg.textContent = collapsed ? t('Mostrar') : t('Recolher'); tg.setAttribute('aria-expanded', String(!collapsed));
  root.classList.toggle('collapsed', collapsed); root.querySelector('.cards-body').hidden = collapsed;
  root.querySelector('.cards-prev').setAttribute('aria-label', t('Cartão anterior')); root.querySelector('.cards-next').setAttribute('aria-label', t('Próximo cartão'));
  root.querySelector('.cards-nav').hidden = items.length < 2;
}
function render() {
  stackEl.replaceChildren(...items.map((c, i) => {
    const el = document.createElement('article'); el.className = 'card'; el.setAttribute('role', 'listitem'); el.dataset.i = i;
    const ev = c.event, badge = ev && ev.state !== 'scheduled' ? `<span class="card-state ${esc(ev.state)}">${esc(stateLabel(ev.state))}</span>` : '';
    el.innerHTML = `<button type="button" class="card-open">${c.image_url ? `<img src="${esc(c.image_url)}" alt="${esc(c.image_alt || '')}" loading="lazy" decoding="async">` : `<span class="card-fallback" aria-hidden="true">${esc((c.title || '?')[0])}</span>`}
      <span class="card-text">${badge}<strong>${esc(c.title)}</strong><small>${esc(ev ? when(ev) : (c.place ? `${c.place.name} · ${t(c.place.floor_name)}` : ''))}</small>${c.reward_points ? `<em>+${c.reward_points} ${esc(t('pts na campanha'))}</em>` : ''}</span></button>`;
    const img = el.querySelector('img');
    img?.addEventListener('error', () => { const f = document.createElement('span'); f.className = 'card-fallback'; f.setAttribute('role', 'img'); f.setAttribute('aria-label', c.image_alt || c.title); f.textContent = (c.title || '?')[0]; img.replaceWith(f); }, { once: true });
    el.querySelector('.card-open').addEventListener('click', e => openDetail(i, e.currentTarget));
    return el;
  }));
  layout(); paintChrome();
}
function layout() {
  const n = items.length;
  [...stackEl.children].forEach((el, i) => {
    const k = (i - active + n) % n;                 // 0 = topo da pilha
    el.style.setProperty('--k', k); el.style.zIndex = String(10 - k);
    el.classList.toggle('top', k === 0); el.hidden = k > 2;
    const b = el.querySelector('.card-open'); b.tabIndex = k === 0 ? 0 : -1; el.setAttribute('aria-hidden', String(k !== 0));
  });
  root.classList.toggle('still', reduced());
}
function go(d) { if (items.length < 2) return; active = (active + d + items.length) % items.length; layout(); paintChrome(); stackEl.querySelector('.card.top .card-open')?.focus({ preventScroll: true }); }

function openDetail(i, from) {
  const c = items[i]; if (!c) return; opener = from;
  const ev = c.event, place = c.place, open_ = ev && ['scheduled', 'ongoing'].includes(ev.state);
  dialog.innerHTML = `<div class="cd-wrap">
    <button type="button" class="cd-close" aria-label="${esc(t('Fechar'))}">×</button>
    ${c.image_url ? `<img class="cd-img" src="${esc(c.image_url)}" alt="${esc(c.image_alt || '')}">` : ''}
    ${ev && ev.state !== 'scheduled' ? `<span class="card-state ${esc(ev.state)}">${esc(stateLabel(ev.state))}</span>` : ''}
    <h2 id="card-dialog-title">${esc(c.title)}</h2>
    ${c.description ? `<p class="cd-desc">${esc(c.description)}</p>` : ''}
    <dl class="cd-meta">
      ${ev ? `<dt>${esc(t('Quando'))}</dt><dd>${esc(when(ev))}</dd>` : ''}
      ${place ? `<dt>${esc(t('Onde'))}</dt><dd>${esc(place.name)} · ${esc(t(place.floor_name))}</dd>` : ''}
    </dl>
    ${place && !place.route_available ? `<p class="cd-warn">${esc(t('Este local ainda não tem percurso confirmado no mapa. Peça orientação a um funcionário.'))}</p>` : ''}
    <div class="cd-actions">
      ${place && place.route_available ? `<button type="button" class="cd-route">${esc(t('Como chegar'))}</button>` : ''}
      ${open_ ? `<button type="button" class="cd-cal" aria-expanded="false" aria-controls="cd-qr">${esc(t('Adicionar à agenda'))}</button>` : ''}
    </div>
    ${open_ ? `<section class="cd-qr" id="cd-qr" hidden><div class="cd-qr-code"></div><div><strong>${esc(t('Leve o evento no celular'))}</strong>
      <p>${esc(t('Escaneie o QR: a página do evento oferece Google Agenda e arquivo .ics. Você confirma na sua própria agenda.'))}</p>
      <a class="cd-link" href="${esc(ev.url)}?lang=${esc(getLocale())}" target="_blank" rel="noopener">${esc(t('Abrir página do evento'))}</a></div></section>` : ''}
    ${c.reward_points ? `<section class="cd-campaign"><strong>${esc(t('Campanha de pontos'))}</strong>
      <p>${esc(t('Confirme seu interesse nesta campanha para receber 5 pontos, conforme as regras.'))}</p>
      <p class="cd-small">${esc(t('A confirmação é feita no balcão de atendimento, com um atendente. Este totem não pede telefone.'))}</p></section>` : ''}
  </div>`;
  dialog.querySelector('.cd-img')?.addEventListener('error', e => e.currentTarget.remove(), { once: true }); // título continua visível
  dialog.querySelector('.cd-close').addEventListener('click', () => dialog.close());
  dialog.querySelector('.cd-route')?.addEventListener('click', () => { dialog.close(); options.onRoute?.(place.id); });
  dialog.querySelector('.cd-cal')?.addEventListener('click', e => {
    const box = dialog.querySelector('.cd-qr'), show = box.hidden; box.hidden = !show; e.currentTarget.setAttribute('aria-expanded', String(show));
    const code = box.querySelector('.cd-qr-code');
    if (show && !code.childElementCount) {
      const url = new URL(ev.url, location.origin); url.searchParams.set('lang', getLocale());
      code.setAttribute('role', 'img'); code.setAttribute('aria-label', t('QR code da página do evento'));
      if (window.QRCode) new window.QRCode(code, { text: url.href, width: 168, height: 168, colorDark: '#173c32', colorLight: '#fffef9', correctLevel: window.QRCode.CorrectLevel.M });
      else code.textContent = t('QR indisponível. Use o link abaixo.');
    }
  });
  dialog.showModal();
  dialog.querySelector('.cd-close').focus({ preventScroll: true });
}

export async function loadCards() {
  const seq = ++loadSeq;
  try {
    const r = await fetch(`${API}?locale=${encodeURIComponent(getLocale())}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    const data = await r.json();
    if (seq !== loadSeq) return;
    items = Array.isArray(data.items) ? data.items : []; active = Math.min(active, Math.max(0, items.length - 1));
  } catch { if (seq === loadSeq) items = []; }
  if (!root) return;
  root.hidden = !items.length;
  if (items.length) render();
}
export function initCards(opts = {}) {
  options = opts; build();
  if (opts.kiosk && innerHeight < 900) collapsed = true; // telas baixas: começa recolhido para não cobrir as barras
  window.addEventListener('viva:map-language', () => { if (dialog.open) dialog.close(); loadCards(); });
  window.addEventListener('viva:map-reset', () => { if (dialog.open) dialog.close(); active = 0; collapsed = false; loadCards(); });
  setInterval(() => { if (!document.hidden && !dialog.open) loadCards(); }, 300000); // vigência pode expirar
  loadCards();
}
