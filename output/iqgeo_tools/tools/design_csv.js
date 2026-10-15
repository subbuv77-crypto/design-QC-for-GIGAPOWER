(() => {
  if (window.__iqgCsvPanel3) { window.__iqgCsvPanel3.toggle(); return; }

  // ---------- rules ----------
  // Never written, whatever the CSV says
  const SYSTEM_FIELDS = new Set(['id', 'delta_created', 'design_id', 'created_at', 'updated_at',
    'create_user', 'update_user', 'sort_children', 'myw_orientation_location']);
  // Field types that are never written (geometry, audit stamps, reference sets)
  const PROTECTED_TYPES = new Set(['point', 'linestring', 'polygon', 'multipoint', 'multilinestring',
    'multipolygon', 'raster', 'timestamp', 'id_set', 'reference_set', 'foreign_key_set']);
  // Reference ('id') fields are protected except these
  const WRITABLE_REFS = new Set(['specification']);
  // Network-model feature types managed by IQGeo Comms itself
  const isProtectedFeatureType = t => /^mywcom_/.test(t) && !/_slack$/.test(t);

  // ---------- CSV ----------
  function parseCSV(text, keepSpaces) {
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
    const headers = clean.shift().map(h => h.trim());
    const cell = v => keepSpaces ? (v ?? '') : (v ?? '').trim();
    return { headers, rows: clean.map(r => Object.fromEntries(headers.map((h, i) => [h, cell(r[i])]))) };
  }
  const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

  // ---------- ZIP (no library: uses the browser's built-in DecompressionStream) ----------
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
      else if (method === 8) bytes = new Uint8Array(await new Response(
        new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      else throw new Error(`unsupported compression (method ${method}) for ${name}`);
      out.push({ path: name, text: dec.decode(bytes) });
    }
    return out;
  }

  // ---------- value handling ----------
  // kind: int | num | bool | date | str   (from the .fields type, else from the live value)
  function kindOf(fieldType, liveVal) {
    const t = (fieldType || '').replace(/\(.*$/, '').toLowerCase();
    if (t === 'integer') return 'int';
    if (['double', 'numeric', 'float', 'real', 'decimal'].includes(t)) return 'num';
    if (t === 'boolean') return 'bool';
    if (t === 'date') return 'date';
    if (t) return 'str';
    if (typeof liveVal === 'number') return 'num';
    if (typeof liveVal === 'boolean') return 'bool';
    return 'str';
  }
  const maxLenOf = ft => { const m = /^string\((\d+)\)/i.exec(ft || ''); return m ? +m[1] : 0; };
  // CSV text -> value to store. Returns {val} or {err}
  function parseCell(kind, raw, maxLen) {
    if (raw === '') return { val: null };
    switch (kind) {
      case 'int': { const s = raw.replace(/,/g, ''); return /^[-+]?\d+(\.0+)?$/.test(s) ? { val: parseInt(s, 10) } : { err: `"${raw}" is not a whole number` }; }
      case 'num': { const v = Number(raw.replace(/,/g, '')); return Number.isFinite(v) ? { val: v } : { err: `"${raw}" is not a number` }; }
      case 'bool': {
        const s = raw.toLowerCase();
        if (['true', 't', 'yes', 'y', '1'].includes(s)) return { val: true };
        if (['false', 'f', 'no', 'n', '0'].includes(s)) return { val: false };
        return { err: `"${raw}" is not true/false` };
      }
      case 'date': {
        let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
        if (m) return { val: `${m[1]}-${m[2]}-${m[3]}` };
        m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);           // Excel style M/D/YYYY
        if (m) return { val: `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` };
        return { err: `"${raw}" is not a date (use YYYY-MM-DD)` };
      }
      default: {
        const v = raw.replace(/\r\n/g, '\n');
        if (maxLen && v.length > maxLen) return { err: `too long (${v.length} > ${maxLen} chars)` };
        return { val: v };
      }
    }
  }
  function normLive(kind, v, strict) {
    if (v === undefined || v === null || v === '') return null;
    switch (kind) {
      case 'int': case 'num': { const n = Number(v); return Number.isFinite(n) ? n : String(v); }
      case 'bool': return typeof v === 'boolean' ? v : /^(true|t|1|yes|y)$/i.test(String(v));
      case 'date': return String(v).slice(0, 10);
      default: { const t = String(v).replace(/\r\n/g, '\n'); return strict ? t : t.trim(); }
    }
  }
  function same(kind, a, b, strict) {
    if (a === null || b === null) return a === b;
    if ((kind === 'num' || kind === 'int') && typeof a === 'number' && typeof b === 'number')
      return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
    if (kind === 'str') return strict ? String(a) === String(b) : String(a).trim() === String(b).trim();
    return a === b;
  }
  const plain = v => v === null || v === undefined ? '' : String(v);
  const show = v => v === null || v === undefined ? '(empty)' : JSON.stringify(v);

  // ---------- space cleaning ----------
  // tabs, no-break spaces, zero-width spaces and runs of spaces -> one space; trimmed at both ends
  const flat = s => String(s).replace(/[\s\u00a0\u200b\ufeff]+/g, ' ').trim();
  const cleanText = (s, keepBreaks) => {
    s = String(s).replace(/\r\n?/g, '\n');
    return keepBreaks && s.includes('\n') ? s.split('\n').map(flat).filter(Boolean).join('\n') : flat(s);
  };
  const showWs = v => v === null || v === undefined || v === '' ? '(empty)' : '“' + String(v).replace(/ /g, '·').replace(/\t/g, '⇥')
    .replace(/\r?\n/g, '↵').replace(/[\u00a0\u200b\ufeff]/g, '◦') + '”';
  // text fields that are IDs, codes or JSON are never touched
  const CLEAN_SKIP = /^(glid|sn_asset_id|cbl_sn_id|lat_lon|labor_costs|mapping|.*_info)$/;
  const looksJson = v => /^\s*[\[{]/.test(v);

  // ---------- UI ----------
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      .p{width:540px;max-height:94vh;overflow:auto;background:#fff;color:#222;border:1px solid #888;border-radius:8px;
         box-shadow:0 4px 18px rgba(0,0,0,.3);font:13px system-ui,sans-serif;padding:12px}
      h3{margin:0 0 6px;font-size:15px;display:flex;justify-content:space-between}
      label.t{display:block;margin:8px 0 2px;font-weight:600}
      input[type=text],input[type=number]{width:100%;box-sizing:border-box;padding:5px}
      button{padding:6px 10px;margin:8px 6px 0 0;cursor:pointer}
      button:disabled{opacity:.5;cursor:default}
      table{border-collapse:collapse;width:100%;margin-top:4px;font-size:12px}
      td,th{border-bottom:1px solid #eee;padding:2px 4px;text-align:left;vertical-align:top}
      .box{max-height:190px;overflow:auto;border:1px solid #ddd;padding:4px}
      #log{margin-top:8px;height:180px;overflow:auto;background:#f6f6f6;border:1px solid #ddd;
           padding:6px;white-space:pre-wrap;font:12px ui-monospace,monospace}
      .x{cursor:pointer;border:0;background:none;font-size:16px;margin:0;padding:0}
      .sm{font-size:11px;color:#666}
      .row{display:flex;gap:10px}.row>div{flex:1}
      .muted{color:#999}
      .tabs{display:flex;gap:4px;margin:2px 0 6px}
      .tabs button{margin:0;flex:1;border:1px solid #888;background:#f2f2f2;border-radius:5px}
      .tabs button.on{background:#1f5fbf;color:#fff;border-color:#1f5fbf}
    </style>
    <div class="p">
      <h3>IQGeo Design CSV Updater v3 <button class="x" id="close" title="Hide">✕</button></h3>
      <div class="tabs"><button id="modeCsv" class="on">Update from CSV</button><button id="modeClean">Clean extra spaces</button></div>
      <div class="row">
        <div><label class="t">IQGeo base URL</label><input type="text" id="base"></div>
        <div style="flex:0 0 90px"><label class="t">Parallel</label><input type="number" id="conc" min="1" max="8" value="4"></div>
      </div>
      <label class="t">Design to edit in</label>
      <input type="text" id="design" placeholder="design/PSA-1043PA-ALBQNMMA-VICTOR">
      <label class="t">Design export (.zip) or CSV files <span class="sm">(add the matching .fields files too if loading CSVs)</span></label>
      <input type="file" id="file" multiple accept=".zip,.csv,.fields">
      <button id="clearFiles" type="button">Clear file selection</button>
      <label class="t">Feature types to check</label>
      <div id="types" class="box sm">Load the design export to see its feature types.</div>
      <div id="optCsv"><label style="display:block;margin-top:6px"><input type="checkbox" id="blankClears"> Blank CSV cells clear the value in IQGeo <span class="sm">(off = blanks are ignored)</span></label></div>
      <div id="optClean" style="display:none">
        <div class="sm" style="margin-top:6px">Removes spaces at the start/end of text fields and turns tabs, double spaces and line breaks into one space. IDs, codes and JSON fields are left alone.</div>
        <label class="t">Only features with Design Created = <span class="sm">(blank = all features)</span></label>
        <input type="text" id="createdIn" placeholder="PSA-1043PA-ALBQNMMA-VICTOR">
        <label style="display:block;margin-top:4px"><input type="checkbox" id="keepBreaks"> Keep line breaks in multi-line fields (e.g. manhole <code>addr_full</code>)</label>
        <label style="display:block;margin-top:2px"><input type="checkbox" id="checkAll"> Check every feature in IQGeo, not only the ones the export shows with extra spaces <span class="sm">(slower)</span></label>
      </div>
      <button id="test" disabled>Test connection</button>
      <button id="preview" disabled>1. Preview changes</button>
      <button id="apply" disabled>2. Apply ticked changes</button>
      <button id="stop" disabled title="Stop after the requests already in progress finish">■ Stop</button>
      <label class="t">Changes found <span class="sm">(untick a field to leave it alone)</span></label>
      <div id="changes" class="box sm">Run Preview to see what differs from IQGeo. Nothing is saved until Apply.</div>
      <button id="report" disabled>Download change report</button>
      <button id="undo" disabled>Download undo log</button>
      <button id="restore">Restore from undo log…</button>
      <input type="file" id="restoreFile" accept=".json" style="display:none">
      <div id="status" class="sm" style="margin-top:8px;font-weight:600"></div>
      <div id="log">1) Check the design name  2) Load the export  3) Test connection  4) Preview  5) Apply</div>
    </div>`;
  document.documentElement.appendChild(host);
  const $ = id => root.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  $('base').value = location.origin;
  const log = m => { $('log').textContent += '\n' + m; $('log').scrollTop = 1e9; };
  const setLog = m => { $('log').textContent = m; };
  $('close').onclick = () => { host.style.display = 'none'; };
  window.__iqgCsvPanel3 = { hide: () => { host.style.display = 'none'; }, toggle: () => { host.style.display = host.style.display === 'none' ? '' : 'none'; } };

  // state
  let types = {};        // typeName -> {rows, fieldTypes:{name:type}, headers, path}
  let plan = new Map();  // urn -> {type, urn, changes:{f:val}, old:{f:raw}}
  let fieldCounts = {};  // "type.field" -> count
  let reportRows = [];
  let undo = [];
  let busy = false;

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
  const writableField = (name, ft) => {
    if (SYSTEM_FIELDS.has(name)) return false;
    const t = (ft || '').replace(/\(.*$/, '').toLowerCase();
    if (PROTECTED_TYPES.has(t)) return false;
    if ((t === 'id' || t === 'reference' || t === 'foreign_key') && !WRITABLE_REFS.has(name)) return false;
    return true;
  };
  const checkedTypes = () => [...root.querySelectorAll('#types input:checked')].map(i => i.value);
  const checkedFields = () => new Set([...root.querySelectorAll('#changes input:checked')].map(i => i.value));
  const setBusy = b => { if (b) stopReq = false; $('stop').disabled = !b; busy = b; ['test', 'preview', 'apply', 'file', 'clearFiles', 'restore'].forEach(id => $(id).disabled = b); if (!b) refreshButtons(); };
  function refreshButtons() {
    const loaded = Object.keys(types).length > 0;
    $('test').disabled = $('preview').disabled = !loaded;
    $('apply').disabled = !plan.size || $('apply').dataset.blocked === '1';
    $('report').disabled = !reportRows.length;
    $('undo').disabled = !undo.length;
  }

  // ---------- load files ----------
  $('file').onchange = async (e) => {
    const files = [...e.target.files]; if (!files.length) return;
    try {
      const sources = [];
      for (const f of files) {
        if (/\.zip$/i.test(f.name)) sources.push(...await unzip(await f.arrayBuffer(), n => /\.(csv|fields)$/i.test(n)));
        else sources.push({ path: f.name, text: await f.text() });
      }
      const fieldsBy = {}, csvs = [];
      for (const s of sources) {
        const stem = s.path.split('/').pop().replace(/\.(csv|fields)$/i, '');
        if (/\.fields$/i.test(s.path)) fieldsBy[stem] = Object.fromEntries(parseCSV(s.text).rows.map(r => [r.name, r.type]));
        else csvs.push({ stem, path: s.path, text: s.text });
      }
      types = {};
      for (const c of csvs) {
        const p = parseCSV(c.text), pr = parseCSV(c.text, true);
        if (!p.headers.includes('id')) { log(`Skipped ${c.path}: no 'id' column`); continue; }
        if (!p.rows.length) continue;
        const t = (p.rows[0].id.split('/')[0]) || c.stem;
        const prev = types[t];
        types[t] = { rows: (prev ? prev.rows : []).concat(p.rows), rawRows: (prev ? prev.rawRows : []).concat(pr.rows), headers: p.headers, path: c.path,
          fieldTypes: fieldsBy[c.stem] || fieldsBy[t] || (prev && prev.fieldTypes) || null };
      }
      const names = Object.keys(types).sort();
      if (!names.length) throw new Error('no usable CSV files found');
      // default design = most common delta_created
      if (!design()) {
        const cnt = {};
        names.forEach(t => types[t].rows.forEach(r => { if (r.delta_created) cnt[r.delta_created] = (cnt[r.delta_created] || 0) + 1; }));
        const best = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
        if (best) $('design').value = best[0];
      }
      if (!$('createdIn').value.trim() && design()) {
        $('createdIn').value = design().replace(/^design\//i, '');
      }
      $('types').innerHTML = `<table><tr><th></th><th>Feature type</th><th>Rows</th><th>Editable columns</th></tr>` +
        names.map(t => {
          const T = types[t], prot = isProtectedFeatureType(t);
          const ed = T.headers.filter(h => writableField(h, T.fieldTypes && T.fieldTypes[h])).length;
          return `<tr class="${prot ? 'muted' : ''}"><td><input type="checkbox" value="${esc(t)}" ${prot ? 'disabled' : 'checked'}></td>
            <td>${esc(t)}${T.fieldTypes ? '' : ' <span title="no .fields file: types taken from IQGeo">*</span>'}</td>
            <td>${T.rows.length}</td><td>${prot ? 'managed by IQGeo – not updated' : ed}</td></tr>`;
        }).join('') + `</table>`;
      plan = new Map(); reportRows = []; fieldCounts = {};
      $('changes').textContent = 'Run Preview to see what differs from IQGeo.';
      const total = names.filter(t => !isProtectedFeatureType(t)).reduce((s, t) => s + types[t].rows.length, 0);
      setLog(`Loaded ${names.length} feature types (${total} editable rows). Untick types you did not edit to make Preview faster.`);
      if (names.some(t => !types[t].fieldTypes)) log('* = no .fields file found for that type; field types are taken from the live IQGeo values.');
      refreshButtons();
    } catch (err) { types = {}; setLog('Error reading files: ' + err.message); refreshButtons(); }
  };

  // ---------- stop / clear files ----------
  $('stop').onclick = () => {
    stopReq = true; $('stop').disabled = true;
    $('status').textContent += ' — stopping…';
    log('\nStop pressed — finishing the requests already in progress, nothing new is started…');
  };
  $('clearFiles').onclick = () => {
    $('file').value = '';
    types = {}; plan = new Map(); reportRows = []; fieldCounts = {}; undo = []; $('apply').dataset.blocked = '1';
    $('design').value = ''; $('createdIn').value = '';
    $('types').textContent = 'Load the design export to see its feature types.';
    $('changes').textContent = 'Run Preview to see what differs from IQGeo. Nothing is saved until Apply.'; $('status').textContent = '';
    refreshButtons();
    log('\nFile selection cleared. Load new files to start again.');
  };

  // ---------- test connection ----------
  $('test').onclick = async () => {
    const t = checkedTypes()[0] || Object.keys(types)[0];
    const row = types[t].rows[0];
    if (!design()) log('\nWarning: no design entered — this test reads master data.');
    log(`\nTesting GET ${urlFor(row.id, design())}`);
    setBusy(true);
    try {
      const r = await getFeature(row.id, design());
      const txt = await r.text();
      log(`HTTP ${r.status}`);
      try {
        const j = JSON.parse(txt);
        log('Fields returned: ' + Object.keys(j.properties || {}).join(', '));
        log(r.ok ? 'OK — reading works. Writing is checked on the first record during Apply.' : 'Server answered with an error (see above).');
      } catch { log('Not JSON. First 300 chars: ' + txt.slice(0, 300)); }
    } catch (err) { log('Request failed: ' + err.message); }
    setBusy(false);
  };

  function renderChanges(fmt, emptyText) {
    const keys = Object.keys(fieldCounts).sort();
    $('changes').innerHTML = keys.length
      ? `<table><tr><th></th><th>Feature type</th><th>Field</th><th>Changes</th><th>Example</th></tr>` + keys.map(k => {
          const [t, f] = k.split('.');
          const ex = [...plan.values()].find(p => p.type === t && f in p.changes);
          return `<tr><td><input type="checkbox" value="${esc(k)}" checked></td><td>${esc(t)}</td><td>${esc(f)}</td><td>${fieldCounts[k]}</td>
            <td>${esc(fmt(ex.old[f]))} → ${esc(fmt(ex.changes[f]))}</td></tr>`;
        }).join('') + '</table>'
      : esc(emptyText);
  }

  // ---------- mode switch ----------
  let mode = 'csv';
  function setMode(m) {
    if (busy || m === mode) return;
    mode = m;
    $('modeCsv').classList.toggle('on', m === 'csv'); $('modeClean').classList.toggle('on', m === 'clean');
    $('optCsv').style.display = m === 'csv' ? '' : 'none'; $('optClean').style.display = m === 'clean' ? '' : 'none';
    $('preview').textContent = m === 'csv' ? '1. Preview changes' : '1. Check spaces';
    $('apply').textContent = m === 'csv' ? '2. Apply ticked changes' : '2. Fix ticked fields';
    plan = new Map(); reportRows = []; fieldCounts = {}; $('apply').dataset.blocked = '1';
    $('changes').textContent = m === 'csv' ? 'Run Preview to see what differs from IQGeo. Nothing is saved until Apply.'
      : 'Run Check spaces to find text fields with extra spaces. Nothing is saved until Fix.';
    log(m === 'csv' ? '\n— Mode: Update from CSV —' : '\n— Mode: Clean extra spaces (uses the loaded design export to find features) —');
    refreshButtons();
  }
  $('modeCsv').onclick = () => setMode('csv');
  $('modeClean').onclick = () => setMode('clean');

  // ---------- check spaces ----------
  async function runClean() {
    const sel = checkedTypes(); if (!sel.length) return log('\nTick at least one feature type.');
    const keep = $('keepBreaks').checked, all = $('checkAll').checked;
    // Design Created filter: "PSA-1043PA-ALBQNMMA-VICTOR" matches "design/PSA-1043PA-ALBQNMMA-VICTOR"
    const normDC = v => String(v ?? '').trim().replace(/^design\//i, '').toLowerCase();
    const want = normDC($('createdIn').value);
    const createdOk = v => !want || normDC(v) === want;
    const skip = { other: 0, noField: {} };
    const cleanable = (T, col, v) => {
      const ft = T.fieldTypes ? T.fieldTypes[col] : undefined;
      if (!writableField(col, ft) || WRITABLE_REFS.has(col) || CLEAN_SKIP.test(col)) return false;
      if (T.fieldTypes && (ft === undefined || kindOf(ft) !== 'str')) return false;
      return typeof v === 'string' && v !== '' && !looksJson(v);
    };
    const dirty = (v) => cleanText(v, keep) !== v.replace(/\r\n?/g, '\n');
    setBusy(true);
    plan = new Map(); reportRows = []; fieldCounts = {};
    $('changes').textContent = 'Checking…';
    const jobs = [];
    for (const t of sel) {
      const T = types[t], seen = new Set();
      for (const row of T.rawRows) {
        if (!row.id || seen.has(row.id)) continue;
        seen.add(row.id);
        if (want && !T.headers.includes('delta_created')) { skip.noField[t] = (skip.noField[t] || 0) + 1; continue; }
        if (!createdOk(row.delta_created)) { skip.other++; continue; }
        if (all || T.headers.some(c => cleanable(T, c, row[c]) && dirty(row[c]))) jobs.push({ t, urn: row.id });
      }
    }
    setLog(all ? `Checking all ${jobs.length} features in IQGeo for extra spaces (design ${design()})…`
      : `The export shows ${jobs.length} features with extra spaces. Checking them in IQGeo (design ${design()})…`);
    if (want) {
      log(`Only features with Design Created = ${$('createdIn').value.trim()}. Left out: ${skip.other} created in another design.`);
      const nf = Object.entries(skip.noField);
      if (nf.length) log(`Also left out (these types have no Design Created field): ` + nf.map(([t, n]) => `${t} (${n})`).join(', ') + '.');
    }
    const st = { checked: 0, changed: 0, missing: 0, errors: 0 };
    const tick = progress('Checked', jobs.length);
    await pool(jobs, async ({ t, urn }) => {
      try {
        const r = await getFeature(urn, design());
        if (r.status === 404) { st.missing++; log(`Not found in IQGeo: ${urn}`); return; }
        if (!r.ok) throw new Error('GET ' + r.status);
        const props = (await r.json()).properties || {};
        if (want && 'delta_created' in props && !createdOk(props.delta_created)) {
          log(`Skipped ${urn}: Design Created in IQGeo is ${props.delta_created}`); return;
        }
        st.checked++;
        const changes = {}, old = {};
        for (const col of Object.keys(props)) {
          const v = props[col];
          if (!cleanable(types[t], col, v) || !dirty(v)) continue;
          const nv = cleanText(v, keep);
          changes[col] = nv === '' ? null : nv; old[col] = v;
          fieldCounts[`${t}.${col}`] = (fieldCounts[`${t}.${col}`] || 0) + 1;
          reportRows.push([t, urn, col, v, nv, 'CHANGE']);
        }
        if (Object.keys(changes).length) { plan.set(urn, { type: t, urn, changes, old }); st.changed++; }
      } catch (err) { st.errors++; log(`Error ${urn}: ${err.message}`); }
    }, tick);
    renderChanges(showWs, 'No extra spaces found in IQGeo for the ticked types.');
    log(`\nCheck: ${st.checked} checked, ${st.changed} features have extra spaces (${reportRows.length} fields), ${st.missing} not found, ${st.errors} errors.`);
    if (st.changed) log('In the examples · = space, ⇥ = tab, ↵ = line break, ◦ = hidden space character.');
    $('apply').dataset.blocked = (st.errors || stopReq) ? '1' : '0';
    if (stopReq) log('Stopped by user — only part of the features were checked. Run Preview again before applying.');
    if (st.errors) log('Some features could not be read. Run Check again before fixing.');
    setBusy(false);
  }

  // ---------- preview ----------
  $('preview').onclick = async () => {
    if (!design()) return log('\nEnter the design to edit in first (e.g. design/PSA-1043PA-ALBQNMMA-VICTOR).');
    if (mode === 'clean') return runClean();
    if (!design()) return log('\nEnter the design to edit in first (e.g. design/PSA-1043PA-ALBQNMMA-VICTOR).');
    const sel = checkedTypes(); if (!sel.length) return log('\nTick at least one feature type.');
    const blankClears = $('blankClears').checked;
    setBusy(true);
    plan = new Map(); reportRows = []; fieldCounts = {};
    $('changes').textContent = 'Checking…';
    const st = { checked: 0, changed: 0, missing: 0, errors: 0, invalid: 0, dup: 0, otherDesign: 0 };
    const jobs = [];
    for (const t of sel) {
      const seen = new Set();
      for (const row of types[t].rows) {
        if (!row.id) continue;
        if (seen.has(row.id)) { st.dup++; log(`Duplicate row ignored: ${row.id}`); continue; }
        seen.add(row.id);
        if (row.delta_created && row.delta_created !== design()) st.otherDesign++;
        jobs.push({ t, row });
      }
    }
    setLog(`Comparing ${jobs.length} features with IQGeo (design ${design()})…`);
    const tick = progress('Checked', jobs.length);
    await pool(jobs, async ({ t, row }) => {
      const T = types[t], urn = row.id;
      try {
        const r = await getFeature(urn, design());
        if (r.status === 404) { st.missing++; log(`Not found in IQGeo: ${urn}`); return; }
        if (!r.ok) throw new Error('GET ' + r.status);
        const props = (await r.json()).properties || {};
        st.checked++;
        const changes = {}, old = {};
        for (const col of T.headers) {
          const ft = T.fieldTypes ? T.fieldTypes[col] : undefined;
          if (!writableField(col, ft)) continue;
          if (T.fieldTypes && ft === undefined) continue;               // column not in the .fields definition
          if (!T.fieldTypes && !(col in props)) continue;
          let raw = row[col] ?? '';
          if (raw === '' && !blankClears) continue;
          // The export writes references as "anchor_spec/ANCHOR"; IQGeo stores just "ANCHOR".
          // Drop the "<table>/" prefix unless IQGeo's own value uses it.
          if (WRITABLE_REFS.has(col) && raw.includes('/') && !String(props[col] ?? '').includes('/'))
            raw = raw.slice(raw.indexOf('/') + 1);
          const kind = kindOf(ft, props[col]);
          const p = parseCell(kind, raw, maxLenOf(ft));
          if (p.err) { st.invalid++; reportRows.push([t, urn, col, plain(props[col]), raw, 'INVALID: ' + p.err]); continue; }
          if (same(kind, normLive(kind, props[col]), p.val)) continue;
          changes[col] = p.val; old[col] = props[col] ?? null;
          fieldCounts[`${t}.${col}`] = (fieldCounts[`${t}.${col}`] || 0) + 1;
          reportRows.push([t, urn, col, plain(old[col]), plain(p.val), 'CHANGE']);
        }
        if (Object.keys(changes).length) { plan.set(urn, { type: t, urn, changes, old }); st.changed++; }
      } catch (err) { st.errors++; log(`Error ${urn}: ${err.message}`); }
    }, tick);

    renderChanges(show, 'No differences — IQGeo already matches the CSV for the ticked types.');

    log(`\nPreview: ${st.checked} checked, ${st.changed} features to update (${reportRows.filter(r => r[5] === 'CHANGE').length} field changes), ` +
      `${st.missing} not found, ${st.invalid} invalid values, ${st.errors} errors` + (st.dup ? `, ${st.dup} duplicate rows ignored` : '') + '.');
    if (st.otherDesign) log(`Note: ${st.otherDesign} rows were created in another design; they will still be edited in ${design()}.`);
    if (st.invalid) log('Invalid values are left out — see the change report.');
    $('apply').dataset.blocked = (st.errors || stopReq) ? '1' : '0';
    if (stopReq) log('Stopped by user — only part of the features were checked. Run Preview again before applying.');
    if (st.errors) log('Some features could not be read. Run Preview again before applying.');
    setBusy(false);
  };

  // ---------- apply ----------
  async function applyOne(p, fields) {
    const changes = {}, old = {};
    for (const f of fields) { changes[f] = p.changes[f]; old[f] = p.old[f]; }
    // fresh read so nothing edited since Preview is overwritten
    const g = await getFeature(p.urn, design());
    if (!g.ok) throw new Error('GET ' + g.status);
    const feature = await g.json();
    const props = feature.properties || (feature.properties = {});
    const T = types[p.type];
    for (const f of fields) {
      const kind = kindOf(T.fieldTypes && T.fieldTypes[f], props[f]);
      if (!same(kind, normLive(kind, props[f], true), normLive(kind, old[f], true), true))
        throw new Error(`${f} was changed in IQGeo after Preview (now ${show(props[f])}) — skipped`);
    }
    Object.assign(props, changes);
    const r = await putFeature(feature, p.urn, design());
    if (!r.ok) throw new Error(`PUT ${r.status} ${(await r.text()).slice(0, 200)}`);
    return { changes, old };
  }
  async function verify(urn, changes) {
    const r = await getFeature(urn, design());
    const props = (await r.json()).properties || {};
    return Object.entries(changes).every(([k, v]) => {
      const kind = typeof v === 'number' ? 'num' : typeof v === 'boolean' ? 'bool' : 'str';
      return same(kind, normLive(kind, props[k], true), v, true);
    });
  }

  $('apply').onclick = async () => {
    const ticked = checkedFields();
    const work = [...plan.values()].map(p => ({ p, fields: Object.keys(p.changes).filter(f => ticked.has(`${p.type}.${f}`)) }))
      .filter(w => w.fields.length);
    if (!work.length) return log('\nNothing ticked to apply.');
    const nFields = work.reduce((s, w) => s + w.fields.length, 0);
    if (!confirm(`Update ${work.length} features (${nFields} field changes) in design\n${design()} ?\n\nThe first one is saved and read back before the rest.`)) return;
    setBusy(true);
    undo = []; let ok = 0, fail = 0;
    const doneSet = new Set();
    const record = (p, res) => { undo.push({ urn: p.urn, delta: design(), restore: res.old, applied: res.changes }); doneSet.add(p.urn); ok++; };

    const [first, ...rest] = work;
    try {
      const res = await applyOne(first.p, first.fields);
      if (!(await verify(first.p.urn, res.changes)))
        throw new Error('read-back mismatch — IQGeo accepted the request but the values were not stored');
      record(first.p, res);
      log(`\nVerified first update (${first.p.urn}). Continuing…`);
    } catch (err) {
      log(`\nSTOPPED on first record ${first.p.urn}: ${err.message}`);
      log('No other records were changed. Copy this message for your developer/assistant.');
      setBusy(false); return;
    }
    const tick = progress('Updated', rest.length);
    await pool(rest, async ({ p, fields }) => {
      try { record(p, await applyOne(p, fields)); }
      catch (err) { fail++; log(`FAILED ${p.urn}: ${err.message}`); }
    }, tick);
    for (const urn of doneSet) plan.delete(urn);
    reportRows = reportRows.map(r => r[5] === 'CHANGE' && doneSet.has(r[1]) ? [...r.slice(0, 5), 'APPLIED'] : r);
    if (stopReq) log(`\nStopped by user — ${work.length - ok - fail} features were not attempted (nothing was changed on them).`);
    log(`\nDone. Updated ${ok} features, failed ${fail}. Undo log downloaded automatically — keep it.`);
    log(mode === 'clean' ? 'Tip: run Check spaces again — it should now find nothing for what you fixed.' : 'Tip: run Preview again — it should now find 0 changes for what you applied.');
    download(`iqgeo_undo_${stamp()}.json`, JSON.stringify(undo, null, 2), 'application/json');
    $('apply').dataset.blocked = '1';
    setBusy(false);
  };

  // ---------- report / undo ----------
  $('report').onclick = () => {
    const lines = [['feature_type', 'id', 'field', 'iqgeo_value', 'new_value', 'status'], ...reportRows].map(r => r.map(csvCell).join(','));
    download(`iqgeo_${mode === 'clean' ? 'space_cleaning' : 'change'}_report_${stamp()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
  };
  $('undo').onclick = () => download(`iqgeo_undo_${stamp()}.json`, JSON.stringify(undo, null, 2), 'application/json');
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
    if (stopReq) log(`\nStopped by user — ${entries.length - ok - fail} features were not restored.`);
    log(`\nRestore done. Restored ${ok}, failed ${fail}.`);
    setBusy(false);
  };
})();
