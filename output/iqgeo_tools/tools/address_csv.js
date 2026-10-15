(() => {
  if (window.__iqgAddrPanel) { window.__iqgAddrPanel.toggle(); return; }

  // ---------- rules ----------
  // Address fields: pre-ticked, and the only fields whose spaces are cleaned
  const ADDR_RE = /^(a_address|a_scity|a_county|a_state2?|a_szip5?|a_saddno|a_saddpref|a_saddstr|a_saddstsuf|a_saddsttyp|unit|gis_street\w*|gis_postcode|gis_postalcodeplus4|gis_city|gis_stateorprovince|gis_country|gis_unit_type|gis_unit_value|addr_\w+|address\w*)$/i;
  // Report columns joined from other tables (design, FST, clusters, boundaries…) – never written
  const JOIN_RE = /^(design|demand|fst|dist_cluster|drop_cluster|mdu_boundary|prgc_boundary|term_fed|coiled)_/i;
  // Never written
  const SYSTEM = new Set(['id', 'glid', 'sn_asset_id', 'll_uuid', 'iqg_updated_fields', 'delta_created', 'design_id',
    'created_at', 'updated_at', 'create_user', 'update_user', 'sort_children', 'location', 'myw_orientation_location']);
  const writable = c => !SYSTEM.has(c) && !JOIN_RE.test(c) && !/^myw_/.test(c);

  // ---------- CSV ----------
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
    const headers = clean.shift().map(h => h.trim());
    return { headers, rows: clean.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']))) };   // cells kept untrimmed
  }
  const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

  // ---------- values ----------
  const flat = s => String(s).replace(/[\s ​﻿]+/g, ' ').trim();   // tabs, double/no-break/zero-width spaces, line breaks
  const kindOf = live => typeof live === 'number' ? 'num' : typeof live === 'boolean' ? 'bool' : 'str';
  function parseCell(kind, raw) {
    const s = raw.trim();
    if (s === '') return { val: null };
    if (kind === 'num') { const v = Number(s.replace(/,/g, '')); return Number.isFinite(v) ? { val: v } : { err: `"${s}" is not a number` }; }
    if (kind === 'bool') {
      if (/^(true|t|yes|y|1)$/i.test(s)) return { val: true };
      if (/^(false|f|no|n|0)$/i.test(s)) return { val: false };
      return { err: `"${s}" is not true/false` };
    }
    return { val: s };
  }
  function same(a, b) {
    if (a === undefined) a = null; if (b === undefined) b = null;
    if (a === '' ) a = null; if (b === '') b = null;
    if (a === null || b === null) return a === b;
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
    return String(a).replace(/\r\n/g, '\n') === String(b).replace(/\r\n/g, '\n');
  }
  const showWs = v => v === null || v === undefined || v === '' ? '(empty)' : '“' + String(v).replace(/ /g, '·').replace(/\t/g, '⇥')
    .replace(/\r?\n/g, '↵').replace(/[ ​﻿]/g, '◦') + '”';
  const plain = v => v === null || v === undefined ? '' : String(v);

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
      .box{max-height:190px;overflow:auto;border:1px solid #ddd;padding:4px}
      .grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px 8px}
      .grid label{display:flex;gap:4px;align-items:center;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .grp{font-weight:600;margin:4px 0 2px;font-size:12px;display:flex;justify-content:space-between}
      .grp a{font-weight:400;color:#1f5fbf;cursor:pointer;margin-left:8px}
      .opt label{display:block;margin-top:3px}
      #log{margin-top:8px;height:170px;overflow:auto;background:#f6f6f6;border:1px solid #ddd;
           padding:6px;white-space:pre-wrap;font:12px ui-monospace,monospace}
      .x{cursor:pointer;border:0;background:none;font-size:16px;margin:0;padding:0}
      .sm{font-size:11px;color:#666}
      .row{display:flex;gap:10px}.row>div{flex:1}
    </style>
    <div class="p">
      <h3>IQGeo Address CSV Updater <button class="x" id="close" title="Hide">✕</button></h3>
      <div class="row">
        <div><label class="t">IQGeo base URL</label><input type="text" id="base"></div>
        <div style="flex:0 0 80px"><label class="t">Parallel</label><input type="number" id="conc" min="1" max="8" value="4"></div>
      </div>
      <label class="t">CSV file <span class="sm">(e.g. the PSA demand point report)</span></label>
      <input type="file" id="file" accept=".csv,text/csv">
      <button id="clearFiles" type="button">Clear file selection</button>
      <label class="t">Design to edit in</label>
      <input type="text" id="design" placeholder="design/PSA-3010PA-ALBQNMMA-VICTOR">
      <div class="row">
        <div><label class="t">IQGeo feature type</label><input type="text" id="ftype" value="demand_point"></div>
        <div><label class="t">ID column in the CSV</label><select id="idcol"><option>id</option></select></div>
      </div>
      <div class="sm" id="urnHint" style="margin-top:2px"></div>
      <label class="t">Fields</label>
      <div id="fields" class="box sm">Load the CSV to see its columns.</div>
      <div class="opt">
        <label><input type="checkbox" id="optUpdate" checked> Update the ticked fields with the CSV values</label>
        <label><input type="checkbox" id="optClean" checked> Remove extra spaces in address fields <span class="sm">(in the CSV values and in values already in IQGeo)</span></label>
        <label><input type="checkbox" id="optSkipDeleted" checked> Skip rows where <code>deleted</code> = Yes</label>
        <label><input type="checkbox" id="optBlank"> Blank CSV cells clear the value in IQGeo <span class="sm">(off = blanks are ignored)</span></label>
      </div>
      <button id="test" disabled>Test connection</button>
      <button id="preview" disabled>1. Preview</button>
      <button id="apply" disabled>2. Apply ticked changes</button>
      <button id="stop" disabled title="Stop after the requests already in progress finish">■ Stop</button>
      <label class="t">Changes found <span class="sm">(untick a field to leave it alone)</span></label>
      <div id="changes" class="box sm">Run Preview to see what will change. Nothing is saved until Apply.</div>
      <button id="report" disabled>Download change report</button>
      <button id="undo" disabled>Download undo log</button>
      <button id="restore">Restore from undo log…</button>
      <input type="file" id="restoreFile" accept=".json" style="display:none">
      <div id="status" class="sm" style="margin-top:8px;font-weight:600"></div>
      <div id="log">1) Load the CSV  2) Check design, feature type and fields  3) Test connection  4) Preview  5) Apply</div>
    </div>`;
  document.documentElement.appendChild(host);
  const $ = id => root.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  $('base').value = location.origin;
  const log = m => { $('log').textContent += '\n' + m; $('log').scrollTop = 1e9; };
  const setLog = m => { $('log').textContent = m; };
  $('close').onclick = () => { host.style.display = 'none'; };
  window.__iqgAddrPanel = { hide: () => { host.style.display = 'none'; }, toggle: () => { host.style.display = host.style.display === 'none' ? '' : 'none'; } };

  let parsed = null, plan = new Map(), fieldCounts = {}, reportRows = [], undo = [], blocked = true;

  // ---------- API ----------
  const base = () => $('base').value.trim().replace(/\/+$/, '');
  const design = () => $('design').value.trim();
  const ftype = () => $('ftype').value.trim();
  const conc = () => Math.min(8, Math.max(1, parseInt($('conc').value, 10) || 4));
  const urnOf = row => { const v = String(row[$('idcol').value] ?? '').trim(); return !v ? '' : v.includes('/') ? v : `${ftype()}/${v}`; };
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
  const tickedFields = () => [...root.querySelectorAll('#fields input:checked')].map(i => i.value);
  const tickedChanges = () => new Set([...root.querySelectorAll('#changes input:checked')].map(i => i.value));
  function refresh() {
    $('test').disabled = $('preview').disabled = !parsed;
    $('apply').disabled = !plan.size || blocked;
    $('report').disabled = !reportRows.length;
    $('undo').disabled = !undo.length;
  }
  const setBusy = b => { if (b) stopReq = false; $('stop').disabled = !b; ['test', 'preview', 'apply', 'file', 'clearFiles', 'restore'].forEach(id => $(id).disabled = b); if (!b) refresh(); };
  const updateHint = () => { if (parsed) $('urnHint').textContent = `IQGeo id for the first row: ${urnOf(parsed.rows[0]) || '(empty)'}`; };
  $('ftype').oninput = updateHint; $('idcol').onchange = updateHint;

  // ---------- load CSV ----------
  $('file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      parsed = parseCSV(await f.text());
      if (!parsed.rows.length) throw new Error('the CSV has no rows');
      const H = parsed.headers;
      // ID column choices
      const idChoices = [...new Set(['id', 'demand_id', ...H.filter(h => /(^|_)id$/.test(h) && !JOIN_RE.test(h) && !SYSTEM.has(h))])].filter(h => H.includes(h));
      $('idcol').innerHTML = idChoices.map(h => `<option ${h === 'id' ? 'selected' : ''}>${esc(h)}</option>`).join('');
      // design from design_job_name / delta_created
      if (!design()) {
        const cnt = {};
        parsed.rows.forEach(r => { const d = (r.delta_created || r.design_job_name || '').trim(); if (d) cnt[d] = (cnt[d] || 0) + 1; });
        const best = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
        if (best) $('design').value = best[0].startsWith('design/') ? best[0] : 'design/' + best[0];
      }
      const cols = H.filter(writable);
      const addr = cols.filter(c => ADDR_RE.test(c)), other = cols.filter(c => !ADDR_RE.test(c));
      const box = (c, on) => `<label title="${esc(c)}"><input type="checkbox" value="${esc(c)}" ${on ? 'checked' : ''}>${esc(c)}</label>`;
      $('fields').innerHTML =
        `<div class="grp">Address fields (${addr.length})<span><a data-g="addr" data-v="1">all</a><a data-g="addr" data-v="0">none</a></span></div>
         <div class="grid" id="g-addr">${addr.map(c => box(c, true)).join('')}</div>
         <div class="grp">Other fields (${other.length})<span><a data-g="other" data-v="1">all</a><a data-g="other" data-v="0">none</a></span></div>
         <div class="grid" id="g-other">${other.map(c => box(c, false)).join('')}</div>
         <div class="sm" style="margin-top:4px">Report columns (design_*, fst_*, mdu_boundary_* …) and ids are not listed and never written.
         Ticked fields that the IQGeo feature does not have are ignored.</div>`;
      root.querySelectorAll('#fields a[data-g]').forEach(a => a.onclick = () =>
        root.querySelectorAll(`#g-${a.dataset.g} input`).forEach(i => i.checked = a.dataset.v === '1'));
      plan = new Map(); reportRows = []; fieldCounts = {}; blocked = true;
      $('changes').textContent = 'Run Preview to see what will change.';
      const del = H.includes('deleted') ? parsed.rows.filter(r => /^(yes|true|1)$/i.test((r.deleted || '').trim())).length : 0;
      setLog(`Loaded ${parsed.rows.length} rows, ${cols.length} updatable columns (${addr.length} address fields pre-ticked).` +
        (del ? ` ${del} rows have deleted = Yes.` : ''));
      updateHint();
      log('Check the IQGeo id above, then press Test connection.');
      refresh();
    } catch (err) { parsed = null; setLog('Error: ' + err.message); refresh(); }
  };

  // ---------- stop / clear files ----------
  $('stop').onclick = () => {
    stopReq = true; $('stop').disabled = true;
    $('status').textContent += ' — stopping…';
    log('\nStop pressed — finishing the requests already in progress, nothing new is started…');
  };
  $('clearFiles').onclick = () => {
    $('file').value = '';
    parsed = null; plan = new Map(); reportRows = []; fieldCounts = {}; undo = []; blocked = true;
    $('design').value = '';
    $('idcol').innerHTML = '<option>id</option>'; $('urnHint').textContent = '';
    $('fields').textContent = 'Load the CSV to see its columns.';
    $('changes').textContent = 'Run Preview to see what will change. Nothing is saved until Apply.'; $('status').textContent = '';
    refresh();
    log('\nFile selection cleared. Load new files to start again.');
  };

  // ---------- test ----------
  $('test').onclick = async () => {
    const row = parsed.rows.find(r => urnOf(r)); if (!row) return log('\nNo row has an id.');
    const urn = urnOf(row);
    log(`\nTesting GET ${urlFor(urn, design())}`);
    setBusy(true);
    try {
      const r = await getFeature(urn, design());
      const txt = await r.text();
      log(`HTTP ${r.status}`);
      try {
        const j = JSON.parse(txt), keys = Object.keys(j.properties || {});
        log('Fields returned: ' + keys.join(', '));
        const sel = tickedFields(), missing = sel.filter(c => !keys.includes(c));
        if (r.ok) log(`OK — ${sel.length - missing.length} of ${sel.length} ticked fields exist on this feature.` +
          (missing.length ? ` Not on the feature (ignored): ${missing.join(', ')}` : ''));
        else log(r.status === 404 ? 'Not found — check the feature type and ID column.' : 'Server answered with an error (see above).');
      } catch { log('Not JSON. First 300 chars: ' + txt.slice(0, 300)); }
    } catch (err) { log('Request failed: ' + err.message); }
    setBusy(false);
  };

  // ---------- preview ----------
  $('preview').onclick = async () => {
    if (!design()) return log('\nEnter the design to edit in first (e.g. design/PSA-3010PA-ALBQNMMA-VICTOR).');
    const fields = tickedFields(); if (!fields.length) return log('\nTick at least one field.');
    const doUpdate = $('optUpdate').checked, doClean = $('optClean').checked;
    if (!doUpdate && !doClean) return log('\nTick "Update…" and/or "Remove extra spaces…".');
    const blankClears = $('optBlank').checked, skipDel = $('optSkipDeleted').checked;
    setBusy(true);
    plan = new Map(); reportRows = []; fieldCounts = {};
    $('changes').textContent = 'Checking…';
    const st = { checked: 0, changed: 0, missing: 0, errors: 0, invalid: 0, dup: 0, deleted: 0, noId: 0, upd: 0, sp: 0 };
    const notOnFeature = {};
    const jobs = [], seen = new Set();
    for (const row of parsed.rows) {
      const urn = urnOf(row);
      if (!urn) { st.noId++; continue; }
      if (seen.has(urn)) { st.dup++; continue; }
      seen.add(urn);
      if (skipDel && /^(yes|true|1)$/i.test((row.deleted || '').trim())) { st.deleted++; continue; }
      jobs.push({ row, urn });
    }
    setLog(`Comparing ${jobs.length} features with IQGeo (design ${design()})…` +
      (st.deleted ? ` ${st.deleted} deleted rows skipped.` : '') + (st.dup ? ` ${st.dup} duplicate rows ignored.` : '') + (st.noId ? ` ${st.noId} rows without id.` : ''));
    const tick = progress('Checked', jobs.length);
    await pool(jobs, async ({ row, urn }) => {
      try {
        const r = await getFeature(urn, design());
        if (r.status === 404) { st.missing++; log(`Not found in IQGeo: ${urn}`); return; }
        if (!r.ok) throw new Error('GET ' + r.status);
        const props = (await r.json()).properties || {};
        st.checked++;
        const changes = {}, old = {}, why = {};
        for (const col of fields) {
          if (!(col in props)) { notOnFeature[col] = (notOnFeature[col] || 0) + 1; continue; }
          const live = props[col], kind = kindOf(live), isAddr = ADDR_RE.test(col);
          const raw = row[col] ?? '';
          let target, reason;
          if (doUpdate && raw.trim() !== '') {
            const p = parseCell(kind, doClean && isAddr ? flat(raw) : raw);
            if (p.err) { st.invalid++; reportRows.push([urn, col, plain(live), raw, 'INVALID: ' + p.err]); continue; }
            target = p.val;
            reason = doClean && isAddr && typeof live === 'string' && flat(live) === target ? 'SPACES' : 'UPDATE';
          } else if (doUpdate && raw.trim() === '' && blankClears) {
            target = null; reason = 'UPDATE';
          } else if (doClean && isAddr && typeof live === 'string') {
            target = flat(live) || null; reason = 'SPACES';
          } else continue;
          if (same(live, target)) continue;
          changes[col] = target; old[col] = live ?? null; why[col] = reason;
          fieldCounts[col] = (fieldCounts[col] || 0) + 1;
          reason === 'SPACES' ? st.sp++ : st.upd++;
          reportRows.push([urn, col, plain(live), plain(target), reason === 'SPACES' ? 'REMOVE SPACES' : 'UPDATE']);
        }
        if (Object.keys(changes).length) { plan.set(urn, { urn, changes, old, why }); st.changed++; }
      } catch (err) { st.errors++; log(`Error ${urn}: ${err.message}`); }
    }, tick);

    const keys = Object.keys(fieldCounts).sort();
    $('changes').innerHTML = keys.length
      ? `<table><tr><th></th><th>Field</th><th>Changes</th><th>Example</th></tr>` + keys.map(f => {
          const ex = [...plan.values()].find(p => f in p.changes);
          return `<tr><td><input type="checkbox" value="${esc(f)}" checked></td><td>${esc(f)}</td><td>${fieldCounts[f]}</td>
            <td>${esc(showWs(ex.old[f]))} → ${esc(showWs(ex.changes[f]))}</td></tr>`;
        }).join('') + '</table>'
      : 'No changes — IQGeo already matches.';
    log(`\nPreview: ${st.checked} checked, ${st.changed} features to change — ${st.upd} value updates, ${st.sp} space fixes. ` +
      `${st.missing} not found, ${st.invalid} invalid values, ${st.errors} errors.`);
    const nf = Object.entries(notOnFeature);
    if (nf.length) log('Ticked fields not on the IQGeo feature (ignored): ' + nf.map(([c]) => c).join(', '));
    if (st.sp) log('Examples: · = space, ⇥ = tab, ↵ = line break, ◦ = hidden space character.');
    if (st.invalid) log('Invalid values are left out — see the change report.');
    if (st.missing && !st.checked) log('Nothing was found — check the feature type and ID column (Test connection).');
    blocked = st.errors > 0 || stopReq;
    if (stopReq) log('Stopped by user — only part of the features were checked. Run Preview again before applying.');
    if (st.errors) log('Some features could not be read. Run Preview again before applying.');
    setBusy(false);
  };

  // ---------- apply ----------
  async function applyOne(p, fields) {
    const changes = {}, old = {};
    for (const f of fields) { changes[f] = p.changes[f]; old[f] = p.old[f]; }
    const g = await getFeature(p.urn, design());             // fresh read: never overwrite edits made after Preview
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
    if (!confirm(`Change ${work.length} ${ftype()} features (${n} field changes) in design\n${design()} ?\n\nThe first one is saved and read back before the rest.`)) return;
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
      log(`\nSTOPPED on first record ${first.p.urn}: ${err.message}`);
      log('No other records were changed. Copy this message for your developer/assistant.');
      setBusy(false); return;
    }
    const tick = progress('Updated', rest.length);
    await pool(rest, async ({ p, fields }) => {
      try { record(p, await applyOne(p, fields)); }
      catch (err) { fail++; log(`FAILED ${p.urn}: ${err.message}`); }
    }, tick);
    for (const u of done) plan.delete(u);
    reportRows = reportRows.map(r => done.has(r[0]) && !/^INVALID/.test(r[4]) ? [...r.slice(0, 4), r[4] + ' – APPLIED'] : r);
    if (stopReq) log(`\nStopped by user — ${work.length - ok - fail} features were not attempted (nothing was changed on them).`);
    log(`\nDone. Updated ${ok} features, failed ${fail}. Undo log downloaded automatically — keep it.`);
    log('Tip: run Preview again — it should now find 0 changes for what you applied.');
    download(`iqgeo_address_undo_${stamp()}.json`, JSON.stringify(undo, null, 2), 'application/json');
    blocked = true;
    setBusy(false);
  };

  // ---------- report / undo ----------
  $('report').onclick = () => {
    const lines = [['id', 'field', 'iqgeo_value', 'new_value', 'action'], ...reportRows].map(r => r.map(csvCell).join(','));
    download(`iqgeo_address_report_${stamp()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
  };
  $('undo').onclick = () => download(`iqgeo_address_undo_${stamp()}.json`, JSON.stringify(undo, null, 2), 'application/json');
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
