/*
 * Modo totem explícito + tela de atração "Toque para iniciar".
 * - ?modo=totem liga o modo neste aparelho (localStorage 'viva-kiosk'); ?modo=site desliga.
 * - Visitantes do site comum nunca veem a tela (o modo só existe no aparelho configurado).
 * - Links diretos (?destination, ?origin, ?service) pulam a tela na abertura.
 * - No totem, "viva:map-reset" (novo atendimento/inatividade) volta para a tela inicial.
 * Mascotes da tela são decorativos (aria-hidden, fora da ordem de foco).
 */
import { t, setLocale, getLocale } from './map-i18n.js';

const KEY = 'viva-kiosk';
export function isKiosk() {
  const mode = new URLSearchParams(location.search).get('modo');
  try {
    if (mode === 'totem') localStorage.setItem(KEY, '1');
    if (mode === 'site') localStorage.removeItem(KEY);
    return mode === 'totem' || (mode !== 'site' && localStorage.getItem(KEY) === '1');
  } catch { return mode === 'totem'; }
}
const deepLink = () => { const q = new URLSearchParams(location.search); return ['destination', 'origin', 'service'].some(k => q.get(k)); };
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('reduced-motion');

let layer = null;
function build() {
  layer = document.createElement('section');
  layer.className = 'attract'; layer.id = 'attract'; layer.setAttribute('aria-labelledby', 'attract-title'); layer.dataset.mapNoTranslate = '';
  layer.innerHTML = `
    <div class="attract-glow" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="attract-content">
      <div class="attract-brand"><span class="attract-mark" aria-hidden="true">v</span><span>viva<b>capim</b></span></div>
      <h1 id="attract-title"></h1>
      <p class="attract-sub"></p>
      <button type="button" class="attract-start"><span class="attract-pulse" aria-hidden="true"></span><span class="attract-start-label"></span></button>
      <div class="attract-langs" role="group"><button type="button" data-l="pt-BR" lang="pt-BR">PT</button><button type="button" data-l="en" lang="en">EN</button><button type="button" data-l="es" lang="es">ES</button></div>
      <p class="attract-note"></p>
    </div>
    <div class="attract-parade" aria-hidden="true"></div>`;
  document.body.append(layer);
  layer.querySelector('.attract-start').addEventListener('click', start);
  layer.addEventListener('pointerdown', e => { if (e.target === layer || e.target.closest('.attract-glow,.attract-parade')) start(); });
  layer.querySelectorAll('[data-l]').forEach(b => b.addEventListener('click', () => { setLocale(b.dataset.l); label(); }));
  window.addEventListener('viva:map-language', label);
  label();
  // Mascotes decorativos: se a geração falhar, a tela continua utilizável.
  import('./map-mascots.js').then(({ MASCOTS, spriteSheet, SPRITE }) => {
    const parade = layer.querySelector('.attract-parade');
    MASCOTS.forEach((m, i) => {
      const scale = 4, url = spriteSheet(m, scale).toDataURL('image/png');
      const w = document.createElement('div'); w.className = 'walker'; w.dataset.i = i;
      w.style.setProperty('--sheet', `url(${url})`); w.style.setProperty('--fw', `${SPRITE.W * scale}px`); w.style.setProperty('--fh', `${SPRITE.H * scale}px`);
      w.style.setProperty('--row', i === 1 ? 2 : 3); w.style.setProperty('--dur', `${[19, 26, 23][i]}s`); w.style.setProperty('--delay', `${[-3, -15, -9][i]}s`);
      w.style.setProperty('--lane', `${[0, 1, 2][i]}`); if (i === 1) w.classList.add('rtl');
      parade.append(w);
    });
  }).catch(() => {});
}
function label() {
  if (!layer) return;
  layer.querySelector('#attract-title').textContent = t('Toque para iniciar');
  layer.querySelector('.attract-sub').textContent = t('Encontre lojas, serviços e eventos do Shopping Capim Dourado.');
  layer.querySelector('.attract-start-label').textContent = t('Iniciar');
  layer.querySelector('.attract-start').setAttribute('aria-label', t('Toque para iniciar'));
  layer.querySelector('.attract-langs').setAttribute('aria-label', t('Idioma'));
  layer.querySelector('.attract-note').textContent = t('Mapa interativo · sem cadastro e sem acompanhar você');
  const loc = getLocale(); layer.querySelectorAll('[data-l]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.l === loc)));
}
// Enquanto a tela inicial está visível, o restante fica inerte (o foco não escapa), exceto Libras.
const KEEP = '#libras-launcher,[vw],.vw-plugin-wrapper,[data-libras]';
function setInert(on) { for (const el of document.body.children) if (el !== layer && !el.matches(KEEP) && el.tagName !== 'SCRIPT') { if (on) el.setAttribute('inert', ''); else el.removeAttribute('inert'); } }
function show() {
  if (!layer) build();
  setInert(true);
  layer.hidden = false; layer.classList.toggle('still', reducedMotion());
  document.body.classList.add('attract-on');
  requestAnimationFrame(() => layer.querySelector('.attract-start')?.focus({ preventScroll: true }));
}
function start() {
  if (!layer || layer.hidden) return;
  document.body.classList.remove('attract-on'); setInert(false);
  layer.classList.add('leaving');
  const done = () => { layer.hidden = true; layer.classList.remove('leaving'); };
  if (reducedMotion()) done(); else setTimeout(done, 260);
  window.dispatchEvent(new CustomEvent('viva:attract-start'));
  // Foco sem efeito colateral: no totem, focar a busca abriria a gaveta e cobriria o mapa.
  setTimeout(() => {
    const target = document.querySelector('.cards-dock:not([hidden]) .card.top .card-open') || document.querySelector('.topbar .brand') || document.getElementById('search');
    target?.focus({ preventScroll: true });
  }, reducedMotion() ? 0 : 280);
}
export function initAttract() {
  if (!isKiosk()) return false;
  document.body.classList.add('kiosk');
  if (!deepLink()) show();
  // Novo atendimento no totem: idioma volta ao padrão para o próximo visitante.
  window.addEventListener('viva:map-reset', () => { if (getLocale() !== 'pt-BR') setLocale('pt-BR'); show(); });
  return true;
}
export const attractVisible = () => !!layer && !layer.hidden;
