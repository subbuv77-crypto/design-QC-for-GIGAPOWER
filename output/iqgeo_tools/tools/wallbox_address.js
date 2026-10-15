(() => {
  if (window.__iqgWbAddrPanel) { window.__iqgWbAddrPanel.toggle(); return; }

  // ---------- address rules (same as Wall Box Address Filler v1) ----------
  const FIELDS = ['addr_house_number', 'addr_street_direction', 'addr_street_name', 'addr_street_name_suffix', 'addr_city', 'addr_state',
    'addr_postal_code', 'addr_postal_code_plus_4', 'addr_county', 'addr_country', 'addr_unit', 'addr_full'];
  // wall_box field lengths (used when no .fields file is loaded)
  const MAXLEN = { addr_house_number: 8, addr_street_direction: 4, addr_street_name: 128, addr_street_name_suffix: 8, addr_city: 128,
    addr_state: 2, addr_postal_code: 5, addr_postal_code_plus_4: 9, addr_county: 128, addr_country: 32, addr_unit: 100, addr_full: 1024 };
  const DIRS = ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'];
  const ws = s => String(s == null ? '' : s).replace(/[\s ​﻿]+/g, ' ').trim();
  const title = s => ws(s).split(' ').filter(Boolean).map(w => (/^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1).toLowerCase())).join(' ');

  function targetFor(r) {
    const no = ws(r.a_saddno) || ws(r.gis_streetnr);
    const name = title(r.a_saddstr || r.gis_streetname);
    let typ = ws(r.a_saddsttyp || r.gis_streettype);
    const suf = ws(r.a_saddstsuf).toUpperCase(), pre = ws(r.a_saddpref).toUpperCase();
    const dir = DIRS.includes(suf) ? suf : DIRS.includes(pre) ? pre : ws(r.gis_streetdirection).toUpperCase();
    if (!typ && suf && !DIRS.includes(suf)) typ = suf;
    if (!no || !name) return null;
    const zip = ws(r.a_szip), z5 = ws(r.a_szip5) || zip.slice(0, 5);
    const p4 = zip.includes('-') ? zip.split('-')[1] : ws(r.gis_postalcodeplus4);
    const city = title(r.a_scity) || 'Albuquerque', st = ws(r.a_state2) || 'NM', unit = ws(r.unit);
    return {
      addr_house_number: no, addr_street_direction: dir, addr_street_name: name, addr_street_name_suffix: typ.toUpperCase(),
      addr_city: city.toUpperCase(), addr_state: st, addr_postal_code: z5, addr_postal_code_plus_4: p4,
      addr_county: ws(r.a_county).toUpperCase(), addr_country: 'USA', addr_unit: unit, addr_full: ''
    };
  }
  function fullAddress(t) {
    const line = [t.addr_house_number, title(t.addr_street_name), title(t.addr_street_name_suffix), t.addr_street_direction, t.addr_unit].filter(Boolean).join(' ');
    return line + ', ' + title(t.addr_city) + ', ' + t.addr_state + (t.addr_postal_code ? ' ' + t.addr_postal_code : '') + ', USA';
  }

  // ---------- coordinates ----------
  function wkbPoint(hex) {
    hex = String(hex || '').trim();
    if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 42) return null;
    const b = new Uint8Array(hex.match(/../g).map(h => parseInt(h, 16)));
    const dv = new DataView(b.buffer), le = b[0] === 1;
    const type = dv.getUint32(1, le), off = type & 0x20000000 ? 9 : 5;
    if ((type & 0xff) !== 1) return null;
    return [dv.getFloat64(off, le), dv.getFloat64(off + 8, le)];
  }
  function anyPoint(v) {
    if (!v) return null;
    if (typeof v === 'string') {
      const w = wkbPoint(v); if (w) return w;
      const m = v.match(/POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)/i); if (m) return [+m[1], +m[2]];
      try { return anyPoint(JSON.parse(v)); } catch { return null; }
    }
    if (v.type === 'Point' && v.coordinates) return [v.coordinates[0], v.coordinates[1]];
    if (v.coordinates && typeof v.coordinates[0] === 'number') return [v.coordinates[0], v.coordinates[1]];
    if (typeof v.lng === 'number') return [v.lng, v.lat];
    if (v.geometry) return anyPoint(v.geometry);
    return null;
  }
  const metres = (a, b) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos(a[1] * Math.PI / 180), (a[1] - b[1]) * 110540);
  function pointOf(r) {
    for (const [la, lo] of [['demand_point_lat', 'demand_point_lon'], ['a_lat', 'a_lon'], ['gis_latitude', 'gis_longitude'], ['latitude', 'longitude'], ['lat', 'lon']]) {
      const y = parseFloat(r[la]), x = parseFloat(r[lo]);
      if (isFinite(x) && isFinite(y) && x && y) return [x, y];
    }
    return null;
  }

  // ---------- CSV / ZIP ----------
  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
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
      input[type=text],input[type=number]{width:100%;box-sizing:border-box;padding:5px}
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
      <h3>IQGeo Wall Box Address Updater <button class="x" id="close" title="Hide">✕</button></h3>
      <div class="row">
        <div><label class="t">IQGeo base URL</label><input type="text" id="base"></div>
        <div style="flex:0 0 80px"><label class="t">Parallel</label><input type="number" id="conc" min="1" max="8" value="4"></div>
      </div>
      <label class="t">Wall boxes <span class="sm">(design export .zip, or a wall box .csv with an <code>id</code> column)</span></label>
      <input type="file" id="fbox" accept=".zip,.csv">
      <label class="t">Address export CSV <span class="sm">(e.g. PSA_…_VICTOR….csv)</span></label>
      <input type="file" id="faddr" accept=".csv,text/csv">
      <button id="clearFiles" type="button">Clear file selection</button>
      <label class="t">Design to edit in</label>
      <input type="text" id="design" placeholder="design/PSA-1043PA-ALBQNMMA-VICTOR">
      <label class="t">Only wall boxes with Design Created = <span class="sm">(blank = all wall boxes)</span></label>
      <input type="text" id="createdIn" placeholder="PSA-1043PA-ALBQNMMA-VICTOR">
      <div class="opt">
        <label><input type="checkbox" id="overwrite" checked> Overwrite existing values <span class="sm">(off = only fill blank fields)</span></label>
        <label><input type="checkbox" id="guard" checked> Skip wall boxes whose house number or street would change</label>
        <label>Max distance to the address point <input type="number" id="maxd" value="1" min="0" step="0.5" style="width:70px;padding:3px"> m</label>
      </div>
      <button id="test" disabled>Test connection</button>
      <button id="preview" disabled>1. Preview</button>
      <button id="apply" disabled>2. Apply ticked changes</button>
      <button id="stop" disabled title="Stop after the requests already in progress finish">■ Stop</button>
      <label class="t">Changes found <span class="sm">(untick a field to leave it alone)</span></label>
      <div id="changes" class="box sm">Load both files, then Preview. Nothing is saved until Apply.</div>
      <div id="flags" class="sm warn" style="margin-top:4px"></div>
      <button id="report" disabled>Download change report</button>
      <button id="undo" disabled>Download undo log</button>
      <button id="restore">Restore from undo log…</button>
      <input type="file" id="restoreFile" accept=".json" style="display:none">
      <div id="status" class="sm" style="margin-top:8px;font-weight:600"></div>
      <div id="log">1) Load the wall boxes and the address export  2) Check design  3) Test connection  4) Preview  5) Apply</div>
    </div>`;
  document.documentElement.appendChild(host);
  const $ = id => root.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  $('base').value = location.origin;
  const log = m => { $('log').textContent += '\n' + m; $('log').scrollTop = 1e9; };
  const setLog = m => { $('log').textContent = m; };
  $('close').onclick = () => { host.style.display = 'none'; };
  window.__iqgWbAddrPanel = { hide: () => { host.style.display = 'none'; }, toggle: () => { host.style.display = host.style.display === 'none' ? '' : 'none'; } };

  let boxes = null, boxFields = null, points = null;
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
  let stopReq = false;                    // set by the Stop button; pool() then starts no new work
  async function pool(items, worker, onProgress) {
    let i = 0, done = 0;
    await Promise.all(Array.from({ length: Math.min(conc(), items.length || 1) }, async () => {
      while (i < items.length && !stopReq) { const idx = i++; await worker(items[idx], idx); done++; onProgress && onProgress(done); }
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
    .replace(/[ ​﻿]/g, '◦').replace(/^ +| +$/g, m => '·'.repeat(m.length)).replace(/ {2,}/g, m => '·'.repeat(m.length)) + '”';
  const tickedChanges = () => new Set([...root.querySelectorAll('#changes input:checked')].map(i => i.value));
  const normDC = v => String(v ?? '').trim().replace(/^design\//i, '').toLowerCase();
  function refresh() {
    $('test').disabled = !boxes;
    $('preview').disabled = !(boxes && points);
    $('apply').disabled = !plan.size || blocked;
    $('report').disabled = !reportRows.length;
    $('undo').disabled = !undo.length;
  }
  const setBusy = b => { if (b) stopReq = false; $('stop').disabled = !b; ['test', 'preview', 'apply', 'fbox', 'faddr', 'clearFiles', 'restore'].forEach(id => $(id).disabled = b); if (!b) refresh(); };
  const resetPlan = () => { plan = new Map(); fieldCounts = {}; reportRows = []; blocked = true; $('flags').textContent = ''; };
  const fillDesign = (cands) => {
    if (!design()) {
      const cnt = {};
      cands.forEach(d => { d = (d || '').trim(); if (d) cnt[d] = (cnt[d] || 0) + 1; });
      const best = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
      if (best) $('design').value = /^design\//i.test(best[0]) ? best[0] : 'design/' + best[0];
    }
    if (!$('createdIn').value.trim() && design()) $('createdIn').value = design().replace(/^design\//i, '');
  };

  // ---------- load files ----------
  $('fbox').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      let csvText = null; boxFields = null;
      if (/\.zip$/i.test(f.name)) {
        const files = await unzip(await f.arrayBuffer(), n => /(^|\/)wall_box\.(csv|fields)$/i.test(n));
        const c = files.find(x => /\.csv$/i.test(x.path)), d = files.find(x => /\.fields$/i.test(x.path));
        if (!c) throw new Error('no wall_box.csv in this zip');
        csvText = c.text;
        if (d) boxFields = Object.fromEntries(parseCSV(d.text).rows.map(r => [r.name, r.type]));
      } else csvText = await f.text();
      const p = parseCSV(csvText);
      const idcol = ['id', 'urn', 'wall_box', 'wall_box_id'].find(h => p.headers.includes(h));
      if (!idcol) throw new Error("the wall box file needs an 'id' column");
      boxes = p.rows.map(r => { let urn = ws(r[idcol]); if (urn && !urn.includes('/')) urn = 'wall_box/' + urn; return { urn, row: r }; }).filter(b => b.urn);
      fillDesign(boxes.map(b => b.row.delta_created));
      resetPlan();
      log(`\nLoaded ${boxes.length} wall boxes from ${f.name}` + (boxes[0].row.location ? ' (with coordinates).' : ' (coordinates will be read from IQGeo).'));
    } catch (err) { boxes = null; log('\nError reading wall boxes: ' + err.message); }
    refresh();
  };
  $('faddr').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const p = parseCSV(await f.text());
      points = p.rows.map(r => ({ p: pointOf(r), r })).filter(x => x.p);
      if (!points.length) throw new Error('no coordinate columns (demand_point_lat/lon, a_lat/a_lon or gis_latitude/longitude)');
      if (!boxes) fillDesign(p.rows.map(r => r.design_job_name));
      resetPlan();
      log(`\nLoaded ${points.length} address points from ${f.name}` + (p.rows.length > points.length ? ` (${p.rows.length - points.length} rows without coordinates ignored).` : '.'));
    } catch (err) { points = null; log('\nError reading address export: ' + err.message); }
    refresh();
  };

  // ---------- stop / clear files ----------
  $('stop').onclick = () => {
    stopReq = true; $('stop').disabled = true;
    $('status').textContent += ' — stopping…';
    log('\nStop pressed — finishing the requests already in progress, nothing new is started…');
  };
  $('clearFiles').onclick = () => {
    $('fbox').value = ''; $('faddr').value = '';
    boxes = null; boxFields = null; points = null; undo = [];
    $('design').value = ''; $('createdIn').value = '';
    resetPlan(); $('changes').textContent = 'Load both files, then Preview. Nothing is saved until Apply.'; $('status').textContent = '';
    refresh();
    log('\nFile selection cleared. Load new files to start again.');
  };

  // ---------- test ----------
  $('test').onclick = async () => {
    const urn = boxes[0].urn;
    log(`\nTesting GET ${urlFor(urn, design())}`);
    setBusy(true);
    try {
      const r = await getFeature(urn, design());
      const txt = await r.text();
      log(`HTTP ${r.status}`);
      try {
        const j = JSON.parse(txt), keys = Object.keys(j.properties || {});
        const miss = FIELDS.filter(f => !keys.includes(f));
        log(r.ok ? `OK — wall box found; ${FIELDS.length - miss.length} of ${FIELDS.length} address fields present` + (miss.length ? ` (missing: ${miss.join(', ')})` : '') +
          `; coordinates ${anyPoint(j.geometry) || anyPoint(j.properties && j.properties.location) ? 'found' : 'NOT found'}.`
          : 'Server answered with an error (see above).');
      } catch { log('Not JSON. First 300 chars: ' + txt.slice(0, 300)); }
    } catch (err) { log('Request failed: ' + err.message); }
    setBusy(false);
  };

  // ---------- preview ----------
  $('preview').onclick = async () => {
    if (!design()) return log('\nEnter the design to edit in first.');
    const overwrite = $('overwrite').checked, guard = $('guard').checked, maxD = parseFloat($('maxd').value) || 1;
    const want = normDC($('createdIn').value);
    setBusy(true); resetPlan();
    $('changes').textContent = 'Checking…';
    const seen = new Set(), jobs = [];
    let otherDesign = 0, dup = 0;
    for (const b of boxes) {
      if (seen.has(b.urn)) { dup++; continue; }
      seen.add(b.urn);
      if (want && 'delta_created' in b.row && normDC(b.row.delta_created) !== want) { otherDesign++; continue; }
      jobs.push(b);
    }
    setLog(`Matching ${jobs.length} wall boxes to ${points.length} address points (max ${maxD} m), design ${design()}…` +
      (otherDesign ? ` ${otherDesign} wall boxes with another Design Created left out.` : '') + (dup ? ` ${dup} duplicate rows ignored.` : ''));
    const st = { checked: 0, toUpdate: 0, same: 0, skipped: 0, missing: 0, errors: 0, invalid: 0, warned: 0 };
    const skipReasons = {}, items = [];
    const skip = (urn, why, extra = []) => { st.skipped++; const k = why.replace(/ \(nearest [\d.]+ m\)/, '').replace(/:.*$/, ''); skipReasons[k] = (skipReasons[k] || 0) + 1; reportRows.push([urn, '', '', '', 'SKIPPED: ' + why, ...extra]); };
    const tick = progress('Checked', jobs.length);
    await pool(jobs, async (b) => {
      const urn = b.urn;
      try {
        const r = await getFeature(urn, design());
        if (r.status === 404) { st.missing++; skip(urn, 'not found in IQGeo'); return; }
        if (!r.ok) throw new Error('GET ' + r.status);
        const feat = await r.json(), props = feat.properties || {};
        if (want && 'delta_created' in props && normDC(props.delta_created) !== want) { skip(urn, 'Design Created in IQGeo is ' + props.delta_created); return; }
        st.checked++;
        const pt = anyPoint(b.row.location) || anyPoint(feat.geometry) || anyPoint(props.location);
        if (!pt) { skip(urn, 'no coordinates for this wall box'); return; }
        let best = null, bd = Infinity;
        for (const x of points) { const d = metres(pt, x.p); if (d < bd) { bd = d; best = x; } }
        const addrId = best.r.id || best.r.demand_id || '';
        const extra = [bd.toFixed(2), addrId];
        if (bd > maxD) { skip(urn, `no address point within ${maxD} m (nearest ${bd.toFixed(1)} m)`, extra); return; }
        const t = targetFor(best.r);
        if (!t) { skip(urn, 'matched address point has no house number/street', extra); return; }
        const cur = Object.fromEntries(FIELDS.map(n => [n, ws(props[n])]));
        for (const n of FIELDS) if (n !== 'addr_full' && !t[n] && cur[n]) t[n] = cur[n];   // never blank a value the address point lacks
        t.addr_full = fullAddress(t);
        const flags = [];
        if (cur.addr_house_number && cur.addr_house_number !== t.addr_house_number) flags.push(`house number ${cur.addr_house_number} → ${t.addr_house_number}`);
        if (cur.addr_street_name && !cur.addr_street_name.toLowerCase().startsWith(t.addr_street_name.toLowerCase())) flags.push(`street ${cur.addr_street_name} → ${t.addr_street_name}`);
        if (guard && flags.length) { skip(urn, 'house number/street would change: ' + flags.join('; '), extra); return; }
        const changes = {}, old = {};
        for (const n of FIELDS) {
          if (!(n in props)) continue;                            // field not on this feature
          const live = props[n];
          if (str(live) === t[n]) continue;                       // exact match (also catches extra spaces in IQGeo)
          if (!overwrite && cur[n]) continue;                     // fill blanks only
          if (!t[n] && !str(live)) continue;
          const max = (boxFields && /\((\d+)\)/.exec(boxFields[n] || '') || [])[1] || MAXLEN[n];
          if (max && t[n].length > +max) { st.invalid++; reportRows.push([urn, n, str(live), t[n], `INVALID: too long (${t[n].length} > ${max})`, ...extra]); continue; }
          changes[n] = t[n] === '' ? null : t[n]; old[n] = live ?? null;
          fieldCounts[n] = (fieldCounts[n] || 0) + 1;
          reportRows.push([urn, n, str(live), t[n], ws(live) === t[n] ? 'REMOVE SPACES' : 'UPDATE' + (flags.length ? ' ⚠ ' + flags.join('; ') : ''), ...extra]);
        }
        if (flags.length && Object.keys(changes).length) st.warned++;
        if (Object.keys(changes).length) { plan.set(urn, { urn, changes, old, pt, key: pt[0].toFixed(7) + ',' + pt[1].toFixed(7) }); st.toUpdate++; }
        else st.same++;
        items.push({ urn, key: pt[0].toFixed(7) + ',' + pt[1].toFixed(7) });
      } catch (err) { st.errors++; log(`Error ${urn}: ${err.message}`); }
    }, tick);

    // several wall boxes at the same spot
    const spot = {}; items.forEach(i => spot[i.key] = (spot[i.key] || 0) + 1);
    const stacked = items.filter(i => spot[i.key] > 1).length;

    const keys = FIELDS.filter(f => fieldCounts[f]);
    $('changes').innerHTML = keys.length
      ? `<table><tr><th></th><th>Field</th><th>Changes</th><th>Example</th></tr>` + keys.map(f => {
          const ex = [...plan.values()].find(p => f in p.changes);
          return `<tr><td><input type="checkbox" value="${esc(f)}" checked></td><td>${esc(f)}</td><td>${fieldCounts[f]}</td>
            <td>${esc(showWs(ex.old[f]))} → ${esc(showWs(ex.changes[f]))}</td></tr>`;
        }).join('') + '</table>'
      : 'No changes — the wall boxes already match their address points.';
    const sk = Object.entries(skipReasons);
    $('flags').textContent = (sk.length ? 'Skipped: ' + sk.map(([k, n]) => `${n} × ${k}`).join(' | ') : '') +
      (st.warned ? `${sk.length ? ' — ' : ''}${st.warned} updates change house number/street (guard is off)` : '') +
      (stacked ? `${sk.length || st.warned ? ' — ' : ''}${stacked} wall boxes share a spot with another wall box` : '');
    log(`\nPreview: ${st.checked} checked — ${st.toUpdate} to update, ${st.same} already correct, ${st.skipped} skipped, ` +
      `${st.invalid} invalid values, ${st.errors} errors. Details per wall box: Download change report.`);
    blocked = st.errors > 0 || stopReq;
    if (stopReq) log('Stopped by user — only part of the features were checked. Run Preview again before applying.');
    if (st.errors) log('Some wall boxes could not be read. Run Preview again before applying.');
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
    if (!confirm(`Update the address of ${work.length} wall boxes (${n} field changes) in design\n${design()} ?\n\nThe first one is saved and read back before the rest.`)) return;
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
      log(`\nSTOPPED on first wall box ${first.p.urn}: ${err.message}`);
      log('No other wall boxes were changed. Copy this message for your developer/assistant.');
      setBusy(false); return;
    }
    const tick = progress('Updated', rest.length);
    await pool(rest, async ({ p, fields }) => {
      try { record(p, await applyOne(p, fields)); }
      catch (err) { fail++; log(`FAILED ${p.urn}: ${err.message}`); }
    }, tick);
    for (const u of done) plan.delete(u);
    reportRows = reportRows.map(r => done.has(r[0]) && /^(UPDATE|REMOVE)/.test(r[4]) ? [...r.slice(0, 4), r[4] + ' – APPLIED', ...r.slice(5)] : r);
    if (stopReq) log(`\nStopped by user — ${work.length - ok - fail} features were not attempted (nothing was changed on them).`);
    log(`\nDone. Updated ${ok} wall boxes, failed ${fail}. Undo log downloaded automatically — keep it.`);
    log('Tip: run Preview again — it should now find 0 changes for what you applied.');
    download(`wallbox_address_undo_${stamp()}.json`, JSON.stringify(undo, null, 2), 'application/json');
    blocked = true;
    setBusy(false);
  };

  // ---------- report / undo ----------
  $('report').onclick = () => {
    const lines = [['wall_box', 'field', 'iqgeo_value', 'new_value', 'action', 'distance_m', 'address_id'], ...reportRows].map(r => r.map(csvCell).join(','));
    download(`wallbox_address_report_${stamp()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
  };
  $('undo').onclick = () => download(`wallbox_address_undo_${stamp()}.json`, JSON.stringify(undo, null, 2), 'application/json');
  $('restore').onclick = () => $('restoreFile').click();
  $('restoreFile').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    let entries; try { entries = JSON.parse(await f.text()); } catch { return log('\nUndo log is not valid JSON.'); }
    if (!Array.isArray(entries) || !entries.length) return log('\nUndo log is empty.');
    if (!confirm(`Restore previous values on ${entries.length} wall box(es)?`)) return;
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
    if (stopReq) log(`\nStopped by user — ${entries.length - ok - fail} features were not restored.`);
    log(`\nRestore done. Restored ${ok}, failed ${fail}.`);
    setBusy(false);
  };
})();
