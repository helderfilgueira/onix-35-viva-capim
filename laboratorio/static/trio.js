/*
 * Easter egg "Encontre o trio". Progresso só na memória do atendimento atual (apagado por viva:map-reset).
 * Não concede pontos e não exige cadastro. Alternativa acessível: lista com os três personagens.
 */
import { t } from './map-i18n.js';
// Sprites carregados à parte: sem eles o easter egg funciona só com texto (lista acessível intacta).
let MASCOTS = [{ id: 'caio' }, { id: 'lia' }, { id: 'bento' }], spriteSheet = null, SPRITE = null;
const spritesReady = import('./map-mascots.js').then(m => { MASCOTS = m.MASCOTS; spriteSheet = m.spriteSheet; SPRITE = m.SPRITE; }).catch(() => {});

const LINES = {
  caio: 'Opa! Você achou o Caio, o mais alto do trio.',
  lia: 'Oi! Sou a Lia. Repare nos cachos e no boné azul.',
  bento: 'Fala! Bento aqui, firme na Praça de alimentação.',
};
const NAMES = { caio: 'Caio', lia: 'Lia', bento: 'Bento' };
const LOOKS = {
  caio: 'Camisa vermelha e calça jeans preta',
  lia: 'Boné azul, cabelo cacheado e casaco amarelo',
  bento: 'Camisa amarela, calça jeans e botas',
};
const found = new Set();
let chip, toast, panel, party, toastTimer = 0, partyTimer = 0;

function easter(year) { // algoritmo de Meeus/Jones/Butcher (calendário gregoriano)
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}
export function theme(now = new Date()) {
  const forced = new URLSearchParams(location.search).get('tema');
  if (['natal', 'ano-novo', 'pascoa', 'padrao'].includes(forced)) return forced;
  const m = now.getMonth() + 1, d = now.getDate();
  if ((m === 12 && d >= 26) || (m === 1 && d <= 6)) return 'ano-novo';
  if (m === 12) return 'natal';
  const e = easter(now.getFullYear()), diff = (new Date(now.getFullYear(), now.getMonth(), d) - e) / 864e5;
  if (diff >= -7 && diff <= 1) return 'pascoa';
  return 'padrao';
}
const THEME_TEXT = {
  natal: ['Feliz Natal!', 'Vocês encontraram o trio do Capim. Boas festas!'],
  'ano-novo': ['Feliz Ano Novo!', 'Trio completo! Que o novo ano traga ótimos encontros.'],
  pascoa: ['Feliz Páscoa!', 'Trio completo! Obrigado por explorar o Capim.'],
  padrao: ['Trio completo!', 'Você encontrou os três. Obrigado por explorar o Capim.'],
};

function avatar(m, scale = 3) {
  if (!spriteSheet || !m || !m.colors) return null;
  const c = document.createElement('canvas'); c.width = SPRITE.W * scale; c.height = SPRITE.H * scale; c.setAttribute('aria-hidden', 'true');
  const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.drawImage(spriteSheet(m, scale), 0, 0, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}
function paintChip() {
  chip.querySelector('.trio-label').textContent = t('Encontre o trio');
  chip.querySelector('.trio-count').textContent = `${found.size}/3`;
  chip.setAttribute('aria-label', `${t('Encontre o trio')}: ${found.size} ${t('de')} 3`);
  if (panel?.open) paintPanel();
}
function paintPanel() {
  panel.querySelector('h2').textContent = t('Encontre o trio');
  panel.querySelector('.trio-help').textContent = t('Três personagens fictícios passeiam pelo mapa. Toque neles no 3D ou use esta lista. Um deles está na Praça de alimentação. Não vale pontos.');
  panel.querySelector('.trio-close').setAttribute('aria-label', t('Fechar'));
  panel.querySelectorAll('[data-m]').forEach(li => {
    const id = li.dataset.m, ok = found.has(id);
    li.querySelector('.trio-name').textContent = NAMES[id];
    li.querySelector('.trio-look').textContent = t(LOOKS[id]);
    const b = li.querySelector('button'); b.textContent = ok ? t('Encontrado') : t('Cumprimentar'); b.disabled = ok; b.setAttribute('aria-label', `${ok ? t('Encontrado') : t('Cumprimentar')} ${NAMES[id]}`);
  });
}
function say(id) {
  const text = document.createElement('span'); text.className = 'trio-toast-text'; text.textContent = `${t(LINES[id])} (${found.size}/3)`;
  let pic = null; try { pic = avatar(MASCOTS.find(m => m.id === id), 2); } catch { /* sem sprite: só o texto */ }
  toast.replaceChildren(...(pic ? [pic, text] : [text]));
  toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 4200);
}
function celebrate() {
  const th = theme(), [title, text] = THEME_TEXT[th];
  party.className = `trio-party ${th}`;
  party.querySelector('h2').textContent = t(title); party.querySelector('p').textContent = t(text);
  party.querySelector('.trio-party-close').textContent = t('Continuar explorando');
  const row = party.querySelector('.trio-party-row'); row.replaceChildren(...MASCOTS.map((m, i) => { const c = avatar(m, 4); if (c) c.style.animationDelay = `${i * 120}ms`; return c; }).filter(Boolean));
  if (panel.open) panel.close();                                  // celebração nunca fica atrás do painel
  party.showModal(); party.querySelector('.trio-party-close').focus({ preventScroll: true });
  clearTimeout(partyTimer); partyTimer = setTimeout(() => { if (party.open) party.close(); }, 12000); // fechar devolve o foco
}
export function foundMascot(id) {
  if (!NAMES[id]) return;
  const isNew = !found.has(id); found.add(id); paintChip(); say(id);
  if (isNew && found.size === 3) setTimeout(celebrate, 600);
}
function reset() { found.clear(); toast.hidden = true; clearTimeout(partyTimer); if (party.open) party.close(); if (panel.open) panel.close(); paintChip(); }

export function initTrio({ mount } = {}) {
  chip = document.createElement('button'); chip.type = 'button'; chip.className = 'trio-chip'; chip.dataset.mapNoTranslate = '';
  chip.innerHTML = '<span aria-hidden="true">★</span> <span class="trio-label"></span> <b class="trio-count"></b>';
  (mount || document.body).append(chip);
  toast = document.createElement('div'); toast.className = 'trio-toast'; toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite'); toast.hidden = true; toast.dataset.mapNoTranslate = '';
  toast.innerHTML = '<span class="trio-toast-text"></span>'; document.body.append(toast);
  panel = document.createElement('dialog'); panel.className = 'trio-panel'; panel.dataset.mapNoTranslate = ''; panel.setAttribute('aria-labelledby', 'trio-title');
  panel.innerHTML = `<button type="button" class="trio-close">×</button><h2 id="trio-title"></h2><p class="trio-help"></p><ul>${MASCOTS.map(m => `<li data-m="${m.id}"><span class="trio-av"></span><span class="trio-who"><strong class="trio-name"></strong><small class="trio-look"></small></span><button type="button"></button></li>`).join('')}</ul>`;
  document.body.append(panel);
  panel.querySelectorAll('[data-m]').forEach(li => li.querySelector('button').addEventListener('click', () => foundMascot(li.dataset.m)));
  spritesReady.then(() => panel.querySelectorAll('[data-m]').forEach(li => { const a = avatar(MASCOTS.find(m => m.id === li.dataset.m), 2); if (a) li.querySelector('.trio-av').replaceChildren(a); }));
  panel.querySelector('.trio-close').addEventListener('click', () => panel.close());
  panel.addEventListener('close', () => chip.focus({ preventScroll: true }));
  party = document.createElement('dialog'); party.className = 'trio-party'; party.dataset.mapNoTranslate = ''; party.setAttribute('aria-labelledby', 'trio-party-title');
  party.innerHTML = '<div class="trio-party-card"><div class="trio-confetti" aria-hidden="true"></div><div class="trio-party-row" aria-hidden="true"></div><h2 id="trio-party-title"></h2><p></p><button type="button" class="trio-party-close"></button></div>';
  document.body.append(party);
  party.querySelector('.trio-party-close').addEventListener('click', () => party.close());
  party.addEventListener('close', () => { clearTimeout(partyTimer); chip.focus({ preventScroll: true }); });
  chip.addEventListener('click', () => { paintPanel(); panel.showModal(); });
  window.addEventListener('viva:map-language', () => { paintChip(); if (panel.open) paintPanel(); });
  window.addEventListener('viva:map-reset', reset);
  paintChip();
}
