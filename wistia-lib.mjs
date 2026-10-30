// Shared by sync.mjs (GitHub Action) and netlify/functions/videos.mjs (live endpoint).
// Reads the video list straight from the Wistia API. Needs Node 18+. No npm install.
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const api = () => process.env.WISTIA_API || 'https://api.wistia.com/v1';   // read on every call so tests can point it elsewhere
export const modern = () => process.env.WISTIA_MODERN_API || 'https://api.wistia.com/modern';   // the newer API: account usage lives here

// raw = the text of accounts.json / the WISTIA_ACCOUNTS secret: [ { "label": "Velora", "token": "abc..." }, ... ]
export function parseAccounts(raw) {
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

// opts.tries / opts.timeout let the live endpoint fail fast (a serverless function only has a few seconds)
export async function get(url, token, opts = {}) {
  const tries = opts.tries || 5, timeout = opts.timeout || 30000;
  let last = '';
  for (let i = 0; i < tries; i++) {
    let r;
    try { r = await fetch(url, { headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) }, signal: AbortSignal.timeout(timeout) }); }
    catch (e) { last = e.name === 'TimeoutError' ? 'timed out' : 'network error'; await sleep(1000 * (i + 1)); continue; }   // offline / DNS / timeout: wait and retry
    if (r.status === 429 || r.status >= 500) { last = 'HTTP ' + r.status; await sleep(1500 * (i + 1)); continue; }   // rate limit / hiccup: wait and retry
    if (r.status === 401 || r.status === 403) throw new Error('Wistia rejected the token (HTTP ' + r.status + ')');
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    try { return await r.json(); } catch (e) { throw new Error('Wistia sent something that is not JSON for ' + url); }
  }
  throw new Error('Gave up after ' + tries + ' tries (' + last + '): ' + url);
}

// Every video of one account. The unique key is Wistia's hashed id (the 10 characters in the video link).
export async function fetchAccount({ label, token }, opts = {}) {
  const out = [];
  let firstOfPrev = null;
  for (let page = 1; ; page++) {
    const batch = await get(`${api()}/medias.json?page=${page}&per_page=100&sort_by=created&sort_direction=0`, token, opts);
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

// Plan, bandwidth and storage of one account (GET /modern/account_usage). Only owners/managers get the numbers.
// Returns null when Wistia will not say (wrong role, old plan, network): the board then simply shows no meter for that account.
export async function fetchUsage(token, opts = {}) {
  try {
    const j = await get(`${modern()}/account_usage`, token, { tries: 2, timeout: 8000, ...opts, headers: { 'X-Wistia-API-Version': '2026-09' } });
    const L = j && j.limits, n = x => typeof x === 'number' && isFinite(x) ? x : null;
    const out = { plan: (j && j.plan && j.plan.name) || '' };
    if (L && L.bandwidth && n(L.bandwidth.used_bytes) !== null) out.bandwidth = { used: L.bandwidth.used_bytes, limit: n(L.bandwidth.limit_bytes), period: L.bandwidth.period || '', resets: L.bandwidth.resets_at || '' };
    if (L && L.storage && n(L.storage.used_bytes) !== null) out.storage = { used: L.storage.used_bytes, limit: n(L.storage.inflexible_limit_bytes) !== null ? L.storage.inflexible_limit_bytes : n(L.storage.flexible_limit_bytes) };
    if (L && L.media && n(L.media.count) !== null) out.media = L.media.count;
    return out.bandwidth || out.storage ? out : null;
  } catch (e) { return null; }
}
