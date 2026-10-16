(() => {
  if (window.__iqgConflictPanel) { window.__iqgConflictPanel.toggle(); return; }

  // Update / Delete conflict = the design deletes a feature that master changed after the design was created.
  // "Keep the delete" re-applies the design's delete on top of the CURRENT master version:
  //   1. read the feature in master (no delta)        – must exist
  //   2. read it in the design                        – normally 404 (already deleted there)
  //   3. PUT the master version into the design       – the design now holds an update based on current master
  //   4. DELETE it in the design                      – a fresh delete, based on current master → no conflict
  //   5. read back: gone in the design, master unchanged
  // Every write goes to the design (?delta=…); master is only read.

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
      input[type=text],input[type=number],textarea{width:100%;box-sizing:border-box;padding:5px;font:12px ui-monospace,monospace}
      button{padding:6px 10px;margin:8px 6px 0 0;cursor:pointer}
      button:disabled{opacity:.5;cursor:default}
      table{border-collapse:collapse;width:100%;margin-top:4px;font-size:12px}
      td,th{border-bottom:1px solid #eee;padding:2px 4px;text-align:left;vertical-align:top}
      .box{max-height:200px;overflow:auto;border:1px solid #ddd;padding:4px}
      #log{margin-top:8px;height:170px;overflow:auto;background:#f6f6f6;border:1px solid #ddd;
           padding:6px;white-space:pre-wrap;font:12px ui-monospace,monospace}
      .x{cursor:pointer;border:0;background:none;font-size:16px;margin:0;padding:0}
      .sm{font-size:11px;color:#666}
      .row{display:flex;gap:10px}.row>div{flex:1}
      .warn{color:#8a5a00}
    </style>
    <div class="p">
      <h3>IQGeo Delete Conflict Fixer <button class="x" id="close" title="Hide">✕</button></h3>
      <div class="sm">Fixes <b>Conflict: Update / Delete</b> by keeping the design's delete: the feature is re-deleted in the design on top of the current master version. Master is never written.</div>
      <div class="row">
        <div><label class="t">IQGeo base URL</label><input type="text" id="base"></div>
      </div>
      <label class="t">Design to fix</label>
      <input type="text" id="design" placeholder="design/PSA-2023PA-ALBUNMTL-VICTOR">
      <label class="t">Feature ids <span class="sm">(one per line: <code>type/id</code>, or a bare id such as <code>877682</code>)</span></label>
      <textarea id="ids" rows="3" placeholder="877682"></textarea>
      <button id="clearFiles" type="button">Clear ids</button>
      <label class="t">Feature types to try for bare ids <span class="sm">(comma separated; the one whose master record exists is used)</span></label>
      <input type="text" id="types" value="uub, fp, flowerpot, handhole, hand_hole, pedestal, vault, manhole">
      <button id="preview">1. Preview</button>
      <button id="apply" disabled>2. Keep the delete</button>
      <button id="stop" disabled title="Stop after the feature in progress">■ Stop</button>
      <label class="t">Conflicts found</label>
      <div id="changes" class="box sm">Enter the design and the id(s), then Preview. Nothing is changed until step 2.</div>
      <button id="report" disabled>Download report</button>
      <button id="probe" title="Read only: lists IQGeo's own conflict / revert functions and URLs">Find IQGeo's revert / conflict functions</button>
      <button id="copyProbe" disabled>Copy results</button>
      <div id="status" class="sm" style="margin-top:8px;font-weight:600"></div>
      <div id="log">1) Check the design  2) Enter the id  3) Preview – check the name matches  4) Keep the delete  5) Run Check Design again in IQGeo</div>
    </div>`;
  document.documentElement.appendChild(host);
  const $ = id => root.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const log = m => { $('log').textContent += '\n' + m; $('log').scrollTop = 1e9; };
  const setLog = m => { $('log').textContent = m; };
  $('base').value = location.origin;
  // the design shown in IQGeo's title bar, if any
  const shown = /Design:\s*([A-Za-z0-9_.\-]+)/.exec(document.body ? document.body.innerText.slice(0, 20000) : '');
  if (shown) $('design').value = 'design/' + shown[1];
  $('close').onclick = () => { host.style.display = 'none'; };
  window.__iqgConflictPanel = { hide: () => { host.style.display = 'none'; }, toggle: () => { host.style.display = host.style.display === 'none' ? '' : 'none'; } };

  let plan = [], reportRows = [], stopReq = false;

  // ---------- API ----------
  const base = () => $('base').value.trim().replace(/\/+$/, '');
  const design = () => $('design').value.trim();
  const urlFor = (urn, delta) => `${base()}/feature/${urn.split('/').map(encodeURIComponent).join('/')}` + (delta ? `?delta=${encodeURIComponent(delta)}` : '');
  function csrfHeaders() {
    const h = {};
    const m = document.cookie.split('; ').map(c => c.split('=')).find(([k]) => /csrf|xsrf/i.test(k));
    if (m) { const v = decodeURIComponent(m[1]); h['X-CSRFToken'] = v; h['X-XSRF-TOKEN'] = v; h['X-CSRF-Token'] = v; }
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta) h['X-CSRF-Token'] = meta.content;
    return h;
  }
  const get = (urn, delta) => fetch(urlFor(urn, delta), { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  const put = (feature, urn, delta) => fetch(urlFor(urn, delta), {
    method: 'PUT', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...csrfHeaders() }, body: JSON.stringify(feature) });
  const del = (urn, delta) => fetch(urlFor(urn, delta), {
    method: 'DELETE', credentials: 'same-origin', headers: { Accept: 'application/json', ...csrfHeaders() } });
  const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const download = (name, text, mime) => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = name; root.appendChild(a); a.click(); a.remove();
  };
  const setBusy = b => {
    if (b) stopReq = false;
    ['preview', 'apply', 'clearFiles', 'ids', 'design'].forEach(id => $(id).disabled = b);
    $('stop').disabled = !b;
    if (!b) { $('apply').disabled = !plan.some(p => p.ok); $('report').disabled = !reportRows.length; }
  };
  const nameOf = f => (f && f.properties && (f.properties.name ?? f.properties.label)) ?? '';

  $('stop').onclick = () => { stopReq = true; $('stop').disabled = true; log('\nStop pressed — finishing the feature in progress, nothing new is started…'); };
  $('clearFiles').onclick = () => {
    $('ids').value = ''; plan = []; reportRows = [];
    $('changes').textContent = 'Enter the design and the id(s), then Preview. Nothing is changed until step 2.'; $('status').textContent = '';
    setBusy(false); log('\nIds cleared.');
  };

  // ---------- preview ----------
  $('preview').onclick = async () => {
    if (!/^design\//i.test(design())) return log('\nEnter the design as design/<name> (e.g. design/PSA-2023PA-ALBUNMTL-VICTOR).');
    const ids = $('ids').value.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
    if (!ids.length) return log('\nEnter at least one id.');
    const types = $('types').value.split(',').map(s => s.trim()).filter(Boolean);
    setBusy(true); plan = []; reportRows = [];
    setLog(`Checking ${ids.length} feature(s) in master and in ${design()}…`);
    for (const id of ids) {
      if (stopReq) break;
      const cands = id.includes('/') ? [id] : types.map(t => `${t}/${id}`);
      let urn = null, master = null;
      for (const c of cands) {
        try { const r = await get(c, ''); if (r.ok) { urn = c; master = await r.json(); break; } } catch {}
      }
      if (!urn) { plan.push({ id, ok: false, why: `not found in master as ${cands.join(' / ')} — enter it as type/id` }); continue; }
      let inDesign = 'error';
      try { const r = await get(urn, design()); inDesign = r.status === 404 ? 'deleted' : r.ok ? 'exists' : 'HTTP ' + r.status; } catch (e) { inDesign = e.message; }
      const p = master.properties || {};
      const item = { id, urn, master, name: nameOf(master), updated: p.updated_at || '', user: p.update_user || '', inDesign,
        ok: inDesign === 'deleted' || inDesign === 'exists' };
      if (!item.ok) item.why = 'could not read it in the design: ' + inDesign;
      plan.push(item);
    }
    $('changes').innerHTML = `<table><tr><th>Feature</th><th>Name (master)</th><th>Master last updated</th><th>In design</th><th>Action</th></tr>` +
      plan.map(p => `<tr><td>${esc(p.urn || p.id)}</td><td>${esc(p.name)}</td><td>${esc(p.updated)}<br><span class="sm">${esc(p.user)}</span></td>
        <td>${esc(p.inDesign || '')}</td><td>${p.ok ? (p.inDesign === 'deleted' ? 'Re-delete on current master' : 'Delete in design')
        : '<span class="warn">' + esc(p.why) + '</span>'}</td></tr>`).join('') + '</table>';
    plan.forEach(p => reportRows.push([p.urn || p.id, p.name || '', p.updated || '', p.inDesign || '', p.ok ? 'TO FIX' : 'SKIPPED: ' + p.why]));
    const n = plan.filter(p => p.ok).length;
    log(`\nPreview: ${n} to fix, ${plan.length - n} skipped. Check that the name and type are the conflicting feature before step 2.`);
    if (stopReq) { plan = []; log('Stopped by user — run Preview again.'); }
    setBusy(false);
  };

  // ---------- apply ----------
  $('apply').onclick = async () => {
    const work = plan.filter(p => p.ok);
    if (!work.length) return;
    if (!confirm(`Keep the delete for ${work.length} feature(s) in\n${design()} ?\n\n` +
      work.map(p => `${p.urn}  ${p.name}`).join('\n') + '\n\nEach is re-deleted in the design on top of the current master version. Master is not changed.')) return;
    setBusy(true);
    let ok = 0, fail = 0;
    for (const p of work) {
      if (stopReq) break;
      const step = s => { $('status').textContent = `${p.urn}: ${s}`; };
      try {
        if (p.inDesign === 'deleted') {
          step('putting the current master version into the design…');
          const r = await put(p.master, p.urn, design());
          if (!r.ok) throw new Error(`could not take the master version into the design (PUT ${r.status} ${(await r.text()).slice(0, 200)}) — nothing was changed`);
        }
        step('deleting in the design…');
        const d = await del(p.urn, design());
        if (!d.ok && d.status !== 204) throw new Error(`DELETE ${d.status} ${(await d.text()).slice(0, 200)} — the feature is now BACK in the design: delete it in IQGeo by hand`);
        step('checking…');
        const g = await get(p.urn, design());
        if (g.status !== 404) throw new Error(`still visible in the design after delete (HTTP ${g.status}) — delete it in IQGeo by hand`);
        const m = await get(p.urn, '');
        const mp = m.ok ? ((await m.json()).properties || {}) : null;
        const masterSame = mp && (mp.updated_at || '') === p.updated;
        ok++; log(`FIXED ${p.urn} (${p.name}): deleted in the design on top of the current master version.` + (masterSame ? ' Master unchanged ✓' : ' NOTE: master record changed since Preview — check it.'));
        reportRows.push([p.urn, p.name, p.updated, 'deleted', 'FIXED – delete re-applied on current master']);
      } catch (err) {
        fail++; log(`FAILED ${p.urn}: ${err.message}`);
        reportRows.push([p.urn, p.name, p.updated, '', 'FAILED: ' + err.message]);
      }
    }
    if (stopReq) log(`Stopped by user — ${work.length - ok - fail} feature(s) not attempted.`);
    log(`\nDone. Fixed ${ok}, failed ${fail}. Now run Check Design (Conflicts) in IQGeo again — the conflict should be gone.`);
    $('status').textContent = `Fixed ${ok}, failed ${fail}`;
    plan = []; setBusy(false);
  };

  // ---------- read-only probe: what does this IQGeo call to revert / resolve a design change? ----------
  let probeText = '';
  $('probe').onclick = async () => {
    setBusy(true); $('probe').disabled = true;
    setLog('Looking for IQGeo\'s own conflict / revert functions and URLs (read only – nothing is called or changed)…');
    const lines = [`IQGeo: ${location.origin}  design: ${design()}`];
    try {
      const r = await chrome.runtime.sendMessage({ type: 'iqgProbe' });
      if (r.error) lines.push('page functions: ' + r.error);
      else { lines.push(`myw: ${r.myw} ${r.version}`); lines.push(...(r.hits.length ? r.hits : ['(no matching functions found)'])); }
    } catch (e) { lines.push('page functions: ' + e.message); }
    // URL paths in the page's own scripts that mention conflicts / reverting / deltas
    const RE = /["'`](\/?[\w\-{}$:./]*(?:conflict|resolve|revert|rebase|discard)[\w\-{}$:./]*)["'`]/gi;
    const found = new Set();
    for (const sc of [...document.scripts]) {
      try {
        const txt = sc.src ? (new URL(sc.src).origin === location.origin ? await (await fetch(sc.src, { credentials: 'same-origin' })).text() : '') : sc.textContent;
        for (const m of txt.matchAll(RE)) if (m[1].length < 120 && m[1].includes('/')) found.add(m[1]);
      } catch {}
    }
    lines.push('--- URL paths in IQGeo scripts ---', ...(found.size ? [...found].sort() : ['(none found)']));
    probeText = lines.join('\n');
    log('\n' + probeText + '\n\nClick "Copy results" and paste them to your assistant.');
    $('copyProbe').disabled = false; setBusy(false); $('probe').disabled = false;
  };
  $('copyProbe').onclick = async () => {
    try { await navigator.clipboard.writeText(probeText); log('Copied.'); }
    catch { download(`iqgeo_probe_${stamp()}.txt`, probeText, 'text/plain'); log('Clipboard blocked – saved as a file instead.'); }
  };

  $('report').onclick = () => {
    const lines = [['feature', 'name', 'master_updated_at', 'in_design', 'result'], ...reportRows].map(r => r.map(csvCell).join(','));
    download(`delete_conflict_report_${stamp()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
  };
})();
