/* Viva Capim — staff dashboard (vanilla JS, no dependencies).
 * Security notes:
 *  - All dynamic text is inserted with textContent / text nodes. No innerHTML with data.
 *  - Session lives in an HttpOnly cookie; only the CSRF token is kept in memory.
 *  - Only the language preference is stored in localStorage.
 *  - Hiding sections is a convenience; every API call handles 401/403 itself.
 */
'use strict';
(() => {
  const DICT = window.VC_DASH_I18N || {};
  const LANGS = ['pt-BR', 'en', 'es'];
  const LANG_KEY = 'vc.dashboard.lang';
  const PAGE_SIZE = 15;
  const LIST_CAP = 250; // backend returns at most 250 most recent records per list
  const ROLES = ['admin', 'partner', 'cashier'];

  const state = {
    lang: initialLang(),
    csrf: '',
    user: null,
    renderSeq: 0,
    orgs: null,
    stores: null,
    firstRender: true,
    lastSection: null,
  };

  /* ------------------------------------------------------------------ i18n */
  function initialLang() {
    let saved = null;
    try { saved = localStorage.getItem(LANG_KEY); } catch (_) { /* storage blocked */ }
    if (LANGS.includes(saved)) return saved;
    const nav = String(navigator.language || 'pt-BR').toLowerCase();
    if (nav.startsWith('es')) return 'es';
    if (nav.startsWith('en')) return 'en';
    return 'pt-BR';
  }
  function t(key, vars) {
    let s = (DICT[state.lang] || {})[key];
    if (s == null) s = (DICT['pt-BR'] || {})[key];
    if (s == null) s = key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
    return s;
  }
  function applyStaticI18n() {
    document.documentElement.lang = state.lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-lang-select]').forEach((sel) => { sel.value = state.lang; });
    const toggle = $('#login-toggle-pw');
    if (toggle) toggle.textContent = t(toggle.getAttribute('aria-pressed') === 'true' ? 'login.hidePassword' : 'login.showPassword');
  }
  function setLang(lang) {
    if (!LANGS.includes(lang) || lang === state.lang) return;
    state.lang = lang;
    try { localStorage.setItem(LANG_KEY, lang); } catch (_) { /* ignore */ }
    applyStaticI18n();
    if (state.user) { renderShell(); route(); }
    announce(t('lang.changed'));
  }

  /* ------------------------------------------------------------- formatting */
  const fmt = {
    num(v) { return (v == null || v === '' || Number.isNaN(Number(v))) ? '—' : new Intl.NumberFormat(state.lang).format(Number(v)); },
    avg(v) { return v == null ? '—' : new Intl.NumberFormat(state.lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v); },
    date(v) {
      if (!v) return '—';
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return String(v);
      return new Intl.DateTimeFormat(state.lang, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
    },
    range(a, b) {
      if (!a && !b) return t('common.noPeriod');
      return fmt.date(a) + ' → ' + fmt.date(b);
    },
  };
  function tzName() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) { return ''; }
  }
  const pad = (n) => String(n).padStart(2, '0');
  function toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function fromLocalInput(v) {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const a = Math.abs(off);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
  }

  /* ------------------------------------------------------------------ DOM */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const PROP_KEYS = new Set(['value', 'checked', 'disabled', 'hidden', 'selected', 'required', 'multiple', 'readOnly', 'open', 'colSpan', 'htmlFor', 'tabIndex']);
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = String(v);
        else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (PROP_KEYS.has(k)) el[k] = v;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    appendKids(el, kids);
    return el;
  }
  function appendKids(el, kids) {
    for (const kid of kids) {
      if (kid == null || kid === false) continue;
      if (Array.isArray(kid)) appendKids(el, kid);
      else if (kid instanceof Node) el.appendChild(kid);
      else el.appendChild(document.createTextNode(String(kid)));
    }
  }
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    content: 'M4 5h16v14H4zM4 9h16M8 3v4M16 3v4M8 13h5M8 16h8',
    store: 'M3 9l2-5h14l2 5M4 9v11h16V9M3 9h18M9 20v-6h6v6',
    star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z',
    counter: 'M3 6h18v12H3zM3 10h18M7 15h4',
    gift: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7C10 3 6 4 7.5 7M12 7c2-4 6-3 4.5 0',
    receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
    users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-4-6.3',
    account: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
    map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
    logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
    lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
    alert: 'M12 3l10 18H2zM12 10v5M12 18v.5',
    inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5',
    check: 'M5 12l5 5L20 7',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  };
  function icon(name, cls) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    if (cls) svg.setAttribute('class', cls);
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', ICONS[name] || ICONS.inbox);
    svg.appendChild(path);
    return svg;
  }
  function announce(msg) {
    const el = $('#announcer');
    el.textContent = '';
    window.setTimeout(() => { el.textContent = msg; }, 30);
  }
  function toast(msg, kind) {
    const box = $('#toasts');
    const close = h('button', { type: 'button', 'aria-label': t('common.close'), text: '×' });
    const el = h('div', { class: 'toast' + (kind === 'error' ? ' toast--error' : '') }, icon(kind === 'error' ? 'alert' : 'check'), h('span', { text: msg }), close);
    const remove = () => el.remove();
    close.addEventListener('click', remove);
    box.appendChild(el);
    window.setTimeout(remove, kind === 'error' ? 9000 : 5000);
  }

  /* ------------------------------------------------------------------ API */
  class ApiError extends Error {
    constructor(status, code, serverMessage) {
      super(serverMessage || code || String(status));
      this.status = status;
      this.code = code || '';
      this.serverMessage = serverMessage || '';
    }
  }
  function cookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }
  async function api(method, path, payload, opts) {
    const o = opts || {};
    const init = { method, credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' };
    if (method !== 'GET') {
      init.headers['Content-Type'] = 'application/json';
      init.headers['X-CSRFToken'] = state.csrf || cookie('csrftoken');
      init.body = JSON.stringify(payload || {});
    }
    let res;
    try {
      res = await fetch('/api/v2' + path, init);
    } catch (_) {
      throw new ApiError(0, 'network');
    }
    let data = null;
    if ((res.headers.get('content-type') || '').includes('application/json')) {
      try { data = await res.json(); } catch (_) { data = null; }
    }
    if (!res.ok) {
      const err = new ApiError(res.status, data && data.code, data && data.error);
      // A rejected CSRF check happens before any processing, so one silent retry is safe.
      if (res.status === 403 && err.code === 'csrf' && !o.retried && method !== 'GET') {
        try { await refreshSession(); } catch (_) { throw err; }
        return api(method, path, payload, { ...o, retried: true });
      }
      if (res.status === 401 && !o.noAuthRedirect) handleExpired();
      throw err;
    }
    if (data === null) throw new ApiError(res.status, 'invalid_response');
    return data;
  }
  async function refreshSession() {
    const s = await api('GET', '/session', null, { noAuthRedirect: true });
    state.csrf = s.csrf_token || '';
    return s;
  }

  // Exact backend messages (Portuguese) mapped to translatable keys.
  const SERVER_MESSAGES = {
    'Sessão de segurança inválida. Atualize a página.': 'srv.csrf',
    'Entre na conta da equipe.': 'srv.authRequired',
    'Conta sem acesso ao piloto.': 'srv.noProfile',
    'Acesso suspenso.': 'srv.suspended',
    'Acesso exclusivo da administração.': 'srv.adminOnly',
    'Perfil de balcão não edita conteúdo.': 'srv.cashierNoEdit',
    'Registro não encontrado.': 'srv.notFound',
    'Credenciais inválidas.': 'srv.badCredentials',
    'Muitas tentativas. Aguarde e tente novamente.': 'srv.rateLimited',
    'Selecione uma organização ativa.': 'srv.selectOrg',
    'Não é possível mudar a organização.': 'srv.orgImmutable',
    'Destino deve usar HTTPS.': 'srv.https',
    'Máximo três descobertas.': 'srv.maxDiscoveries',
    'Identificadores de descobertas repetidos.': 'srv.dupDiscoveries',
    'Título obrigatório.': 'srv.titleRequired',
    'Período inválido.': 'srv.badPeriod',
    'Local obrigatório.': 'srv.locationRequired',
    'Local ocupado neste período.': 'srv.locationBusy',
    'Custo deve ser positivo.': 'srv.costPositive',
    'Loja já vinculada.': 'srv.storeLinked',
    'Loja não encontrada.': 'srv.storeNotFound',
    'Organização obrigatória.': 'srv.orgRequired',
    'Perfil inválido.': 'srv.badRole',
    'Você não pode desativar a própria conta.': 'srv.selfDeactivate',
    'Confirme a maioridade declarada.': 'srv.confirmAdult',
    'Saldo existente: confirme a renúncia expressa para encerrar.': 'srv.forfeitRequired',
    'Telefone inválido.': 'srv.badPhone',
    'Cadastro ativo não encontrado.': 'srv.memberNotActive',
    'Cadastro não encontrado.': 'srv.memberNotFound',
    'Benefício não encontrado.': 'srv.benefitNotFound',
    'Chave já usada em outra operação.': 'srv.keyReused',
    'Benefício não está disponível.': 'srv.benefitUnavailable',
    'Benefício sem estoque.': 'srv.noStock',
    'Saldo insuficiente.': 'srv.insufficient',
    'Resgate não encontrado.': 'srv.redemptionNotFound',
    'Cadastro encerrado: estorno exige atendimento específico.': 'srv.reverseClosed',
    'Adicione título e descrição em inglês e espanhol antes de aprovar.': 'srv.needTranslations',
    'Defina validade de início e fim.': 'srv.needValidity',
    'O período já terminou.': 'srv.periodEnded',
    'Imagem exige texto alternativo nos três idiomas.': 'srv.imageAlt',
    'Campanha exige três descobertas.': 'srv.needThreeDiscoveries',
    'Traduza as três descobertas.': 'srv.translateDiscoveries',
    'Imagem excede 300KB.': 'srv.imageTooBig',
    'Imagem inválida ou excede 300KB.': 'srv.imageTooBig',
    'Use imagem PNG, JPEG ou WebP em data URL.': 'srv.imageType',
    'Imagem inválida.': 'srv.imageInvalid',
    'Operação duplicada ou conflito de dados.': 'srv.conflict',
    'Serviço ocupado. Tente novamente com a mesma chave da operação.': 'srv.busy',
    'Dados inválidos.': 'srv.invalid',
    'Campos inválidos.': 'srv.invalid',
    'JSON inválido.': 'srv.invalid',
    'Informe data ISO com fuso horário.': 'srv.isoDate',
    'Método não permitido.': 'srv.invalid',
    'Recurso não encontrado.': 'srv.notFound',
  };
  function errorTitle(err) {
    if (!(err instanceof ApiError)) return t('err.unexpected');
    if (err.status === 0) return t('err.network');
    if (err.status === 401) return t('err.unauthenticated');
    if (err.status === 403) return t('err.forbidden');
    if (err.status === 404) return t('err.notFound');
    if (err.status === 409) return t('err.conflict');
    if (err.status === 413) return t('err.tooLarge');
    if (err.status === 429) return t('err.rateLimited');
    if (err.status >= 500) return t('err.server');
    return t('err.invalid');
  }
  function errorDetail(err) {
    if (!(err instanceof ApiError) || !err.serverMessage) return '';
    const key = SERVER_MESSAGES[err.serverMessage];
    if (key) return t(key);
    return err.serverMessage; // untranslated server text (e.g. password validator messages)
  }
  function errorText(err) {
    const d = errorDetail(err);
    return d ? errorTitle(err) + ' ' + d : errorTitle(err);
  }
  function handleExpired() {
    if (!state.user) return;
    state.user = null;
    resetCaches();
    closeAllDialogs();
    showLogin(t('err.sessionExpired'));
  }
  function resetCaches() {
    state.orgs = null;
    state.stores = null;
    counter = freshCounter();
  }

  async function loadOrgs(force) {
    if (state.orgs && !force) return state.orgs;
    const data = await api('GET', '/organizations');
    state.orgs = Array.isArray(data.items) ? data.items : [];
    return state.orgs;
  }
  async function loadStores() {
    if (state.stores) return state.stores;
    const res = await fetch('/api/navigation', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!res.ok) throw new ApiError(res.status, 'navigation');
    const data = await res.json();
    state.stores = (Array.isArray(data.stores) ? data.stores : [])
      .filter((s) => s && s.id && !['facility', 'structure'].includes(s.unit_type))
      .map((s) => ({ id: String(s.id), name: String(s.name || s.id) }))
      .sort((a, b) => a.name.localeCompare(b.name, state.lang));
    return state.stores;
  }
  const orgName = (id) => {
    if (id == null) return '—';
    const o = (state.orgs || []).find((x) => x.id === id);
    return o ? o.name : '#' + id;
  };
  const isAdmin = () => state.user && state.user.role === 'admin';
  const role = () => (state.user ? state.user.role : null);

  /* --------------------------------------------------------- UI primitives */
  function badge(status, labelKeyPrefix) {
    const known = ['approved', 'pending', 'paused', 'active', 'suspended', 'closed', 'redeemed', 'reversed', 'inactive'];
    const cls = known.includes(status) ? status : 'neutral';
    const key = (labelKeyPrefix || 'status.') + status;
    const label = t(key) === key ? String(status || '—') : t(key);
    return h('span', { class: 'badge badge--' + cls, text: label });
  }
  function pageHead(title, lead, actions) {
    return h('div', { class: 'page-head' },
      h('div', null, h('h1', { id: 'page-title', tabindex: '-1', text: title }), lead ? h('p', { text: lead }) : null),
      actions && actions.length ? h('div', { class: 'page-actions' }, actions) : null);
  }
  function btn(label, opts) {
    const o = opts || {};
    const b = h('button', { type: o.type || 'button', class: 'btn ' + (o.cls || 'btn--secondary') + (o.sm ? ' btn--sm' : ''), disabled: !!o.disabled, 'aria-label': o.aria || null, 'aria-describedby': o.describedBy || null }, o.icon ? icon(o.icon) : null, h('span', { text: label }));
    if (o.onClick) b.addEventListener('click', o.onClick);
    return b;
  }
  function setBusy(button, busy, busyLabel) {
    if (!button) return;
    if (busy) {
      button.dataset.label = button.textContent;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', { text: busyLabel || t('common.saving') }));
    } else {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      if (button.dataset.label != null) button.replaceChildren(h('span', { text: button.dataset.label }));
    }
  }
  function loadingState(label) {
    return h('div', { class: 'loading-row', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', { text: label || t('state.loading') }));
  }
  function emptyState(title, text, action) {
    return h('div', { class: 'state' }, h('div', { class: 'state-icon' }, icon('inbox')), h('h3', { text: title }), text ? h('p', { text }) : null, action || null);
  }
  function errorState(err, retry) {
    const forbidden = err instanceof ApiError && err.status === 403;
    const detail = errorDetail(err);
    return h('div', { class: 'state state--error', role: 'alert' },
      h('div', { class: 'state-icon' }, icon(forbidden ? 'lock' : 'alert')),
      h('h3', { text: forbidden ? t('state.forbiddenTitle') : t('state.errorTitle') }),
      h('p', { text: forbidden ? t('state.forbiddenText') : errorTitle(err) }),
      detail ? h('p', { class: 'small', text: detail }) : null,
      !forbidden && retry ? btn(t('common.retry'), { onClick: retry }) : null);
  }
  function alertBox(kind, title, text, extra) {
    return h('div', { class: 'alert alert--' + kind, role: kind === 'error' ? 'alert' : null },
      icon(kind === 'error' ? 'alert' : kind === 'success' ? 'check' : 'alert'),
      h('div', null, title ? h('span', { class: 'alert-title', text: title }) : null, text ? h('p', { text }) : null, extra || null));
  }
  /** Runs loader, shows loading/error states in `box`, calls render(data) on success. */
  async function mount(box, ctx, loader, render) {
    box.setAttribute('aria-busy', 'true');
    box.replaceChildren(loadingState());
    try {
      const data = await loader();
      if (!ctx.alive()) return;
      box.removeAttribute('aria-busy');
      box.replaceChildren();
      render(data);
    } catch (err) {
      if (!ctx.alive()) return;
      box.removeAttribute('aria-busy');
      if (err instanceof ApiError && err.status === 401) return;
      box.replaceChildren(errorState(err, () => mount(box, ctx, loader, render)));
    }
  }

  /* Tabs (WAI-ARIA tabs pattern, manual activation by click/Enter, arrows move focus+select). */
  function tabs(id, items, selected, onSelect) {
    const list = h('div', { class: 'tabs', role: 'tablist', 'aria-label': t('common.sections') });
    const btns = items.map((it) => h('button', {
      type: 'button', class: 'tab', role: 'tab', id: `${id}-tab-${it.id}`, 'aria-controls': `${id}-panel`,
      'aria-selected': String(it.id === selected), tabindex: it.id === selected ? '0' : '-1', text: it.label,
      on: { click: () => onSelect(it.id) },
    }));
    list.addEventListener('keydown', (e) => {
      const idx = btns.indexOf(document.activeElement);
      if (idx < 0) return;
      let next = null;
      if (e.key === 'ArrowRight') next = (idx + 1) % btns.length;
      else if (e.key === 'ArrowLeft') next = (idx - 1 + btns.length) % btns.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = btns.length - 1;
      if (next != null) { e.preventDefault(); btns[next].focus(); onSelect(items[next].id, true); }
    });
    appendKids(list, btns);
    const panel = h('div', { id: `${id}-panel`, role: 'tabpanel', 'aria-labelledby': `${id}-tab-${selected}` });
    return { list, panel };
  }

  /* Data table with search, select filters, client-side pagination (no endless scroll). */
  function dataTable(o) {
    const st = { q: '', filters: {}, page: 1 };
    let rows = o.rows || [];
    const root = h('div', { class: 'dt' });
    const toolbar = h('div', { class: 'toolbar' });
    let searchTimer = 0;
    if (o.search) {
      const id = uid('q');
      const input = h('input', { id, type: 'search', autocomplete: 'off', placeholder: t('table.searchPlaceholder') });
      input.addEventListener('input', () => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => { st.q = input.value.trim().toLowerCase(); st.page = 1; draw(); }, 150);
      });
      toolbar.appendChild(h('div', { class: 'field' }, h('label', { for: id, text: t('table.search') }), input));
    }
    (o.filters || []).forEach((f) => {
      const id = uid('f');
      const sel = h('select', { id }, h('option', { value: '', text: t('table.all') }), f.options.map((op) => h('option', { value: op.value, text: op.label })));
      sel.addEventListener('change', () => { st.filters[f.key] = sel.value; st.page = 1; draw(); });
      toolbar.appendChild(h('div', { class: 'field' }, h('label', { for: id, text: f.label }), sel));
    });
    if (toolbar.childNodes.length) root.appendChild(toolbar);
    const wrap = h('div', { class: 'table-wrap stack' });
    const info = h('p', { class: 'pager-info', 'aria-live': 'polite' });
    const prev = btn(t('table.prev'), { sm: true, onClick: () => { st.page -= 1; draw(); focusTable(); } });
    const next = btn(t('table.next'), { sm: true, onClick: () => { st.page += 1; draw(); focusTable(); } });
    const pageLabel = h('span');
    const pager = h('nav', { class: 'pager', 'aria-label': t('table.pagination') }, info, h('div', { class: 'pager-buttons' }, prev, pageLabel, next));
    root.append(wrap, pager);
    let table = null;
    function focusTable() { if (table) { table.setAttribute('tabindex', '-1'); table.focus({ preventScroll: false }); } }
    function filtered() {
      return rows.filter((r) => {
        if (st.q && !String(o.search(r) || '').toLowerCase().includes(st.q)) return false;
        for (const f of o.filters || []) {
          const v = st.filters[f.key];
          if (v && !f.test(r, v)) return false;
        }
        return true;
      });
    }
    function draw() {
      const list = filtered();
      const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
      st.page = Math.min(Math.max(1, st.page), pages);
      const start = (st.page - 1) * PAGE_SIZE;
      const slice = list.slice(start, start + PAGE_SIZE);
      table = h('table');
      table.appendChild(h('caption', null, o.caption, h('span', { class: 'caption-count', text: t('table.count', { n: fmt.num(list.length) }) })));
      table.appendChild(h('thead', null, h('tr', null, o.columns.map((c) => h('th', { scope: 'col', class: c.num ? 'num' : (c.actions ? 'actions' : null) }, c.actions ? h('span', { class: 'visually-hidden', text: c.label }) : c.label)))));
      const tbody = h('tbody');
      if (!slice.length) {
        tbody.appendChild(h('tr', { class: 'table-empty' }, h('td', { colSpan: o.columns.length, text: rows.length ? t('table.noMatch') : (o.empty || t('table.empty')) })));
      } else {
        slice.forEach((r) => {
          tbody.appendChild(h('tr', null, o.columns.map((c, i) => {
            const content = c.render(r);
            const td = h(i === 0 && !c.actions ? 'th' : 'td', { class: c.num ? 'num' : (c.actions ? 'actions' : null), 'data-label': c.label, scope: i === 0 && !c.actions ? 'row' : null });
            appendKids(td, [content]);
            return td;
          })));
        });
      }
      table.appendChild(tbody);
      wrap.replaceChildren(table);
      info.textContent = list.length ? t('table.showing', { from: fmt.num(start + 1), to: fmt.num(start + slice.length), total: fmt.num(list.length) }) : '';
      pageLabel.textContent = t('table.page', { page: st.page, pages });
      prev.disabled = st.page <= 1;
      next.disabled = st.page >= pages;
      pager.hidden = list.length <= PAGE_SIZE;
    }
    draw();
    if (rows.length >= LIST_CAP) root.appendChild(h('p', { class: 'small muted', text: t('table.capped', { n: LIST_CAP }) }));
    return { el: root, setRows(r) { rows = r; draw(); } };
  }
  function cellTitle(title, sub) {
    return [h('span', { class: 'cell-title', text: title || '—' }), sub ? h('span', { class: 'cell-sub', text: sub }) : null];
  }

  /* --------------------------------------------------------------- Forms */
  let uidSeq = 0;
  const uid = (p) => `${p || 'id'}-${++uidSeq}`;
  function field(o) {
    const id = uid('fld');
    const errId = id + '-err';
    const hintId = id + '-hint';
    let input;
    if (o.type === 'textarea') {
      input = h('textarea', { id, name: o.name, rows: o.rows || 4 });
      input.value = o.value == null ? '' : String(o.value);
    } else if (o.type === 'select') {
      input = h('select', { id, name: o.name }, (o.options || []).map((op) => h('option', { value: op.value, selected: String(op.value) === String(o.value == null ? '' : o.value), disabled: !!op.disabled, text: op.label })));
    } else {
      input = h('input', { id, name: o.name, type: o.type || 'text' });
      if (o.type !== 'file') input.value = o.value == null ? '' : String(o.value);
    }
    if (o.required) input.required = true;
    for (const [k, v] of Object.entries(o.attrs || {})) if (v != null) input.setAttribute(k, String(v));
    input.setAttribute('aria-describedby', (o.hint ? hintId + ' ' : '') + errId);
    const label = h('label', { for: id }, o.label,
      o.required ? [h('span', { class: 'req', 'aria-hidden': 'true', text: '*' }), h('span', { class: 'visually-hidden', text: ' (' + t('form.required') + ')' })] : null,
      o.optional ? h('span', { class: 'optional', text: '(' + t('form.optional') + ')' }) : null);
    const wrap = h('div', { class: 'field' + (o.cls ? ' ' + o.cls : '') }, label, input,
      o.hint ? h('p', { class: 'field-hint', id: hintId, text: o.hint }) : null,
      h('p', { class: 'field-error', id: errId, hidden: true }));
    wrap.input = input;
    return wrap;
  }
  function checkField(o) {
    const id = uid('chk');
    const errId = id + '-err';
    const input = h('input', { id, type: 'checkbox', name: o.name, checked: !!o.checked, required: !!o.required, 'aria-describedby': errId });
    const wrap = h('div', { class: 'field' },
      h('label', { class: 'check', for: id }, input, h('span', null, o.label, o.required ? h('span', { class: 'visually-hidden', text: ' (' + t('form.required') + ')' }) : null)),
      h('p', { class: 'field-error', id: errId, hidden: true }));
    wrap.input = input;
    return wrap;
  }
  function setFieldError(input, msg) {
    const errId = (input.getAttribute('aria-describedby') || '').split(' ').find((x) => x.endsWith('-err'));
    const errEl = errId ? document.getElementById(errId) : null;
    if (msg) {
      input.setAttribute('aria-invalid', 'true');
      if (errEl) { errEl.textContent = msg; errEl.hidden = false; }
    } else {
      input.removeAttribute('aria-invalid');
      if (errEl) { errEl.textContent = ''; errEl.hidden = true; }
    }
  }
  function validityMessage(el) {
    const v = el.validity;
    if (v.valueMissing) return el.type === 'checkbox' ? t('val.mustCheck') : t('val.required');
    if (v.tooShort) return t('val.minLength', { n: el.minLength });
    if (v.tooLong) return t('val.maxLength', { n: el.maxLength });
    if (v.rangeUnderflow) return t('val.min', { n: el.min });
    if (v.rangeOverflow) return t('val.max', { n: el.max });
    if (v.stepMismatch) return t('val.integer');
    if (v.badInput) return t('val.number');
    if (v.typeMismatch) return el.type === 'url' ? t('val.url') : t('val.format');
    if (v.patternMismatch) return el.dataset.patternMsg || t('val.format');
    return t('val.format');
  }
  /** Native constraint validation + custom checks; shows inline errors and a summary. */
  function validateForm(form, summaryBox, custom) {
    const errors = [];
    Array.from(form.elements).forEach((el) => { if (el.willValidate && el.getAttribute('aria-describedby')) setFieldError(el, ''); });
    Array.from(form.elements).forEach((el) => {
      if (!el.willValidate || el.disabled || el.closest('[hidden]')) return;
      if (!el.checkValidity()) errors.push([el, validityMessage(el)]);
    });
    (custom || []).forEach(([el, ok, msg]) => {
      if (!ok && !errors.some((e) => e[0] === el)) errors.push([el, msg]);
    });
    errors.forEach(([el, msg]) => setFieldError(el, msg));
    if (summaryBox) {
      summaryBox.replaceChildren();
      if (errors.length) {
        const list = h('ul', null, errors.map(([el, msg]) => {
          const lbl = form.querySelector(`label[for="${el.id}"]`);
          const name = lbl ? lbl.textContent.replace('*', '').trim() : el.name;
          return h('li', null, h('a', { href: '#' + el.id, text: `${name}: ${msg}`, on: { click: (e) => { e.preventDefault(); el.focus(); } } }));
        }));
        summaryBox.appendChild(h('div', { class: 'alert alert--error error-summary', role: 'alert' }, icon('alert'), h('div', null, h('span', { class: 'alert-title', text: t('form.fixErrors', { n: errors.length }) }), list)));
      }
    }
    if (errors.length) { errors[0][0].focus(); return false; }
    return true;
  }
  function showFormError(box, err) {
    box.replaceChildren(alertBox('error', errorTitle(err), errorDetail(err)));
    const a = box.firstChild;
    if (a) { a.setAttribute('tabindex', '-1'); a.focus(); }
  }

  /* -------------------------------------------------------------- Dialogs */
  function closeAllDialogs() { document.querySelectorAll('dialog.modal').forEach((d) => { if (d.open) d.close(); d.remove(); }); }
  /**
   * openDialog({title, build(body), submitLabel, submitCls, onSubmit(form) -> Promise<any>, wide, cancelLabel, readOnly})
   * onSubmit may throw ApiError: the dialog stays open and shows the translated server error.
   */
  function openDialog(o) {
    const opener = document.activeElement;
    const titleId = uid('dlg');
    const dlg = h('dialog', { class: 'modal' + (o.wide ? ' modal--wide' : ''), 'aria-labelledby': titleId });
    const form = h('form', { class: 'modal-form', novalidate: true });
    const alertSlot = h('div', { 'aria-live': 'polite' });
    const body = h('div', { class: 'modal-body' }, alertSlot);
    const closeBtn = h('button', { type: 'button', class: 'btn btn--ghost btn--icon close-x', 'aria-label': t('common.close'), text: '×' });
    const head = h('div', { class: 'modal-head' }, h('h2', { id: titleId, text: o.title }), closeBtn);
    const submit = o.readOnly ? null : h('button', { type: 'submit', class: 'btn ' + (o.submitCls || 'btn--primary'), text: o.submitLabel || t('common.save') });
    const cancel = h('button', { type: 'button', class: 'btn btn--secondary', text: o.readOnly ? t('common.close') : (o.cancelLabel || t('common.cancel')) });
    const foot = h('div', { class: 'modal-foot' }, cancel, submit);
    form.append(head, body, foot);
    dlg.appendChild(form);
    let busy = false;
    const ctl = { dlg, form, body, alertSlot, close: () => dlg.close() };
    const custom = o.build(body, ctl) || {};
    closeBtn.addEventListener('click', () => { if (!busy) dlg.close(); });
    cancel.addEventListener('click', () => { if (!busy) dlg.close(); });
    dlg.addEventListener('cancel', (e) => { if (busy) e.preventDefault(); });
    dlg.addEventListener('close', () => {
      dlg.remove();
      if (opener && document.contains(opener) && typeof opener.focus === 'function') opener.focus();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy || !submit) return;
      alertSlot.replaceChildren();
      const checks = typeof custom.validate === 'function' ? custom.validate() : [];
      if (!validateForm(form, alertSlot, checks)) return;
      busy = true;
      setBusy(submit, true, o.busyLabel);
      try {
        const keepOpen = await o.onSubmit(form, ctl);
        busy = false;
        setBusy(submit, false);
        if (keepOpen !== false) dlg.close();
      } catch (err) {
        busy = false;
        setBusy(submit, false);
        if (err instanceof ApiError && err.status === 401) return;
        showFormError(alertSlot, err);
      }
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    const first = body.querySelector('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])');
    (first || (submit || cancel)).focus();
    return ctl;
  }
  function confirmDialog(o) {
    return openDialog({
      title: o.title,
      submitLabel: o.confirmLabel,
      submitCls: o.danger ? 'btn--danger' : (o.approve ? 'btn--approve' : 'btn--primary'),
      busyLabel: o.busyLabel,
      build(body) {
        if (o.text) body.appendChild(h('p', { text: o.text }));
        if (o.extra) body.appendChild(o.extra);
        return o.validate ? { validate: o.validate } : {};
      },
      onSubmit: o.onConfirm,
    });
  }

  /* ---------------------------------------------------------------- Shell */
  const SECTIONS = [
    { id: 'overview', icon: 'home', group: 'main', roles: ['admin', 'partner'], render: viewOverview },
    { id: 'content', icon: 'content', group: 'publish', roles: ['admin', 'partner'], render: viewContent },
    { id: 'partners', icon: 'store', group: 'publish', roles: ['admin'], render: viewPartners },
    { id: 'reviews', icon: 'star', group: 'publish', roles: ['admin', 'partner'], render: viewReviews },
    { id: 'counter', icon: 'counter', group: 'loyalty', roles: ['admin', 'partner', 'cashier'], render: viewCounter },
    { id: 'benefits', icon: 'gift', group: 'loyalty', roles: ['admin', 'partner'], render: viewBenefits },
    { id: 'redemptions', icon: 'receipt', group: 'loyalty', roles: ['admin', 'partner', 'cashier'], render: viewRedemptions },
    { id: 'members', icon: 'users', group: 'loyalty', roles: ['admin'], render: viewMembers },
    { id: 'account', icon: 'account', group: 'settings', roles: ROLES, render: viewAccount },
  ];
  const GROUPS = ['main', 'publish', 'loyalty', 'settings'];
  const sectionsFor = (r) => SECTIONS.filter((s) => s.roles.includes(r));
  const sectionLabel = (id) => t((role() === 'partner' && DICT[state.lang] && DICT[state.lang]['nav.partner.' + id]) ? 'nav.partner.' + id : 'nav.' + id);

  function renderShell() {
    const u = state.user;
    $('#sidebar-user').replaceChildren(
      h('strong', { text: u.username }),
      u.organization_name ? h('span', { class: 'org', text: u.organization_name }) : h('span', { class: 'org', text: t('role.scope.global') }),
      h('div', null, h('span', { class: 'role-pill', text: t('role.' + u.role) })));
    const groups = $('#nav-groups');
    groups.replaceChildren();
    const allowed = sectionsFor(u.role);
    GROUPS.forEach((g) => {
      const items = allowed.filter((s) => s.group === g);
      if (!items.length) return;
      const titleId = uid('navg');
      groups.appendChild(h('div', { class: 'nav-group' },
        h('p', { class: 'nav-group-title', id: titleId, text: t('navgroup.' + g) }),
        h('ul', { class: 'nav-list', 'aria-labelledby': titleId }, items.map((s) => h('li', null,
          h('a', { class: 'sidebar-link', href: '#/' + s.id, dataset: { section: s.id } }, h('span', { class: 'nav-icon' }, icon(s.icon)), h('span', { text: sectionLabel(s.id) })))))));
    });
    document.querySelectorAll('[data-icon]').forEach((el) => { el.replaceChildren(icon(el.dataset.icon)); });
  }
  function setCurrentNav(id) {
    document.querySelectorAll('#nav-groups .sidebar-link').forEach((a) => {
      if (a.dataset.section === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }
  function route() {
    if (!state.user) return;
    const parts = (location.hash || '').replace(/^#\/?/, '').split('/');
    const id = parts[0];
    const sub = parts[1] || '';
    const allowed = sectionsFor(state.user.role);
    if (!id) {
      const first = allowed[0];
      history.replaceState(null, '', '#/' + first.id);
      return route();
    }
    if (id !== 'counter') counter = freshCounter(); // drop counter PII when leaving
    closeDrawer(false);
    const view = $('#view');
    const seq = ++state.renderSeq;
    const ctx = { sub, alive: () => seq === state.renderSeq && !!state.user };
    view.replaceChildren();
    const sec = SECTIONS.find((s) => s.id === id);
    setCurrentNav(sec ? sec.id : null);
    if (!sec) {
      view.append(pageHead(t('state.notFoundTitle')), emptyState(t('state.notFoundTitle'), t('state.notFoundText'), h('a', { class: 'btn btn--primary', href: '#/', text: t('common.goHome') })));
    } else if (!sec.roles.includes(state.user.role)) {
      view.append(pageHead(sectionLabel(sec.id)), errorState(new ApiError(403, 'forbidden')));
    } else {
      document.title = sectionLabel(sec.id) + ' · ' + t('brand.title');
      sec.render(view, ctx);
    }
    if (!state.firstRender) {
      const sameSection = sec && state.lastSection === sec.id;
      const tab = sameSection ? view.querySelector('[role=tab][aria-selected="true"]') : null;
      if (tab) tab.focus({ preventScroll: true });
      else {
        const h1 = $('#page-title');
        if (h1) h1.focus({ preventScroll: true });
        window.scrollTo(0, 0);
      }
    }
    state.lastSection = sec ? sec.id : null;
    state.firstRender = false;
  }

  /* Drawer (mobile) */
  function isMobile() { return window.matchMedia('(max-width: 960px)').matches; }
  function openDrawer() {
    const sb = $('#sidebar');
    sb.classList.add('is-open');
    $('#scrim').hidden = false;
    $('#menu-toggle').setAttribute('aria-expanded', 'true');
    $('#main').inert = true;
    const first = sb.querySelector('a, button');
    if (first) first.focus();
  }
  function closeDrawer(returnFocus) {
    const sb = $('#sidebar');
    if (!sb.classList.contains('is-open')) return;
    sb.classList.remove('is-open');
    $('#scrim').hidden = true;
    $('#menu-toggle').setAttribute('aria-expanded', 'false');
    $('#main').inert = false;
    if (returnFocus) $('#menu-toggle').focus();
  }

  function showLogin(message) {
    document.body.classList.remove('is-booting');
    $('#app-view').hidden = true;
    $('#login-view').hidden = false;
    document.title = t('login.title') + ' · ' + t('brand.title');
    const errBox = $('#login-error');
    if (message) { errBox.textContent = message; errBox.hidden = false; } else { errBox.hidden = true; errBox.textContent = ''; }
    const pw = $('#login-password');
    pw.value = '';
    $('#login-username').focus();
  }
  function showApp() {
    document.body.classList.remove('is-booting');
    $('#login-view').hidden = true;
    $('#app-view').hidden = false;
    state.firstRender = true;
    renderShell();
    route();
  }
  function acceptSession(s) {
    state.csrf = s.csrf_token || state.csrf;
    if (s.authenticated && s.user && ROLES.includes(s.user.role)) {
      state.user = s.user;
      return true;
    }
    state.user = null;
    return false;
  }

  async function boot() {
    applyStaticI18n();
    wireStatic();
    try {
      const s = await refreshSession();
      if (acceptSession(s)) showApp(); else showLogin();
    } catch (err) {
      document.body.classList.remove('is-booting');
      $('#login-view').hidden = false;
      // A 403 here means the account exists but has no pilot access or is suspended.
      const errBox = $('#login-error');
      errBox.textContent = errorText(err);
      errBox.hidden = false;
    }
  }

  function wireStatic() {
    document.querySelectorAll('[data-lang-select]').forEach((sel) => sel.addEventListener('change', () => setLang(sel.value)));
    window.addEventListener('hashchange', route);
    $('#menu-toggle').addEventListener('click', () => { if ($('#sidebar').classList.contains('is-open')) closeDrawer(true); else openDrawer(); });
    $('#scrim').addEventListener('click', () => closeDrawer(true));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#sidebar').classList.contains('is-open')) closeDrawer(true); });
    window.matchMedia('(max-width: 960px)').addEventListener('change', () => { if (!isMobile()) closeDrawer(false); });
    $('#logout-btn').addEventListener('click', logout);

    const pwToggle = $('#login-toggle-pw');
    pwToggle.addEventListener('click', () => {
      const pw = $('#login-password');
      const show = pw.type === 'password';
      pw.type = show ? 'text' : 'password';
      pwToggle.setAttribute('aria-pressed', String(show));
      pwToggle.textContent = t(show ? 'login.hidePassword' : 'login.showPassword');
    });

    const form = $('#login-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submit = $('#login-submit');
      const errBox = $('#login-error');
      errBox.hidden = true;
      if (!validateForm(form, null)) return;
      setBusy(submit, true, t('login.submitting'));
      try {
        if (!state.csrf) await refreshSession();
        const s = await api('POST', '/auth/login', { username: form.username.value.trim(), password: form.password.value }, { noAuthRedirect: true });
        form.password.value = '';
        if (acceptSession(s)) {
          showApp();
          toast(t('login.welcome', { name: s.user.username }));
        } else {
          errBox.textContent = t('err.noRole');
          errBox.hidden = false;
        }
      } catch (err) {
        errBox.textContent = err instanceof ApiError && err.status === 401 ? t('srv.badCredentials') : errorText(err);
        errBox.hidden = false;
        $('#login-password').focus();
      } finally {
        setBusy(submit, false);
        submit.textContent = t('login.submit');
      }
    });
  }

  async function logout() {
    const b = $('#logout-btn');
    b.disabled = true;
    try {
      await api('POST', '/auth/logout', {}, { noAuthRedirect: true });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        b.disabled = false;
        toast(t('account.logoutFailed') + ' ' + errorText(err), 'error');
        return;
      }
    }
    b.disabled = false;
    state.user = null;
    resetCaches();
    closeAllDialogs();
    history.replaceState(null, '', location.pathname);
    try { await refreshSession(); } catch (_) { state.csrf = ''; }
    showLogin();
    toast(t('account.loggedOut'));
  }

  /* ===================================================== Section: Overview */
  function viewOverview(view, ctx) {
    const admin = isAdmin();
    view.appendChild(pageHead(sectionLabel('overview'), admin ? t('overview.leadAdmin') : t('overview.leadPartner', { org: state.user.organization_name || '' })));
    const metricsBox = h('div');
    const queueBox = h('section', { class: 'card', 'aria-labelledby': 'queue-title' });
    const linksBox = h('section', { class: 'card', 'aria-labelledby': 'links-title' });
    view.append(metricsBox, queueBox, linksBox);

    mount(metricsBox, ctx, () => api('GET', '/overview'), (d) => {
      const defs = admin
        ? [['pending_approvals', 'metric.pending', true], ['members', 'metric.members'], ['redemptions', 'metric.redemptions'], ['points_issued', 'metric.pointsIssued']]
        : [['pending_approvals', 'metric.pendingOwn', true], ['events', 'metric.events'], ['benefits', 'metric.benefits'], ['redemptions', 'metric.redemptions']];
      const items = defs.filter(([k]) => typeof d[k] === 'number').slice(0, 4);
      metricsBox.appendChild(h('ul', { class: 'metrics', 'aria-label': t('overview.metrics') }, items.map(([k, label, attention]) =>
        h('li', { class: 'metric' + (attention && d[k] > 0 ? ' metric--attention' : '') },
          h('p', { class: 'metric-label', text: t(label) }),
          h('p', { class: 'metric-value', text: fmt.num(d[k]) }),
          h('p', { class: 'metric-note', text: admin ? t('metric.scopeGlobal') : t('metric.scopeOrg') })))));
    });

    queueBox.appendChild(h('div', { class: 'card-head' }, h('h2', { id: 'queue-title', text: admin ? t('overview.queueAdmin') : t('overview.queuePartner') })));
    const queueInner = h('div');
    queueBox.appendChild(queueInner);
    const loadQueue = async () => {
      const kinds = [['events', '/events'], ['content', '/content'], ['benefits', '/benefits']];
      const [orgs, ...results] = await Promise.allSettled([admin ? loadOrgs() : Promise.resolve([]), ...kinds.map(([, p]) => api('GET', p))]);
      void orgs;
      const failed = results.find((r) => r.status === 'rejected');
      if (failed && results.every((r) => r.status === 'rejected')) throw failed.reason;
      const rows = [];
      results.forEach((r, i) => {
        if (r.status !== 'fulfilled') return;
        (r.value.items || []).filter((x) => x.status === 'pending').forEach((x) => rows.push({ ...x, _kind: kinds[i][0] }));
      });
      return { rows, partial: !!failed };
    };
    const drawQueue = ({ rows, partial }) => {
      if (partial) queueInner.appendChild(alertBox('warn', t('state.partialTitle'), t('state.partialText')));
      if (!rows.length) {
        queueInner.appendChild(emptyState(t('overview.queueEmpty'), admin ? t('overview.queueEmptyAdmin') : t('overview.queueEmptyPartner')));
        return;
      }
      const table = dataTable({
        caption: admin ? t('overview.queueAdmin') : t('overview.queuePartner'),
        rows,
        columns: [
          { label: t('col.title'), render: (r) => cellTitle(r.title, r.organization_name) },
          { label: t('col.type'), render: (r) => t('kind.' + (r._kind === 'content' ? r.kind : r._kind)) },
          { label: t('col.status'), render: (r) => badge(r.status) },
          { label: t('col.actions'), actions: true, render: (r) => [
            h('a', { class: 'btn btn--secondary btn--sm', href: '#/' + (r._kind === 'benefits' ? 'benefits' : 'content/' + (r._kind === 'events' ? 'events' : 'campaigns')), text: t('common.open') }),
            admin ? btn(t('action.review'), { sm: true, cls: 'btn--approve', onClick: () => approveDialog(r._kind, r, () => route()) }) : null,
          ] },
        ],
      });
      queueInner.appendChild(table.el);
    };
    mount(queueInner, ctx, loadQueue, drawQueue);

    linksBox.appendChild(h('h2', { id: 'links-title', text: t('overview.shortcuts') }));
    const links = [
      ['counter', 'counter', 'overview.linkCounter'],
      ['content/events', 'content', 'overview.linkEvent'],
      ['benefits', 'gift', 'overview.linkBenefit'],
      ['reviews', 'star', 'overview.linkReviews'],
    ];
    if (admin) links.push(['members', 'users', 'overview.linkMembers'], ['partners', 'store', 'overview.linkPartners']);
    linksBox.appendChild(h('div', { class: 'quick-links' },
      links.map(([href, ic, label]) => h('a', { class: 'quick-link', href: '#/' + href }, h('span', { class: 'nav-icon' }, icon(ic)), h('span', { text: t(label) }))),
      h('a', { class: 'quick-link', href: '/explorar.html' }, h('span', { class: 'nav-icon' }, icon('map')), h('span', { text: t('nav.map') }))));
  }

  /* ================================================= Editorial (shared) */
  const EDITORIAL = {
    events: { path: '/events', titleKey: 'content.events', newKey: 'content.newEvent', editKey: 'content.editEvent' },
    content: { path: '/content', titleKey: 'content.campaigns', newKey: 'content.newContent', editKey: 'content.editContent' },
    benefits: { path: '/benefits', titleKey: 'nav.benefits', newKey: 'benefits.new', editKey: 'benefits.edit' },
  };

  function translationsBlock(item, withAlt) {
    const tr = (item && item.translations) || {};
    const block = h('details', { class: 'translations', open: true },
      h('summary', { text: t('form.translations') }),
      h('p', { class: 'field-hint', text: t('form.translationsHint') }));
    ['en', 'es'].forEach((lng) => {
      const v = tr[lng] || {};
      const fs = h('fieldset', null, h('legend', { text: t('lang.name.' + lng) }));
      fs.appendChild(field({ name: `tr_${lng}_title`, label: t('form.title') + ' (' + lng.toUpperCase() + ')', value: v.title || '', attrs: { maxlength: 120, lang: lng } }));
      fs.appendChild(field({ name: `tr_${lng}_description`, label: t('form.description') + ' (' + lng.toUpperCase() + ')', type: 'textarea', rows: 3, value: v.description || '', attrs: { maxlength: 2000, lang: lng } }));
      if (withAlt) fs.appendChild(field({ name: `tr_${lng}_image_alt`, label: t('form.imageAlt') + ' (' + lng.toUpperCase() + ')', value: v.image_alt || '', attrs: { maxlength: 240, lang: lng } }));
      block.appendChild(fs);
    });
    return block;
  }
  function readTranslations(form, withAlt) {
    const out = {};
    ['en', 'es'].forEach((lng) => {
      const o = { title: form[`tr_${lng}_title`].value.trim(), description: form[`tr_${lng}_description`].value.trim() };
      if (withAlt) o.image_alt = form[`tr_${lng}_image_alt`].value.trim();
      out[lng] = o;
    });
    return out;
  }
  async function orgField(item) {
    if (!isAdmin()) return null;
    const orgs = await loadOrgs();
    if (item) {
      return field({ name: 'organization_id', label: t('form.organization'), type: 'select', value: item.organization_id, options: [{ value: item.organization_id, label: item.organization_name || orgName(item.organization_id) }], attrs: { disabled: 'disabled' }, hint: t('form.orgImmutable') });
    }
    const active = orgs.filter((o) => o.active);
    return field({ name: 'organization_id', label: t('form.organization'), type: 'select', required: true, value: '', options: [{ value: '', label: t('form.chooseOrg') }].concat(active.map((o) => ({ value: o.id, label: o.name }))), hint: active.length ? null : t('form.noOrgs') });
  }
  function periodFields(item, required) {
    const tz = tzName();
    const starts = field({ name: 'starts', label: t('form.starts'), type: 'datetime-local', required, value: toLocalInput(item && item.starts), hint: tz ? t('form.tzHint', { tz }) : null });
    const ends = field({ name: 'ends', label: t('form.ends'), type: 'datetime-local', required, value: toLocalInput(item && item.ends) });
    return { row: h('div', { class: 'form-row' }, starts, ends), starts: starts.input, ends: ends.input };
  }
  function periodCheck(p) {
    const a = p.starts.value; const b = p.ends.value;
    return [[p.ends, !(a && b) || new Date(b) > new Date(a), t('val.endsAfterStarts')]];
  }
  function editWarning(item) {
    if (item) return alertBox('warn', null, t('form.partnerEditWarning'));
    if (!item) return alertBox('info', null, t('form.partnerCreateInfo'));
    return null;
  }

  async function editorialDialog(kind, item, onDone) {
    const cfg = EDITORIAL[kind];
    let org;
    try { org = await orgField(item); } catch (err) { toast(errorText(err), 'error'); return; }
    let period; let imageState = { changed: false, data: item ? (item.image_data || '') : '' };
    let discoveriesBox = null; let kindSelect = null; let altField = null;
    openDialog({
      title: t(item ? cfg.editKey : cfg.newKey),
      wide: true,
      submitLabel: item ? t('common.saveChanges') : t('common.create'),
      build(body) {
        const warn = editWarning(item);
        if (warn) body.appendChild(warn);
        if (org) body.appendChild(org);
        if (kind === 'content') {
          const kf = field({ name: 'kind', label: t('form.contentKind'), type: 'select', required: true, value: item ? item.kind : 'ad', options: ['ad', 'campaign', 'easter_egg'].map((k) => ({ value: k, label: t('kind.' + k) })), hint: t('form.contentKindHint') });
          kindSelect = kf.input;
          body.appendChild(kf);
        }
        body.appendChild(field({ name: 'title', label: t('form.title'), required: true, value: item ? item.title : '', attrs: { maxlength: 120 } }));
        body.appendChild(field({ name: 'description', label: t('form.description'), type: 'textarea', value: item ? item.description : '', attrs: { maxlength: 2000 }, optional: true }));
        if (kind === 'events') body.appendChild(field({ name: 'location', label: t('form.location'), required: true, value: item ? item.location : '', attrs: { maxlength: 120 }, hint: t('form.locationHint') }));
        if (kind === 'benefits') {
          body.appendChild(h('div', { class: 'form-row' },
            field({ name: 'points_cost', label: t('form.pointsCost'), type: 'number', required: true, value: item ? item.points_cost : '', attrs: { min: 1, max: 1000000, step: 1, inputmode: 'numeric' }, hint: t('form.pointsCostHint') }),
            field({ name: 'stock', label: t('form.stock'), type: 'number', required: true, value: item ? item.stock : '', attrs: { min: 0, max: 1000000, step: 1, inputmode: 'numeric' } })));
        }
        period = periodFields(item, true);
        if (kind === 'benefits') body.appendChild(h('p', { class: 'field-hint', text: t('form.validityHint') }));
        body.appendChild(period.row);
        if (kind === 'content') {
          body.appendChild(h('div', { class: 'form-row' },
            field({ name: 'theme', label: t('form.theme'), value: item ? item.theme : '', optional: true, attrs: { maxlength: 40 }, hint: t('form.themeHint') }),
            field({ name: 'target_url', label: t('form.targetUrl'), type: 'url', value: item ? item.target_url : '', optional: true, attrs: { maxlength: 2000, pattern: 'https://.+', placeholder: 'https://' }, hint: t('form.targetUrlHint') })));
          body.lastChild.querySelector('input[name=target_url]').dataset.patternMsg = t('val.https');
          body.appendChild(imageBlock(item, imageState));
          altField = field({ name: 'image_alt', label: t('form.imageAlt'), value: item ? item.image_alt : '', attrs: { maxlength: 240 }, hint: t('form.imageAltHint'), optional: true });
          body.appendChild(altField);
          discoveriesBox = discoveriesBlock(item);
          body.appendChild(discoveriesBox);
          const sync = () => { discoveriesBox.hidden = kindSelect.value === 'ad'; };
          kindSelect.addEventListener('change', sync);
          sync();
        }
        body.appendChild(translationsBlock(item, kind === 'content'));
        return {
          validate() {
            const checks = periodCheck(period);
            if (kind === 'content' && imageState.data && altField) checks.push([altField.input, !!altField.input.value.trim(), t('val.altRequired')]);
            return checks;
          },
        };
      },
      async onSubmit(form) {
        const p = {
          title: form.title.value.trim(),
          description: form.description.value.trim(),
          starts: fromLocalInput(form.starts.value),
          ends: fromLocalInput(form.ends.value),
          translations: readTranslations(form, kind === 'content'),
        };
        if (!item && isAdmin()) p.organization_id = Number(form.organization_id.value);
        if (kind === 'events') p.location = form.location.value.trim();
        if (kind === 'benefits') { p.points_cost = parseInt(form.points_cost.value, 10); p.stock = parseInt(form.stock.value, 10); }
        if (kind === 'content') {
          p.kind = form.kind.value;
          p.theme = form.theme.value.trim();
          p.target_url = form.target_url.value.trim();
          p.image_alt = form.image_alt.value.trim();
          if (imageState.changed) p.image_data = imageState.data;
          p.discoveries = p.kind === 'ad' ? [] : readDiscoveries(form);
        }
        const saved = item ? await api('PATCH', `${cfg.path}/${item.id}`, p) : await api('POST', cfg.path, p);
        toast(item ? t('toast.saved', { title: saved.title }) : t('toast.created', { title: saved.title }));
        if (saved.status === 'pending') announce(t('toast.pendingApproval'));
        onDone && onDone(saved);
      },
    });
  }

  function imageBlock(item, imageState) {
    const id = uid('img');
    const errId = id + '-err';
    const input = h('input', { id, type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-describedby': id + '-hint ' + errId });
    const preview = h('img', { class: 'img-preview', alt: '', hidden: true });
    const removeBtn = btn(t('form.removeImage'), { sm: true, cls: 'btn--danger-outline' });
    const status = h('p', { class: 'field-hint', 'aria-live': 'polite' });
    const err = h('p', { class: 'field-error', id: errId, hidden: true });
    function show() {
      const has = !!imageState.data && imageState.data.startsWith('data:image/');
      preview.hidden = !has;
      if (has) preview.src = imageState.data; else preview.removeAttribute('src');
      removeBtn.hidden = !has;
      status.textContent = has ? t('form.imageSet') : t('form.imageNone');
    }
    input.addEventListener('change', () => {
      err.hidden = true; input.removeAttribute('aria-invalid');
      const f = input.files && input.files[0];
      if (!f) return;
      const okType = ['image/png', 'image/jpeg', 'image/webp'].includes(f.type);
      if (!okType || f.size > 300 * 1024) {
        err.textContent = okType ? t('srv.imageTooBig') : t('srv.imageType');
        err.hidden = false; input.setAttribute('aria-invalid', 'true'); input.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = () => { imageState.data = String(reader.result || ''); imageState.changed = true; show(); };
      reader.onerror = () => { err.textContent = t('srv.imageInvalid'); err.hidden = false; };
      reader.readAsDataURL(f);
    });
    removeBtn.addEventListener('click', () => { imageState.data = ''; imageState.changed = true; input.value = ''; show(); });
    show();
    return h('div', { class: 'field' },
      h('label', { for: id }, t('form.image'), h('span', { class: 'optional', text: '(' + t('form.optional') + ')' })),
      input,
      h('p', { class: 'field-hint', id: id + '-hint', text: t('form.imageHint') }),
      err, status, h('div', { class: 'img-row' }, preview, removeBtn));
  }

  function discoveriesBlock(item) {
    const list = (item && Array.isArray(item.discoveries)) ? item.discoveries : [];
    const fs = h('fieldset', { class: 'discoveries' }, h('legend', { text: t('form.discoveries') }), h('p', { class: 'field-hint', text: t('form.discoveriesHint') }));
    for (let i = 0; i < 3; i += 1) {
      const d = list[i] || {};
      const tr = d.translations || {};
      const box = h('div', { class: 'discovery' }, h('p', { class: 'discovery-title', text: t('form.discoveryN', { n: i + 1 }) }));
      box.appendChild(h('input', { type: 'hidden', name: `disc_${i}_id`, value: d.id || `d${i + 1}` }));
      box.appendChild(h('div', { class: 'form-row' },
        field({ name: `disc_${i}_title`, label: t('form.discoveryTitle') + ' (PT)', value: d.title || '', attrs: { maxlength: 120, lang: 'pt-BR' } }),
        field({ name: `disc_${i}_en`, label: t('form.discoveryTitle') + ' (EN)', value: (tr.en || {}).title || '', attrs: { maxlength: 120, lang: 'en' } }),
        field({ name: `disc_${i}_es`, label: t('form.discoveryTitle') + ' (ES)', value: (tr.es || {}).title || '', attrs: { maxlength: 120, lang: 'es' } })));
      fs.appendChild(box);
    }
    return fs;
  }
  function readDiscoveries(form) {
    const out = [];
    for (let i = 0; i < 3; i += 1) {
      const title = form[`disc_${i}_title`].value.trim();
      if (!title) continue;
      out.push({ id: form[`disc_${i}_id`].value, title, translations: { en: { title: form[`disc_${i}_en`].value.trim() }, es: { title: form[`disc_${i}_es`].value.trim() } } });
    }
    return out;
  }

  /** Local pre-check mirroring backend publish rules; the server remains the authority. */
  function publishChecklist(kind, item) {
    const tr = item.translations || {};
    const checks = [];
    ['en', 'es'].forEach((l) => {
      const v = tr[l] || {};
      checks.push([t('check.translation', { lang: t('lang.name.' + l) }), !!v.title && (!item.description || !!v.description)]);
    });
    if ('starts' in item) {
      const ok = !!item.starts && !!item.ends && new Date(item.ends) > new Date(item.starts);
      checks.push([t('check.validity'), ok]);
      checks.push([t('check.notEnded'), !!item.ends && new Date(item.ends) > new Date()]);
    }
    if (item.image_data) checks.push([t('check.imageAlt'), !!item.image_alt && !!(tr.en || {}).image_alt && !!(tr.es || {}).image_alt]);
    if (kind === 'content' && item.kind !== 'ad') {
      const d = Array.isArray(item.discoveries) ? item.discoveries : [];
      checks.push([t('check.discoveries'), d.length === 3 && d.every((x) => x.translations && (x.translations.en || {}).title && (x.translations.es || {}).title)]);
    }
    if (kind === 'benefits') checks.push([t('check.stock'), Number(item.stock) > 0]);
    return checks;
  }
  function approveDialog(kind, item, onDone) {
    const cfg = EDITORIAL[kind];
    const checks = publishChecklist(kind, item);
    const allOk = checks.every((c) => c[1]);
    const list = h('ul', { class: 'checklist' }, checks.map(([label, ok]) => h('li', { class: ok ? 'ok' : 'bad' },
      h('span', { class: 'check-mark', 'aria-hidden': 'true', text: ok ? '✓' : '!' }),
      h('span', null, label, h('span', { class: 'visually-hidden', text: ok ? ' — ' + t('check.ok') : ' — ' + t('check.missing') })))));
    const summary = h('dl', { class: 'kv' },
      h('dt', { text: t('col.title') }), h('dd', { text: item.title }),
      h('dt', { text: t('form.organization') }), h('dd', { text: item.organization_name || orgName(item.organization_id) }),
      item.location != null ? [h('dt', { text: t('form.location') }), h('dd', { text: item.location })] : null,
      'starts' in item ? [h('dt', { text: t('col.period') }), h('dd', { text: fmt.range(item.starts, item.ends) })] : null,
      item.points_cost != null ? [h('dt', { text: t('form.pointsCost') }), h('dd', { text: fmt.num(item.points_cost) })] : null,
      item.stock != null ? [h('dt', { text: t('form.stock') }), h('dd', { text: fmt.num(item.stock) })] : null,
      item.description ? [h('dt', { text: t('form.description') }), h('dd', { text: item.description })] : null);
    confirmDialog({
      title: t('approve.title'),
      approve: true,
      confirmLabel: t('action.approve'),
      busyLabel: t('common.approving'),
      extra: h('div', null, summary, h('h3', { class: 'mt', text: t('approve.checklist') }), list,
        allOk ? null : alertBox('warn', null, t('approve.checklistWarn'))),
      async onConfirm() {
        const saved = await api('POST', `${cfg.path}/${item.id}/approve`, {});
        toast(t('toast.approved', { title: saved.title || item.title }));
        onDone && onDone(saved);
      },
    });
  }
  function pauseDialog(kind, item, onDone) {
    const cfg = EDITORIAL[kind];
    confirmDialog({
      title: t('pause.title'),
      text: t('pause.text', { title: item.title }),
      confirmLabel: t('action.pause'),
      busyLabel: t('common.saving'),
      async onConfirm() {
        const saved = await api('POST', `${cfg.path}/${item.id}/pause`, {});
        toast(t('toast.paused', { title: saved.title || item.title }));
        onDone && onDone(saved);
      },
    });
  }
  function editorialActions(kind, r, reload) {
    const out = [];
    const canEdit = role() === 'admin' || role() === 'partner';
    if (canEdit) out.push(btn(t('action.edit'), { sm: true, aria: t('action.editNamed', { title: r.title }), onClick: () => editorialDialog(kind, r, reload) }));
    if (isAdmin() && r.status !== 'approved') out.push(btn(t('action.approve'), { sm: true, cls: 'btn--approve', aria: t('action.approveNamed', { title: r.title }), onClick: () => approveDialog(kind, r, reload) }));
    if (canEdit && r.status === 'approved') out.push(btn(t('action.pause'), { sm: true, cls: 'btn--danger-outline', aria: t('action.pauseNamed', { title: r.title }), onClick: () => pauseDialog(kind, r, reload) }));
    return out;
  }
  const STATUS_FILTER = () => ({ key: 'status', label: t('col.status'), options: ['pending', 'approved', 'paused'].map((s) => ({ value: s, label: t('status.' + s) })), test: (r, v) => r.status === v });
  const ORG_FILTER = (rows) => {
    const ids = Array.from(new Set(rows.map((r) => r.organization_id)));
    return { key: 'org', label: t('form.organization'), options: ids.map((id) => ({ value: String(id), label: (rows.find((r) => r.organization_id === id) || {}).organization_name || orgName(id) })), test: (r, v) => String(r.organization_id) === v };
  };

  /* ====================================================== Section: Content */
  function viewContent(view, ctx) {
    const sub = ctx.sub === 'campaigns' ? 'campaigns' : 'events';
    view.appendChild(pageHead(sectionLabel('content'), role() === 'admin' ? t('content.leadAdmin') : t('content.leadPartner')));
    const tb = tabs('content', [{ id: 'events', label: t('content.events') }, { id: 'campaigns', label: t('content.campaigns') }], sub, (id) => {
      if (id !== sub) location.hash = '#/content/' + id;
    });
    view.append(tb.list, tb.panel);
    const kind = sub === 'events' ? 'events' : 'content';
    const cfg = EDITORIAL[kind];
    const box = h('div');
    const reload = () => load();
    const newBtn = btn(t(cfg.newKey), { cls: 'btn--primary', onClick: () => editorialDialog(kind, null, reload) });
    tb.panel.append(h('div', { class: 'card-head' }, h('p', { class: 'muted', text: kind === 'events' ? t('content.eventsHint') : t('content.campaignsHint') }), newBtn), box);
    const load = () => mount(box, ctx, async () => {
      const [data] = await Promise.all([api('GET', cfg.path), isAdmin() ? loadOrgs().catch(() => []) : null]);
      return data.items || [];
    }, (rows) => {
      if (!rows.length) {
        box.appendChild(emptyState(t('content.emptyTitle'), kind === 'events' ? t('content.emptyEvents') : t('content.emptyCampaigns'), btn(t(cfg.newKey), { cls: 'btn--primary', onClick: () => editorialDialog(kind, null, reload) })));
        return;
      }
      const columns = [
        { label: t('col.title'), render: (r) => cellTitle(r.title, kind === 'events' ? r.location : (r.theme ? t('form.theme') + ': ' + r.theme : null)) },
      ];
      if (kind === 'content') columns.push({ label: t('col.type'), render: (r) => t('kind.' + r.kind) });
      if (isAdmin()) columns.push({ label: t('form.organization'), render: (r) => r.organization_name || orgName(r.organization_id) });
      columns.push(
        { label: t('col.period'), render: (r) => fmt.range(r.starts, r.ends) },
        { label: t('col.status'), render: (r) => badge(r.status) },
        { label: t('col.actions'), actions: true, render: (r) => editorialActions(kind, r, reload) });
      const filters = [STATUS_FILTER()];
      if (kind === 'content') filters.push({ key: 'kind', label: t('col.type'), options: ['ad', 'campaign', 'easter_egg'].map((k) => ({ value: k, label: t('kind.' + k) })), test: (r, v) => r.kind === v });
      if (isAdmin()) filters.push(ORG_FILTER(rows));
      box.appendChild(dataTable({ caption: t(cfg.titleKey), rows, columns, filters, search: (r) => [r.title, r.location, r.theme, r.organization_name].join(' ') }).el);
    });
    load();
  }

  /* ===================================================== Section: Benefits */
  function viewBenefits(view, ctx) {
    const box = h('div');
    const reload = () => load();
    view.appendChild(pageHead(sectionLabel('benefits'), isAdmin() ? t('benefits.leadAdmin') : t('benefits.leadPartner'),
      [btn(t('benefits.new'), { cls: 'btn--primary', onClick: () => editorialDialog('benefits', null, reload) })]));
    view.appendChild(alertBox('info', null, t('benefits.rules')));
    view.appendChild(box);
    const load = () => mount(box, ctx, async () => {
      const [data] = await Promise.all([api('GET', '/benefits'), isAdmin() ? loadOrgs().catch(() => []) : null]);
      return data.items || [];
    }, (rows) => {
      if (!rows.length) {
        box.appendChild(emptyState(t('benefits.emptyTitle'), t('benefits.emptyText'), btn(t('benefits.new'), { cls: 'btn--primary', onClick: () => editorialDialog('benefits', null, reload) })));
        return;
      }
      const columns = [{ label: t('col.title'), render: (r) => cellTitle(r.title, r.description) }];
      if (isAdmin()) columns.push({ label: t('form.organization'), render: (r) => r.organization_name || orgName(r.organization_id) });
      columns.push(
        { label: t('form.pointsCost'), num: true, render: (r) => h('span', { class: 'points', text: fmt.num(r.points_cost) }) },
        { label: t('form.stock'), num: true, render: (r) => fmt.num(r.stock) },
        { label: t('col.validity'), render: (r) => fmt.range(r.starts, r.ends) },
        { label: t('col.status'), render: (r) => badge(r.status) },
        { label: t('col.actions'), actions: true, render: (r) => editorialActions('benefits', r, reload) });
      const filters = [STATUS_FILTER()];
      if (isAdmin()) filters.push(ORG_FILTER(rows));
      box.appendChild(dataTable({ caption: t('nav.benefits'), rows, columns, filters, search: (r) => [r.title, r.description, r.organization_name].join(' ') }).el);
    });
    load();
  }

  /* ===================================================== Section: Partners */
  function viewPartners(view, ctx) {
    const sub = ctx.sub === 'staff' ? 'staff' : 'orgs';
    view.appendChild(pageHead(sectionLabel('partners'), t('partners.lead')));
    const tb = tabs('partners', [{ id: 'orgs', label: t('partners.orgs') }, { id: 'staff', label: t('partners.staff') }], sub, (id) => {
      if (id !== sub) location.hash = '#/partners/' + id;
    });
    view.append(tb.list, tb.panel);
    if (sub === 'orgs') partnersOrgs(tb.panel, ctx); else partnersStaff(tb.panel, ctx);
  }
  function partnersOrgs(panel, ctx) {
    const box = h('div');
    const reload = () => load();
    panel.append(h('div', { class: 'card-head' }, h('p', { class: 'muted', text: t('partners.orgsHint') }), btn(t('partners.newOrg'), { cls: 'btn--primary', onClick: () => orgDialog(null, reload) })), box);
    const load = () => mount(box, ctx, async () => {
      const orgs = await loadOrgs(true);
      try { await loadStores(); } catch (_) { /* store names optional */ }
      return orgs;
    }, (rows) => {
      if (!rows.length) {
        box.appendChild(emptyState(t('partners.emptyOrgs'), t('partners.emptyOrgsText'), btn(t('partners.newOrg'), { cls: 'btn--primary', onClick: () => orgDialog(null, reload) })));
        return;
      }
      box.appendChild(dataTable({
        caption: t('partners.orgs'), rows,
        search: (r) => [r.name, r.store_id, storeName(r.store_id)].join(' '),
        filters: [
          { key: 'kind', label: t('col.type'), options: ['store', 'producer'].map((k) => ({ value: k, label: t('orgkind.' + k) })), test: (r, v) => r.kind === v },
          { key: 'active', label: t('col.status'), options: [{ value: '1', label: t('status.active') }, { value: '0', label: t('status.inactive') }], test: (r, v) => (r.active ? '1' : '0') === v },
        ],
        columns: [
          { label: t('col.name'), render: (r) => cellTitle(r.name, '#' + r.id) },
          { label: t('col.type'), render: (r) => t('orgkind.' + r.kind) },
          { label: t('form.store'), render: (r) => (r.store_id ? storeName(r.store_id) : '—') },
          { label: t('col.status'), render: (r) => badge(r.active ? 'active' : 'inactive') },
          { label: t('col.actions'), actions: true, render: (r) => [
            btn(t('action.edit'), { sm: true, aria: t('action.editNamed', { title: r.name }), onClick: () => orgDialog(r, reload) }),
            btn(r.active ? t('action.deactivate') : t('action.activate'), { sm: true, cls: r.active ? 'btn--danger-outline' : 'btn--approve', onClick: () => orgToggle(r, reload) }),
          ] },
        ],
      }).el);
    });
    load();
  }
  function storeName(id) {
    if (!id) return '—';
    const s = (state.stores || []).find((x) => x.id === id);
    return s ? s.name : id;
  }
  async function orgDialog(item, onDone) {
    let stores = null;
    try { stores = await loadStores(); } catch (_) { stores = null; }
    openDialog({
      title: item ? t('partners.editOrg') : t('partners.newOrg'),
      submitLabel: item ? t('common.saveChanges') : t('common.create'),
      build(body) {
        body.appendChild(field({ name: 'name', label: t('col.name'), required: true, value: item ? item.name : '', attrs: { maxlength: 120, autocomplete: 'organization' } }));
        body.appendChild(field({ name: 'kind', label: t('col.type'), type: 'select', required: true, value: item ? item.kind : 'store', options: ['store', 'producer'].map((k) => ({ value: k, label: t('orgkind.' + k) })), hint: t('partners.kindHint') }));
        if (stores && stores.length) {
          const opts = [{ value: '', label: t('form.noStore') }].concat(stores.map((s) => ({ value: s.id, label: s.name })));
          if (item && item.store_id && !stores.some((s) => s.id === item.store_id)) opts.push({ value: item.store_id, label: item.store_id });
          body.appendChild(field({ name: 'store_id', label: t('form.store'), type: 'select', value: item ? item.store_id : '', optional: true, options: opts, hint: t('partners.storeHint') }));
        } else {
          body.appendChild(field({ name: 'store_id', label: t('form.storeId'), value: item ? item.store_id : '', optional: true, attrs: { maxlength: 120 }, hint: t('partners.storeIdHint') }));
        }
      },
      async onSubmit(form) {
        const p = { name: form.name.value.trim(), kind: form.kind.value, store_id: form.store_id.value.trim() };
        const saved = item ? await api('PATCH', `/organizations/${item.id}`, p) : await api('POST', '/organizations', p);
        state.orgs = null;
        toast(item ? t('toast.saved', { title: saved.name }) : t('toast.created', { title: saved.name }));
        onDone && onDone(saved);
      },
    });
  }
  function orgToggle(item, onDone) {
    const deactivate = item.active;
    confirmDialog({
      title: deactivate ? t('partners.deactivateTitle') : t('partners.activateTitle'),
      text: deactivate ? t('partners.deactivateText', { name: item.name }) : t('partners.activateText', { name: item.name }),
      confirmLabel: deactivate ? t('action.deactivate') : t('action.activate'),
      danger: deactivate,
      async onConfirm() {
        const saved = await api('PATCH', `/organizations/${item.id}`, { active: !deactivate });
        state.orgs = null;
        toast(t('toast.saved', { title: saved.name }));
        onDone && onDone(saved);
      },
    });
  }
  function partnersStaff(panel, ctx) {
    const box = h('div');
    const reload = () => load();
    panel.append(h('div', { class: 'card-head' }, h('p', { class: 'muted', text: t('partners.staffHint') }), btn(t('partners.newStaff'), { cls: 'btn--primary', onClick: () => staffDialog(reload) })), box);
    const load = () => mount(box, ctx, async () => {
      const [data] = await Promise.all([api('GET', '/staff'), loadOrgs()]);
      return data.items || [];
    }, (rows) => {
      if (!rows.length) { box.appendChild(emptyState(t('partners.emptyStaff'), null)); return; }
      box.appendChild(dataTable({
        caption: t('partners.staff'), rows,
        search: (r) => [r.username, orgName(r.organization_id)].join(' '),
        filters: [
          { key: 'role', label: t('col.role'), options: ROLES.map((x) => ({ value: x, label: t('role.' + x) })), test: (r, v) => r.role === v },
          { key: 'active', label: t('col.status'), options: [{ value: '1', label: t('status.active') }, { value: '0', label: t('status.inactive') }], test: (r, v) => (r.active ? '1' : '0') === v },
        ],
        columns: [
          { label: t('col.username'), render: (r) => cellTitle(r.username, r.id === state.user.id ? t('partners.you') : null) },
          { label: t('col.role'), render: (r) => (r.role ? t('role.' + r.role) : t('partners.noRole')) },
          { label: t('form.organization'), render: (r) => (r.organization_id ? orgName(r.organization_id) : t('role.scope.global')) },
          { label: t('col.status'), render: (r) => badge(r.active ? 'active' : 'inactive') },
          { label: t('col.actions'), actions: true, render: (r) => [
            btn(t('partners.resetPassword'), { sm: true, aria: t('partners.resetPasswordFor', { name: r.username }), onClick: () => passwordDialog(r, reload) }),
            r.id === state.user.id ? null : btn(r.active ? t('action.deactivate') : t('action.activate'), { sm: true, cls: r.active ? 'btn--danger-outline' : 'btn--approve', onClick: () => staffToggle(r, reload) }),
          ] },
        ],
      }).el);
    });
    load();
  }
  function passwordFields() {
    const pw = field({ name: 'password', label: t('form.password'), type: 'password', required: true, attrs: { minlength: 10, maxlength: 128, autocomplete: 'new-password' }, hint: t('form.passwordHint') });
    const pw2 = field({ name: 'password2', label: t('form.passwordConfirm'), type: 'password', required: true, attrs: { minlength: 10, maxlength: 128, autocomplete: 'new-password' } });
    return { pw, pw2, check: () => [[pw2.input, pw.input.value === pw2.input.value, t('val.passwordMatch')]] };
  }
  function staffDialog(onDone) {
    let pf; let roleSel; let orgWrap;
    const active = (state.orgs || []).filter((o) => o.active);
    openDialog({
      title: t('partners.newStaff'),
      submitLabel: t('common.create'),
      build(body) {
        body.appendChild(alertBox('info', null, t('partners.staffIndividual')));
        body.appendChild(field({ name: 'username', label: t('col.username'), required: true, attrs: { maxlength: 150, autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', pattern: '[\\w.@+\\-]+' }, hint: t('form.usernameHint') }));
        const rf = field({ name: 'role', label: t('col.role'), type: 'select', required: true, value: 'cashier', options: ROLES.map((x) => ({ value: x, label: t('role.' + x) + ' — ' + t('role.desc.' + x) })) });
        roleSel = rf.input;
        body.appendChild(rf);
        orgWrap = field({ name: 'organization_id', label: t('form.organization'), type: 'select', required: true, options: [{ value: '', label: t('form.chooseOrg') }].concat(active.map((o) => ({ value: o.id, label: o.name }))) });
        body.appendChild(orgWrap);
        const sync = () => { const isAdm = roleSel.value === 'admin'; orgWrap.hidden = isAdm; orgWrap.input.required = !isAdm; };
        roleSel.addEventListener('change', sync);
        sync();
        pf = passwordFields();
        body.append(pf.pw, pf.pw2);
        return { validate: () => pf.check() };
      },
      async onSubmit(form) {
        const p = { username: form.username.value.trim(), password: form.password.value, role: form.role.value };
        if (p.role !== 'admin') p.organization_id = Number(form.organization_id.value);
        const saved = await api('POST', '/staff', p);
        form.password.value = ''; form.password2.value = '';
        toast(t('toast.created', { title: saved.username }));
        onDone && onDone(saved);
      },
    });
  }
  function passwordDialog(item, onDone) {
    let pf;
    openDialog({
      title: t('partners.resetPasswordFor', { name: item.username }),
      submitLabel: t('partners.resetPassword'),
      build(body) {
        body.appendChild(h('p', { class: 'muted', text: t('partners.resetHint') }));
        pf = passwordFields();
        body.append(pf.pw, pf.pw2);
        return { validate: () => pf.check() };
      },
      async onSubmit(form) {
        await api('PATCH', `/staff/${item.id}`, { password: form.password.value });
        form.password.value = ''; form.password2.value = '';
        toast(t('toast.passwordReset', { name: item.username }));
        onDone && onDone();
      },
    });
  }
  function staffToggle(item, onDone) {
    const deactivate = item.active;
    confirmDialog({
      title: deactivate ? t('partners.deactivateStaff') : t('partners.activateStaff'),
      text: t(deactivate ? 'partners.deactivateStaffText' : 'partners.activateStaffText', { name: item.username }),
      confirmLabel: deactivate ? t('action.deactivate') : t('action.activate'),
      danger: deactivate,
      async onConfirm() {
        await api('PATCH', `/staff/${item.id}`, { active: !deactivate });
        toast(t('toast.saved', { title: item.username }));
        onDone && onDone();
      },
    });
  }

  /* ====================================================== Section: Reviews */
  function viewReviews(view, ctx) {
    view.appendChild(pageHead(sectionLabel('reviews'), t('reviews.lead')));
    const rules = h('section', { class: 'card', 'aria-labelledby': 'rules-title' },
      h('h2', { id: 'rules-title', text: t('reviews.rulesTitle') }),
      h('ul', { class: 'rules' }, ['reviews.rule1', 'reviews.rule2', 'reviews.rule3', 'reviews.rule4', 'reviews.rule5'].map((k) => h('li', { text: t(k) }))));
    const box = h('div');
    view.append(box, rules);
    mount(box, ctx, async () => {
      const [ratings, events] = await Promise.all([
        api('GET', '/ratings'),
        api('GET', '/events').then((d) => d.items || []).catch(() => []),
        isAdmin() ? loadOrgs().catch(() => []) : null,
        loadStores().catch(() => []),
      ]);
      return { ratings, events };
    }, ({ ratings, events }) => {
      const rows = ratings.items || [];
      const threshold = ratings.threshold || 5;
      const targetName = (r) => {
        if (r.target_type === 'event') { const e = events.find((x) => String(x.id) === String(r.target_id)); return e ? e.title : t('kind.events') + ' #' + r.target_id; }
        return storeName(r.target_id);
      };
      const available = rows.filter((r) => r.status === 'available');
      box.appendChild(h('ul', { class: 'metrics', 'aria-label': t('reviews.summary') },
        h('li', { class: 'metric' }, h('p', { class: 'metric-label', text: t('reviews.targets') }), h('p', { class: 'metric-value', text: fmt.num(rows.length) })),
        h('li', { class: 'metric' }, h('p', { class: 'metric-label', text: t('reviews.published') }), h('p', { class: 'metric-value', text: fmt.num(available.length) }), h('p', { class: 'metric-note', text: t('reviews.thresholdNote', { n: threshold }) }))));
      if (!rows.length) { box.appendChild(h('div', { class: 'card' }, emptyState(t('reviews.emptyTitle'), t('reviews.emptyText')))); return; }
      box.appendChild(h('section', { class: 'card' }, dataTable({
        caption: t('reviews.tableCaption', { n: threshold }), rows,
        search: (r) => targetName(r) + ' ' + r.target_id,
        filters: [
          { key: 'type', label: t('col.type'), options: [{ value: 'store', label: t('target.store') }, { value: 'event', label: t('target.event') }], test: (r, v) => r.target_type === v },
          { key: 'status', label: t('col.status'), options: [{ value: 'available', label: t('ratingstatus.available') }, { value: 'insufficient_sample', label: t('ratingstatus.insufficient_sample') }], test: (r, v) => r.status === v },
        ],
        columns: [
          { label: t('reviews.target'), render: (r) => cellTitle(targetName(r), t('target.' + r.target_type)) },
          { label: t('reviews.count'), num: true, render: (r) => (r.count == null ? h('span', { class: 'muted', text: t('reviews.hidden', { n: threshold }) }) : fmt.num(r.count)) },
          { label: t('reviews.average'), num: true, render: (r) => (r.average == null ? '—' : [h('span', { class: 'stars', 'aria-hidden': 'true', text: '★ ' }), t('reviews.avgOf5', { v: fmt.avg(r.average) })]) },
          { label: t('col.status'), render: (r) => h('span', { class: 'badge badge--' + (r.status === 'available' ? 'approved' : 'paused'), text: t('ratingstatus.' + r.status) }) },
        ],
      }).el));
    });
  }

  /* ====================================================== Section: Counter */
  function freshCounter() { return { phone: '', member: null, benefits: null, benefitId: null, attempt: null, result: null, delivered: false }; }
  let counter = freshCounter();
  function newKey() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    const b = window.crypto.getRandomValues(new Uint8Array(16));
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }
  function benefitAvailable(b) {
    const now = Date.now();
    return b.status === 'approved' && Number(b.stock) > 0 && b.starts && b.ends && new Date(b.starts).getTime() <= now && now < new Date(b.ends).getTime();
  }

  function viewCounter(view, ctx) {
    view.appendChild(pageHead(sectionLabel('counter'), t('counter.lead')));
    const stepsEl = h('ol', { class: 'steps', 'aria-label': t('counter.steps') });
    const lookupCard = h('section', { class: 'card', 'aria-labelledby': 'lookup-title' });
    const flow = h('div', { 'aria-live': 'polite' });
    view.append(stepsEl, lookupCard, flow);

    function drawSteps() {
      const step = counter.result ? 3 : (counter.member && counter.member.status === 'active' && counter.benefitId ? 3 : (counter.member ? 2 : 1));
      stepsEl.replaceChildren(...['counter.step1', 'counter.step2', 'counter.step3'].map((k, i) => h('li', { class: i + 1 < step || counter.result ? 'is-done' : null, 'aria-current': i + 1 === step && !counter.result ? 'step' : null, text: t(k) })));
    }

    // Step 1: lookup by phone
    const errBox = h('div');
    const phoneF = field({ name: 'phone', label: t('counter.phone'), type: 'tel', required: true, value: counter.phone, attrs: { autocomplete: 'off', inputmode: 'tel', maxlength: 30, pattern: '[0-9()+\\-\\s.]{8,30}' }, hint: t('counter.phoneHint') });
    phoneF.input.dataset.patternMsg = t('srv.badPhone');
    const lookupBtn = h('button', { type: 'submit', class: 'btn btn--primary' }, icon('search'), h('span', { text: t('counter.lookup') }));
    const clearBtn = btn(t('counter.newService'), { onClick: () => { counter = freshCounter(); phoneF.input.value = ''; draw(); phoneF.input.focus(); } });
    const lookupForm = h('form', { class: 'lookup-form', novalidate: true }, phoneF, h('div', { class: 'page-actions' }, lookupBtn, clearBtn));
    lookupCard.append(h('h2', { id: 'lookup-title', text: t('counter.step1') }), h('p', { class: 'muted small', text: t('counter.privacy') }), errBox, lookupForm);

    async function doLookup(phone, quiet) {
      const data = await api('POST', '/members/lookup', { phone });
      counter.member = data.member || null;
      counter.benefitId = null; counter.attempt = null; counter.delivered = false;
      if (!quiet) counter.result = null;
      if (counter.member && counter.member.status === 'active') {
        const b = await api('GET', '/benefits');
        counter.benefits = (b.items || []);
      } else counter.benefits = null;
    }
    lookupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.replaceChildren();
      if (!validateForm(lookupForm, null)) return;
      counter = freshCounter();
      counter.phone = phoneF.input.value.trim();
      setBusy(lookupBtn, true, t('counter.looking'));
      try {
        await doLookup(counter.phone);
        if (!ctx.alive()) return;
        draw();
        const target = flow.querySelector('h2');
        if (target) { target.setAttribute('tabindex', '-1'); target.focus(); }
      } catch (err) {
        if (!ctx.alive()) return;
        counter.member = null;
        draw();
        if (!(err instanceof ApiError && err.status === 401)) showFormError(errBox, err);
      } finally {
        setBusy(lookupBtn, false);
        lookupBtn.replaceChildren(icon('search'), h('span', { text: t('counter.lookup') }));
      }
    });

    function memberCard(m) {
      const short = [m.first_name, m.last_name ? m.last_name.charAt(0) + '.' : ''].join(' ').trim();
      return h('div', { class: 'member-card' },
        h('dl', null,
          h('div', null, h('dt', { text: t('counter.member') }), h('dd', { text: short || '—' })),
          h('div', null, h('dt', { text: t('counter.phoneMasked') }), h('dd', { class: 'mono', text: m.phone_masked || '—' })),
          h('div', null, h('dt', { text: t('col.status') }), h('dd', null, badge(m.status, 'mstatus.'))),
          h('div', null, h('dt', { text: t('counter.balance') }), h('dd', { class: 'balance', text: t('counter.points', { n: fmt.num(m.balance) }) }))),
        h('p', { class: 'small muted', text: t('counter.unverified') }));
    }

    function draw() {
      drawSteps();
      flow.replaceChildren();
      if (counter.result) { flow.appendChild(receiptCard()); return; }
      if (!counter.phone) return;
      const m = counter.member;
      const card = h('section', { class: 'card', 'aria-labelledby': 'flow-title' });
      flow.appendChild(card);
      if (!m) {
        card.append(h('h2', { id: 'flow-title', text: t('counter.notFoundTitle') }), h('p', { text: t('counter.notFoundText') }), h('p', { class: 'small muted', text: t('counter.notFoundHint') }));
        return;
      }
      card.appendChild(h('h2', { id: 'flow-title', text: t('counter.step2') }));
      card.appendChild(memberCard(m));
      if (m.status === 'pending') {
        card.appendChild(alertBox('warn', t('counter.pendingTitle'), isAdmin() ? t('counter.pendingAdmin') : t('counter.pendingStaff')));
        if (isAdmin()) card.appendChild(btn(t('members.activate'), { cls: 'btn--primary', onClick: () => activateDialog(m, async () => { await doLookup(counter.phone, true); draw(); }) }));
        return;
      }
      if (m.status !== 'active') {
        card.appendChild(alertBox('error', t('counter.inactiveTitle'), t('counter.inactiveText')));
        return;
      }
      const list = (counter.benefits || []).filter(benefitAvailable);
      if (!list.length) {
        card.appendChild(emptyState(t('counter.noBenefits'), isAdmin() ? t('counter.noBenefitsAdmin') : t('counter.noBenefitsStaff'), role() === 'cashier' ? null : h('a', { class: 'btn btn--secondary', href: '#/benefits', text: t('nav.benefits') })));
        return;
      }
      const form = h('form', { novalidate: true });
      const fsId = uid('ben');
      const fs = h('fieldset', { 'aria-describedby': fsId + '-err' }, h('legend', { text: t('counter.chooseBenefit') }));
      const radios = h('div', { class: 'radio-cards' });
      list.forEach((b) => {
        const enough = Number(m.balance) >= Number(b.points_cost);
        const id = uid('rb');
        const input = h('input', { type: 'radio', name: 'benefit', id, value: String(b.id), checked: counter.benefitId === b.id, disabled: !enough, required: true });
        input.addEventListener('change', () => {
          counter.benefitId = b.id;
          counter.delivered = false;
          if (!counter.attempt || counter.attempt.benefitId !== b.id || counter.attempt.memberId !== m.id) counter.attempt = null;
          draw();
          const again = flow.querySelector(`input[name=benefit][value="${b.id}"]`);
          if (again) again.focus();
        });
        radios.appendChild(h('label', { class: 'radio-card', for: id }, input, h('span', null,
          h('span', { class: 'radio-card-title', text: b.title }),
          h('span', { class: 'radio-card-meta' }, h('span', { class: 'points', text: t('counter.points', { n: fmt.num(b.points_cost) }) }), ' · ', t('counter.stockLeft', { n: fmt.num(b.stock) })),
          isAdmin() ? h('span', { class: 'radio-card-meta', text: b.organization_name || orgName(b.organization_id) }) : null,
          enough ? null : h('span', { class: 'radio-card-meta', text: t('counter.notEnough') }))));
      });
      fs.append(radios, h('p', { class: 'field-error', id: fsId + '-err', hidden: true }));
      form.appendChild(fs);
      const sel = list.find((b) => b.id === counter.benefitId);
      if (sel) {
        const confirmBox = h('section', { class: 'confirm-box', 'aria-labelledby': 'confirm-title' },
          h('h3', { id: 'confirm-title', text: t('counter.step3') }),
          h('dl', { class: 'kv' },
            h('dt', { text: t('counter.benefit') }), h('dd', { text: sel.title }),
            h('dt', { text: t('counter.debit') }), h('dd', { class: 'points', text: t('counter.points', { n: fmt.num(sel.points_cost) }) }),
            h('dt', { text: t('counter.balanceAfter') }), h('dd', { text: t('counter.points', { n: fmt.num(Number(m.balance) - Number(sel.points_cost)) }) })));
        const deliveredF = checkField({ name: 'delivered', label: t('counter.deliveredCheck'), required: true, checked: counter.delivered });
        deliveredF.input.addEventListener('change', () => { counter.delivered = deliveredF.input.checked; });
        const errSlot = h('div');
        const confirmBtn = h('button', { type: 'submit', class: 'btn btn--primary', text: counter.attempt ? t('counter.retryConfirm') : t('counter.confirm') });
        confirmBox.append(deliveredF, errSlot,
          counter.attempt ? alertBox('warn', null, t('counter.retryNote')) : null,
          h('div', { class: 'form-actions' }, btn(t('common.cancel'), { onClick: () => { counter.benefitId = null; counter.attempt = null; counter.delivered = false; draw(); } }), confirmBtn));
        form.appendChild(confirmBox);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (confirmBtn.disabled) return;
          errSlot.replaceChildren();
          if (!validateForm(form, null)) return;
          // Reuse the same key for retries of the same (member, benefit) pair so the server never duplicates.
          if (!counter.attempt || counter.attempt.memberId !== m.id || counter.attempt.benefitId !== sel.id) {
            counter.attempt = { memberId: m.id, benefitId: sel.id, key: newKey() };
          }
          setBusy(confirmBtn, true, t('counter.confirming'));
          try {
            const r = await api('POST', '/redemptions', { member_id: m.id, benefit_id: sel.id, idempotency_key: counter.attempt.key });
            if (!ctx.alive()) return;
            counter.result = r;
            counter.attempt = null;
            let refreshed = null;
            try { const d = await api('POST', '/members/lookup', { phone: counter.phone }); refreshed = d.member; } catch (_) { refreshed = null; }
            counter.result._balance = refreshed ? refreshed.balance : null;
            counter.phone = '';
            phoneF.input.value = '';
            draw();
            announce(t('counter.successAnnounce'));
            const h2 = flow.querySelector('h2');
            if (h2) { h2.setAttribute('tabindex', '-1'); h2.focus(); }
          } catch (err) {
            if (!ctx.alive()) return;
            setBusy(confirmBtn, false);
            confirmBtn.textContent = t('counter.retryConfirm');
            if (err instanceof ApiError && err.status === 401) return;
            // Business rejections (409/404) are final for this key; network/5xx keep the key for a safe retry.
            const definitive = err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429;
            if (definitive) counter.attempt = null;
            errSlot.replaceChildren(alertBox('error', t('counter.failedTitle'), errorText(err) + ' ' + (definitive ? t('counter.failedFinal') : t('counter.failedRetry'))));
            errSlot.firstChild.setAttribute('tabindex', '-1');
            errSlot.firstChild.focus();
          }
        });
      }
      card.appendChild(form);
    }

    function receiptCard() {
      const r = counter.result;
      return h('section', { class: 'card', 'aria-labelledby': 'receipt-title' },
        h('div', { class: 'receipt' },
          h('h2', { id: 'receipt-title', text: t('counter.successTitle') }),
          h('p', { text: t('counter.successText') }),
          h('dl', null,
            h('dt', { text: t('counter.receiptId') }), h('dd', { class: 'mono', text: '#' + r.id }),
            h('dt', { text: t('counter.benefit') }), h('dd', { text: r.title }),
            h('dt', { text: t('counter.debit') }), h('dd', { text: t('counter.points', { n: fmt.num(r.points) }) }),
            h('dt', { text: t('col.date') }), h('dd', { text: fmt.date(r.created_at) }),
            h('dt', { text: t('col.status') }), h('dd', null, badge(r.status, 'rstatus.')),
            r._balance != null ? [h('dt', { text: t('counter.newBalance') }), h('dd', { text: t('counter.points', { n: fmt.num(r._balance) }) })] : null)),
        h('div', { class: 'form-actions' },
          h('a', { class: 'btn btn--secondary', href: '#/redemptions', text: t('counter.viewRedemptions') }),
          btn(t('counter.newService'), { cls: 'btn--primary', onClick: () => { counter = freshCounter(); draw(); phoneF.input.value = ''; phoneF.input.focus(); } })));
    }

    if (isAdmin()) loadOrgs().catch(() => null);
    draw();
  }

  /* ================================================== Section: Redemptions */
  function viewRedemptions(view, ctx) {
    view.appendChild(pageHead(sectionLabel('redemptions'), isAdmin() ? t('redemptions.leadAdmin') : t('redemptions.leadStaff'),
      [h('a', { class: 'btn btn--primary', href: '#/counter', text: t('redemptions.newAtCounter') })]));
    const box = h('div');
    view.appendChild(box);
    const reload = () => load();
    const load = () => mount(box, ctx, async () => {
      const [data] = await Promise.all([api('GET', '/redemptions'), isAdmin() ? loadOrgs().catch(() => []) : null]);
      return data.items || [];
    }, (rows) => {
      if (!rows.length) { box.appendChild(emptyState(t('redemptions.emptyTitle'), t('redemptions.emptyText'))); return; }
      const columns = [
        { label: t('col.id'), render: (r) => h('span', { class: 'mono', text: '#' + r.id }) },
        { label: t('col.date'), render: (r) => fmt.date(r.created_at) },
        { label: t('counter.benefit'), render: (r) => r.title },
        { label: t('counter.member'), render: (r) => h('span', { class: 'mono', text: '#' + r.member_id }) },
      ];
      if (isAdmin()) columns.push({ label: t('form.organization'), render: (r) => orgName(r.organization_id) });
      columns.push(
        { label: t('col.points'), num: true, render: (r) => fmt.num(r.points) },
        { label: t('col.status'), render: (r) => badge(r.status, 'rstatus.') });
      if (isAdmin()) columns.push({ label: t('col.actions'), actions: true, render: (r) => (r.status === 'redeemed' ? btn(t('redemptions.reverse'), { sm: true, cls: 'btn--danger-outline', aria: t('redemptions.reverseNamed', { id: r.id }), onClick: () => reverseDialog(r, reload) }) : null) });
      box.appendChild(dataTable({
        caption: sectionLabel('redemptions'), rows, columns,
        search: (r) => [r.id, r.title, r.member_id].join(' '),
        filters: [{ key: 'status', label: t('col.status'), options: ['redeemed', 'reversed'].map((s) => ({ value: s, label: t('rstatus.' + s) })), test: (r, v) => r.status === v }],
      }).el);
    });
    load();
  }
  function reverseDialog(r, onDone) {
    openDialog({
      title: t('redemptions.reverseTitle', { id: r.id }),
      submitLabel: t('redemptions.reverse'),
      submitCls: 'btn--danger',
      busyLabel: t('common.saving'),
      build(body) {
        body.appendChild(h('dl', { class: 'kv' },
          h('dt', { text: t('counter.benefit') }), h('dd', { text: r.title }),
          h('dt', { text: t('col.points') }), h('dd', { text: fmt.num(r.points) }),
          h('dt', { text: t('col.date') }), h('dd', { text: fmt.date(r.created_at) })));
        body.appendChild(h('p', { class: 'muted', text: t('redemptions.reverseText') }));
        body.appendChild(field({ name: 'reason', label: t('form.reason'), type: 'textarea', rows: 3, required: true, attrs: { maxlength: 240, minlength: 5 }, hint: t('form.reasonHint') }));
      },
      async onSubmit(form) {
        const saved = await api('POST', `/redemptions/${r.id}/reverse`, { reason: form.reason.value.trim() });
        toast(t('toast.reversed', { id: saved.id }));
        onDone && onDone(saved);
      },
    });
  }

  /* ====================================================== Section: Members */
  function viewMembers(view, ctx) {
    view.appendChild(pageHead(sectionLabel('members'), t('members.lead')));
    view.appendChild(alertBox('info', null, t('members.rules')));
    const box = h('div');
    view.appendChild(box);
    const reload = () => load();
    const load = () => mount(box, ctx, () => api('GET', '/members').then((d) => d.items || []), (rows) => {
      if (!rows.length) { box.appendChild(emptyState(t('members.emptyTitle'), t('members.emptyText'))); return; }
      box.appendChild(dataTable({
        caption: sectionLabel('members'), rows,
        search: (r) => [r.first_name, r.last_name, r.phone_masked, r.id].join(' '),
        filters: [{ key: 'status', label: t('col.status'), options: ['pending', 'active', 'suspended', 'closed'].map((s) => ({ value: s, label: t('mstatus.' + s) })), test: (r, v) => r.status === v }],
        columns: [
          { label: t('col.name'), render: (r) => cellTitle(r.status === 'closed' ? t('members.closedName') : [r.first_name, r.last_name].join(' '), '#' + r.id) },
          { label: t('counter.phoneMasked'), render: (r) => h('span', { class: 'mono', text: r.phone_masked || '—' }) },
          { label: t('col.status'), render: (r) => badge(r.status, 'mstatus.') },
          { label: t('counter.balance'), num: true, render: (r) => fmt.num(r.balance) },
          { label: t('col.created'), render: (r) => fmt.date(r.created_at) },
          { label: t('col.actions'), actions: true, render: (r) => [
            r.status === 'pending' || r.status === 'suspended' ? btn(t('members.activate'), { sm: true, cls: 'btn--approve', onClick: () => activateDialog(r, reload) }) : null,
            r.status === 'active' ? btn(t('members.suspend'), { sm: true, cls: 'btn--danger-outline', onClick: () => suspendDialog(r, reload) }) : null,
            btn(t('members.ledger'), { sm: true, onClick: () => ledgerDialog(r) }),
            r.status !== 'closed' ? btn(t('members.close'), { sm: true, cls: 'btn--danger-outline', onClick: () => closeDialog(r, reload) }) : null,
          ] },
        ],
      }).el);
    });
    load();
  }
  function memberLabel(m) { return [m.first_name, m.last_name].join(' ').trim() || '#' + m.id; }
  function activateDialog(m, onDone) {
    openDialog({
      title: t('members.activateTitle', { name: memberLabel(m) }),
      submitLabel: t('members.activate'),
      build(body) {
        body.appendChild(h('p', { text: t('members.activateText') }));
        body.appendChild(alertBox('warn', null, t('counter.unverified')));
        body.appendChild(checkField({ name: 'confirmed_18', label: t('members.confirm18'), required: true }));
      },
      async onSubmit(form) {
        await api('POST', `/members/${m.id}/activate`, { confirmed_18: form.confirmed_18.checked === true });
        toast(t('toast.memberActivated'));
        onDone && (await onDone());
      },
    });
  }
  function suspendDialog(m, onDone) {
    confirmDialog({
      title: t('members.suspendTitle'),
      text: t('members.suspendText', { name: memberLabel(m) }),
      confirmLabel: t('members.suspend'),
      danger: true,
      async onConfirm() {
        await api('POST', `/members/${m.id}/suspend`, {});
        toast(t('toast.memberSuspended'));
        onDone && onDone();
      },
    });
  }
  function closeDialog(m, onDone) {
    openDialog({
      title: t('members.closeTitle', { name: memberLabel(m) }),
      submitLabel: t('members.close'),
      submitCls: 'btn--danger',
      build(body) {
        body.appendChild(h('p', { text: t('members.closeText') }));
        body.appendChild(field({ name: 'reason', label: t('form.reason'), type: 'textarea', rows: 3, required: true, attrs: { maxlength: 240, minlength: 5 } }));
        if (Number(m.balance) > 0) {
          body.appendChild(alertBox('warn', null, t('members.closeBalance', { n: fmt.num(m.balance) })));
          body.appendChild(checkField({ name: 'forfeit_balance', label: t('members.forfeit'), required: true }));
        }
      },
      async onSubmit(form) {
        const p = { reason: form.reason.value.trim() };
        if (form.forfeit_balance) p.forfeit_balance = form.forfeit_balance.checked === true;
        await api('POST', `/members/${m.id}/close`, p);
        toast(t('toast.memberClosed'));
        onDone && onDone();
      },
    });
  }
  function ledgerDialog(m) {
    openDialog({
      title: t('members.ledgerTitle', { name: m.status === 'closed' ? '#' + m.id : memberLabel(m) }),
      wide: true,
      readOnly: true,
      build(body) {
        const box = h('div');
        body.appendChild(box);
        let alive = true;
        const ctx = { alive: () => alive && document.contains(box) };
        mount(box, ctx, () => api('GET', `/members/${m.id}/ledger`).then((d) => d.items || []), (rows) => {
          if (!rows.length) { box.appendChild(emptyState(t('members.ledgerEmpty'), null)); return; }
          box.appendChild(dataTable({
            caption: t('members.ledger'), rows,
            columns: [
              { label: t('col.date'), render: (r) => fmt.date(r.created_at) },
              { label: t('col.type'), render: (r) => t('ledger.' + r.kind) === 'ledger.' + r.kind ? r.kind : t('ledger.' + r.kind) },
              { label: t('col.points'), num: true, render: (r) => h('span', { class: Number(r.delta) >= 0 ? 'points' : 'neg', text: (Number(r.delta) > 0 ? '+' : '') + fmt.num(r.delta) }) },
              { label: t('form.reason'), render: (r) => r.reason || '—' },
            ],
          }).el);
        });
        return {};
      },
    });
  }

  /* ====================================================== Section: Account */
  function viewAccount(view) {
    const u = state.user;
    view.appendChild(pageHead(sectionLabel('account'), t('account.lead')));
    const langId = uid('lang');
    const langSel = h('select', { id: langId }, LANGS.map((l) => h('option', { value: l, selected: l === state.lang, text: t('lang.name.' + l) })));
    langSel.addEventListener('change', () => setLang(langSel.value));
    view.appendChild(h('div', { class: 'grid-2' },
      h('section', { class: 'card', 'aria-labelledby': 'acc-title' },
        h('h2', { id: 'acc-title', text: t('account.profile') }),
        h('dl', { class: 'kv' },
          h('dt', { text: t('col.username') }), h('dd', { text: u.username }),
          h('dt', { text: t('col.role') }), h('dd', { text: t('role.' + u.role) + ' — ' + t('role.desc.' + u.role) }),
          h('dt', { text: t('form.organization') }), h('dd', { text: u.organization_name || t('role.scope.global') })),
        h('hr'),
        h('div', { class: 'field' }, h('label', { for: langId, text: t('lang.label') }), langSel, h('p', { class: 'field-hint', text: t('account.langHint') })),
        btn(t('nav.logout'), { cls: 'btn--danger-outline', icon: 'logout', onClick: logout })),
      h('section', { class: 'card', 'aria-labelledby': 'sec-title' },
        h('h2', { id: 'sec-title', text: t('account.security') }),
        h('ul', { class: 'rules' }, ['account.sec1', 'account.sec2', 'account.sec3', 'account.sec4'].map((k) => h('li', { text: t(k) }))))));
  }

  /* ------------------------------------------------------------------ go */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
