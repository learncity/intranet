/* Learn City Staff Hub. Overview, apps, weekly highlights, reminders. */
(function () {
'use strict';

const ENDPOINT = 'https://script.google.com/macros/s/AKfycbxahzgarriiZeHw-RCWr8PivATnm1ajQa3cUcadNyyj0eNYdUFT4zbt8_yqxQSxSBqW/exec';
const ACTION_PREFIX = 'intranet.';
const K_EMAIL = 'LC_HUB_EMAIL', K_CODE = 'LC_HUB_CODE';
const TIP_MS = 8000, REFRESH_AFTER_MS = 45000;

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let state = { creds: null, data: null, view: 'overview', loadedAt: 0, removing: '' };
let tick = { list: [], i: 0, timer: null, paused: false };

function readSaved() {
  try { return { email: localStorage.getItem(K_EMAIL) || sessionStorage.getItem(K_EMAIL) || '', code: localStorage.getItem(K_CODE) || sessionStorage.getItem(K_CODE) || '' }; }
  catch (e) { return { email: '', code: '' }; }
}
function clearSaved() { try { [localStorage, sessionStorage].forEach(s => { s.removeItem(K_EMAIL); s.removeItem(K_CODE); }); } catch (e) {} }
function save(c, remember) { try { clearSaved(); const s = remember ? localStorage : sessionStorage; s.setItem(K_EMAIL, c.email); s.setItem(K_CODE, c.code); } catch (e) {} }

function fatal(msg) { const b = $('errorBar'); b.textContent = msg; b.hidden = false; }

function call(action, extra) {
  const payload = Object.assign({ action: ACTION_PREFIX + action }, state.creds, extra || {});
  return fetch(ENDPOINT, { method: 'POST', body: new URLSearchParams({ data: JSON.stringify(payload) }) }).then(r => r.json());
}

function show(which) {
  $('signinView').hidden = which !== 'signin';
  $('hubView').hidden = which !== 'hub';
  $('loadingView').hidden = which !== 'loading';
}

function firstName(n) { return String(n || '').trim().split(/\s+/)[0] || 'there'; }
function prettyDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); if (!m) return '';
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/* ---------- apps ---------- */
function appCard(a) {
  let action, badge = '';
  if (a.state === 'soon') {
    badge = '<span class="badge badge--info"><span aria-hidden="true">◷</span> Coming soon</span>';
    action = '<span class="btn btn--disabled" aria-disabled="true">Not open yet</span>';
  } else if (a.state === 'unavailable') {
    badge = '<span class="badge badge--danger"><span aria-hidden="true">!</span> Needs attention</span>';
    action = '<span class="btn btn--disabled" aria-disabled="true">Not available</span>';
  } else if (a.state === 'closed') {
    badge = '<span class="badge badge--warning"><span aria-hidden="true">⏸</span> Closed for now</span>';
    action = '<span class="btn btn--disabled" aria-disabled="true">Closed for now</span>';
  } else {
    if (a.closedForStaff) badge = '<span class="badge badge--warning"><span aria-hidden="true">⏸</span> Closed to staff</span>';
    action = '<a class="btn btn--primary" href="' + esc(a.url) + '" target="_blank" rel="noopener">Open ' + esc(a.name) + ' <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a>';
  }
  return '<article class="card app-card" data-app="' + esc(a.id) + '" data-state="' + esc(a.state) + '">' +
    '<div class="app-card__top"><span class="app-card__icon" aria-hidden="true">' + esc(a.name.charAt(0)) + '</span><h3 class="app-card__name">' + esc(a.name) + '</h3></div>' +
    badge + '<p class="app-card__desc">' + esc(a.desc) + '</p>' +
    (a.note ? '<p class="app-card__note">' + esc(a.note) + '</p>' : '') + action + '</article>';
}

function renderApps() {
  const d = state.data; if (!d) return;
  const q = $('search').value.trim().toLowerCase();
  const apps = d.apps.filter(a => !q || (a.name + ' ' + a.desc).toLowerCase().indexOf(q) !== -1);
  const empty = '<div class="card empty-state search-empty"><div class="empty-state__title">' + (q ? 'No app matches “' + esc(q) + '”' : 'No apps yet') + '</div><p>' + (q ? 'Try a different word, or clear the search.' : 'Your role has no apps set up yet. Please ask the Head of IT.') + '</p></div>';
  $('overviewApps').innerHTML = apps.length ? apps.map(appCard).join('') : empty;
  const groups = {}; apps.forEach(a => { (groups[a.group || 'Apps'] = groups[a.group || 'Apps'] || []).push(a); });
  const keys = Object.keys(groups);
  $('appsList').innerHTML = keys.length ? keys.map(g => '<div class="section-label">' + esc(g) + '</div><div class="grid grid--3">' + groups[g].map(appCard).join('') + '</div>').join('') : empty;
}

/* ---------- numbers ---------- */
function statBadge(c) {
  if (!c.state) return '';
  const map = { done: ['success', '✓'], waiting: ['warning', '!'], quiet: ['info', '–'] }[c.state] || ['info', ''];
  return '<span class="badge badge--' + map[0] + '"><span aria-hidden="true">' + map[1] + '</span> ' + esc(c.note) + '</span>';
}
function statCard(c) {
  return '<div class="card stat" data-stat="' + esc(c.id) + '"><div class="metric__label">' + esc(c.label) + '</div><div class="metric__value">' + esc(c.value) + '</div>' +
    (c.state ? statBadge(c) : '<div class="stat__note">' + esc(c.note) + '</div>') + '</div>';
}
function renderStats() {
  const d = state.data;
  $('statsBlock').hidden = !(d.stats || d.statsError);
  if (d.stats) { $('statsLabel').textContent = d.stats.label; $('statsGrid').innerHTML = d.stats.cards.map(statCard).join(''); }
  else $('statsGrid').innerHTML = '';
  $('statsError').hidden = !d.statsError; $('statsError').textContent = d.statsError || '';
  $('sgBlock').hidden = !d.safeguarding;
  if (d.safeguarding) { $('sgLabel').textContent = 'Safeguarding · ' + d.safeguarding.label; $('sgGrid').innerHTML = d.safeguarding.cards.map(statCard).join(''); }
}

/* ---------- reminders and tips ---------- */
function renderReminders() {
  const list = state.data.reminders || [];
  $('reminders').innerHTML = list.map(r =>
    '<div class="notice notice--warning reminder" data-reminder="' + esc(r.id) + '"><div class="reminder__main"><span class="reminder__icon" aria-hidden="true">!</span><div><p class="notice__title">' + esc(r.title) + '</p>' + esc(r.text) + '</div></div>' +
    (r.url ? '<a class="btn btn--primary" href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.actionLabel || 'Open') + ' <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a>' : '') + '</div>').join('');
}
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function reducedMotion() { try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
function showTip(i) {
  if (!tick.list.length) return;
  tick.i = (i + tick.list.length) % tick.list.length;
  const t = tick.list[tick.i], el = $('tickerText');
  el.innerHTML = esc(t.text) + (t.url ? ' <a href="' + esc(t.url) + '" target="_blank" rel="noopener">Open Spark Points<span class="sr-only"> (opens in a new tab)</span></a>' : '');
}
function stopTicker() { if (tick.timer) { clearInterval(tick.timer); tick.timer = null; } }
function startTicker() {
  stopTicker();
  if (tick.paused || reducedMotion() || tick.list.length < 2) return;
  tick.timer = setInterval(() => {
    const el = $('tickerText'); el.classList.add('is-fading');
    setTimeout(() => { showTip(tick.i + 1); el.classList.remove('is-fading'); }, 250);
  }, TIP_MS);
}
function renderTicker() {
  const tips = state.data.tips || [];
  $('ticker').hidden = !tips.length;
  if (!tips.length) { stopTicker(); tick.list = []; return; }
  if (!tick.list.length) { tick.list = shuffle(tips); tick.i = 0; tick.paused = reducedMotion(); }
  showTip(tick.i);
  $('tickerPause').textContent = tick.paused ? 'Play' : 'Pause';
  $('tickerPause').setAttribute('aria-pressed', tick.paused ? 'true' : 'false');
  $('tickerPause').setAttribute('aria-label', tick.paused ? 'Play tips' : 'Pause tips');
  $('tickerPause').hidden = reducedMotion() || tick.list.length < 2;
  $('tickerNext').hidden = tick.list.length < 2;
  startTicker();
}

/* ---------- highlights ---------- */
function renderHighlights() {
  const d = state.data, list = d.notices || [];
  $('weekLabel').textContent = d.weekLabel || '';
  $('postBtn').hidden = !d.canPublish;
  $('hlList').innerHTML = list.length ? list.map(n =>
    '<article class="hl" data-notice="' + esc(n.id) + '"><h3 class="hl__title">' + (n.pinned ? '<span class="badge badge--info" style="margin-right:8px">Pinned</span>' : '') + esc(n.title) + '</h3>' +
    (n.body ? '<p class="hl__body">' + esc(n.body) + '</p>' : '') +
    '<div class="hl__meta"><span>' + esc(n.postedBy) + ' · ' + esc(n.postedOn) + '</span><span>Shows until ' + esc(n.until) + '</span>' +
    (n.canRemove ? (state.removing === n.id
      ? '<button class="btn btn--danger" type="button" data-remove-confirm="' + esc(n.id) + '">Yes, remove it</button><button class="btn btn--quiet" type="button" data-remove-cancel="1">Keep it</button>'
      : '<button class="btn btn--quiet" type="button" data-remove="' + esc(n.id) + '">Remove</button>') : '') +
    '</div></article>').join('')
    : '<div class="empty-state" style="padding:24px 0"><div class="empty-state__title">Nothing posted for this week yet</div><p>' + (d.canPublish ? 'Use “Post a highlight” to share what is happening.' : 'Check back later in the week.') + '</p></div>';
}
function openPost(open) {
  $('postForm').hidden = !open; $('postBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) $('hlTitle').focus();
}
function submitPost(ev) {
  ev.preventDefault();
  const title = $('hlTitle').value.trim(), e = $('hlError');
  if (!title) { e.textContent = 'Please give the highlight a title.'; e.hidden = false; return; }
  e.hidden = true; $('hlSubmit').disabled = true;
  call('postNotice', { title: title, body: $('hlBody').value.trim(), until: $('hlUntil').value, pinned: $('hlPin').checked }).then(r => {
    $('hlSubmit').disabled = false;
    if (!r || !r.success) { e.textContent = (r && r.error) || 'We couldn’t post that. Please try again.'; e.hidden = false; return; }
    $('postForm').reset(); openPost(false); refresh(true);
  }).catch(() => { $('hlSubmit').disabled = false; e.textContent = 'We couldn’t reach the school server. Please try again.'; e.hidden = false; });
}
function removeNotice(id) {
  call('removeNotice', { id: id }).then(r => {
    state.removing = '';
    if (!r || !r.success) { fatal((r && r.error) || 'We couldn’t remove that highlight.'); renderHighlights(); return; }
    refresh(true);
  }).catch(() => { state.removing = ''; fatal('We couldn’t reach the school server. Please try again.'); renderHighlights(); });
}

/* ---------- page ---------- */
function render() {
  const d = state.data; if (!d) return;
  const p = d.profile;
  $('chipName').textContent = p.fullName; $('chipRole').textContent = p.role;
  $('heroDate').textContent = prettyDate(d.today);
  $('heroTitle').textContent = 'Welcome, ' + firstName(p.fullName);
  $('heroSub').textContent = p.role + (p.homeClass ? ' · ' + p.homeClass : '');
  const facts = []; if (d.term) facts.push(d.term); if (d.session) facts.push(d.session + ' session');
  $('heroFacts').innerHTML = facts.map(f => '<span class="badge">' + esc(f) + '</span>').join('');
  renderReminders(); renderTicker(); renderStats(); renderApps(); renderHighlights();
}

function setView(v) {
  if (['overview', 'apps', 'help'].indexOf(v) === -1) v = 'overview';
  state.view = v;
  document.querySelectorAll('[data-pane]').forEach(el => { el.hidden = el.getAttribute('data-pane') !== v; });
  document.querySelectorAll('.nav__link').forEach(a => { if (a.getAttribute('data-view') === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  closeNav();
}
function openNav() { $('hubView').setAttribute('data-nav-open', 'true'); $('menuBtn').setAttribute('aria-expanded', 'true'); }
function closeNav() { $('hubView').setAttribute('data-nav-open', 'false'); $('menuBtn').setAttribute('aria-expanded', 'false'); }

/* Quiet reload: keeps the page on screen, so reminders clear after a register is taken. */
function refresh(force) {
  if (!state.creds || !state.data) return Promise.resolve();
  if (!force && Date.now() - state.loadedAt < REFRESH_AFTER_MS) return Promise.resolve();
  return call('bootstrap').then(r => { if (r && r.success) { state.data = r; state.loadedAt = Date.now(); render(); } }).catch(() => {});
}

function load(creds, remember, fromSaved, quiet) {
  state.creds = creds;
  const btn = $('signinBtn'); btn.disabled = true; btn.textContent = 'Signing in…';
  if (fromSaved || quiet) show('loading');
  return call('bootstrap').then(r => {
    btn.disabled = false; btn.textContent = 'Sign in';
    if (!r || !r.success) {
      clearSaved(); state.creds = null; show('signin');
      const e = $('signinError'); e.textContent = (r && r.error) || 'We couldn’t sign you in. Please try again.'; e.hidden = false; return;
    }
    if (!fromSaved) save(creds, remember);
    state.data = r; state.loadedAt = Date.now(); show('hub'); render(); setView((location.hash || '').replace('#', ''));
    $('main').focus({ preventScroll: true });
  }).catch(() => {
    btn.disabled = false; btn.textContent = 'Sign in'; show('signin');
    fatal('We couldn’t reach the school server. Check your internet connection and try again.');
  });
}

function signOut() { stopTicker(); tick.list = []; clearSaved(); state = { creds: null, data: null, view: 'overview', loadedAt: 0, removing: '' }; $('code').value = ''; $('signinError').hidden = true; show('signin'); }

function wire() {
  ['signinForm', 'email', 'code', 'remember', 'signinBtn', 'signinError', 'hubView', 'loadingView', 'menuBtn', 'search', 'signoutBtn', 'overviewApps', 'appsList', 'scrim', 'errorBar', 'main',
   'ticker', 'tickerText', 'tickerNext', 'tickerPause', 'reminders', 'statsBlock', 'statsGrid', 'sgBlock', 'sgGrid', 'highlights', 'hlList', 'postBtn', 'postForm', 'hlTitle', 'hlBody', 'hlUntil', 'hlPin', 'hlError', 'hlSubmit', 'hlCancel', 'weekLabel']
    .forEach(id => { if (!$(id)) throw new Error('Missing element #' + id); });
  $('signinForm').addEventListener('submit', ev => {
    ev.preventDefault();
    const email = $('email').value.trim(), code = $('code').value.trim(), e = $('signinError');
    if (!email || !code) { e.textContent = 'Please enter your email and your code.'; e.hidden = false; return; }
    e.hidden = true; $('errorBar').hidden = true;
    load({ email: email, code: code }, $('remember').checked, false);
  });
  $('signoutBtn').addEventListener('click', signOut);
  $('menuBtn').addEventListener('click', () => ($('hubView').getAttribute('data-nav-open') === 'true' ? closeNav() : openNav()));
  $('scrim').addEventListener('click', closeNav);
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeNav(); });
  $('search').addEventListener('input', () => { renderApps(); if (state.view === 'help') location.hash = '#apps'; });
  window.addEventListener('hashchange', () => { if (state.data) setView((location.hash || '').replace('#', '')); });
  $('tickerNext').addEventListener('click', () => { showTip(tick.i + 1); startTicker(); });
  $('tickerPause').addEventListener('click', () => { tick.paused = !tick.paused; renderTicker(); });
  $('postBtn').addEventListener('click', () => openPost($('postForm').hidden));
  $('hlCancel').addEventListener('click', () => { $('postForm').reset(); $('hlError').hidden = true; openPost(false); $('postBtn').focus(); });
  $('postForm').addEventListener('submit', submitPost);
  $('hlList').addEventListener('click', ev => {
    const t = ev.target.closest('button'); if (!t) return;
    if (t.hasAttribute('data-remove')) { state.removing = t.getAttribute('data-remove'); renderHighlights(); }
    else if (t.hasAttribute('data-remove-cancel')) { state.removing = ''; renderHighlights(); }
    else if (t.hasAttribute('data-remove-confirm')) removeNotice(t.getAttribute('data-remove-confirm'));
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(false); });
  window.addEventListener('focus', () => refresh(false));
}

function start() {
  wire();
  const qs = new URLSearchParams(location.search), qe = qs.get('email'), qc = qs.get('code');
  if (qe && qc) {
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
    load({ email: qe.trim(), code: qc.trim() }, false, false, true); return;
  }
  const s = readSaved();
  if (s.email && s.code) load(s, false, true); else show('signin');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
