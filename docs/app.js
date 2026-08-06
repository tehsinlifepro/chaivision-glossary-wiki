/* ChaiVision Glossary Wiki — client.
   Passcode decrypts data.enc.json (AES-GCM, key via PBKDF2 — mirrors build.mjs),
   then renders a hero stat, department leaderboard, and A–Z searchable glossary. */

const DEPARTMENTS = ['Operations', 'Marketing', 'HR', 'Finance', 'Sales', 'Product Development'];
const ITERATIONS = 150000;
const $ = (sel) => document.querySelector(sel);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let TERMS = [];
let activeDept = 'All';
let query = '';

/* ---------- theme ---------- */
function initTheme() {
  const saved = localStorage.getItem('cv-theme');
  document.documentElement.setAttribute('data-theme', saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
}
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('cv-theme', next);
}

/* ---------- crypto ---------- */
const b64ToBuf = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
async function decrypt(payload, passcode) {
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey('raw', enc.encode(passcode), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64ToBuf(payload.salt), iterations: payload.iterations || ITERATIONS, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBuf(payload.iv) }, key, b64ToBuf(payload.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

/* ---------- helpers ---------- */
function esc(s) { return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
function highlight(text, q) {
  const safe = esc(text);
  if (!q) return safe;
  const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
  return safe.replace(re, '<mark>$1</mark>');
}
function countUp(el, target) {
  if (reduceMotion || target === 0) { el.textContent = target; return; }
  const dur = 900, start = Date.now();
  const step = () => {
    const p = Math.min(1, (Date.now() - start) / dur);
    el.textContent = Math.round((1 - Math.pow(1 - p, 3)) * target);
    if (p < 1) setTimeout(step, 16); else el.textContent = target; // guaranteed final value
  };
  setTimeout(step, 16);
  setTimeout(() => { el.textContent = target; }, dur + 400); // hard guarantee even if timers are throttled
}
function deptCounts() {
  const c = {};
  for (const d of DEPARTMENTS) c[d] = TERMS.filter((t) => t.department === d).length;
  return c;
}

/* ---------- gate ---------- */
async function showGateMeta() {
  try {
    const meta = await (await fetch('meta.json', { cache: 'no-store' })).json();
    const when = new Date(meta.builtAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    $('#gate-meta').textContent = `${meta.count} term${meta.count === 1 ? '' : 's'} · updated ${when}`;
  } catch { /* first ever load */ }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function unlock(e) {
  e.preventDefault();
  const passcode = $('#passcode').value.trim();
  const btn = $('#gate-btn');
  $('#gate-error').hidden = true;
  if (!passcode) return;
  btn.disabled = true;
  btn.classList.add('loading');
  try {
    const payload = await (await fetch('data.enc.json', { cache: 'no-store' })).json();
    const data = await decrypt(payload, passcode);
    TERMS = data.terms || [];
    sessionStorage.setItem('cv-pass', passcode);
    btn.classList.remove('loading');
    btn.classList.add('done');            // spinner → checkmark
    await wait(reduceMotion ? 0 : 320);
    transitionToApp(data.builtAt);        // gate out, app in like a new page
  } catch {
    btn.classList.remove('loading');
    btn.disabled = false;
    $('#gate-error').hidden = false;
    shake($('.gate-card'));
    $('#passcode').select();
  }
}

function shake(el) {
  if (reduceMotion || !el) return;
  el.classList.remove('shake');
  void el.offsetWidth; // restart the animation
  el.classList.add('shake');
  el.addEventListener('animationend', () => el.classList.remove('shake'), { once: true });
}

// Manual unlock: animated "new page" transition + celebration.
function transitionToApp(builtAt) {
  const gate = $('#gate'), app = $('#app');
  if (reduceMotion) { gate.hidden = true; app.hidden = false; finishEnter(builtAt, false); return; }
  gate.classList.add('leaving');
  setTimeout(() => {
    gate.hidden = true; gate.classList.remove('leaving');
    app.hidden = false; app.classList.add('entering');
    window.scrollTo(0, 0);
    finishEnter(builtAt, true);
    setTimeout(() => app.classList.remove('entering'), 560);
  }, 320);
}

// Same-session reload (remembered passcode): straight in, no fanfare.
function enterApp(builtAt) {
  $('#gate').hidden = true;
  $('#app').hidden = false;
  finishEnter(builtAt, false);
}

function finishEnter(builtAt, celebrate) {
  $('#footer-meta').textContent = builtAt ? `Last refreshed ${new Date(builtAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : '';
  renderOverview();
  renderBoard();
  renderChips();
  render();
  if (celebrate) { stagger(['#stats', '.board-panel', '#glossary']); confetti(); }
}

function stagger(selectors) {
  if (reduceMotion) return;
  selectors.forEach((sel, i) => {
    const el = $(sel);
    if (!el) return;
    const delay = i * 100;
    el.style.animationDelay = delay + 'ms';
    el.classList.add('stagger');
    const clear = () => { el.classList.remove('stagger'); el.style.animationDelay = ''; };
    el.addEventListener('animationend', clear, { once: true });
    setTimeout(clear, delay + 900); // guarantee reveal even if animationend never fires
  });
}

function confetti() {
  if (reduceMotion) return;
  const c = $('#confetti');
  if (!c) return;
  const ctx = c.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const colors = ['#0C2748', '#E1624B', '#324C90', '#5F95CD', '#ffffff'];
  const parts = Array.from({ length: 150 }, (_, i) => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 240, y: innerHeight * 0.26,
    vx: (Math.random() - 0.5) * 11, vy: Math.random() * -10 - 4, g: 0.3 + Math.random() * 0.12,
    size: 6 + Math.random() * 7, rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 0.4,
    color: colors[i % colors.length],
  }));
  const start = Date.now();
  (function frame() {
    const t = Date.now() - start;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    let alive = false;
    for (const p of parts) {
      p.vy += p.g; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      if (p.y < innerHeight + 30) alive = true;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, 1 - t / 1700);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    if (t < 1700 && alive) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })();
}

/* ---------- overview + leaderboard ---------- */
function renderOverview() {
  const counts = deptCounts();
  const live = DEPARTMENTS.filter((d) => counts[d] > 0).length;
  countUp($('#hero-count'), TERMS.length);
  const tiles = [
    { num: TERMS.length, label: 'Terms defined', accent: false },
    { num: `${live}/${DEPARTMENTS.length}`, label: 'Departments live', accent: true },
    { num: TERMS.filter((t) => t.acronym).length, label: 'Acronyms', accent: false },
  ];
  $('#stats').innerHTML = tiles.map((t) =>
    `<div class="stat-tile ${t.accent ? 'accent' : ''}"><div class="stat-num">${t.num}</div><div class="stat-label">${t.label}</div></div>`,
  ).join('');
}

function renderBoard() {
  const counts = deptCounts();
  const rows = DEPARTMENTS.map((d) => ({ d, n: counts[d] })).sort((a, b) => b.n - a.n);
  const max = rows[0].n || 1;
  $('#board').innerHTML = rows.map((row, i) => {
    const leader = row.n > 0 && i === 0;
    const rankClass = i === 1 ? 'r2' : i === 2 ? 'r3' : '';
    const pill = leader ? '<span class="pill lead">Leading</span>' : row.n === 0 ? '<span class="pill empty">Needs terms</span>' : '';
    const width = Math.round((row.n / max) * 100);
    return `<button class="board-row ${leader ? 'leader' : ''} ${row.n === 0 ? 'zero' : ''}" data-dept="${esc(row.d)}">
      <span class="rank ${rankClass}">${i + 1}</span>
      <span class="board-main">
        <span class="board-name">${esc(row.d)} ${pill}</span>
        <span class="bar-track"><span class="bar-fill" data-w="${width}"></span></span>
      </span>
      <span class="board-count">${row.n}</span>
    </button>`;
  }).join('');
  $('#board').querySelectorAll('.board-row').forEach((el) =>
    el.addEventListener('click', () => {
      activeDept = el.dataset.dept; query = ''; $('#search').value = ''; $('#search-clear').hidden = true;
      renderChips(); render();
      $('#glossary').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    }),
  );
  // fill bars just after insert (setTimeout, not rAF, so it runs even without a compositor)
  setTimeout(() => $('#board').querySelectorAll('.bar-fill').forEach((b) => { b.style.width = b.dataset.w + '%'; }), 60);
}

/* ---------- glossary ---------- */
function renderChips() {
  const counts = deptCounts();
  const chips = ['All', ...DEPARTMENTS.filter((d) => counts[d] > 0)];
  const all = { All: TERMS.length, ...counts };
  $('#chips').innerHTML = chips.map((d) =>
    `<button class="chip" aria-pressed="${d === activeDept}" data-dept="${esc(d)}">${esc(d)}<span class="chip-count">${all[d]}</span></button>`,
  ).join('');
  $('#chips').querySelectorAll('.chip').forEach((c) =>
    c.addEventListener('click', () => { activeDept = c.dataset.dept; renderChips(); render(); }),
  );
}

function letterOf(term) {
  const ch = term.trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(ch) ? ch : '#';
}

function render() {
  const q = query.toLowerCase();
  let items = TERMS;
  if (activeDept !== 'All') items = items.filter((t) => t.department === activeDept);
  if (q) items = items.filter((t) => [t.term, t.acronym, t.definition, t.example].some((f) => (f || '').toLowerCase().includes(q)));

  $('#result-count').textContent = items.length
    ? `${items.length} term${items.length === 1 ? '' : 's'}${activeDept !== 'All' ? ' in ' + activeDept : ''}${q ? ` matching “${query}”` : ''}`
    : '';

  const list = $('#list'), empty = $('#empty');
  if (!items.length) {
    list.innerHTML = '';
    empty.hidden = false;
    $('#empty-text').textContent = TERMS.length === 0
      ? 'No terms yet. They appear here as they are added to the glossary sheet.'
      : `No terms match “${query}”.`;
    return;
  }
  empty.hidden = true;

  // group A–Z (already globally sorted by build)
  const groups = new Map();
  for (const t of items) {
    const L = letterOf(t.term);
    if (!groups.has(L)) groups.set(L, []);
    groups.get(L).push(t);
  }
  const order = [...groups.keys()].sort((a, b) => (a === '#' ? -1 : b === '#' ? 1 : a.localeCompare(b)));

  list.innerHTML = order.map((L) =>
    `<div class="letter-group"><h3 class="letter-head">${L}</h3>${groups.get(L).map(card).join('')}</div>`,
  ).join('');
}

function card(t) {
  const acr = t.acronym ? `<span class="term-acr">${highlight(t.acronym, query)}</span>` : '';
  const example = t.example ? `<p class="term-example"><b>Example:</b> ${highlight(t.example, query)}</p>` : '';
  const approved = t.approvedBy || t.dateApproved
    ? `<p class="term-approved">Approved${t.approvedBy ? ' by ' + esc(t.approvedBy) : ''}${t.dateApproved ? ' · ' + esc(t.dateApproved) : ''}</p>` : '';
  return `<details class="term-card">
    <summary class="term-head">
      <span class="term-title">
        <span class="term-name">${highlight(t.term, query)}</span>${acr}
        <span class="term-dept">${esc(t.department)}</span>
      </span>
      <svg class="chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>
    </summary>
    <div class="term-body">
      <p class="term-def">${highlight(t.definition || 'No definition provided.', query)}</p>
      ${example}${approved}
    </div>
  </details>`;
}

/* ---------- wire up ---------- */
function init() {
  initTheme();
  showGateMeta();
  $('#gate-form').addEventListener('submit', unlock);
  $('#theme-toggle').addEventListener('click', toggleTheme);
  $('#pass-toggle').addEventListener('click', () => {
    const inp = $('#passcode'), btn = $('#pass-toggle');
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    btn.classList.toggle('on', show);
    btn.setAttribute('aria-pressed', String(show));
    btn.setAttribute('aria-label', show ? 'Hide passcode' : 'Show passcode');
    inp.focus();
  });
  const search = $('#search');
  search.addEventListener('input', () => { query = search.value.trim(); $('#search-clear').hidden = !query; render(); });
  $('#search-clear').addEventListener('click', () => { search.value = ''; query = ''; $('#search-clear').hidden = true; render(); search.focus(); });

  const remembered = sessionStorage.getItem('cv-pass');
  if (remembered) {
    fetch('data.enc.json', { cache: 'no-store' }).then((r) => r.json()).then((p) => decrypt(p, remembered))
      .then((data) => { TERMS = data.terms || []; enterApp(data.builtAt); })
      .catch(() => sessionStorage.removeItem('cv-pass'));
  }
}
init();
