(() => {
  if (window.__iqgNameAddrPanel) { window.__iqgNameAddrPanel.toggle(); return; }
  const { ws, parseName, buildTarget, streetLine, isAddrFile, buildAddrIndex, lookupZip } = window.IQG_NAME_RULES;

  const FIELDS = ['addr_house_number', 'addr_street_direction', 'addr_street_name', 'addr_street_name_suffix', 'addr_city', 'addr_state',
    'addr_postal_code', 'addr_postal_code_plus_4', 'addr_county', 'addr_country', 'addr_full'];
  const MAXLEN = { addr_house_number: 8, addr_street_direction: 4, addr_street_name: 128, addr_street_name_suffix: 8, addr_city: 128,
    addr_state: 2, addr_postal_code: 5, addr_postal_code_plus_4: 9, addr_county: 128, addr_country: 32, addr_full: 1024 };
  const KNOWN_TYPES = ['manhole', 'pole'];

  // ---------- CSV / ZIP ----------
  function parseCSV(text) {
    text = text.replace(/^\ufeff/, '');
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; rows.push(row); row = []; }
      else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    const clean = rows.filter(r => r.some(v => v.trim() !== ''));
    if (!clean.length) return { headers: [], rows: [] };
    const headers = clean.shift().map(h => h.trim().toLowerCase());
    return { headers, rows: clean.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']))) };
  }
  const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  async function unzip(buf, wanted) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf), dec = new TextDecoder();
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--)
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('not a valid zip file');
    const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
    const out = [];
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('damaged zip directory');
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + el + cl;
      if (name.endsWith('/') || !wanted(name)) continue;
      const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      const data = u8.subarray(start, start + csize);
      let bytes;
      if (method === 0) bytes = data;
      else if (method === 8) bytes = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      else throw new Error(`unsupported compression (method ${method}) for ${name}`);
      out.push({ path: name, text: dec.decode(bytes) });
    }
    return out;
  }

  // ---------- UI ----------
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      .p{width:560px;max-height:94vh;overflow:auto;background:#fff;color:#222;border:1px solid #888;border-radius:8px;
         box-shadow:0 4px 18px rgba(0,0,0,.3);font:13px system-ui,sans-serif;padding:12px}
      h3{margin:0 0 6px;font-size:15px;display:flex;justify-content:space-between}
      label.t{display:block;margin:8px 0 2px;font-weight:600}
      input[type=text],input[type=number],select{width:100%;box-sizing:border-box;padding:5px}
      button{padding:6px 10px;margin:8px 6px 0 0;cursor:pointer}
      button:disabled{opacity:.5;cursor:default}
      table{border-collapse:collapse;width:100%;margin-top:4px;font-size:12px}
      td,th{border-bottom:1px solid #eee;padding:2px 4px;text-align:left;vertical-align:top}
      .box{max-height:200px;overflow:auto;border:1px solid #ddd;padding:4px}
      .opt label{display:block;margin-top:3px}
      #log{margin-top:8px;height:170px;overflow:auto;background:#f6f6f6;border:1px solid #ddd;
           padding:6px;white-space:pre-wrap;font:12px ui-monospace,monospace}
      .x{cursor:pointer;border:0;background:none;font-size:16px;margin:0;padding:0}
      .sm{font-size:11px;color:#666}
      .row{display:flex;gap:10px}.row>div{flex:1}
      .warn{color:#8a5a00}
    </style>
    <div class="p">
      <h3>IQGeo Name Address Updater <button class="x" id="close" title="Hide">✕</button></h3>
      <div class="row">
        <div><label class="t">IQGeo base URL</label><input type="text" id="base"></div>
        <div style="flex:0 0 80px"><label class="t">Parallel</label><input type="number" id="conc" min="1" max="8" value="4"></div>
      </div>
      <label class="t">Manholes / poles <span class="sm">(design export .zip, or manhole / pole .csv files with an <code>id</code> column – select several at once)</span></label>
      <input type="file" id="ffiles" accept=".zip,.csv" multiple>
      <div class="row">
        <div><label class="t">Feature type for bare ids <span class="sm">(manhole / pole)</span></label><input type="text" id="deftype" placeholder="pole"></div>
        <div><label class="t">Name has no direction</label>
          <select id="nodir"><option value="blank">Leave direction blank (as the name says)</option><option value="keep">Keep the direction already in IQGeo</option></select></div>
        <div><label class="t">Name case</label>
          <select id="casemode"><option value="title">Suffix / city / county: Title case (St, Albuquerque)</option><option value="upper">Suffix / city / county: UPPER (ST, ALBUQUERQUE)</option></select></div>
      </div>
      <label class="t">Design to edit in</label>
      <input type="text" id="design" placeholder="design/PSA-1043PA-ALBQNMMA-VICTOR">
      <label class="t">Only features with Design Created = <span class="sm">(blank = all features)</span></label>
      <input type="text" id="createdIn" placeholder="PSA-1043PA-ALBQNMMA-VICTOR">
      <div class="row">
        <div><label class="t">City</label><input type="text" id="city" value="Albuquerque"></div>
        <div style="flex:0 0 60px"><label class="t">State</label><input type="text" id="state" value="NM" maxlength="2"></div>
        <div style="flex:0 0 80px"><label class="t">Postal code</label><input type="text" id="zip" value="87108" maxlength="5"></div>
      </div>
      <div class="row">
        <div><label class="t">County</label><input type="text" id="county" value="Bernalillo"></div>
        <div style="flex:0 0 100px"><label class="t">Country</label><input type="text" id="country" value="USA"></div>
      </div>
      <label class="t">Address file for Postal code <span class="sm">(optional – PSA address export .csv / .zip with a_saddstr, a_saddsttyp, a_saddstsuf, a_szip5; matched on street name + type + direction)</span></label>
      <input type="file" id="afiles" accept=".zip,.csv" multiple>
      <div class="opt">
        <label><input type="checkbox" id="usecb"> <b>Look up Postal code + plus 4 from USPS</b> <span class="sm">(USPS Addresses API; one lookup per distinct address; used only for features the address file does not match)</span></label>
      </div>
      <div id="uspsbox" style="display:none">
        <div class="row">
          <div><label class="t">USPS Consumer Key</label><input type="text" id="ukey" autocomplete="off"></div>
          <div><label class="t">USPS Consumer Secret</label><input type="password" id="usecret" autocomplete="off"></div>
          <div style="flex:0 0 110px"><label class="t">Environment</label><select id="uenv"><option value="prod">Production</option><option value="test">Test</option></select></div>
        </div>
        <label style="display:block;margin-top:4px"><input type="checkbox" id="uremember"> Remember key/secret in this browser <span class="sm">(chrome.storage.local, not shared)</span></label>
        <button id="utest">Test USPS</button>
      </div>
      <div class="opt">
        <label><input type="checkbox" id="overwrite" checked> Overwrite existing values that do not match the name <span class="sm">(off = only fill blank fields)</span></label>
        <label><input type="checkbox" id="clearp4" checked> Clear Postal Code plus 4 when the house number or street changes <span class="sm">(it belonged to the old address)</span></label>
      </div>
      <button id="test" disabled>Test connection</button>
      <button id="preview" disabled>1. Preview</button>
      <button id="apply" disabled>2. Apply ticked changes</button>
      <label class="t">Changes found <span class="sm">(untick a field to leave it alone)</span></label>
      <div id="changes" class="box sm">Load the files, then Preview. Nothing is saved until Apply.</div>
      <div id="flags" class="sm warn" style="margin-top:4px"></div>
      <button id="report" disabled>Download change report</button>
      <button id="undo" disabled>Download undo log</button>
      <button id="restore">Restore from undo log…</button>
      <input type="file" id="restoreFile" accept=".json" style="display:none">
      <div id="status" class="sm" style="margin-top:8px;font-weight:600"></div>
      <div id="log">1) Load the manhole / pole files  2) Check design and address defaults  3) Test connection  4) Preview  5) Apply</div>
    </div>`;
  document.documentElement.appendChild(host);
  const $ = id => root.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  $('base').value = location.origin;
  try {
    chrome.storage.local.get(['uspsKey', 'uspsSecret', 'uspsEnv', 'uspsOn'], v => {
      if (v.uspsKey) { $('ukey').value = v.uspsKey; $('uremember').checked = true; }
      if (v.uspsSecret) $('usecret').value = v.uspsSecret;
      if (v.uspsEnv) $('uenv').value = v.uspsEnv;
      if (v.uspsOn) { $('usecb').checked = true; $('uspsbox').style.display = ''; }
    });
  } catch { /* storage unavailable */ }
  $('usecb').onchange = () => { $('uspsbox').style.display = $('usecb').checked ? '' : 'none'; try { chrome.storage.local.set({ uspsOn: $('usecb').checked }); } catch {} };
  const log = m => { $('log').textContent += '\n' + m; $('log').scrollTop = 1e9; };
  const setLog = m => { $('log').textContent = m; };
  $('close').onclick = () => { host.style.display = 'none'; };
  window.__iqgNameAddrPanel = { toggle: () => { host.style.display = host.style.display === 'none' ? '' : 'none'; } };

  let feats = null, fieldDefs = {}, addrIndex = null;        // fieldDefs[type][field] = 'string(8)'
  let plan = new Map(), fieldCounts = {}, reportRows = [], undo = [], blocked = true;

  // ---------- API ----------
  const base = () => $('base').value.trim().replace(/\/+$/, '');
  const design = () => $('design').value.trim();
  const conc = () => Math.min(8, Math.max(1, parseInt($('conc').value, 10) || 4));
  const urlFor = (urn, delta) => `${base()}/feature/${urn.split('/').map(encodeURIComponent).join('/')}` + (delta ? `?delta=${encodeURIComponent(delta)}` : '');
  function csrfHeaders() {
    const h = {};
    const m = document.cookie.split('; ').map(c => c.split('=')).find(([k]) => /csrf|xsrf/i.test(k));
    if (m) { const v = decodeURIComponent(m[1]); h['X-CSRFToken'] = v; h['X-XSRF-TOKEN'] = v; h['X-CSRF-Token'] = v; }
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta) h['X-CSRF-Token'] = meta.content;
    return h;
  }
  async function withRetry(fn, tries = 3) {
    let last;
    for (let i = 0; i < tries; i++) {
      try { const r = await fn(); if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status); return r; }
      catch (e) { last = e; await new Promise(res => setTimeout(res, 500 * (i + 1))); }
    }
    throw last;
  }
  const getFeature = (urn, delta) => withRetry(() =>
    fetch(urlFor(urn, delta), { credentials: 'same-origin', headers: { Accept: 'application/json' } }));
  const putFeature = (feature, urn, delta) => withRetry(() =>
    fetch(urlFor(urn, delta), {
      method: 'PUT', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...csrfHeaders() },
      body: JSON.stringify(feature)
    }));
  async function pool(items, worker, onProgress) {
    let i = 0, done = 0;
    await Promise.all(Array.from({ length: Math.min(conc(), items.length || 1) }, async () => {
      while (i < items.length) { const idx = i++; await worker(items[idx], idx); done++; onProgress && onProgress(done); }
    }));
  }
  function progress(label, total) {
    $('status').textContent = `${label}: 0/${total}`;
    let last = 0;
    return done => {
      if (done !== total && Date.now() - last < 250) return;
      last = Date.now();
      $('status').textContent = `${label}: ${done}/${total}` + (done === total ? ' ✓' : '');
    };
  }
  function download(name, text, mime) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = name; root.appendChild(a); a.click(); a.remove();
  }
  const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const str = v => v == null ? '' : String(v);
  const showWs = v => v === null || v === undefined || v === '' ? '(blank)' : '“' + String(v).replace(/\t/g, '⇥').replace(/\r?\n/g, '↵')
    .replace(/[ \u00a0\u200b\ufeff]/g, '◦').replace(/^ +| +$/g, m => '·'.repeat(m.length)).replace(/ {2,}/g, m => '·'.repeat(m.length)) + '”';
  const tickedChanges = () => new Set([...root.querySelectorAll('#changes input:checked')].map(i => i.value));
  const normDC = v => String(v ?? '').trim().replace(/^design\//i, '').toLowerCase();
  const cfg = () => ({ city: $('city').value, state: $('state').value, zip: $('zip').value, county: $('county').value,
    country: $('country').value, caseMode: $('casemode').value });
  function refresh() {
    $('test').disabled = !feats;
    $('preview').disabled = !feats;
    $('apply').disabled = !plan.size || blocked;
    $('report').disabled = !reportRows.length;
    $('undo').disabled = !undo.length;
  }
  const setBusy = b => { ['test', 'preview', 'apply', 'ffiles', 'afiles', 'restore', 'utest'].forEach(id => $(id).disabled = b); if (!b) refresh(); };
  const resetPlan = () => { plan = new Map(); fieldCounts = {}; reportRows = []; blocked = true; $('flags').textContent = ''; };
  const typeFromPath = p => (KNOWN_TYPES.find(t => new RegExp('(^|[\\\\/_\\-. ])' + t + '(?![a-z])', 'i').test(p.split(/[\\/]/).pop())) || '');

  // ---------- USPS lookup (via background service worker) ----------
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const uspsCreds = () => ({ id: $('ukey').value.trim(), secret: $('usecret').value.trim(), env: $('uenv').value });
  function saveUspsCreds() {
    try {
      if ($('uremember').checked) chrome.storage.local.set({ uspsKey: $('ukey').value.trim(), uspsSecret: $('usecret').value.trim(), uspsEnv: $('uenv').value });
      else chrome.storage.local.remove(['uspsKey', 'uspsSecret', 'uspsEnv']);
    } catch {}
  }
  let uspsChain = Promise.resolve(), uspsMemo = new Map(), uspsStop = null;
  const uspsReset = () => { uspsChain = Promise.resolve(); uspsMemo = new Map(); uspsStop = null; };
  function uspsAsk(street, city, state) {
    return chrome.runtime.sendMessage({ type: 'usps', ...uspsCreds(), street, city, state })
      .then(r => r || { fatal: 'no answer from the extension background worker' })
      .catch(e => ({ fatal: 'extension messaging failed: ' + e.message }));
  }
  function usps(parsed, c) {                        // one lookup per distinct address, one at a time
    const street = streetLine(parsed);
    const key = (street + '|' + c.city + '|' + c.state).toUpperCase();
    if (!uspsMemo.has(key)) {
      const p = uspsChain = uspsChain.then(async () => {
        if (uspsStop) return { skipped: true };
        const r = await uspsAsk(street, c.city, c.state);
        if (r.fatal || r.rate) uspsStop = r;
        if (!r.cached) await sleep(150);
        return r;
      });
      uspsMemo.set(key, p);
    }
    return uspsMemo.get(key);
  }
  $('utest').onclick = async () => {
    setBusy(true); saveUspsCreds();
    log('\nTesting USPS with the USPS documentation example (3120 M St NW, Washington, DC — expects ZIP 20007)…');
    const r = await uspsAsk('3120 M St NW', 'Washington', 'DC');
    if (r.fatal) log('USPS error: ' + r.fatal);
    else if (r.rate) log('USPS says rate limit reached (HTTP 429). Wait and try again.');
    else if (r.ok) log(`USPS OK — ${r.street}, ${r.city} ${r.zip}-${r.plus4} (DPV ${r.dpv || 'n/a'})${r.cached ? ' [from cache]' : ''}`);
    else log(`USPS answered HTTP ${r.status}${r.detail ? ': ' + r.detail : ''}`);
    setBusy(false);
  };

  // ---------- load files ----------
  $('ffiles').onchange = async (e) => {
    const files = [...e.target.files]; if (!files.length) return;
    try {
      const loaded = [];   // {source, type, text}
      fieldDefs = {};
      for (const f of files) {
        if (/\.zip$/i.test(f.name)) {
          const entries = await unzip(await f.arrayBuffer(), n => /(^|\/)(manhole|pole)\.(csv|fields)$/i.test(n));
          if (!entries.length) throw new Error(`no manhole.csv or pole.csv in ${f.name}`);
          for (const x of entries) {
            const type = typeFromPath(x.path);
            if (/\.fields$/i.test(x.path)) fieldDefs[type] = Object.fromEntries(parseCSV(x.text).rows.map(r => [r.name, r.type]));
            else loaded.push({ source: x.path, type, text: x.text });
          }
        } else loaded.push({ source: f.name, type: typeFromPath(f.name), text: await f.text() });
      }
      const bare = loaded.filter(l => !l.type).length;
      if (!$('deftype').value && loaded.length === 1 && loaded[0].type) $('deftype').value = loaded[0].type;
      feats = [];
      for (const l of loaded) {
        const p = parseCSV(l.text);
        const idcol = ['id', 'urn'].find(h => p.headers.includes(h));
        if (!idcol) throw new Error(`${l.source} needs an 'id' column`);
        for (const r of p.rows) {
          let urn = ws(r[idcol]); if (!urn) continue;
          if (!urn.includes('/')) {
            const t = l.type || $('deftype').value.trim().toLowerCase();
            if (!t) throw new Error(`${l.source}: ids have no feature type – fill "Feature type for bare ids"`);
            urn = t + '/' + urn;
          }
          feats.push({ urn, row: r, source: l.source });
        }
      }
      const dc = {}; feats.forEach(b => { const d = (b.row.delta_created || '').trim(); if (d) dc[d] = (dc[d] || 0) + 1; });
      const best = Object.entries(dc).sort((a, b) => b[1] - a[1])[0];
      if (!design() && best) $('design').value = /^design\//i.test(best[0]) ? best[0] : 'design/' + best[0];
      if (!$('createdIn').value.trim() && design()) $('createdIn').value = design().replace(/^design\//i, '');
      resetPlan();
      const byType = {}; feats.forEach(b => { const t = b.urn.split('/')[0]; byType[t] = (byType[t] || 0) + 1; });
      log(`\nLoaded ${feats.length} features: ` + Object.entries(byType).map(([t, n]) => `${n} ${t}`).join(', ') + (bare ? ` (${bare} file(s) used the default type).` : '.'));
    } catch (err) { feats = null; log('\nError reading files: ' + err.message); }
    refresh();
  };

  $('afiles').onchange = async (e) => {
    const files = [...e.target.files];
    addrIndex = null; resetPlan();
    if (!files.length) { log('\nAddress file cleared – postal code comes from USPS or the default.'); return refresh(); }
    try {
      const idx = {}; const used = [];
      for (const f of files) {
        const texts = /\.zip$/i.test(f.name)
          ? (await unzip(await f.arrayBuffer(), n => /\.csv$/i.test(n))).map(x => ({ source: x.path, text: x.text }))
          : [{ source: f.name, text: await f.text() }];
        for (const t of texts) {
          const p = parseCSV(t.text);
          if (!isAddrFile(p.headers)) continue;
          const before = idx.count || 0;
          buildAddrIndex(p.rows, idx);
          used.push(`${t.source} (${idx.count - before})`);
        }
      }
      if (!used.length) throw new Error('no CSV with address columns (a_saddstr + a_szip5, or gis_streetname + gis_postcode) found');
      addrIndex = idx;
      const multi = Object.entries(idx).filter(([, v]) => new Set(v.map(c => c.zip)).size > 1).map(([k]) => k.replace(/\|/g, ' ').trim());
      log(`\nAddress file: ${idx.count} addresses on ${Object.keys(idx).length} streets from ${used.join(', ')}.` +
        (multi.length ? ` Streets with more than one ZIP (house number decides): ${multi.join('; ')}.` : ''));
    } catch (err) { addrIndex = null; log('\nError reading address file: ' + err.message); }
    refresh();
  };

  // ---------- test ----------
  $('test').onclick = async () => {
    const urn = feats[0].urn;
    log(`\nTesting GET ${urlFor(urn, design())}`);
    setBusy(true);
    try {
      const r = await getFeature(urn, design());
      const txt = await r.text();
      log(`HTTP ${r.status}`);
      try {
        const j = JSON.parse(txt), props = j.properties || {}, keys = Object.keys(props);
        const miss = FIELDS.filter(f => !keys.includes(f));
        log(r.ok ? `OK — ${urn} found; ${FIELDS.length - miss.length} of ${FIELDS.length} address fields present` + (miss.length ? ` (missing: ${miss.join(', ')})` : '') +
          `; name = ${showWs(props.name)}.` : 'Server answered with an error (see above).');
      } catch { log('Not JSON. First 300 chars: ' + txt.slice(0, 300)); }
    } catch (err) { log('Request failed: ' + err.message); }
    setBusy(false);
  };

  // ---------- preview ----------
  $('preview').onclick = async () => {
    if (!design()) return log('\nEnter the design to edit in first.');
    const overwrite = $('overwrite').checked, clearP4 = $('clearp4').checked;
    const want = normDC($('createdIn').value), c = cfg();
    const useUsps = $('usecb').checked;
    if (useUsps) {
      const u = uspsCreds();
      if (!u.id || !u.secret) return log('\nEnter the USPS Consumer Key and Secret (or untick the USPS lookup).');
      saveUspsCreds(); uspsReset();
    }
    setBusy(true); resetPlan();
    $('changes').textContent = 'Checking…';
    const seen = new Set(), jobs = [];
    let otherDesign = 0, dup = 0;
    for (const b of feats) {
      if (seen.has(b.urn)) { dup++; continue; }
      seen.add(b.urn);
      if (want && 'delta_created' in b.row && normDC(b.row.delta_created) !== want) { otherDesign++; continue; }
      jobs.push(b);
    }
    setLog(`Reading ${jobs.length} features and comparing their address with the name, design ${design()}…` +
      (otherDesign ? ` ${otherDesign} features with another Design Created left out.` : '') + (dup ? ` ${dup} duplicate rows ignored.` : ''));
    const st = { checked: 0, toUpdate: 0, same: 0, skipped: 0, missing: 0, errors: 0, invalid: 0, uspsOk: 0, uspsNo: 0, uspsDiff: 0, uspsSkip: 0, addrOk: 0, addrNo: 0, addrNear: 0 };
    const skipReasons = {};
    const skip = (urn, name, why) => { st.skipped++; const k = why.replace(/ ".*"/, '').replace(/:.*$/, ''); skipReasons[k] = (skipReasons[k] || 0) + 1; reportRows.push([urn, name, '', '', '', 'SKIPPED: ' + why]); };
    const tick = progress('Checked', jobs.length);
    await pool(jobs, async (b) => {
      const urn = b.urn, type = urn.split('/')[0];
      try {
        const r = await getFeature(urn, design());
        if (r.status === 404) { st.missing++; skip(urn, b.row.name || '', 'not found in IQGeo'); return; }
        if (!r.ok) throw new Error('GET ' + r.status);
        const feat = await r.json(), props = feat.properties || {};
        const name = ws(props.name) || ws(b.row.name);
        if (want && 'delta_created' in props && normDC(props.delta_created) !== want) { skip(urn, name, 'Design Created in IQGeo is ' + props.delta_created); return; }
        st.checked++;
        let parsed = parseName(name);
        if (parsed.error) { skip(urn, name, parsed.error); return; }
        if (!parsed.dir && $('nodir').value === 'keep') parsed = { ...parsed, dir: ws(props.addr_street_direction).toUpperCase() };
        let az = null, uz = null;
        if (addrIndex) {
          az = lookupZip(addrIndex, parsed);
          if (az.zip) { st.addrOk++; if (/nearest/.test(az.how)) { st.addrNear++; reportRows.push([urn, name, '', '', '', `ADDRESS FILE NOTE: ZIP ${az.zip} from ${az.how} – check`]); } }
          else { st.addrNo++; reportRows.push([urn, name, '', '', '', `ADDRESS FILE NOTE: ${az.how} (${streetLine(parsed)})` + (useUsps ? ' – USPS asked' : ' – default postal code kept')]); }
        }
        if (useUsps && !(az && az.zip)) {
          uz = await usps(parsed, c);
          if (uz.ok && uz.zip && uz.dpv !== 'N') {
            st.uspsOk++;
            const ours = streetLine(parsed).toUpperCase();
            if (uz.street && uz.street.toUpperCase().replace(/\s+/g, ' ') !== ours) {
              st.uspsDiff++; reportRows.push([urn, name, '', '', '', `USPS NOTE: USPS standardizes the street to "${uz.street}" (name gives "${ours}")`]);
            }
          } else if (uz.skipped || uz.rate || uz.fatal) st.uspsSkip++;
          else { st.uspsNo++; reportRows.push([urn, name, '', '', '', 'USPS NOTE: address not confirmed by USPS' + (uz.dpv === 'N' ? ' (DPV N)' : '') + ' – default postal code kept']); }
        }
        const good = uz && uz.ok && uz.zip && uz.dpv !== 'N';
        const fromAddr = az && az.zip;
        const t = buildTarget(parsed, fromAddr ? { ...c, zip: az.zip } : good ? { ...c, zip: uz.zip } : c);
        const live = Object.fromEntries(FIELDS.map(n => [n, str(props[n])]));
        const moved = (live.addr_house_number && ws(live.addr_house_number) !== t.addr_house_number) ||
          (ws(live.addr_street_name) && ws(live.addr_street_name).toLowerCase() !== t.addr_street_name.toLowerCase());
        const zipChanged = ws(live.addr_postal_code) && ws(live.addr_postal_code) !== t.addr_postal_code;
        if (clearP4 && (moved || zipChanged)) t.addr_postal_code_plus_4 = '';
        if (good && uz.plus4) t.addr_postal_code_plus_4 = uz.plus4;
        if (fromAddr && az.plus4) t.addr_postal_code_plus_4 = az.plus4;
        const changes = {}, old = {};
        for (const n of FIELDS) {
          if (!(n in props)) continue;
          if (n === 'addr_postal_code_plus_4' && !(n in t)) continue;       // never touched unless cleared
          const tv = t[n] ?? '';
          if (live[n] === tv) continue;                                      // exact match (also catches stray spaces in IQGeo)
          if (!overwrite && ws(live[n])) continue;                           // fill blanks only
          const max = ((fieldDefs[type] && /\((\d+)\)/.exec(fieldDefs[type][n] || '') || [])[1]) || MAXLEN[n];
          if (max && tv.length > +max) { st.invalid++; reportRows.push([urn, name, n, live[n], tv, `INVALID: too long (${tv.length} > ${max})`]); continue; }
          changes[n] = tv === '' ? null : tv; old[n] = props[n] ?? null;
          fieldCounts[n] = (fieldCounts[n] || 0) + 1;
          reportRows.push([urn, name, n, live[n], tv, ws(live[n]) === tv ? 'REMOVE SPACES' : (live[n] ? 'OVERWRITE' : 'FILL') + (n === 'addr_postal_code_plus_4' ? (tv ? ' (from ' + (fromAddr ? 'address file' : 'USPS') + ')' : ' (cleared: address or ZIP changed)') : '') +
            (n === 'addr_postal_code' && fromAddr ? ' (address file: ' + az.how + ')' : '')]);
        }
        if (Object.keys(changes).length) { plan.set(urn, { urn, name, changes, old }); st.toUpdate++; }
        else st.same++;
      } catch (err) { st.errors++; log(`Error ${urn}: ${err.message}`); }
    }, tick);

    const keys = FIELDS.filter(f => fieldCounts[f]);
    $('changes').innerHTML = keys.length
      ? `<table><tr><th></th><th>Field</th><th>Changes</th><th>Example</th></tr>` + keys.map(f => {
          const ex = [...plan.values()].find(p => f in p.changes);
          return `<tr><td><input type="checkbox" value="${esc(f)}" checked></td><td>${esc(f)}</td><td>${fieldCounts[f]}</td>
            <td>${esc(ex.name)}:<br>${esc(showWs(ex.old[f]))} → ${esc(showWs(ex.changes[f]))}</td></tr>`;
        }).join('') + '</table>'
      : 'No changes — every address already matches its name.';
    const sk = Object.entries(skipReasons);
    const uspsMsg = [];
    if (addrIndex) uspsMsg.push(`Address file: ${st.addrOk} matched` + (st.addrNear ? ` (${st.addrNear} by nearest house number)` : '') + `, ${st.addrNo} not matched` +
      (st.addrNo ? (useUsps ? ' (USPS asked)' : ' (default postal code kept – see report)') : ''));
    if (useUsps) {
      uspsMsg.push(`USPS: ${st.uspsOk} confirmed, ${st.uspsNo} not confirmed` + (st.uspsDiff ? `, ${st.uspsDiff} with a different street spelling (see report)` : ''));
      if (uspsStop) uspsMsg.push(uspsStop.rate ? `USPS rate limit reached – ${st.uspsSkip} features used the default postal code; wait and Preview again (answers already received are cached)` : `USPS stopped: ${uspsStop.fatal} – ${st.uspsSkip} features used the default postal code`);
    }
    $('flags').textContent = [sk.length ? 'Skipped: ' + sk.map(([k, n]) => `${n} × ${k}`).join(' | ') : '', ...uspsMsg].filter(Boolean).join(' — ');
    if (uspsStop) log('\n' + (uspsStop.rate ? 'USPS rate limit reached (HTTP 429).' : 'USPS stopped: ' + uspsStop.fatal));
    log(`\nPreview: ${st.checked} checked — ${st.toUpdate} to update, ${st.same} already correct, ${st.skipped} skipped, ` +
      `${st.invalid} invalid values, ${st.errors} errors. Details per feature: Download change report.`);
    blocked = st.errors > 0;
    if (st.errors) log('Some features could not be read. Run Preview again before applying.');
    setBusy(false);
  };

  // ---------- apply ----------
  const same = (a, b) => str(a) === str(b);
  async function applyOne(p, fields) {
    const changes = {}, old = {};
    for (const f of fields) { changes[f] = p.changes[f]; old[f] = p.old[f]; }
    const g = await getFeature(p.urn, design());
    if (!g.ok) throw new Error('GET ' + g.status);
    const feature = await g.json();
    const props = feature.properties || (feature.properties = {});
    for (const f of fields) if (!same(props[f], old[f])) throw new Error(`${f} was changed in IQGeo after Preview (now ${showWs(props[f])}) — skipped`);
    Object.assign(props, changes);
    const r = await putFeature(feature, p.urn, design());
    if (!r.ok) throw new Error(`PUT ${r.status} ${(await r.text()).slice(0, 200)}`);
    return { changes, old };
  }
  async function verify(urn, changes) {
    const r = await getFeature(urn, design());
    const props = (await r.json()).properties || {};
    return Object.entries(changes).every(([k, v]) => same(props[k], v));
  }
  $('apply').onclick = async () => {
    const ticked = tickedChanges();
    const work = [...plan.values()].map(p => ({ p, fields: Object.keys(p.changes).filter(f => ticked.has(f)) })).filter(w => w.fields.length);
    if (!work.length) return log('\nNothing ticked to apply.');
    const n = work.reduce((s, w) => s + w.fields.length, 0);
    if (!confirm(`Update the address of ${work.length} features (${n} field changes) in design\n${design()} ?\n\nThe first one is saved and read back before the rest.`)) return;
    setBusy(true);
    undo = []; let ok = 0, fail = 0;
    const done = new Set();
    const record = (p, res) => { undo.push({ urn: p.urn, delta: design(), restore: res.old, applied: res.changes }); done.add(p.urn); ok++; };
    const [first, ...rest] = work;
    try {
      const res = await applyOne(first.p, first.fields);
      if (!(await verify(first.p.urn, res.changes))) throw new Error('read-back mismatch — IQGeo accepted the request but the values were not stored');
      record(first.p, res);
      log(`\nVerified first update (${first.p.urn}). Continuing…`);
    } catch (err) {
      log(`\nSTOPPED on first feature ${first.p.urn}: ${err.message}`);
      log('No other features were changed. Copy this message for your developer/assistant.');
      setBusy(false); return;
    }
    const tick = progress('Updated', rest.length);
    await pool(rest, async ({ p, fields }) => {
      try { record(p, await applyOne(p, fields)); }
      catch (err) { fail++; log(`FAILED ${p.urn}: ${err.message}`); }
    }, tick);
    for (const u of done) plan.delete(u);
    reportRows = reportRows.map(r => done.has(r[0]) && /^(FILL|OVERWRITE|REMOVE)/.test(r[5]) ? [...r.slice(0, 5), r[5] + ' – APPLIED'] : r);
    log(`\nDone. Updated ${ok} features, failed ${fail}. Undo log downloaded automatically — keep it.`);
    log('Tip: run Preview again — it should now find 0 changes for what you applied.');
    download(`name_address_undo_${stamp()}.json`, JSON.stringify(undo, null, 2), 'application/json');
    blocked = true;
    setBusy(false);
  };

  // ---------- report / undo ----------
  $('report').onclick = () => {
    const lines = [['feature', 'name', 'field', 'iqgeo_value', 'new_value', 'action / note'], ...reportRows].map(r => r.map(csvCell).join(','));
    download(`name_address_report_${stamp()}.csv`, '\ufeff' + lines.join('\r\n'), 'text/csv');
  };
  $('undo').onclick = () => download(`name_address_undo_${stamp()}.json`, JSON.stringify(undo, null, 2), 'application/json');
  $('restore').onclick = () => $('restoreFile').click();
  $('restoreFile').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    let entries; try { entries = JSON.parse(await f.text()); } catch { return log('\nUndo log is not valid JSON.'); }
    if (!Array.isArray(entries) || !entries.length) return log('\nUndo log is empty.');
    if (!confirm(`Restore previous values on ${entries.length} feature(s)?`)) return;
    setBusy(true);
    let ok = 0, fail = 0;
    const tick = progress('Restored', entries.length);
    await pool(entries, async (en) => {
      try {
        const r = await getFeature(en.urn, en.delta);
        if (!r.ok) throw new Error('GET ' + r.status);
        const feature = await r.json();
        Object.assign(feature.properties, en.restore);
        const w = await putFeature(feature, en.urn, en.delta);
        if (!w.ok) throw new Error('PUT ' + w.status);
        ok++;
      } catch (err) { fail++; log(`Restore failed ${en.urn}: ${err.message}`); }
    }, tick);
    log(`\nRestore done. Restored ${ok}, failed ${fail}.`);
    setBusy(false);
  };
})();
