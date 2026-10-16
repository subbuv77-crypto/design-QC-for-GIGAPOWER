(() => {
  if (window.__iqgNameIdPanel) { window.__iqgNameIdPanel.toggle(); return; }

  // ---------- rule ----------
  // The number in the name must be the feature's id number:
  //   fiber_ont/1025037  XX-ONT-1025030        -> XX-ONT-1025037
  //   fiber_ont/1350020  UNSET-1349999-Apt B   -> UNSET-1350020-Apt B
  // Only the id-like number (a run of at least N digits) is replaced; the rest of the name is kept.
  function fixName(name, idNum, minDigits) {
    const s = String(name ?? '');
    const re = new RegExp(`(?<!\\d)\\d{${minDigits},}(?!\\d)`, 'g');
    const runs = [...s.matchAll(re)];
    if (!runs.length) return { skip: `no number of ${minDigits}+ digits in the name` };
    if (runs.some(m => m[0] === idNum)) return { ok: true };
    if (runs.length > 1) return { skip: `several numbers in the name (${runs.map(m => m[0]).join(', ')}) – none is the id` };
    const m = runs[0];
    return { name: s.slice(0, m.index) + idNum + s.slice(m.index + m[0].length), old: m[0] };
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
      .box{max-height:220px;overflow:auto;border:1px solid #ddd;padding:4px}
      .opt label{display:block;margin-top:3px}
      #log{margin-top:8px;height:170px;overflow:auto;background:#f6f6f6;border:1px solid #ddd;
           padding:6px;white-space:pre-wrap;font:12px ui-monospace,monospace}
      .x{cursor:pointer;border:0;background:none;font-size:16px;margin:0;padding:0}
      .sm{font-size:11px;color:#666}
      .row{display:flex;gap:10px}.row>div{flex:1}
      .warn{color:#8a5a00}
    </style>
    <div class="p">
      <h3>IQGeo Name–ID Fixer <button class="x" id="close" title="Hide">✕</button></h3>
      <div class="sm">Makes the number in each feature's <b>name</b> match its <b>id</b>: <code>fiber_ont/1025037</code> + <code>XX-ONT-1025030</code> → <code>XX-ONT-1025037</code>. The rest of the name is kept. Only <code>name</code> is written.</div>
      <div class="row">
        <div><label class="t">IQGeo base URL</label><input type="text" id="base"></div>
        <div style="flex:0 0 80px"><label class="t">Parallel</label><input type="number" id="conc" min="1" max="8" value="4"></div>
      </div>
      <label class="t">Features <span class="sm">(design export .zip, or .csv files with <code>id</code> and <code>name</code> columns, e.g. fiber_ont.csv – select several at once)</span></label>
      <input type="file" id="ffiles" accept=".zip,.csv" multiple>
      <button id="clearFiles" type="button">Clear file selection</button>
      <label class="t">Feature types</label>
      <div id="types" class="box sm">Load the files to see their feature types.</div>
      <label class="t">Design to edit in</label>
      <input type="text" id="design" placeholder="design/PSA-3006PA-ALBQNMMA-VICTOR">
      <label class="t">Only features with Design Created = <span class="sm">(blank = all features)</span></label>
      <input type="text" id="createdIn" placeholder="blank = all features">
      <div class="row">
        <div style="flex:0 0 220px"><label class="t">Id-like number = at least</label><input type="number" id="mind" min="3" max="12" value="5"></div>
        <div><label class="t">&nbsp;</label><span class="sm">digits in a row (shorter numbers such as “Apt 2” are never touched)</span></div>
      </div>
      <button id="test" disabled>Test connection</button>
      <button id="preview" disabled>1. Preview</button>
      <button id="apply" disabled>2. Apply ticked changes</button>
      <button id="stop" disabled title="Stop after the requests already in progress finish">■ Stop</button>
      <label class="t">Names to fix <span class="sm">(untick a row to leave it alone)</span></label>
      <div id="changes" class="box sm">Load the files, then Preview. Nothing is saved until Apply.</div>
      <div id="flags" class="sm warn" style="margin-top:4px"></div>
      <button id="report" disabled>Download change report</button>
      <button id="undo" disabled>Download undo log</button>
      <button id="restore">Restore from undo log…</button>
      <input type="file" id="restoreFile" accept=".json" style="display:none">
      <div id="status" class="sm" style="margin-top:8px;font-weight:600"></div>
      <div id="log">1) Load the export or CSVs  2) Check design and filter  3) Test connection  4) Preview  5) Apply</div>
    </div>`;
  document.documentElement.appendChild(host);
  const $ = id => root.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const log = m => { $('log').textContent += '\n' + m; $('log').scrollTop = 1e9; };
  const setLog = m => { $('log').textContent = m; };
  $('base').value = location.origin;
  $('close').onclick = () => { host.style.display = 'none'; };
  window.__iqgNameIdPanel = { hide: () => { host.style.display = 'none'; }, toggle: () => { host.style.display = host.style.display === 'none' ? '' : 'none'; } };

  let feats = null, plan = [], reportRows = [], undo = [], blocked = true, stopReq = false;

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
  const getFeature = (urn, delta) => withRetry(() => fetch(urlFor(urn, delta), { credentials: 'same-origin', headers: { Accept: 'application/json' } }));
  const putFeature = (feature, urn, delta) => withRetry(() => fetch(urlFor(urn, delta), {
    method: 'PUT', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...csrfHeaders() }, body: JSON.stringify(feature) }));
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
  const normDC = v => String(v ?? '').trim().replace(/^design\//i, '').toLowerCase();
  const idNumOf = urn => (/(\d+)$/.exec(urn) || [])[1] || '';
  const checkedTypes = () => new Set([...root.querySelectorAll('#types input:checked')].map(i => i.value));
  function refresh() {
    $('test').disabled = $('preview').disabled = !feats;
    $('apply').disabled = !plan.length || blocked;
    $('report').disabled = !reportRows.length;
    $('undo').disabled = !undo.length;
  }
  const setBusy = b => {
    if (b) stopReq = false;
    $('stop').disabled = !b;
    ['test', 'preview', 'apply', 'ffiles', 'clearFiles', 'restore'].forEach(id => $(id).disabled = b);
    if (!b) refresh();
  };
  const resetPlan = () => { plan = []; reportRows = []; blocked = true; $('flags').textContent = ''; };

  // ---------- stop / clear ----------
  $('stop').onclick = () => {
    stopReq = true; $('stop').disabled = true;
    $('status').textContent += ' — stopping…';
    log('\nStop pressed — finishing the requests already in progress, nothing new is started…');
  };
  $('clearFiles').onclick = () => {
    $('ffiles').value = ''; feats = null; undo = [];
    $('design').value = ''; $('createdIn').value = '';
    $('types').textContent = 'Load the files to see their feature types.';
    resetPlan(); $('changes').textContent = 'Load the files, then Preview. Nothing is saved until Apply.'; $('status').textContent = '';
    refresh(); log('\nFile selection cleared. Load new files to start again.');
  };

  // ---------- load ----------
  $('ffiles').onchange = async (e) => {
    const files = [...e.target.files]; if (!files.length) return;
    try {
      const texts = [];
      for (const f of files) {
        if (/\.zip$/i.test(f.name)) texts.push(...(await unzip(await f.arrayBuffer(), n => /\.csv$/i.test(n))).map(x => ({ source: x.path, text: x.text })));
        else texts.push({ source: f.name, text: await f.text() });
      }
      feats = [];
      const seen = new Set();
      for (const t of texts) {
        const p = parseCSV(t.text);
        if (!p.headers.includes('id') || !p.headers.includes('name')) continue;
        for (const r of p.rows) {
          const urn = String(r.id || '').trim();
          if (!/^[\w.]+\/\d+$/.test(urn) || seen.has(urn)) continue;
          seen.add(urn); feats.push({ urn, type: urn.split('/')[0], row: r });
        }
      }
      if (!feats.length) throw new Error('no rows with an id like fiber_ont/1025037 and a name column');
      const byType = {}; feats.forEach(f => { byType[f.type] = (byType[f.type] || 0) + 1; });
      // fiber_ont preselected when present (the usual case); otherwise all types
      const pre = byType.fiber_ont ? new Set(['fiber_ont']) : new Set(Object.keys(byType));
      $('types').innerHTML = Object.entries(byType).sort().map(([t, n]) =>
        `<label style="display:inline-block;margin-right:12px"><input type="checkbox" value="${esc(t)}" ${pre.has(t) ? 'checked' : ''}> ${esc(t)} (${n})</label>`).join('');
      // design to edit in: the export's design (design_id), else the most common Design Created
      const mostCommon = col => {
        const c = {}; feats.forEach(f => { const d = String(f.row[col] || '').split(',')[0].trim(); if (d) c[d] = (c[d] || 0) + 1; });
        return (Object.entries(c).sort((a, b) => b[1] - a[1])[0] || [])[0];
      };
      const best = mostCommon('design_id') || mostCommon('delta_created');
      if (!design() && best) $('design').value = /^design\//i.test(best) ? best : 'design/' + best;
      resetPlan();
      const mind = +$('mind').value || 5;
      const off = feats.filter(f => { const r = fixName(f.row.name, idNumOf(f.urn), mind); return !r.ok; }).length;
      log(`\nLoaded ${feats.length} features from ${texts.length} file(s). In the files, ${off} name(s) do not contain their id number (IQGeo is checked live in Preview).`);
    } catch (err) { feats = null; log('\nError reading files: ' + err.message); }
    refresh();
  };

  // ---------- test ----------
  $('test').onclick = async () => {
    const urn = feats[0].urn;
    log(`\nTesting GET ${urlFor(urn, design())}`);
    setBusy(true);
    try {
      const r = await getFeature(urn, design());
      log(`HTTP ${r.status}`);
      if (r.ok) { const p = (await r.json()).properties || {}; log(`OK — ${urn} found; name = “${p.name ?? ''}”.`); }
    } catch (err) { log('Request failed: ' + err.message); }
    setBusy(false);
  };

  // ---------- preview ----------
  $('preview').onclick = async () => {
    if (!design()) return log('\nEnter the design to edit in first.');
    const types = checkedTypes(); if (!types.size) return log('\nTick at least one feature type.');
    const want = normDC($('createdIn').value), mind = Math.max(3, +$('mind').value || 5);
    setBusy(true); resetPlan();
    $('changes').textContent = 'Checking…';
    let other = 0;
    const jobs = feats.filter(f => types.has(f.type)).filter(f => {
      if (want && 'delta_created' in f.row && normDC(f.row.delta_created) !== want) { other++; return false; } return true; });
    setLog(`Reading ${jobs.length} features in ${design()} and checking their names…` + (other ? ` ${other} with another Design Created left out.` : ''));
    const st = { checked: 0, ok: 0, fix: 0, skipped: 0, missing: 0, errors: 0 };
    const skipWhy = {};
    const tick = progress('Checked', jobs.length);
    await pool(jobs, async (f) => {
      try {
        const r = await getFeature(f.urn, design());
        if (r.status === 404) { st.missing++; reportRows.push([f.urn, '', '', 'SKIPPED: not found in IQGeo']); return; }
        if (!r.ok) throw new Error('GET ' + r.status);
        const props = (await r.json()).properties || {};
        if (want && 'delta_created' in props && normDC(props.delta_created) !== want) { st.skipped++; skipWhy['Design Created differs in IQGeo'] = (skipWhy['Design Created differs in IQGeo'] || 0) + 1; return; }
        st.checked++;
        const name = props.name ?? '';
        const res = fixName(name, idNumOf(f.urn), mind);
        if (res.ok) { st.ok++; return; }
        if (res.skip) { st.skipped++; const k = res.skip.replace(/\(.*\)/, '').trim(); skipWhy[k] = (skipWhy[k] || 0) + 1; reportRows.push([f.urn, name, '', 'SKIPPED: ' + res.skip]); return; }
        st.fix++; plan.push({ urn: f.urn, old: name, name: res.name });
        reportRows.push([f.urn, name, res.name, `CHANGE (${res.old} → ${idNumOf(f.urn)})`]);
      } catch (err) { st.errors++; log(`Error ${f.urn}: ${err.message}`); }
    }, tick);
    plan.sort((a, b) => a.urn.localeCompare(b.urn));
    $('changes').innerHTML = plan.length
      ? `<table><tr><th><input type="checkbox" id="all" checked></th><th>Feature</th><th>Name in IQGeo</th><th>New name</th></tr>` +
        plan.map((p, i) => `<tr><td><input type="checkbox" data-i="${i}" checked></td><td>${esc(p.urn)}</td><td>${esc(p.old)}</td><td><b>${esc(p.name)}</b></td></tr>`).join('') + '</table>'
      : 'Nothing to fix — every checked name already contains its id number.';
    const all = root.getElementById('all');
    if (all) all.onchange = () => root.querySelectorAll('#changes input[data-i]').forEach(c => { c.checked = all.checked; });
    $('flags').textContent = Object.keys(skipWhy).length ? 'Skipped: ' + Object.entries(skipWhy).map(([k, n]) => `${n} × ${k}`).join(' | ') : '';
    log(`\nPreview: ${st.checked} checked — ${st.fix} to fix, ${st.ok} already match, ${st.skipped} skipped, ${st.missing} not found, ${st.errors} errors.`);
    blocked = st.errors > 0 || stopReq;
    if (stopReq) log('Stopped by user — only part of the features were checked. Run Preview again before applying.');
    else if (st.errors) log('Some features could not be read. Run Preview again before applying.');
    setBusy(false);
  };

  // ---------- apply ----------
  async function applyOne(p) {
    const g = await getFeature(p.urn, design());
    if (!g.ok) throw new Error('GET ' + g.status);
    const feature = await g.json();
    const props = feature.properties || (feature.properties = {});
    if ((props.name ?? '') !== p.old) throw new Error(`name was changed in IQGeo after Preview (now “${props.name ?? ''}”) — skipped`);
    props.name = p.name;
    const r = await putFeature(feature, p.urn, design());
    if (!r.ok) throw new Error(`PUT ${r.status} ${(await r.text()).slice(0, 200)}`);
  }
  $('apply').onclick = async () => {
    const ticked = new Set([...root.querySelectorAll('#changes input[data-i]:checked')].map(c => +c.dataset.i));
    const work = plan.filter((p, i) => ticked.has(i));
    if (!work.length) return log('\nNothing ticked to apply.');
    if (!confirm(`Rename ${work.length} feature(s) in design\n${design()} ?\n\ne.g. ${work[0].old} → ${work[0].name}\n\nThe first one is saved and read back before the rest.`)) return;
    setBusy(true);
    undo = []; let ok = 0, fail = 0;
    const done = new Set();
    const record = p => { undo.push({ urn: p.urn, delta: design(), restore: { name: p.old }, applied: { name: p.name } }); done.add(p.urn); ok++; };
    const [first, ...rest] = work;
    try {
      await applyOne(first);
      const r = await getFeature(first.urn, design());
      if (((await r.json()).properties || {}).name !== first.name) throw new Error('read-back mismatch — IQGeo accepted the request but the name was not stored');
      record(first); log(`\nVerified first update (${first.urn}: ${first.name}). Continuing…`);
    } catch (err) {
      log(`\nSTOPPED on first feature ${first.urn}: ${err.message}`); log('No other features were changed.');
      setBusy(false); return;
    }
    const tick = progress('Updated', rest.length);
    await pool(rest, async (p) => {
      try { await applyOne(p); record(p); }
      catch (err) { fail++; log(`FAILED ${p.urn}: ${err.message}`); }
    }, tick);
    plan = plan.filter(p => !done.has(p.urn));
    reportRows = reportRows.map(r => done.has(r[0]) && /^CHANGE/.test(r[3]) ? [...r.slice(0, 3), r[3] + ' – APPLIED'] : r);
    if (stopReq) log(`\nStopped by user — ${work.length - ok - fail} features were not attempted (nothing was changed on them).`);
    log(`\nDone. Renamed ${ok} features, failed ${fail}. Undo log downloaded automatically — keep it.`);
    log('Tip: run Preview again — it should now find nothing to fix.');
    download(`name_id_undo_${stamp()}.json`, JSON.stringify(undo, null, 2), 'application/json');
    blocked = true; setBusy(false);
  };

  // ---------- report / undo ----------
  $('report').onclick = () => {
    const lines = [['feature', 'name_in_iqgeo', 'new_name', 'action / note'], ...reportRows].map(r => r.map(csvCell).join(','));
    download(`name_id_report_${stamp()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
  };
  $('undo').onclick = () => download(`name_id_undo_${stamp()}.json`, JSON.stringify(undo, null, 2), 'application/json');
  $('restore').onclick = () => $('restoreFile').click();
  $('restoreFile').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    let entries; try { entries = JSON.parse(await f.text()); } catch { return log('\nUndo log is not valid JSON.'); }
    if (!Array.isArray(entries) || !entries.length) return log('\nUndo log is empty.');
    if (!confirm(`Restore previous names on ${entries.length} feature(s)?`)) return;
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

  if (typeof module !== 'undefined') module.exports = { fixName };
})();
