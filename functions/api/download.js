// Download link for ONE video, read from the Wistia API with the account token (the token never leaves Cloudflare).
// GET /api/download?id=abc123def4&account=zevora.work -> { url, name } or { error }
// Uses the same WISTIA_ACCOUNTS secret as videos.js.
import { parseAccounts, get, api, pickFile } from '../_lib/wistia.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  const id = (q.get('id') || '').toLowerCase(), label = (q.get('account') || '').trim().toLowerCase();
  if (!/^[a-z0-9]{10}$/.test(id)) return json({ error: 'Not a Wistia video id' }, 400);

  let accounts;
  try { accounts = parseAccounts(env.WISTIA_ACCOUNTS); }
  catch (e) { return json({ error: e.message }, 500); }
  const tryAccounts = label ? accounts.filter(a => a.label.toLowerCase() === label) : accounts;   // no account given: try them all
  if (!tryAccounts.length) return json({ error: 'No account called "' + label + '" in WISTIA_ACCOUNTS' }, 404);

  let why = 'Video not found';
  for (const a of tryAccounts) {
    try {
      const m = await get(`${api()}/medias/${id}.json`, a.token, { tries: 2, timeout: 8000 });
      const url = pickFile(m && m.assets);
      if (url) return json({ url, name: (m && m.name) || '' });
      why = 'Wistia lists no downloadable file for this video';
    } catch (e) { why = e.message.replace(/ for https?:\/\/\S+/, ''); }
  }
  return json({ error: why }, 502);
}
