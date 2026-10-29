// Pulls every video from every Wistia account listed in your tokens and writes
// docs/wistia-board.json, which the board loads automatically.
// The file is a complete snapshot of what Wistia lists right now: a video deleted in Wistia is simply absent from the
// next snapshot, and the board removes it. (If one account's token fails, that account's previous entries are carried
// over so a temporary error never wipes its videos from the board.)
// Needs Node 18+. No npm install.
//
//   Local:   put your tokens in accounts.json, then:  node sync.mjs
//   Actions: store the same JSON in the WISTIA_ACCOUNTS secret.
//
// accounts.json looks like:
//   [ { "label": "Velora", "token": "abc..." }, { "label": "AdAstra", "token": "def..." } ]
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

const API = process.env.WISTIA_API || 'https://api.wistia.com/v1';
const OUT = process.argv[2] || 'docs/wistia-board.json';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function loadAccounts() {
  const raw = process.env.WISTIA_ACCOUNTS || await readFile('accounts.json', 'utf8').catch(() => '');
  if (!raw) throw new Error('No accounts. Create accounts.json or set WISTIA_ACCOUNTS.');
  let list;
  try { list = JSON.parse(raw); } catch (e) { throw new Error('Your accounts list is not valid JSON (' + e.message + '). It should look like [{"label":"Velora","token":"abc..."}]'); }
  if (!Array.isArray(list) || !list.length) throw new Error('accounts must be a non-empty list of {label, token}');
  list = list.map((a, i) => {
    if (!a || typeof a.token !== 'string' || !a.token.trim()) throw new Error('account #' + (i + 1) + ' has no token');
    return { label: String(a.label == null ? '' : a.label).trim() || 'account' + (i + 1), token: a.token.trim() };
  });
  const names = new Set();
  for (const a of list) {   // the board tells accounts apart by label, so two accounts must never share one
    const k = a.label.toLowerCase();
    if (names.has(k)) throw new Error('two accounts share the label "' + a.label + '". Labels must be unique.');
    names.add(k);
  }
  return list;
}

async function get(url, token, tries = 5) {
  let last = '';
  for (let i = 0; i < tries; i++) {
    let r;
    try { r = await fetch(url, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(30000) }); }
    catch (e) { last = e.name === 'TimeoutError' ? 'timed out' : 'network error'; await sleep(1000 * (i + 1)); continue; }   // offline / DNS / timeout: wait and retry
    if (r.status === 429 || r.status >= 500) { last = 'HTTP ' + r.status; await sleep(1500 * (i + 1)); continue; }   // rate limit / hiccup: wait and retry
    if (r.status === 401 || r.status === 403) throw new Error('Wistia rejected the token (HTTP ' + r.status + ')');
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    try { return await r.json(); } catch (e) { throw new Error('Wistia sent something that is not JSON for ' + url); }
  }
  throw new Error('Gave up after ' + tries + ' tries (' + last + '): ' + url);
}

async function fetchAccount({ label, token }) {
  const out = [];
  let firstOfPrev = null;
  for (let page = 1; ; page++) {
    const batch = await get(`${API}/medias.json?page=${page}&per_page=100&sort_by=created&sort_direction=0`, token);
    if (!Array.isArray(batch)) throw new Error('Wistia answered with something other than a list of videos' + (batch && batch.error ? ': ' + batch.error : ''));
    const first = batch[0] && batch[0].hashed_id;
    if (page > 1 && first && first === firstOfPrev) throw new Error('Wistia returned the same page twice (paging is not working), so the list cannot be trusted');
    firstOfPrev = first;
    out.push(...batch);
    if (batch.length < 100) break;
    if (page >= 1000) throw new Error('More than 100,000 videos, stopping');
  }
  const uniq = new Map(); out.forEach(m => { if (m && m.hashed_id && !uniq.has(m.hashed_id)) uniq.set(m.hashed_id, m); });   // pages can overlap if a video is added mid-fetch
  return [...uniq.values()].map(m => ({
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
  const m = /resets?\s+on\s+([a-z]+)\.?\s+(\d{1,2})/i.exec(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));   // "reset on" / "resets on", "November" / "Nov"
  const w = m ? m[1].toLowerCase() : '', mi = m ? MONTHS.findIndex(x => x === w || (w.length >= 3 && x.startsWith(w))) : -1;
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

const ACC_OUT = OUT.replace(/[^/\\]*$/, 'wistia-accounts.json');
const readJSON = async f => { try { const j = JSON.parse(await readFile(f, 'utf8')); return Array.isArray(j) ? j : []; } catch (e) { return []; } };
const previous = await readJSON(OUT), previousInfo = await readJSON(ACC_OUT);

const accounts = await loadAccounts();
const info = [];
const seen = new Map();
const failed = [];
const synced = new Date().toISOString();
for (const acc of accounts) {
  const label = acc.label || '';
  try {
    const vids = await fetchAccount(acc);
    await addStats(vids, acc.token);
    await addEmbedStatus(vids);
    let dup = 0;
    vids.forEach(v => { if (seen.has(v.id)) dup++; else seen.set(v.id, v); });
    if (dup) console.warn(`  ${dup} video id(s) already came from another account, counted once`);
    const account = await get(`${API}/account.json`, acc.token).catch(() => null);
    info.push({ label, videos: vids.length, synced, account });
    // Wistia's own account counter (account.mediaCount) can differ from the list by Wistia's built-in sample video
    const mc = account && typeof account.mediaCount === 'number' ? account.mediaCount : null;
    console.log(`${label || 'account'}: ${vids.length} videos` + (mc !== null && mc !== vids.length ? ` (Wistia's account counter says ${mc})` : ''));
  } catch (e) {
    console.error(`${label || 'account'}: FAILED - ${e.message}`);
    failed.push(label);
    process.exitCode = 1;   // keep going so one bad token doesn't hide the other accounts
  }
}
if (failed.length === accounts.length) { console.error('Every account failed, leaving the old files alone.'); process.exit(1); }
// an account that errored keeps its last known videos, so a hiccup never makes them vanish from the board
for (const label of failed) {
  const old = previous.filter(v => (v.account || '') === label);
  old.forEach(v => { if (!seen.has(v.id)) seen.set(v.id, v); });
  const oi = previousInfo.find(a => (a.label || '') === label);
  info.push(oi || { label, videos: old.length, synced, account: null });
  console.warn(`${label || 'account'}: kept ${old.length} videos from the last good sync`);
}
const all = [...seen.values()].sort((a, b) => b.created - a.created);
const was = new Set(previous.map(v => v.id)), now = new Set(all.map(v => v.id));
const gone = [...was].filter(id => !now.has(id)).length, fresh = [...now].filter(id => !was.has(id)).length;
await mkdir(dirname(OUT), { recursive: true });
// "synced" says when the data last CHANGED, so an unchanged run writes byte-identical files and git sees nothing to commit
for (const e of info) {
  const o = previousInfo.find(a => (a.label || '') === (e.label || ''));
  if (o && o.synced && JSON.stringify({ ...o, synced: 0 }) === JSON.stringify({ ...e, synced: 0 })) e.synced = o.synced;
}
const writeAtomic = async (f, text) => { await writeFile(f + '.tmp', text); await rename(f + '.tmp', f); };   // never leaves a half-written file behind
await writeAtomic(OUT, JSON.stringify(all, null, 1));
await writeAtomic(ACC_OUT, JSON.stringify(info, null, 1));
console.log(`Wrote ${all.length} videos to ${OUT} (${fresh} new, ${gone} no longer in Wistia) and account info to wistia-accounts.json`);
