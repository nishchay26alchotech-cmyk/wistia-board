// Download link for ONE video, read from the Wistia API with the account token (the token never leaves Netlify).
// Why it exists: when an account used up its monthly bandwidth, the Wistia embed no longer lists any file for its videos,
// so the board has no link to download. The API still lists them. The board then downloads the file straight from Wistia.
//   GET /.netlify/functions/download?id=abc123def4&account=zevora.work   ->   { url, name }   or   { error }
// Uses the same WISTIA_ACCOUNTS variable as videos.mjs. Nothing new to configure.
import { parseAccounts, get, api } from '../../wistia-lib.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

// The largest mp4 of the video (the same kind of file the Wistia player itself uses). Only if there is none, the original upload.
export function pickFile(assets) {
  const list = (Array.isArray(assets) ? assets : []).filter(a => a && typeof a.url === 'string' && /^https:\/\//i.test(a.url));
  const isMp4 = a => /mp4|iphone/i.test(a.type || '') || a.contentType === 'video/mp4' || a.container === 'mp4';
  const mp4 = list.filter(a => a.width && isMp4(a) && !/original/i.test(a.type || '')).sort((a, b) => a.width - b.width);
  if (mp4.length) return mp4[mp4.length - 1].url.replace(/\.bin(\?.*)?$/, '.mp4');
  const orig = list.find(a => /original/i.test(a.type || ''));
  return orig ? orig.url : '';
}

export default async (req) => {
  const q = new URL(req.url).searchParams;
  const id = (q.get('id') || '').toLowerCase(), label = (q.get('account') || '').trim().toLowerCase();
  if (!/^[a-z0-9]{10}$/.test(id)) return json({ error: 'Not a Wistia video id' }, 400);

  let accounts;
  try { accounts = parseAccounts(process.env.WISTIA_ACCOUNTS); }
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
};
