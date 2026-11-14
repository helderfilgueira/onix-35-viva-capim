// Viva Capim: avaliações locais de lojas (protótipo HackaRun, aviso store-review-v1).
// Participação opcional, identificador pseudônimo próprio desta finalidade, sem texto livre.
// O token fica só em sessionStorage 'viva-store-session' e no cabeçalho X-Session-Token;
// nunca em URL, nunca em log, nunca reaproveitado do fluxo de eventos ('viva-session').
'use strict';

const TOKEN_KEY = 'viva-store-session';
const NOTICE = 'store-review-v1';
const MIN_PUBLIC = 5;
const REASONS = [
  ['atendimento', 'Atendimento'],
  ['produtos', 'Produtos'],
  ['ambiente', 'Ambiente'],
  ['acessibilidade', 'Acessibilidade'],
  ['outro', 'Outro aspecto'],
];
const INSUFFICIENT = 'Ainda não há amostra suficiente para publicar a média';

const instances = new WeakMap();
let active = null;
let sequence = 0;
let memoryToken = '';
// Progresso conhecido do token atual (check-ins e comprovantes desta aba). Zerado quando o token muda.
const progress = { token: '', checkins: new Set(), receipts: new Map(), expired: false };

/* ---------- token ---------- */
function readToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return memoryToken; }
}
function writeToken(token) {
  memoryToken = token;
  try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* armazenamento indisponível: mantém só em memória */ }
}
function clearToken() {
  memoryToken = '';
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* nada a limpar */ }
  resetProgress('');
}
function resetProgress(token) {
  progress.token = token;
  progress.checkins = new Set();
  progress.receipts = new Map();
  progress.expired = false;
}
function progressFor(token) {
  if (progress.token !== token) resetProgress(token);
  return progress;
}

/* ---------- utilidades ---------- */
function isRetailStore(store) {
  if (!store || typeof store !== 'object') return false;
  if (typeof store.id !== 'string' || !store.id.trim()) return false;
  if (typeof store.name !== 'string' || !store.name.trim()) return false;
  if (store.unit_type === 'facility' || store.unit_type === 'structure') return false;
  if (store.kind === 'event' || store.type === 'event' || 'starts' in store || 'event_id' in store) return false;
  return true;
}

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'hidden') node.hidden = true;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) if (child !== null && child !== undefined) node.append(child);
  return node;
}

function ensureStylesheet() {
  if (document.querySelector('link[data-store-reviews-css], link[href$="store-reviews.css"]')) return;
  const link = h('link', { rel: 'stylesheet', href: '/store-reviews.css', 'data-store-reviews-css': true });
  document.head.append(link);
}

function reducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'paused';
}

class ApiError extends Error {
  constructor(status, message, data) { super(message); this.status = status; this.data = data; }
}

async function api(path, { method = 'GET', body, token, signal } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['X-Session-Token'] = token;
  let response;
  try {
    response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal, cache: 'no-store', credentials: 'same-origin' });
  } catch (error) {
    if (error && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'Sem conexão com o servidor local. Nada foi registrado nesta tentativa; tente novamente.', null);
  }
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) {
    const message = data && typeof data.error === 'string' ? data.error : 'Não foi possível concluir (código ' + response.status + ').';
    throw new ApiError(response.status, message, data);
  }
  if (!data || typeof data !== 'object') throw new ApiError(response.status, 'Resposta inesperada do servidor.', null);
  return data;
}

function alreadyCheckedIn(error) {
  if (!(error instanceof ApiError) || error.status !== 409) return false;
  const d = error.data || {};
  return d.already_checked_in === true || d.code === 'already_checked_in' || /já confirmou uma visita/i.test(error.message);
}
function alreadyReviewed(error) {
  if (!(error instanceof ApiError) || error.status !== 409) return false;
  const d = error.data || {};
  return d.already_reviewed === true || d.code === 'already_reviewed' || /já avaliou/i.test(error.message);
}

function formatAverage(value) {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
function starWord(n) { return n === 1 ? 'estrela' : 'estrelas'; }

/* ---------- montagem ---------- */
function isElement(node) { return typeof Element !== 'undefined' && node instanceof Element; }

function teardown(inst) {
  if (!inst) return;
  inst.alive = false;
  inst.controller.abort();
  inst.host.replaceChildren();
  delete inst.host.dataset.storeReviews;
  instances.delete(inst.host);
  if (active === inst) active = null;
}

export function mountStoreReviews(hostElement, store) {
  if (!isElement(hostElement)) {
    teardown(active);
    return null;
  }
  teardown(instances.get(hostElement));
  if (active && active.host !== hostElement) teardown(active);
  if (!isRetailStore(store)) {
    hostElement.replaceChildren();
    return null;
  }
  ensureStylesheet();
  const inst = {
    id: 'vsr' + (++sequence),
    host: hostElement,
    store: { id: store.id, name: store.name.trim() },
    controller: new AbortController(),
    alive: true,
    busy: false,
    submitted: false,
    els: {},
  };
  instances.set(hostElement, inst);
  active = inst;
  hostElement.dataset.storeReviews = 'mounted';
  build(inst);
  loadRating(inst);
  return { storeId: inst.store.id, open: () => openStoreReview(hostElement), destroy: () => teardown(inst) };
}

export function openStoreReview(hostElement) {
  const inst = isElement(hostElement) ? instances.get(hostElement) : active;
  if (!inst || !inst.alive) return false;
  setFormOpen(inst, true);
  return true;
}

export function resetStoreReviewSession() {
  // Encerramento da sessão do totem (novo visitante/inatividade): apaga só o acesso local.
  // Registros no servidor permanecem até a exclusão pelo titular ou o fim da retenção de 30 dias.
  clearToken();
  if (active && active.alive) {
    const { host, store } = active;
    mountStoreReviews(host, store);
  }
}

function live(inst) { return inst.alive && active === inst; }

function build(inst) {
  const { id, store } = inst;
  const on = (node, type, fn) => node.addEventListener(type, fn, { signal: inst.controller.signal });
  const els = inst.els;

  /* resumo */
  els.summaryStars = h('span', { className: 'vsr-summary-stars', 'aria-hidden': 'true' },
    h('span', { className: 'vsr-stars-outline', text: '★★★★★' }),
    h('span', { className: 'vsr-stars-fill', text: '★★★★★' }));
  els.summaryText = h('p', { className: 'vsr-summary-text', text: 'Consultando avaliações locais…' });
  els.summaryRetry = h('button', { type: 'button', className: 'vsr-link', hidden: true, text: 'Tentar novamente' });
  const summary = h('div', { className: 'vsr-summary', role: 'status', 'aria-live': 'polite' }, els.summaryStars, h('div', {}, els.summaryText, els.summaryRetry));

  const formId = id + '-form';
  els.cta = h('button', { type: 'button', className: 'vsr-cta', 'aria-expanded': 'false', 'aria-controls': formId, text: 'Avaliar esta loja' });

  /* estrelas */
  const scoreName = id + '-score';
  els.starGroup = h('div', { className: 'vsr-stars', 'data-score': '' });
  els.scoreInputs = [];
  for (let i = 1; i <= 5; i++) {
    const input = h('input', { type: 'radio', name: scoreName, value: String(i), id: id + '-s' + i });
    els.scoreInputs.push(input);
    els.starGroup.append(h('label', { className: 'vsr-star', for: id + '-s' + i },
      input, h('span', { className: 'vsr-star-face', 'aria-hidden': 'true', text: '★' }),
      h('span', { className: 'vsr-sr', text: i + ' ' + starWord(i) })));
  }
  els.scoreText = h('p', { className: 'vsr-score-text', 'aria-live': 'polite', text: 'Nenhuma nota selecionada.' });
  const starsFieldset = h('fieldset', { className: 'vsr-fieldset' },
    h('legend', { text: 'Sua nota para ' + store.name }), els.starGroup,
    h('div', { className: 'vsr-scale', 'aria-hidden': 'true' }, h('span', { text: '1 · Precisa melhorar' }), h('span', { text: '5 · Excelente' })),
    els.scoreText);

  /* aspecto */
  const reasonName = id + '-reason';
  els.reasonInputs = [];
  const reasonWrap = h('div', { className: 'vsr-chips' });
  for (const [value, label] of REASONS) {
    const input = h('input', { type: 'radio', name: reasonName, value, id: id + '-r-' + value });
    els.reasonInputs.push(input);
    reasonWrap.append(h('label', { className: 'vsr-chip', for: id + '-r-' + value }, input, h('span', { text: label })));
  }
  const reasonFieldset = h('fieldset', { className: 'vsr-fieldset' }, h('legend', { text: 'O que mais influenciou sua nota?' }), reasonWrap);

  /* visita autodeclarada */
  els.visit = h('input', { type: 'checkbox', id: id + '-visit' });
  const visitLabel = h('label', { className: 'vsr-check', for: id + '-visit' }, els.visit,
    h('span', {}, h('strong', { text: 'Confirmo que visitei esta loja' }),
      h('small', { text: 'Autodeclaração. Não comprova presença física e não usa localização.' })));

  /* consentimento */
  els.consentArea = h('div', { className: 'vsr-consent' });

  els.error = h('div', { className: 'vsr-error', role: 'alert', 'aria-live': 'assertive' });
  els.submit = h('button', { type: 'submit', className: 'vsr-submit', text: 'Enviar avaliação' });
  els.close = h('button', { type: 'button', className: 'vsr-secondary', text: 'Fechar' });
  els.receipt = h('div', { className: 'vsr-receipt', role: 'status', 'aria-live': 'polite', tabindex: '-1', hidden: true });

  els.formTitle = h('h4', { className: 'vsr-form-title', id: id + '-form-title', tabindex: '-1', text: 'Avaliar ' + store.name });
  els.form = h('form', { className: 'vsr-form', id: formId, 'aria-labelledby': id + '-form-title', novalidate: true, hidden: true },
    els.formTitle,
    h('p', { className: 'vsr-intro', text: 'Participação opcional, sem cadastro. Nada é enviado até você tocar em “Enviar avaliação”. Ao encerrar a sessão deste totem (novo visitante ou inatividade), o acesso local ao seu identificador é apagado deste aparelho; antes disso, você pode baixar seus registros e o comprovante.' }),
    starsFieldset, reasonFieldset, visitLabel, els.consentArea, els.error,
    h('div', { className: 'vsr-actions' }, els.submit, els.close),
    els.receipt);

  /* direitos */
  els.rightsStatus = h('p', { className: 'vsr-rights-status', role: 'status', 'aria-live': 'polite' });
  els.export = h('button', { type: 'button', className: 'vsr-secondary', text: 'Baixar meus registros' });
  els.delete = h('button', { type: 'button', className: 'vsr-secondary vsr-danger', text: 'Excluir meus registros' });
  els.restart = h('button', { type: 'button', className: 'vsr-secondary', hidden: true, text: 'Iniciar nova participação' });
  els.confirmText = h('p', { className: 'vsr-confirm-text' });
  els.confirmYes = h('button', { type: 'button', className: 'vsr-submit vsr-danger-solid' });
  els.confirmNo = h('button', { type: 'button', className: 'vsr-secondary', text: 'Cancelar' });
  els.confirm = h('div', { className: 'vsr-confirm', role: 'group', 'aria-label': 'Confirmação', hidden: true }, els.confirmText,
    h('div', { className: 'vsr-actions' }, els.confirmYes, els.confirmNo));
  els.rights = h('section', { className: 'vsr-rights', 'aria-labelledby': id + '-rights-title', hidden: true },
    h('h4', { id: id + '-rights-title', text: 'Seus dados de avaliação de lojas' }),
    h('p', { text: 'Registros pseudônimos desta sessão: aceite, visitas autodeclaradas, notas e aspectos. Retenção de até 30 dias. Exporte ou exclua quando quiser enquanto este acesso existir.' }),
    h('div', { className: 'vsr-actions' }, els.export, els.delete, els.restart), els.confirm, els.rightsStatus);

  const root = h('section', { className: 'vsr', 'aria-labelledby': id + '-title' },
    h('header', { className: 'vsr-head' },
      h('p', { className: 'vsr-eyebrow', text: 'Avaliações locais · demonstração' }),
      h('h3', { className: 'vsr-title', id: id + '-title', text: store.name })),
    summary,
    els.cta,
    els.form,
    els.rights,
    h('p', { className: 'vsr-note', text: 'Notas registradas apenas neste protótipo local do Viva Capim, separadas de avaliações do Google ou de outras plataformas externas. Nenhuma nota é importada ou simulada; a média só aparece com pelo menos 5 avaliações.' }));
  inst.host.replaceChildren(root);

  /* eventos */
  on(els.cta, 'click', () => setFormOpen(inst, true));
  on(els.close, 'click', () => setFormOpen(inst, false));
  on(els.form, 'keydown', event => { if (event.key === 'Escape') { event.preventDefault(); setFormOpen(inst, false); } });
  on(els.starGroup, 'change', () => syncScore(inst));
  on(els.form, 'submit', event => submit(inst, event));
  on(els.summaryRetry, 'click', () => loadRating(inst));
  on(els.export, 'click', () => exportRecords(inst));
  on(els.delete, 'click', () => askConfirm(inst, 'delete'));
  on(els.restart, 'click', () => askConfirm(inst, 'restart'));
  on(els.confirmNo, 'click', () => closeConfirm(inst, true));
  on(els.confirmYes, 'click', () => runConfirm(inst));

  renderConsent(inst);
  renderRights(inst);
  const token = readToken();
  const receipt = token ? progressFor(token).receipts.get(store.id) : null;
  if (receipt) showSubmitted(inst, receipt, false);
}

function setFormOpen(inst, open) {
  const { els } = inst;
  els.form.hidden = !open;
  els.cta.setAttribute('aria-expanded', String(open));
  els.cta.hidden = open;
  if (open) {
    renderConsent(inst);
    els.form.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    els.formTitle.focus({ preventScroll: true });
  } else {
    els.cta.focus({ preventScroll: true });
  }
}

function syncScore(inst) {
  const checked = inst.els.scoreInputs.find(input => input.checked);
  const score = checked ? Number(checked.value) : 0;
  inst.els.starGroup.dataset.score = score ? String(score) : '';
  inst.els.scoreText.textContent = score ? 'Nota selecionada: ' + score + ' de 5 ' + starWord(score) + '.' : 'Nenhuma nota selecionada.';
}

function renderConsent(inst) {
  const { els, id } = inst;
  const token = readToken();
  if (token) {
    // Aceite já registrado no servidor para este token de finalidade específica; não marcamos checkbox automaticamente.
    els.consent = null;
    els.consentArea.replaceChildren(h('p', { className: 'vsr-consent-note', text: 'Seu aceite do aviso store-review-v1 já está registrado nesta sessão do totem. Você ainda precisa confirmar a visita a esta loja.' }));
    return;
  }
  const previous = els.consent && els.consent.checked;
  els.consent = h('input', { type: 'checkbox', id: id + '-consent' });
  els.consent.checked = Boolean(previous);
  els.consentArea.replaceChildren(h('label', { className: 'vsr-check vsr-consent-check', for: id + '-consent' }, els.consent,
    h('span', {}, h('strong', { text: 'Aceito participar voluntariamente (aviso store-review-v1).' }),
      h('small', { text: 'Será criado um identificador pseudônimo temporário, válido por 24 horas para participar, separado do usado em eventos. Ele fica vinculado à visita autodeclarada, à nota e ao aspecto escolhido nesta loja. Os registros ficam guardados por até 30 dias e você pode baixá-los ou excluí-los enquanto tiver este acesso. Não coletamos nome, CPF, telefone, e-mail, localização nem texto livre. Não há prêmio nem benefício condicionado à nota.' }))));
}

function renderRights(inst) {
  const token = readToken();
  inst.els.rights.hidden = !token;
  inst.els.restart.hidden = !(token && progress.token === token && progress.expired);
  if (!token) closeConfirm(inst, false);
}

function setError(inst, message) { inst.els.error.textContent = message || ''; }

function setBusy(inst, busy) {
  inst.busy = busy;
  inst.els.submit.disabled = busy || inst.submitted;
  inst.els.submit.textContent = busy ? 'Enviando…' : inst.submitted ? 'Avaliação já registrada' : 'Enviar avaliação';
  inst.els.form.setAttribute('aria-busy', String(busy));
}

function lockForm(inst) {
  for (const input of [...inst.els.scoreInputs, ...inst.els.reasonInputs, inst.els.visit]) input.disabled = true;
  if (inst.els.consent) inst.els.consent.disabled = true;
}

function showSubmitted(inst, receipt, announce) {
  inst.submitted = true;
  lockForm(inst);
  setBusy(inst, false);
  const { els } = inst;
  els.receipt.hidden = false;
  els.receipt.replaceChildren(
    h('strong', { text: 'Avaliação registrada nesta demonstração.' }),
    h('span', { text: 'Comprovante: ' + receipt }),
    h('small', { text: 'Guarde ou baixe seus registros antes de encerrar a sessão do totem.' }));
  els.cta.textContent = 'Ver minha avaliação';
  if (announce) els.receipt.focus({ preventScroll: true });
}

/* ---------- média pública ---------- */
async function loadRating(inst) {
  const { els, store } = inst;
  const request = inst.ratingRequest = (inst.ratingRequest || 0) + 1;
  els.summaryRetry.hidden = true;
  els.summaryText.textContent = 'Consultando avaliações locais…';
  setSummaryFill(inst, null);
  try {
    const data = await api('/api/store-ratings?store_id=' + encodeURIComponent(store.id), { signal: inst.controller.signal });
    if (!live(inst) || request !== inst.ratingRequest || data.store_id !== store.id) return;
    const threshold = Math.max(MIN_PUBLIC, Number.isInteger(data.threshold) ? data.threshold : MIN_PUBLIC);
    const published = typeof data.average === 'number' && Number.isFinite(data.average) && data.average >= 1 && data.average <= 5
      && Number.isInteger(data.count) && data.count >= threshold;
    if (published) {
      setSummaryFill(inst, data.average);
      els.summaryText.textContent = 'Média local ' + formatAverage(data.average) + ' de 5 · ' + data.count + ' avaliações registradas neste protótipo (sessões, não pessoas únicas).';
    } else {
      els.summaryText.textContent = INSUFFICIENT + ' (mínimo de ' + threshold + ' avaliações locais).';
    }
  } catch (error) {
    if (!live(inst) || request !== inst.ratingRequest || (error && error.name === 'AbortError')) return;
    els.summaryText.textContent = 'Não foi possível consultar a média local agora. ' + (error.message || '');
    els.summaryRetry.hidden = false;
  }
}

function setSummaryFill(inst, average) {
  const fill = inst.els.summaryStars.querySelector('.vsr-stars-fill');
  fill.style.width = average === null ? '0%' : Math.max(0, Math.min(100, (average / 5) * 100)) + '%';
  inst.els.summaryStars.classList.toggle('is-published', average !== null);
}

/* ---------- envio ---------- */
async function submit(inst, event) {
  event.preventDefault();
  if (inst.busy || inst.submitted) return;
  const { els, store } = inst;
  setError(inst, '');
  const checkedScore = els.scoreInputs.find(input => input.checked);
  const checkedReason = els.reasonInputs.find(input => input.checked);
  const score = checkedScore ? Number(checkedScore.value) : 0;
  const reason = checkedReason ? checkedReason.value : '';
  let token = readToken();
  const problems = [];
  let firstInvalid = null;
  if (!Number.isInteger(score) || score < 1 || score > 5) { problems.push('escolha de 1 a 5 estrelas'); firstInvalid = firstInvalid || els.scoreInputs[0]; }
  if (!REASONS.some(([value]) => value === reason)) { problems.push('escolha o aspecto que mais influenciou'); firstInvalid = firstInvalid || els.reasonInputs[0]; }
  if (!els.visit.checked) { problems.push('marque “Confirmo que visitei esta loja”'); firstInvalid = firstInvalid || els.visit; }
  if (!token && !(els.consent && els.consent.checked)) { problems.push('leia e marque o aceite voluntário do aviso store-review-v1'); firstInvalid = firstInvalid || els.consent; }
  if (problems.length) {
    setError(inst, 'Para enviar: ' + problems.join('; ') + '.');
    firstInvalid?.focus();
    return;
  }
  if (token && progressFor(token).expired) {
    setError(inst, 'Sua sessão de avaliação expirou. Baixe ou exclua seus registros abaixo e toque em “Iniciar nova participação” para avaliar novamente.');
    renderRights(inst);
    return;
  }
  setBusy(inst, true);
  try {
    if (!token) {
      const session = await api('/api/session', { method: 'POST', body: { consent: true, notice: NOTICE } });
      if (typeof session.token !== 'string' || !session.token) throw new ApiError(0, 'O servidor não devolveu um identificador válido. Nada foi avaliado.', null);
      token = session.token;
      writeToken(token);
      resetProgress(token);
      if (!live(inst)) return;
      renderConsent(inst);
      renderRights(inst);
    }
    const state = progressFor(token);
    if (!state.checkins.has(store.id)) {
      try {
        const checkin = await api('/api/store-checkins', { method: 'POST', token, body: { store_id: store.id, visited: true } });
        if (checkin.checked_in !== true) throw new ApiError(0, 'O servidor não confirmou a visita autodeclarada. Nada foi avaliado.', checkin);
      } catch (error) {
        if (!alreadyCheckedIn(error)) throw error;
      }
      state.checkins.add(store.id);
    }
    if (!live(inst)) return;
    const result = await api('/api/store-reviews', { method: 'POST', token, body: { store_id: store.id, score, reason } });
    if (typeof result.receipt !== 'string' || !result.receipt) throw new ApiError(0, 'O servidor não devolveu comprovante; a avaliação não foi confirmada. Baixe seus registros para conferir.', result);
    state.receipts.set(store.id, result.receipt);
    if (!live(inst)) return;
    showSubmitted(inst, result.receipt, true);
    renderRights(inst);
    loadRating(inst);
  } catch (error) {
    if (!live(inst)) return;
    if (error instanceof ApiError && error.status === 401 && token) {
      progressFor(token).expired = true;
      setError(inst, 'Sua sessão de avaliação expirou (24 horas) ou foi encerrada. Seus registros anteriores continuam disponíveis para baixar ou excluir abaixo. Para avaliar de novo, toque em “Iniciar nova participação”.');
      renderRights(inst);
    } else if (alreadyReviewed(error)) {
      inst.submitted = true;
      lockForm(inst);
      setError(inst, 'Esta sessão já avaliou esta loja. Uma avaliação por sessão e loja. Você pode baixar seus registros abaixo.');
      renderRights(inst);
    } else {
      setError(inst, (error && error.message) || 'Não foi possível enviar a avaliação. Nada foi confirmado; tente novamente.');
    }
  } finally {
    if (live(inst)) setBusy(inst, false);
  }
}

/* ---------- direitos ---------- */
async function exportRecords(inst) {
  const token = readToken();
  const { els } = inst;
  if (!token) { els.rightsStatus.textContent = 'Não há sessão de avaliação de lojas ativa neste totem.'; return; }
  els.export.disabled = true;
  els.rightsStatus.textContent = 'Preparando seus registros…';
  try {
    const data = await api('/api/me', { token });
    if (!live(inst)) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: 'viva-capim-avaliacoes-lojas.json' });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    const total = Array.isArray(data.store_reviews) ? data.store_reviews.length : 0;
    els.rightsStatus.textContent = 'Arquivo preparado com os registros desta sessão (' + total + ' ' + (total === 1 ? 'avaliação de loja' : 'avaliações de lojas') + ').';
  } catch (error) {
    if (!live(inst)) return;
    if (error instanceof ApiError && error.status === 401) {
      progressFor(token).expired = true;
      renderRights(inst);
      els.rightsStatus.textContent = 'Não encontramos registros para este identificador: podem ter sido excluídos ou eliminados após 30 dias. Você pode iniciar uma nova participação.';
    } else {
      els.rightsStatus.textContent = 'Não foi possível exportar agora. ' + (error.message || '') + ' Seu acesso foi mantido; tente novamente.';
    }
  } finally {
    if (live(inst)) els.export.disabled = false;
  }
}

function askConfirm(inst, action) {
  const { els } = inst;
  inst.pendingAction = action;
  if (action === 'delete') {
    els.confirmText.textContent = 'Excluir definitivamente desta base local a sessão de avaliação de lojas: aceite, visitas autodeclaradas, notas e comprovantes. As médias agregadas podem mudar. Esta ação não pode ser desfeita.';
    els.confirmYes.textContent = 'Sim, excluir meus registros';
  } else {
    els.confirmText.textContent = 'Iniciar nova participação descarta deste totem o acesso ao identificador anterior. Os registros antigos não serão apagados e não poderão mais ser exportados ou excluídos por aqui; eles serão eliminados ao fim da retenção de 30 dias. Baixe ou exclua antes, se quiser.';
    els.confirmYes.textContent = 'Descartar acesso anterior';
  }
  els.confirm.hidden = false;
  els.confirmNo.focus();
}

function closeConfirm(inst, restoreFocus) {
  const { els } = inst;
  const action = inst.pendingAction;
  inst.pendingAction = null;
  els.confirm.hidden = true;
  if (restoreFocus) (action === 'restart' ? els.restart : els.delete).focus();
}

async function runConfirm(inst) {
  const action = inst.pendingAction;
  if (action === 'restart') {
    closeConfirm(inst, false);
    clearToken();
    const { host, store } = inst;
    mountStoreReviews(host, store);
    const next = instances.get(host);
    if (next) {
      setFormOpen(next, true);
      next.els.rightsStatus.textContent = '';
      setError(next, '');
    }
    return;
  }
  if (action !== 'delete') return;
  const token = readToken();
  const { els } = inst;
  if (!token) { closeConfirm(inst, false); els.rightsStatus.textContent = 'Não há sessão de avaliação de lojas ativa neste totem.'; return; }
  els.confirmYes.disabled = true;
  els.rightsStatus.textContent = 'Excluindo seus registros…';
  try {
    const result = await api('/api/me', { method: 'DELETE', token });
    if (result.deleted !== true) throw new ApiError(0, 'O servidor não confirmou a exclusão. Seu acesso foi mantido.', result);
    clearToken();
    if (!inst.alive) return;
    const { host, store } = inst;
    mountStoreReviews(host, store);
    const next = instances.get(host);
    if (next) {
      next.els.cta.focus({ preventScroll: true });
      next.els.summaryText.parentElement.after(h('p', { className: 'vsr-done', role: 'status', text: 'Sessão e registros de avaliação de lojas excluídos desta base. Você pode continuar explorando sem cadastro.' }));
    }
  } catch (error) {
    if (!live(inst)) return;
    els.confirmYes.disabled = false;
    if (error instanceof ApiError && error.status === 401) {
      progressFor(token).expired = true;
      closeConfirm(inst, false);
      renderRights(inst);
      els.rightsStatus.textContent = 'Não encontramos registros para este identificador: podem já ter sido excluídos ou eliminados após 30 dias.';
    } else {
      els.rightsStatus.textContent = 'A exclusão não foi concluída. ' + (error.message || '') + ' Seu acesso foi mantido; tente novamente.';
    }
  }
}
