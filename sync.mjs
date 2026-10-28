// Pulls every video from every Wistia account listed in your tokens and writes
// docs/wistia-board.json, which the board loads automatically.
// Needs Node 18+. No npm install.
//
//   Local:   put your tokens in accounts.json, then:  node sync.mjs
//   Actions: store the same JSON in the WISTIA_ACCOUNTS secret.
//
// accounts.json looks like:
//   [ { "label": "Velora", "token": "abc..." }, { "label": "AdAstra", "token": "def..." } ]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const API = process.env.WISTIA_API || 'https://api.wistia.com/v1';
const OUT = process.argv[2] || 'docs/wistia-board.json';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function loadAccounts() {
  const raw = process.env.WISTIA_ACCOUNTS || await readFile('accounts.json', 'utf8').catch(() => '');
  if (!raw) throw new Error('No accounts. Create accounts.json or set WISTIA_ACCOUNTS.');
  const list = JSON.parse(raw);
  if (!Array.isArray(list) || !list.every(a => a && a.token)) throw new Error('accounts must be a list of {label, token}');
  return list;
}

async function get(url, token, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (r.status === 429 || r.status >= 500) { await sleep(1500 * (i + 1)); continue; }   // rate limit / hiccup: wait and retry
    if (r.status === 401 || r.status === 403) throw new Error('Wistia rejected the token (HTTP ' + r.status + ')');
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r.json();
  }
  throw new Error('Gave up after retries: ' + url);
}

async function fetchAccount({ label, token }) {
  const out = [];
  for (let page = 1; ; page++) {
    const batch = await get(`${API}/medias.json?page=${page}&per_page=100&sort_by=created&sort_direction=0`, token);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out.map(m => ({
    id: String(m.hashed_id || '').toLowerCase(),
    name: m.name || '',
    created: m.created ? Date.parse(m.created) : 0,
    updated: m.updated ? Date.parse(m.updated) : 0,
    duration: m.duration || 0,
    type: m.type ? m.type[0].toUpperCase() + m.type.slice(1) : '',
    desc: m.description || '',
    project: [label, m.project && m.project.name].filter(Boolean).join(' · ')
  })).filter(v => /^[a-z0-9]{10}$/.test(v.id));
}

const accounts = await loadAccounts();
const seen = new Map();
for (const acc of accounts) {
  try {
    const vids = await fetchAccount(acc);
    vids.forEach(v => { if (!seen.has(v.id)) seen.set(v.id, v); });
    console.log(`${acc.label || 'account'}: ${vids.length} videos`);
  } catch (e) {
    console.error(`${acc.label || 'account'}: FAILED - ${e.message}`);
    process.exitCode = 1;   // keep going so one bad token doesn't hide the other accounts
  }
}
if (!seen.size) { console.error('Nothing fetched, leaving the old file alone.'); process.exit(1); }
const all = [...seen.values()].sort((a, b) => b.created - a.created);
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(all, null, 1));
console.log(`Wrote ${all.length} videos to ${OUT}`);
