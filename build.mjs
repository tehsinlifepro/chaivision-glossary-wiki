// ChaiVision Glossary Wiki — build step.
// Reads the company glossary Google Sheet via the authenticated `gws` CLI,
// keeps only APPROVED terms, encrypts them with the site passcode, and writes
// docs/data.enc.json (committed) + docs/meta.json for GitHub Pages to serve.
//
// No npm dependencies: uses the `gws` CLI for Sheets access and Node's built-in
// Web Crypto (identical API to the browser, so the site can decrypt what we write).

import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DOCS = join(ROOT, 'docs');

const SPREADSHEET_ID = '1pK1qrJ1L6TZaNmWJ7vUKF2OdQ99auvPGMm3ClRVg8Gw';
const DEPARTMENTS = ['Operations', 'Marketing', 'HR', 'Finance', 'Sales', 'Product Development'];

// Rollout mode: show every submitted term (any status). Flip to true once the
// glossary is populated and department heads are actively marking terms "Approved".
const APPROVED_ONLY = false;

// PBKDF2 iterations — must match the browser (app.js).
const ITERATIONS = 150000;

// --- passcode (from .env or environment) -----------------------------------
function loadPasscode() {
  if (process.env.WIKI_PASSCODE) return process.env.WIKI_PASSCODE;
  const envPath = join(ROOT, '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*WIKI_PASSCODE\s*=\s*(.*)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, '');
    }
  }
  throw new Error('WIKI_PASSCODE not set. Copy .env.example to .env and set a passcode.');
}

// --- read the sheet ---------------------------------------------------------
function readSheet() {
  const ranges = DEPARTMENTS.map((d) => `${d}!A3:J1000`);
  const params = JSON.stringify({ spreadsheetId: SPREADSHEET_ID, ranges, majorDimension: 'ROWS' });
  const out = execFileSync('gws', ['sheets', 'spreadsheets', 'values', 'batchGet', '--params', params, '--format', 'json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out.slice(out.indexOf('{'))); // strip the "Using keyring backend" preamble
}

function col(header, name) {
  return header.findIndex((h) => (h || '').trim().toLowerCase() === name);
}

function extractTerms(sheet) {
  const terms = [];
  const valueRanges = sheet.valueRanges || [];
  valueRanges.forEach((vr, i) => {
    const department = DEPARTMENTS[i];
    const rows = vr.values || [];
    if (rows.length === 0) return;
    const header = rows[0];
    const iTerm = col(header, 'term');
    const iAcr = col(header, 'acronym / aka');
    const iDef = col(header, 'definition');
    const iEx = col(header, 'example / used in context');
    const iStatus = col(header, 'status');
    const iBy = col(header, 'approved by (dept head)');
    const iDate = col(header, 'date approved');

    for (const row of rows.slice(1)) {
      const get = (idx) => (idx >= 0 && row[idx] != null ? String(row[idx]).trim() : '');
      const term = get(iTerm);
      if (!term) continue; // skip template / blank rows
      const status = get(iStatus).toLowerCase();
      if (APPROVED_ONLY && status !== 'approved') continue;
      terms.push({
        department,
        term,
        acronym: get(iAcr),
        definition: get(iDef),
        example: get(iEx),
        approvedBy: get(iBy),
        dateApproved: get(iDate),
      });
    }
  });
  terms.sort((a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: 'base' }));
  return terms;
}

// --- encrypt (mirrors app.js decrypt) --------------------------------------
const b64 = (buf) => Buffer.from(buf).toString('base64');

async function encrypt(plaintext, passcode) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(passcode), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return { v: 1, iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

// --- main -------------------------------------------------------------------
const passcode = loadPasscode();
const terms = extractTerms(readSheet());
const builtAt = new Date().toISOString();

const payload = await encrypt(JSON.stringify({ terms, builtAt }), passcode);
writeFileSync(join(DOCS, 'data.enc.json'), JSON.stringify(payload));

// Cache-bust the asset URLs so browsers always fetch the latest CSS/JS after a deploy
// (HTML revalidates on refresh, but style.css / app.js otherwise stay cached).
const v = Date.parse(builtAt);
const idxPath = join(DOCS, 'index.html');
const idx = readFileSync(idxPath, 'utf8')
  .replace(/href="style\.css(?:\?v=\d+)?"/, `href="style.css?v=${v}"`)
  .replace(/src="app\.js(?:\?v=\d+)?"/, `src="app.js?v=${v}"`);
writeFileSync(idxPath, idx);

// meta.json is public (no term data) — powers the "last updated" line before unlock.
const byDept = {};
for (const d of DEPARTMENTS) byDept[d] = terms.filter((t) => t.department === d).length;
writeFileSync(join(DOCS, 'meta.json'), JSON.stringify({ builtAt, count: terms.length, byDepartment: byDept }, null, 2));

console.log(`Built ${terms.length} approved term(s) at ${builtAt}`);
for (const d of DEPARTMENTS) console.log(`  ${d}: ${byDept[d]}`);
