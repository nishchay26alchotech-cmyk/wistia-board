// Live video list for the board: asks the Wistia API right now (no waiting for the 30-minute GitHub feed).
// The tokens live ONLY in Netlify's environment variable WISTIA_ACCOUNTS (same JSON as the GitHub secret), never in the page.
// Returns { ts, videos: [...same shape as wistia-board.json, without plays/loads/errors...], failed: [labels], usage: { label: {plan, bandwidth, storage, media} } }.
// An account that errors is listed in "failed" so the board keeps that account's last known videos instead of dropping them.
import { parseAccounts, fetchAccount, fetchUsage } from '../../wistia-lib.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

export default async () => {
  let accounts;
  try { accounts = parseAccounts(process.env.WISTIA_ACCOUNTS); }
  catch (e) { return json({ error: e.message }, 500); }

  const results = await Promise.all(accounts.map(a =>
    Promise.all([fetchAccount(a, { tries: 2, timeout: 8000 }), fetchUsage(a.token, { tries: 1, timeout: 6000 })])   // usage never makes the video list fail
      .then(([videos, usage]) => ({ label: a.label, videos, usage }), e => ({ label: a.label, error: e.message }))));

  const failed = results.filter(r => r.error).map(r => r.label);
  if (failed.length === results.length) return json({ error: 'Every account failed: ' + results.map(r => r.label + ' (' + r.error + ')').join('; ') }, 502);

  const seen = new Map();
  results.forEach(r => (r.videos || []).forEach(v => { if (!seen.has(v.id)) seen.set(v.id, v); }));   // a video id is counted once
  const videos = [...seen.values()].sort((a, b) => b.created - a.created);
  const usage = {}; results.forEach(r => { if (r.usage) usage[r.label] = r.usage; });
  return json({ ts: Date.now(), videos, failed, usage });
};
