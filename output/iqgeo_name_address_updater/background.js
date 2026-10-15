// Service worker: talks to the USPS Addresses 3.0 API (needs host permission, so it works from the IQGeo page without CORS problems).
const BASES = { prod: 'https://apis.usps.com', test: 'https://apis-tem.usps.com' };
const tokens = {};   // env+clientId -> { token, exp }

async function getToken(env, id, secret, force) {
  const k = env + '|' + id, t = tokens[k];
  if (!force && t && t.exp > Date.now() + 60000) return t.token;
  const r = await fetch(BASES[env] + '/oauth2/v3/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: id, client_secret: secret, grant_type: 'client_credentials' })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    const err = new Error(`USPS login failed (HTTP ${r.status}) ${j.error_description || j.message || j.error || ''}`.trim());
    err.fatal = true; throw err;
  }
  tokens[k] = { token: j.access_token, exp: Date.now() + (parseInt(j.expires_in, 10) || 3600) * 1000 };
  return j.access_token;
}

async function lookup(msg) {
  const env = msg.env === 'test' ? 'test' : 'prod';
  if (!msg.id || !msg.secret) return { fatal: 'USPS Consumer Key / Secret missing' };
  const ckey = 'usps|' + [msg.street, msg.city, msg.state].join('|').toUpperCase().replace(/\s+/g, ' ');
  if (env === 'prod' && typeof chrome !== 'undefined' && chrome.storage) {
    const c = (await chrome.storage.local.get(ckey))[ckey];
    if (c) return { ...c, cached: true };
  }
  const url = `${BASES[env]}/addresses/v3/address?` + new URLSearchParams({ streetAddress: msg.street, city: msg.city, state: msg.state });
  let token = await getToken(env, msg.id, msg.secret, false);
  let r = await fetch(url, { headers: { Accept: 'application/json', Authorization: 'Bearer ' + token } });
  if (r.status === 401) {                                   // token expired: get a new one and retry once
    token = await getToken(env, msg.id, msg.secret, true);
    r = await fetch(url, { headers: { Accept: 'application/json', Authorization: 'Bearer ' + token } });
  }
  if (r.status === 429) return { rate: true, status: 429 };
  if (r.status === 404 || r.status === 400) {
    const j = await r.json().catch(() => ({}));
    return { ok: false, notFound: true, status: r.status, detail: (j.error && j.error.message) || j.message || '' };
  }
  if (!r.ok) return { ok: false, status: r.status, detail: (await r.text().catch(() => '')).slice(0, 200) };
  const j = await r.json();
  const a = j.address || {}, info = j.additionalInfo || {};
  const res = { ok: true, zip: a.ZIPCode || '', plus4: a.ZIPPlus4 || '', dpv: info.DPVConfirmation || '',
    street: a.streetAddress || '', secondary: a.secondaryAddress || '', city: a.city || '' };
  if (env === 'prod' && chrome.storage) await chrome.storage.local.set({ [ckey]: res });
  return res;
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((msg, sender, send) => {
    if (!msg || msg.type !== 'usps') return false;
    lookup(msg).then(send).catch(e => send({ fatal: e.message || String(e), error: true }));
    return true;      // answer asynchronously
  });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { lookup, getToken };
