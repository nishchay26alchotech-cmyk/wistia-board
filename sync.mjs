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
    account: label || '',
    project: [label, m.project && m.project.name].filter(Boolean).join(' · ')
  })).filter(v => /^[a-z0-9]{10}$/.test(v.id));
}

// Optional per-video numbers (plays, loads, hours watched). Skipped quietly if Wistia refuses them.
async function addStats(vids, token) {
  if (process.env.WISTIA_STATS === '0') return;
  let i = 0, fails = 0;
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (i < vids.length && fails < 5) {
      const v = vids[i++];
      try {
        const s = await get(`${API}/stats/medias/${v.id}.json`, token);
        v.plays = s.play_count || 0; v.loads = s.load_count || 0; v.hours = +(s.hours_watched || 0).toFixed(2);
      } catch (e) { fails++; }
    }
  }));
  if (fails >= 5) console.warn('  stats not available, skipped');
}

// Which videos is Wistia refusing to serve right now? When an account runs out of monthly bandwidth, the embed page
// says "This video has been very popular!" and when it resets. We read that plain HTML page (no player script runs,
// so it is not counted as a play or load). Result: err 'bw' (+ rst 'YYYY-MM-DD') or err '' per video.
// Set WISTIA_ERRCHECK=0 to skip. A video that could not be checked gets no err field, so the board keeps what it knew.
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function resetDate(html) {
  const m = /reset on\s+([a-z]+)\s+(\d{1,2})/i.exec(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
  const mi = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
  if (mi < 0) return '';
  const now = new Date(), today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let y = now.getUTCFullYear(); if (Date.UTC(y, mi, +m[2]) < today - 864e5) y++;
  return `${y}-${String(mi + 1).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}`;
}
async function addEmbedStatus(vids) {
  if (process.env.WISTIA_ERRCHECK === '0') return;
  let i = 0, fails = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < vids.length) {
      const v = vids[i++];
      try {
        const r = await fetch('https://fast.wistia.net/embed/iframe/' + v.id, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; wistia-board-sync)' } });
        const html = await r.text();
        if (/id=["']iframe_error["']/.test(html) && /very popular|bandwidth/i.test(html)) { v.err = 'bw'; const d = resetDate(html); if (d) v.rst = d; }
        else if (r.ok) v.err = '';
      } catch (e) { fails++; }
    }
  }));
  console.log(`  bandwidth check: ${vids.filter(v => v.err === 'bw').length} blocked` + (fails ? `, ${fails} could not be checked` : ''));
}

const accounts = await loadAccounts();
const info = [];
const seen = new Map();
for (const acc of accounts) {
  try {
    const vids = await fetchAccount(acc);
    await addStats(vids, acc.token);
    await addEmbedStatus(vids);
    vids.forEach(v => { if (!seen.has(v.id)) seen.set(v.id, v); });
    const account = await get(`${API}/account.json`, acc.token).catch(() => null);
    info.push({ label: acc.label || '', videos: vids.length, account });
    if (account) console.log('  account fields:', Object.keys(account).join(', '));
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
await writeFile(OUT.replace(/[^/\\]*$/, 'wistia-accounts.json'), JSON.stringify(info, null, 1));
console.log(`Wrote ${all.length} videos to ${OUT} and account info to wistia-accounts.json`);
