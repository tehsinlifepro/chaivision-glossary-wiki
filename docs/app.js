/* ChaiVision Glossary Wiki — client.
   Unlocks with a passcode that decrypts data.enc.json (AES-GCM, key derived via
   PBKDF2 — mirrors build.mjs). Then renders a searchable, department-filtered glossary. */

const DEPARTMENTS = ['Operations', 'Marketing', 'HR', 'Finance', 'Sales', 'Product Development'];
const ITERATIONS = 150000;
const $ = (sel) => document.querySelector(sel);

let TERMS = [];
let activeDept = 'All';
let query = '';

/* ---------- theme ---------- */
function initTheme() {
  const saved = localStorage.getItem('cv-theme');
  const theme = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
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
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(passcode), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64ToBuf(payload.salt), iterations: payload.iterations || ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBuf(payload.iv) }, key, b64ToBuf(payload.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

/* ---------- meta (public, pre-unlock) ---------- */
async function showGateMeta() {
  try {
    const meta = await (await fetch('meta.json', { cache: 'no-store' })).json();
    const when = new Date(meta.builtAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    $('#gate-meta').textContent = `${meta.count} approved term${meta.count === 1 ? '' : 's'} · updated ${when}`;
  } catch { /* meta may not exist on first ever load */ }
}

/* ---------- unlock ---------- */
async function unlock(e) {
  e.preventDefault();
  const passcode = $('#passcode').value.trim();
  const btn = $('#gate-btn');
  $('#gate-error').hidden = true;
  if (!passcode) return;
  btn.disabled = true;
  btn.textContent = 'Unlocking…';
  try {
    const payload = await (await fetch('data.enc.json', { cache: 'no-store' })).json();
    const data = await decrypt(payload, passcode);
    TERMS = data.terms || [];
    sessionStorage.setItem('cv-pass', passcode);
    enterApp(data.builtAt);
  } catch {
    $('#gate-error').hidden = false;
    $('#passcode').select();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Unlock';
  }
}

function enterApp(builtAt) {
  $('#gate').hidden = true;
  $('#app').hidden = false;
  const when = builtAt ? new Date(builtAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
  $('#footer-meta').textContent = when ? `Last refreshed ${when}` : '';
  renderChips();
  render();
  $('#search').focus();
}

/* ---------- render ---------- */
function renderChips() {
  const counts = { All: TERMS.length };
  for (const d of DEPARTMENTS) counts[d] = TERMS.filter((t) => t.department === d).length;
  const chips = ['All', ...DEPARTMENTS.filter((d) => counts[d] > 0)];
  $('#chips').innerHTML = chips
    .map((d) => `<button class="chip" role="button" aria-pressed="${d === activeDept}" data-dept="${d}">${esc(d)}<span class="chip-count">${counts[d]}</span></button>`)
    .join('');
  $('#chips').querySelectorAll('.chip').forEach((c) =>
    c.addEventListener('click', () => { activeDept = c.dataset.dept; renderChips(); render(); }),
  );
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function highlight(text, q) {
  const safe = esc(text);
  if (!q) return safe;
  const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
  return safe.replace(re, '<mark>$1</mark>');
}

function render() {
  const q = query.toLowerCase();
  let items = TERMS;
  if (activeDept !== 'All') items = items.filter((t) => t.department === activeDept);
  if (q) {
    items = items.filter((t) =>
      [t.term, t.acronym, t.definition, t.example].some((f) => (f || '').toLowerCase().includes(q)),
    );
  }

  const list = $('#list');
  const empty = $('#empty');
  $('#result-count').textContent = items.length
    ? `${items.length} term${items.length === 1 ? '' : 's'}${activeDept !== 'All' ? ' in ' + activeDept : ''}`
    : '';

  if (!items.length) {
    list.innerHTML = '';
    empty.hidden = false;
    $('#empty-text').textContent = TERMS.length === 0
      ? 'No approved terms yet. They appear here as department heads approve them in the glossary sheet.'
      : `No terms match “${query}”.`;
    return;
  }
  empty.hidden = true;

  list.innerHTML = items.map((t) => {
    const acr = t.acronym ? `<span class="term-acr">${highlight(t.acronym, query)}</span>` : '';
    const example = t.example ? `<p class="term-example"><b>Example:</b> ${highlight(t.example, query)}</p>` : '';
    const approved = t.approvedBy || t.dateApproved
      ? `<p class="term-approved">Approved${t.approvedBy ? ' by ' + esc(t.approvedBy) : ''}${t.dateApproved ? ' · ' + esc(t.dateApproved) : ''}</p>`
      : '';
    return `<details class="term-card">
      <summary class="term-head">
        <span class="term-title">
          <span class="term-name">${highlight(t.term, query)}</span>
          ${acr}
          <span class="term-dept">${esc(t.department)}</span>
        </span>
        <svg class="chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>
      </summary>
      <div class="term-body">
        <p class="term-def">${highlight(t.definition || 'No definition provided.', query)}</p>
        ${example}
        ${approved}
      </div>
    </details>`;
  }).join('');
}

/* ---------- wire up ---------- */
function init() {
  initTheme();
  showGateMeta();
  $('#gate-form').addEventListener('submit', unlock);
  $('#theme-toggle').addEventListener('click', toggleTheme);

  const search = $('#search');
  search.addEventListener('input', () => {
    query = search.value.trim();
    $('#search-clear').hidden = !query;
    render();
  });
  $('#search-clear').addEventListener('click', () => {
    search.value = ''; query = ''; $('#search-clear').hidden = true; render(); search.focus();
  });

  // auto-unlock within the same tab session
  const remembered = sessionStorage.getItem('cv-pass');
  if (remembered) {
    fetch('data.enc.json', { cache: 'no-store' })
      .then((r) => r.json())
      .then((p) => decrypt(p, remembered))
      .then((data) => { TERMS = data.terms || []; enterApp(data.builtAt); })
      .catch(() => sessionStorage.removeItem('cv-pass'));
  }
}
init();
