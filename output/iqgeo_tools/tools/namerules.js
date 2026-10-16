// Pure name -> address rules (no browser APIs; also testable in Node).
(function (root) {
  const ws = s => String(s == null ? '' : s).replace(/[\s\u00a0\u200b\ufeff]+/g, ' ').trim();
  const title = s => ws(s).split(' ').filter(Boolean).map(w => (/^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1).toLowerCase())).join(' ');

  // street type as written in the name -> standard suffix
  const TYPES = { ST: 'St', DR: 'Dr', AVE: 'Ave', BLVD: 'Blvd', PL: 'Pl', RD: 'Rd', LOOP: 'Loop', CT: 'Ct', LN: 'Ln',
    WAY: 'Way', CIR: 'Cir', TER: 'Ter', PKWY: 'Pkwy', HWY: 'Hwy', TRL: 'Trl', PLZ: 'Plz',
    PI: 'Pl' /* common typo: capital I instead of L */ };
  // [POLE|FP|HH] <letter>[-][n] <house number>[-n | -A | A] <street name> <type> [direction] [HH]   (direction is optional)
  // a house-number suffix (3124-1, 3025-A, 2709B) is dropped: house number 3124 / 3025 / 2709
  const NAME_RE = /^(?:(?:POLE|FP|HH)\s+)?[A-Z](?:-?\d*)?\s+(\d+)(?:-[A-Z0-9]+|[A-Z])?\s+(.+?)(?:\s+(SE|SW|NE|NW|N|S|E|W))?(?:\s+HH)?$/;

  function parseName(name) {
    const n = ws(name).toUpperCase();
    if (!n) return { error: 'feature has no name' };
    const m = NAME_RE.exec(n);
    if (!m) return { error: 'name does not match the pattern "<prefix> <number> <street> <type> [direction]"' };
    const [, num, street, dir] = m;
    const parts = street.split(' ');
    const typeWord = parts.length > 1 ? parts[parts.length - 1] : '';
    // known street type -> suffix; no (known) type -> whole text is the street name and the suffix stays blank
    if (TYPES[typeWord]) return { num, street: title(parts.slice(0, -1).join(' ')), type: TYPES[typeWord], dir: dir || '' };
    return { num, street: title(street), type: '', dir: dir || '' };
  }

  // "<number> <street> [type] [direction]" as sent to USPS / used in addr_full
  const streetLine = p => `${p.num} ${p.street}${p.type ? ' ' + p.type : ''}${p.dir ? ' ' + p.dir : ''}`;

  // cfg: { city, state, zip, county, country, caseMode: 'title' | 'upper' }
  function buildTarget(p, cfg) {
    const c = s => (cfg.caseMode === 'upper' ? ws(s).toUpperCase() : title(s));
    const t = {
      addr_house_number: p.num, addr_street_direction: p.dir, addr_street_name: p.street,
      addr_street_name_suffix: c(p.type), addr_city: c(cfg.city), addr_state: ws(cfg.state).toUpperCase(),
      addr_postal_code: ws(cfg.zip), addr_county: c(cfg.county), addr_country: ws(cfg.country)
    };
    t.addr_full = `${streetLine(p)}, ${title(cfg.city)}, ${t.addr_state}` +
      (t.addr_postal_code ? ' ' + t.addr_postal_code : '') + (t.addr_country ? ', ' + t.addr_country : '');
    return t;
  }

  // ---------- postal code from an address-point file (PSA export) ----------
  // Columns (lower case): a_saddstr (street name), a_saddsttyp (type), a_saddstsuf (direction), a_saddno (house number),
  // a_szip5 (ZIP) and a_szip (ZIP-plus4). Falls back to gis_streetname / gis_streettype / gis_streetdirection / gis_streetnr / gis_postcode.
  const up = s => ws(s).toUpperCase();
  const typeKey = s => { const t = up(s).replace(/\.$/, ''); return TYPES[t] ? TYPES[t].toUpperCase() : t; };
  const houseNo = s => { const m = /^\d+/.exec(ws(s)); return m ? +m[0] : null; };
  const ADDR_COLS = [
    { street: 'a_saddstr', type: 'a_saddsttyp', dir: 'a_saddstsuf', num: 'a_saddno', zip: 'a_szip5', zipfull: 'a_szip' },
    { street: 'gis_streetname', type: 'gis_streettype', dir: 'gis_streetdirection', num: 'gis_streetnr', zip: 'gis_postcode', zipfull: 'gis_postalcodeplus4' }];
  const isAddrFile = headers => ADDR_COLS.some(c => headers.includes(c.street) && headers.includes(c.zip));

  // rows: objects with lower-case keys -> index { 'STREET|TYPE|DIR': [{ num, zip, plus4 }] }
  function buildAddrIndex(rows, index = {}) {
    let n = 0;
    for (const r of rows) {
      const c = ADDR_COLS.find(c => up(r[c.street]) && /^\d{5}/.test(ws(r[c.zip])));
      if (!c) continue;
      const zip = ws(r[c.zip]).slice(0, 5);
      const full = ws(r[c.zipfull]);
      const plus4 = (/^\d{5}-?(\d{4})$/.exec(full) || /^(\d{4})$/.exec(full) || [])[1] || '';
      const k = `${up(r[c.street])}|${typeKey(r[c.type])}|${up(r[c.dir])}`;
      (index[k] = index[k] || []).push({ num: houseNo(r[c.num]), zip, plus4 });
      n++;
    }
    Object.defineProperty(index, 'count', { value: (index.count || 0) + n, writable: true, enumerable: false });
    return index;
  }

  // parsed name -> { zip, plus4, how } or { how } when nothing matches
  function lookupZip(index, p) {
    const street = up(p.street), type = typeKey(p.type), dir = up(p.dir);
    let cands = index[`${street}|${type}|${dir}`];
    let how = 'street name + type + direction';
    if (!cands && !dir) {                              // name has no direction: use the street if all its directions agree
      cands = Object.keys(index).filter(k => k.startsWith(`${street}|${type}|`)).flatMap(k => index[k]);
      how = 'street name + type (name has no direction)';
    }
    if (!cands || !cands.length) return { how: 'no address with this street name, type and direction' };
    const zips = [...new Set(cands.map(c => c.zip))];
    const h = houseNo(p.num);
    const exact = cands.find(c => c.num === h);
    if (exact) return { zip: exact.zip, plus4: exact.plus4, how: how + ', same house number' };
    if (zips.length === 1) return { zip: zips[0], plus4: '', how: how + ', one ZIP on the street' };
    // street has several ZIPs: nearest house number, same side of the street (odd/even) first
    const withNo = cands.filter(c => c.num != null);
    const side = withNo.filter(c => h != null && c.num % 2 === h % 2);
    const pool = side.length ? side : withNo;
    if (h == null || !pool.length) return { how: `street has several ZIPs (${zips.sort().join('/')}) and no house number to choose` };
    const best = pool.reduce((a, b) => (Math.abs(b.num - h) < Math.abs(a.num - h) ? b : a));
    return { zip: best.zip, plus4: '', how: `${how}, nearest house number ${best.num} (street has ${zips.sort().join('/')})` };
  }

  const api = { ws, title, TYPES, parseName, buildTarget, streetLine, isAddrFile, buildAddrIndex, lookupZip };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.IQG_NAME_RULES = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
