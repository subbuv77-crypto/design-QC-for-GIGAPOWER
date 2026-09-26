---
name: "gigapower-lld-planner"
description: "Plan a Gigapower PSA LLD (drop clusters, FSTs, PFP location, fiber path, closures, counts, coils, slack, QC) from an IQGeo support-route GeoPackage."
---

# Gigapower LLD Planner

Turns an IQGeo design export (.gpkg) that holds the **support route** into a planned PSA LLD. The support route is aerial and UG routes, poles, HH/FP structures and addresses, plus an optional PSA polygon and BBF feeder cable. The plan follows the Gigapower Fiber Design Guidelines v17, the IQGeo Equipment Naming standard and the user's design rules listed below.

## When to use
- The user gives a support-route .gpkg (oh_route / ug_route / pole / manhole / address) and asks for drop clusters, FST placement, fiber path, PFP location, or a full LLD plan for a Gigapower PSA.
- The user asks to re-plan or check an existing PSA against guideline rules.

## Inputs the engine reads (IQGeo layer names)
| Layer | Use |
|---|---|
| address | CLs; uses gc_classification / bain_use, a_address, unit |
| pole, manhole (usage hh/fp), pedestal, mywcom_route_junction | structures |
| oh_route, ug_route | route graph, **existing routes only** (in_structure/out_structure, else endpoint snapping <=10 ft to the same structure). Gaps are never stitched and no new paths are proposed |
| design (project_type = PSA) | PSA boundary. Pass --psa <code> |
| fiber_cable (network_layer = Feeder, >=144F) | BBF for PFP siting |
| `--roads` shapefile (.zip or .shp, lon/lat, e.g. TIGER tl_2025_<county>_roads.zip) | **preferred** street centerlines for the drop / street-side rules. MTFCC S1100/S1200/S1400/S1630/S1640 are streets; alleys (S1730), private roads, parking lots, trails and paths are not |
| street_centerline / centerline / streets / street / roads / road / osm (optional lines in the .gpkg) | street centerlines when no `--roads` file is given. If neither exists, they are estimated from addresses |

Poles that aren't on an oh_route are treated as drop poles (2nd span).

## Procedure
1. Copy the upload to the working dir (uploads are read-only). List layers and counts with sqlite3 (or python sqlite3 if the CLI is missing). If the user gives a roads shapefile / zip, always pass it with `--roads`. GDAL/geopandas may be unavailable; the engine needs only numpy, pandas, scipy, networkx, matplotlib and openpyxl.
2. Write the engine at the bottom of this file to `gp_lld_planner.py` verbatim and run it:
   - Default: `python3 gp_lld_planner.py input.gpkg --psa <PSA> --out out`
   - Allow 8-port FSTs (needs approval): add `--max-ports 8`
   - Real street centerlines: `--roads tl_2025_35001_roads.zip` (classes via `--road-classes`)
   - Force the PFP: `--pfp-structure pole/<id>` (find the id from the pole name / owner_pole_number, e.g. F15A390)
   - Approved rear-easement splice point (repeatable): `--approve-rear-splice pole/<id>`
   - Other options: `--aop-loop-ft`, `--max-tail-4` (1250), `--max-tail-6` (800), `--max-cables-per-closure` (8), `--row-ft` (60), `--max-strand-cross` (2), `--bbf-radius-ft`, `--design-drop-ft`, `--aerial-drop-ft`, `--ug-drop-ft`, `--max-span-ft`, `--max-fst-per-closure`
3. Review the log and `<psa>_LLD_map.png`. The grey lines are the street centerlines used.
4. Verify the hard rules in the report:
   - Splice Closures sheet: `cables` <= 8, and `street_side` True.
   - FST Schedule: `tail_ft` <= 1250 (4-port) or <= 800 (6/8/12-port).
   - Drops sheet: `strands_crossed` <= 2, and `crosses_street` = 1 only where `route_side` = street.
   - FST Schedule: HH / FP terminals used wherever a UG route serves the houses (`housing_type`). INFO "pole FST although UG structure(s) ... reach" means the nearby HH terminals are full (6 ports); report them.
   - QC: no "rear-easement drop cluster crosses street" errors.
5. Work through the QC sheet:
   - ERROR: fix inputs / params and re-run.
   - ERROR "route island ... no existing OH/UG route to PFP": the support route is split. Report each island (structure count, buildings, nearest gap from the WARN "route component not connected"). The fix is new support route in IQGeo. Never bridge gaps, add proposed spans or stitch routes in the planner or in a wrapper.
   - ERROR "splice closure has N cables (> 8)" on a strand that is all rear-easement poles: tell the user, pick an existing rear pole mid-strand that clears the overload with the least cable, and re-run with `--approve-rear-splice pole/<id>` (flagged APPROVAL). Rear splice approval gives splice access only; drops from that pole still may not cross a street.
   - APPROVAL (8-port): list for the Gigapower engineer.
   - WARN "splice closure not on street side": no ROW structure is within tail reach, or all reachable ROW splices are at 8 cables. Report each one to the user with its FSTs, the nearest ROW structure and its route distance. The fix is a new ROW pole/HH near the block, or approval of the rear splice.
6. If the user reports a cluster crossing a street, check `plan_street_centerline` there. If the centerlines were estimated, ask for a roads shapefile (TIGER county roads zip) and re-run with `--roads`. When a roads file is given, compare: re-check the estimated-centerline plan's drops against the real roads and report how many rear-route drops would have crossed a real street.
7. If a finished design exists for the same PSA, compare: PFP offset, FST count, cluster ARI, FST-on-same-structure %, cable ft, closures.
8. Deliver the gpkg, xlsx, kml and png, with a short summary: PFP, FSTs, CL served / coiled, F2 counts, cable by spec, terminals, closures and open QC. The Summary sheet has ready-to-paste WHAT / WHERE text.

## Rules encoded
- **Paths: existing routes only.** Distribution cable, FST tails and PFP reach use only existing oh_route / ug_route segments. Route islands are never stitched or bridged. FSTs on an island with no existing route to the PFP are removed and their buildings reported unserved (route island). Unforced PFP selection heavily penalises unreachable FSTs.
- **Splice closure access:** splices go only at street-side / ROW structures:
  - a pole within `row_ft` (60') of a street centerline or 100' of the BBF arterial
  - an HH / pedestal on a UG route
  - A splice may sit off the direct cable path; its tail then doubles back along the strand.
  - If no ROW structure can reach an FST within its tail limit, the nearest reachable splice is used and flagged WARN.
  - Rear branch points are not spliced. Each splice is fed by its own cable from the upstream splice (or the PFP), overlashed where routes are shared.
- **Splice closure size:** max 8 cables = 1 incoming + one per downstream splice + FST tails. Overloads are fixed by:
  1. Re-homing the longest tail to a closure with a free port within reach.
  2. Otherwise, opening a new ROW splice downstream that picks up 2 or more tails.
- **FST tail:** <= 1250' for 4-port and <= 800' for 6/8/12-port. Tail = route length + 15', rounded to 25 / 100 / 200 / 300 / 500 / 800 / 1000 / 1250. Spec EVOLV<ports><tail>RAW.
- **Drops:**
  - No drop crosses more than 2 aerial strands. That counts the drop wire and, for an off-strand drop pole, the FST->drop-pole span.
  - **Street crossing depends on the route side.** A drop may cross the street only when it leaves a street-side / ROW route structure (for an off-strand drop pole, the feeding strand pole must be street side too). A drop from a rear-easement route never crosses a street; that is checked on the drop itself, the FST->house line and the FST->drop-pole span. The Drops sheet shows `route_side` and `crosses_street`.
  - Street centerlines come from the `--roads` shapefile (preferred), a street layer in the .gpkg, or are estimated from where each house fronts: toward the same-street house across the road, or away from the rear-easement strand / beyond the front UG route. Chained per street (MST).
  - Aerial drop <=2 spans. Buried FP chain <=3 hops / 350'.
  - Design limit is 400' FST->CL. Hard rule is 1000'.
- **Clustering:**
  - **HH first.** Where a UG route is available the terminal goes in the HH / ped / FP on it, with buried drops. Phase 1 fills UG-structure FSTs, phase 2 serves the remaining buildings from poles. Buildings on an HH terminal are never moved to a pole FST, and HH terminals are never dissolved.
  - Capacitated greedy that serves the hardest-to-reach houses first, plus a mop-up pass (free port, swap, or new FST).
  - Whole buildings per FST, and <=6 ports. 8 needs approval.
- **Serve / coil:**
  - Drop-fed: SFU, SFU-like 2-4 and standalone BCL.
  - Coil SFU-like 5-12 at 1:1.
  - Coil MDU <=1000' and BCL complex <=500' at 1:1 up to 50 CL, then 5-6 / 12 / 18 strands.
  - Coils are placed at ROW cable nodes.
  - PR/GC is not counted.
- **Cable:** F2 is 1:1, sized to the next of 48 / 72 / 144 / 288 / 432 / 864. Counts are assigned DFS. Named "PON<house#><street initials>, lo-hi".
- **PFP:**
  - Ground-mounted HH / ped / junction within the BBF radius.
  - Minimizes 12*cable + 0.08*fiber-ft + 30*lateral.
  - Cabinet is 288 / 432 / 864. Splitter ports come from the CLs-minus-MDUs table.
- **Slack:**
  - Aerial: 100' per 1000'.
  - Buried: 50' at pass-through HH.
  - Closures: 25' (aerial) or 50' (buried).
  - Coils: 50'.
- **Names:** FST "<F|R|S|O> <ADDR>" (dash for duplicates), PFP "<dir> <ADDR> PFP", "POLE / HH / FP / PED <dir> <ADDR>" when unnamed.

## Outputs
- `<psa>_LLD_plan.gpkg` layers:
  - plan_pfp, plan_pfp_candidates, plan_fst, plan_drop_cluster
  - plan_drop_route (strands_crossed, route_side, crosses_street), plan_fst_tail, plan_distribution_cable
  - plan_splice_closure (cables, street_side, dist_to_street_ft), plan_coil, plan_slack
  - plan_address_assignment, plan_structure_names, plan_street_centerline, plan_psa_boundary
- `<psa>_LLD_report.xlsx`, `<psa>_LLD_plan.kml`, `<psa>_LLD_map.png`

## Calibration reference (PSA-1002PA, ALBQNMME, 179 LU)
Tested on the bare support route, with the default rules:
- PFP within 47' of the designer's cabinet
- 37 FSTs (same as the designer), and all 179 designer CLs served
- 11 closures, max 8 cables each; 8 are ROW and 3 are flagged
- All drops cross <=1 strand
- No drop cluster crossing a street (original rule; street-side crossings are now allowed)
- No tail over its limit

PSA-3005PA with TIGER roads + HH first (design_20260924_165124, PFP F15A390): 133 FSTs (16 HH, 2 FP, 115 pole; estimated-centerline run had 7 HH), 652 CL drop-fed, 95 street-side drops cross a street, 0 rear drops cross; the estimated-centerline plan had 9 rear-route drops crossing a real street.

PSA-3005PA (ALBQNMMA, PFP forced at F15A390, existing routes only, 1 approved rear splice): 95 FSTs, 463 CL drop-fed, 3 route islands (174 buildings) reported unserved, 26 street-side drops cross the street, 0 rear drops cross, max 8 cables per closure.

Treat the output as a planning draft. Field verification, pole loading, make-ready and permitting stay with the designer.

## Engine (write verbatim to gp_lld_planner.py)
```python
#!/usr/bin/env python3
"""
Gigapower PSA Low-Level-Design planner (IQGeo GeoPackage in -> planned LLD out)
Input : IQGeo design export (.gpkg) with the SUPPORT ROUTE: address, pole, manhole (hh/fp),
        [pedestal], oh_route, ug_route; optional design (PSA polygon), fiber_cable (Feeder/BBF),
        mywcom_route_junction, street centerline layer.
Output: <out>/<psa>_LLD_plan.gpkg, _LLD_plan.kml, _LLD_report.xlsx, _LLD_map.png
Rules: splice closures only on street side / ROW; max 8 cables per splice closure (in + out + FST tails);
       FST tail <= 1250 ft (4-port), <= 800 ft (6/8/12-port); drop clusters never cross a street;
       drops cross <= 2 strands; Gigapower Fiber Design Guidelines v17; IQGeo equipment naming.
Only numpy / pandas / scipy / networkx / matplotlib / openpyxl are required (no GDAL).
"""
import argparse, json, math, os, re, sqlite3, struct, sys
from collections import defaultdict, Counter
import numpy as np, pandas as pd, networkx as nx
from scipy.spatial import cKDTree, ConvexHull

# ----------------------------------------------------------------- GPKG I/O
def _wkb(b, o=0):
    bo = '<' if b[o] == 1 else '>'; o += 1
    t, = struct.unpack(bo + 'I', b[o:o + 4]); o += 4
    code = t & 0x0FFFFFFF; base = code % 1000; fam = code // 1000
    dim = 2 + (1 if (t & 0x80000000 or fam in (1, 3)) else 0) + (1 if (t & 0x40000000 or fam in (2, 3)) else 0)
    def pts(o):
        n, = struct.unpack(bo + 'I', b[o:o + 4]); o += 4
        a = np.frombuffer(b[o:o + 8 * dim * n], dtype=bo + 'f8').reshape(n, dim)[:, :2]
        return a.copy(), o + 8 * dim * n
    if base == 1:
        return ('Point', np.frombuffer(b[o:o + 8 * dim], dtype=bo + 'f8')[:2].copy()), o + 8 * dim
    if base == 2:
        a, o = pts(o); return ('LineString', a), o
    if base == 3:
        n, = struct.unpack(bo + 'I', b[o:o + 4]); o += 4; rings = []
        for _ in range(n):
            a, o = pts(o); rings.append(a)
        return ('Polygon', rings), o
    if base in (4, 5, 6, 7):
        n, = struct.unpack(bo + 'I', b[o:o + 4]); o += 4; parts = []
        for _ in range(n):
            g, o = _wkb(b, o); parts.append(g)
        return ({4: 'MultiPoint', 5: 'MultiLineString', 6: 'MultiPolygon', 7: 'GeometryCollection'}[base], parts), o
    raise ValueError('wkb type %s' % t)

def parse_geom(b):
    if b is None: return None
    b = bytes(b)
    if b[:2] != b'GP': return _wkb(b)[0]
    flags = b[3]; env = (flags >> 1) & 7
    if (flags >> 4) & 1: return None
    return _wkb(b, 8 + {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[env])[0]

def read_layer(con, layer):
    if not con.execute("select 1 from sqlite_master where name=?", (layer,)).fetchone():
        return pd.DataFrame(columns=['geom'])
    g = con.execute("select column_name from gpkg_geometry_columns where table_name=?", (layer,)).fetchone()
    df = pd.read_sql(f'select * from "{layer}"', con)
    if g:
        geo = df[g[0]].apply(parse_geom); df = df.drop(columns=[g[0]]); df['geom'] = geo
    else:
        df['geom'] = None
    return df

def lines_of(g):
    if g is None: return []
    if g[0] == 'LineString': return [g[1]]
    if g[0] == 'MultiLineString': return [p[1] for p in g[1]]
    return []

STREET_MTFCC = ('S1100', 'S1200', 'S1400', 'S1630', 'S1640')   # TIGER: primary, secondary, local, ramp, service drive

def read_shp_lines(path):
    """Minimal ESRI shapefile reader (PolyLine / PolyLineZ / PolyLineM + DBF attributes), no GDAL / pyshp.
    path: .shp or a .zip holding one. Coordinates must be geographic lon/lat (TIGER NAD83 is fine).
    Returns list of (attrs dict, [np.array(n,2) parts])."""
    import zipfile, io
    if path.lower().endswith('.zip'):
        z = zipfile.ZipFile(path); names = z.namelist()
        base = next(n[:-4] for n in names if n.lower().endswith('.shp'))
        shp = z.read(base + '.shp'); dbf = z.read(base + '.dbf')
        prj = z.read(base + '.prj').decode('latin1') if base + '.prj' in names else ''
    else:
        base = path[:-4]; shp = open(base + '.shp', 'rb').read(); dbf = open(base + '.dbf', 'rb').read()
        prj = open(base + '.prj').read() if os.path.exists(base + '.prj') else ''
    if prj.strip().upper().startswith('PROJCS'):
        raise SystemExit('roads shapefile is projected - reproject to geographic lon/lat (EPSG:4269/4326) first')
    n, hl, rl = struct.unpack('<xxxxIHH', dbf[:12]); fields = []; o = 32
    while dbf[o] != 0x0D:
        fields.append((dbf[o:o + 11].split(b'\0')[0].decode(), dbf[o + 16])); o += 32
    recs = []
    for i in range(n):
        r = dbf[hl + i * rl: hl + (i + 1) * rl]; p = 1; d = {}
        for nm, ln in fields: d[nm] = r[p:p + ln].decode('latin1').strip(); p += ln
        recs.append(d)
    out = []; o = 100; i = 0
    while o < len(shp):
        clen = struct.unpack('>i', shp[o + 4:o + 8])[0] * 2; c = shp[o + 8:o + 8 + clen]; o += 8 + clen
        st = struct.unpack('<i', c[:4])[0]
        if st in (3, 13, 23):
            npart, npt = struct.unpack('<ii', c[36:44])
            parts = list(struct.unpack('<%di' % npart, c[44:44 + 4 * npart])) + [npt]
            xy = np.frombuffer(c[44 + 4 * npart:44 + 4 * npart + 16 * npt], dtype='<f8').reshape(npt, 2)
            out.append((recs[i] if i < len(recs) else {}, [xy[parts[k]:parts[k + 1]].copy() for k in range(npart)]))
        i += 1
    return out

class GpkgWriter:
    """Minimal GeoPackage writer (EPSG:4326, 2D geometries)."""
    def __init__(self, path):
        if os.path.exists(path): os.remove(path)
        self.c = sqlite3.connect(path); c = self.c
        c.execute("PRAGMA application_id=1196444487"); c.execute("PRAGMA user_version=10300")
        c.execute("CREATE TABLE gpkg_spatial_ref_sys(srs_name TEXT NOT NULL,srs_id INTEGER PRIMARY KEY,organization TEXT NOT NULL,organization_coordsys_id INTEGER NOT NULL,definition TEXT NOT NULL,description TEXT)")
        c.executemany("INSERT INTO gpkg_spatial_ref_sys VALUES(?,?,?,?,?,?)", [
            ('Undefined cartesian SRS', -1, 'NONE', -1, 'undefined', None),
            ('Undefined geographic SRS', 0, 'NONE', 0, 'undefined', None),
            ('WGS 84 geodetic', 4326, 'EPSG', 4326, 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]', None)])
        c.execute("CREATE TABLE gpkg_contents(table_name TEXT NOT NULL PRIMARY KEY,data_type TEXT NOT NULL,identifier TEXT UNIQUE,description TEXT DEFAULT '',last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),min_x DOUBLE,min_y DOUBLE,max_x DOUBLE,max_y DOUBLE,srs_id INTEGER)")
        c.execute("CREATE TABLE gpkg_geometry_columns(table_name TEXT NOT NULL,column_name TEXT NOT NULL,geometry_type_name TEXT NOT NULL,srs_id INTEGER NOT NULL,z TINYINT NOT NULL,m TINYINT NOT NULL,CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name))")
    @staticmethod
    def _enc(gtype, coords):
        def ring(a): return struct.pack('<I', len(a)) + np.asarray(a, dtype='<f8').tobytes()
        if gtype == 'Point':
            w = struct.pack('<BI', 1, 1) + np.asarray(coords, dtype='<f8').tobytes(); env = b''; fl = 0b00000001
        else:
            a = np.asarray(coords if gtype == 'LineString' else coords[0])
            env = struct.pack('<4d', a[:, 0].min(), a[:, 0].max(), a[:, 1].min(), a[:, 1].max()); fl = 0b00000011
            if gtype == 'LineString': w = struct.pack('<BI', 1, 2) + ring(coords)
            else: w = struct.pack('<BII', 1, 3, len(coords)) + b''.join(ring(r) for r in coords)
        return b'GP' + bytes([0, fl]) + struct.pack('<i', 4326) + env + w
    def add(self, name, gtype, rows, desc=''):
        """rows: list of (geom_coords, dict)"""
        if not rows: return
        cols = []
        for _, d in rows:
            for k in d:
                if k not in cols: cols.append(k)
        def sqlt(k):
            vals = [d.get(k) for _, d in rows if d.get(k) is not None]
            if vals and all(isinstance(v, (int, np.integer, bool)) for v in vals): return 'INTEGER'
            if vals and all(isinstance(v, (int, float, np.integer, np.floating)) for v in vals): return 'REAL'
            return 'TEXT'
        c = self.c
        c.execute(f'CREATE TABLE "{name}"(fid INTEGER PRIMARY KEY AUTOINCREMENT, geom {gtype.upper()}' +
                  ''.join(f', "{k}" {sqlt(k)}' for k in cols) + ')')
        allxy = []
        for g, d in rows:
            blob = self._enc(gtype, g)
            vals = []
            for k in cols:
                v = d.get(k)
                if isinstance(v, (np.integer,)): v = int(v)
                elif isinstance(v, (np.floating,)): v = float(v)
                elif isinstance(v, (list, dict)): v = json.dumps(v)
                vals.append(v)
            c.execute(f'INSERT INTO "{name}"(geom' + ''.join(f',"{k}"' for k in cols) + ') VALUES(?' + ',?' * len(cols) + ')', [blob] + vals)
            a = np.atleast_2d(np.asarray(g if gtype != 'Polygon' else g[0])); allxy.append(a)
        a = np.vstack(allxy)
        c.execute("INSERT INTO gpkg_contents(table_name,data_type,identifier,description,min_x,min_y,max_x,max_y,srs_id) VALUES(?,?,?,?,?,?,?,?,4326)",
                  (name, 'features', name, desc, a[:, 0].min(), a[:, 1].min(), a[:, 0].max(), a[:, 1].max()))
        c.execute("INSERT INTO gpkg_geometry_columns VALUES(?,?,?,4326,0,0)", (name, 'geom', gtype.upper()))
    def close(self):
        self.c.commit(); self.c.close()

# ----------------------------------------------------------------- projection
R_FT = 20925646.3
class Proj:
    def __init__(self, lon0, lat0):
        self.lon0, self.lat0 = lon0, lat0; self.k = math.cos(math.radians(lat0))
    def fwd(self, ll):
        ll = np.asarray(ll, dtype=float)
        x = np.radians(ll[..., 0] - self.lon0) * R_FT * self.k; y = np.radians(ll[..., 1] - self.lat0) * R_FT
        return np.stack([x, y], -1)
    def inv(self, xy):
        xy = np.asarray(xy, dtype=float)
        lon = self.lon0 + np.degrees(xy[..., 0] / (R_FT * self.k)); lat = self.lat0 + np.degrees(xy[..., 1] / R_FT)
        return np.stack([lon, lat], -1)

def plen(a): return float(np.sum(np.hypot(*np.diff(a, axis=0).T))) if len(a) > 1 else 0.0

def pt_seg_dist(p, a, b):
    ab = b - a; t = np.clip(np.dot(p - a, ab) / max(np.dot(ab, ab), 1e-9), 0, 1)
    return float(np.hypot(*(a + t * ab - p)))

def dist_to_lines(p, lines):
    best = 1e18
    for L in lines:
        for i in range(len(L) - 1):
            best = min(best, pt_seg_dist(p, L[i], L[i + 1]))
    return best

# ----------------------------------------------------------------- config
STD_TAILS = [25, 100, 200, 300, 500, 800, 1000, 1250]
TAIL_ALLOW = 15   # ft riser / slack allowance added to the closure->FST route length
STD_CABLES = [(48, '5BQ2MT-048'), (72, '5BQ2MT-072'), (144, '5BQ2MT-144'), (288, '5BQ2MR-288'),
              (432, '5BQ2MR-432'), (864, '5BQ2MR-864')]
SUFFIX_ABBR = {'AVENUE': 'AVE', 'STREET': 'ST', 'DRIVE': 'DR', 'COURT': 'CT', 'PLACE': 'PL', 'BOULEVARD': 'BLVD',
               'ROAD': 'RD', 'LANE': 'LN', 'CIRCLE': 'CIR', 'PARKWAY': 'PKWY', 'TERRACE': 'TER', 'WAY': 'WAY'}

def cable_for(n):
    for c, s in STD_CABLES:
        if n <= c: return c, s
    return STD_CABLES[-1]

def fst_ports(n):
    for p in (4, 6, 8, 12):
        if n <= p: return p
    return n

def std_tail(L):
    for t in STD_TAILS:
        if L <= t: return t
    return int(math.ceil(L / 100.0) * 100)

def mdu_coil_fibers(n, bcl=False):
    if n <= 50: return n
    if n <= 132: return 6 if bcl else 5
    if n <= 408: return 12
    return 18

def splitter_ports(cl_minus_mdu):
    if cl_minus_mdu <= 100: return 64
    if cl_minus_mdu <= 250: return 128
    if cl_minus_mdu <= 450: return 192
    return 256

# ----------------------------------------------------------------- planner
class Planner:
    def __init__(self, gpkg, psa=None, max_ports=6, max_tail_4=1250, max_tail_6=800, max_cables_per_closure=8, max_fst_per_closure=6,
                 row_ft=60, max_strand_cross=2,
                 aerial_drop_ft=200, ug_drop_ft=150, max_span_ft=300, design_drop_ft=400, pfp_structure=None,
                 bbf_radius_ft=400, aop_loop_ft=None, approve_rear=(), roads=None, road_classes=STREET_MTFCC, log=print):
        self.log = log; self.src = gpkg
        self.p = dict(max_ports=max_ports, max_tail_4=max_tail_4, max_tail_6=max_tail_6,
                      max_cables_per_closure=max_cables_per_closure, max_fst_per_closure=max_fst_per_closure,
                      row_ft=row_ft, max_strand_cross=max_strand_cross,
                      aerial_drop_ft=aerial_drop_ft, ug_drop_ft=ug_drop_ft, max_span_ft=max_span_ft, design_drop_ft=design_drop_ft,
                      bbf_radius_ft=bbf_radius_ft, aop_loop_ft=aop_loop_ft)
        self.pfp_structure = pfp_structure; self.psa = psa; self.approve_rear = list(approve_rear or [])
        self.roads = roads; self.road_classes = tuple(road_classes or ())
        self.con = sqlite3.connect(f'file:{gpkg}?mode=ro', uri=True)
        self.qc = []  # (severity, item, message)

    # ---------- load
    def load(self):
        con = self.con; L = {k: read_layer(con, k) for k in
             ['address', 'pole', 'manhole', 'pedestal', 'oh_route', 'ug_route', 'design', 'fiber_cable',
              'mywcom_route_junction', 'ug_transition_location']}
        self.L = L
        self.boundary = None; psa_name = self.psa
        d = L['design']
        if len(d) and 'project_type' in d:
            cand = d[d.project_type.astype(str).str.upper() == 'PSA']
            if self.psa:
                cand = cand[cand['name'].astype(str).str.contains(self.psa) | cand.get('psa_cd', pd.Series(dtype=str)).astype(str).eq(self.psa)]
            if len(cand):
                r = cand.iloc[0]; self.boundary = r.geom[1][0] if r.geom[0] == 'Polygon' else r.geom[1][0][1][0]
                psa_name = str(r.get('psa_cd') or r['name'])
                self.design_row = r
        self.psa = psa_name or 'PSA'
        allpts = [g[1] for g in L['address'].geom if g] + [g[1] for g in L['pole'].geom if g]
        c = np.mean(allpts, axis=0); self.P = Proj(c[0], c[1])
        S = {}
        def addS(layer, df, typ_fn):
            for _, r in df.iterrows():
                if not r.geom or r.geom[0] != 'Point': continue
                key = f"{layer}/{r['id']}"
                S[key] = dict(key=key, layer=layer, type=typ_fn(r), ll=r.geom[1], xy=self.P.fwd(r.geom[1]),
                              name=(r.get('name') if isinstance(r.get('name'), str) else None),
                              owner=r.get('owner') if isinstance(r.get('owner'), str) else None,
                              spec=r.get('specification') if isinstance(r.get('specification'), str) else None)
        addS('pole', L['pole'], lambda r: 'pole')
        addS('manhole', L['manhole'], lambda r: ('fp' if str(r.get('usage')).lower() == 'fp' or str(r.get('name', '')).upper().startswith('FP ') else 'hh'))
        addS('pedestal', L['pedestal'], lambda r: 'ped')
        addS('mywcom_route_junction', L['mywcom_route_junction'], lambda r: 'junction')
        addS('ug_transition_location', L['ug_transition_location'], lambda r: 'junction')
        self.S = S
        self.log(f"structures: {Counter(s['type'] for s in S.values())}")
        self._build_graph()
        self._load_bbf()
        self._load_addresses()
        self._street_centerlines()
        self._access_and_strands()

    def _access_and_strands(self):
        """street_side[k]: structure is in the street ROW (accessible for splicing):
        pole within row_ft of a street centerline or of the BBF arterial; HH / pedestal on a UG route.
        OH strand segments are kept to count strand crossings of drops."""
        S, G, p = self.S, self.G, self.p
        def dline(pt, segs):
            return min((pt_seg_dist(pt, a, b) for a, b in segs), default=1e9)
        self.dist_street = {}; self.street_side = {}; self.splice_ok_rear = set()
        ug_nodes = {n for u, v, d in G.edges(data=True) if d['rt'] == 'UG' for n in (u, v)}
        for k, st in S.items():
            if st['type'] not in ('pole', 'hh', 'ped', 'fp'): continue
            ds = dline(st['xy'], self.street_segs); self.dist_street[k] = ds
            db = dist_to_lines(st['xy'], self.bbf) if self.bbf else 1e9
            if st['type'] == 'pole': ok = ds <= p['row_ft'] or db <= 100
            elif st['type'] in ('hh', 'ped'): ok = k in ug_nodes or ds <= p['row_ft'] or db <= 100
            else: ok = False
            self.street_side[k] = ok
        segs = []
        for u, v, d in G.edges(data=True):
            if d['rt'] == 'OH':
                a = self.P.fwd(d['ll']); segs += [(a[i], a[i + 1]) for i in range(len(a) - 1)]
        self.oh_segs = np.array(segs) if segs else np.zeros((0, 2, 2))
        for k in self.approve_rear:      # engineer-approved rear-easement splice points (splice access only)
            if k in S:
                self.splice_ok_rear.add(k)
                self.qc.append(('APPROVAL', S[k]['name'] or k, 'rear-easement splice closure location approved by user - confirm access with Gigapower'))
        self.log(f"street-side / ROW structures: {sum(self.street_side.values())} of {len(self.street_side)}")

    def strand_crossings(self, a, b):
        """number of aerial strand (oh_route) segments crossed by segment a-b"""
        S = self.oh_segs
        if not len(S): return 0
        p, r = a, b - a; q = S[:, 0]; t = S[:, 1] - S[:, 0]
        rxs = r[0] * t[:, 1] - r[1] * t[:, 0]; qp = q - p
        with np.errstate(divide='ignore', invalid='ignore'):
            tt = (qp[:, 0] * t[:, 1] - qp[:, 1] * t[:, 0]) / rxs
            uu = (qp[:, 0] * r[1] - qp[:, 1] * r[0]) / rxs
        return int(np.sum((np.abs(rxs) > 1e-9) & (tt > 0.02) & (tt < 0.98) & (uu > 0.01) & (uu < 0.99)))

    def _street_centerlines(self):
        """Street centerlines used to keep drop clusters on one side of the street.
        1) If the GeoPackage holds a street layer (osm / street(s) / road(s) / centerline) its lines are used.
        2) Otherwise they are estimated: each house gets a front vector - toward the same-street house
           across the road when one exists, else away from the nearest rear-easement strand pole
           (or toward the nearest UG route) - and a street point is placed in front of it.
           Street points are chained per street name with a minimum spanning tree."""
        from scipy.sparse.csgraph import minimum_spanning_tree
        segs = []; self.street_lines = defaultdict(list); self.street_src = 'estimated'
        if self.roads:      # user-supplied road centerlines (e.g. TIGER tl_YYYY_<county>_roads.zip) take priority
            allxy = np.array([s['xy'] for s in self.S.values()] + list(self.A.xy.values))
            lo, hi = allxy.min(0) - 1000, allxy.max(0) + 1000; kept = Counter(); skipped = Counter()
            for rec, parts in read_shp_lines(self.roads):
                cls = rec.get('MTFCC', '')
                for ln in parts:
                    a = self.P.fwd(ln)
                    if not np.any(np.all((a >= lo) & (a <= hi), axis=1)): continue
                    if self.road_classes and cls and cls not in self.road_classes: skipped[cls] += 1; continue
                    kept[cls] += 1
                    nm = rec.get('FULLNAME') or rec.get('NAME') or 'road'
                    for i in range(len(a) - 1): self.street_lines[nm].append((a[i], a[i + 1])); segs.append((a[i], a[i + 1]))
            self.street_src = 'roads:' + os.path.basename(self.roads)
            self.log(f"roads shapefile: kept {dict(kept)}; not streets (alley / private / parking / path) {dict(skipped)}")
        for lyr in ([] if segs else ('street_centerline', 'centerline', 'streets', 'street', 'roads', 'road', 'osm')):
            df = read_layer(self.con, lyr)
            if len(df) and df.geom.notna().any():
                for _, r in df.iterrows():
                    nm = str(r.get('name') or r.get('street') or lyr)
                    for ln in lines_of(r.geom):
                        a = self.P.fwd(ln)
                        for i in range(len(a) - 1): self.street_lines[nm].append((a[i], a[i + 1])); segs.append((a[i], a[i + 1]))
                if segs:
                    self.street_src = lyr; break
        if not segs:
            A = self.A.drop_duplicates('bkey'); S = self.S; G = self.G
            strand = np.array([S[k]['xy'] for k in G if S[k]['type'] == 'pole']) if len(G) else np.zeros((0, 2))
            ugn = [n for u, v, d in G.edges(data=True) if d['rt'] == 'UG' for n in (u, v)]
            ugxy = np.array([S[k]['xy'] for k in set(ugn)]) if ugn else np.zeros((0, 2))
            stree = cKDTree(strand) if len(strand) else None; utree = cKDTree(ugxy) if len(ugxy) else None
            pts = defaultdict(list); self.front = {}
            for st, g in A.groupby('street'):
                P = np.vstack(g.xy.values); keys = list(g.bkey)
                for i, h in enumerate(P):
                    d = np.hypot(*(P - h).T); near = P[(d < 300) & (d > 0)]
                    if len(near) < 2: continue
                    _, _, vt = np.linalg.svd(np.vstack([near, h]) - np.vstack([near, h]).mean(0)); along = vt[0]
                    n = np.array([-along[1], along[0]])
                    v = P - h; ok = (d > 50) & (d < 300) & (np.abs(v @ along) < 0.5 * np.maximum(d, 1))
                    if ok.any():
                        j = np.where(ok)[0][np.argmin(d[ok])]; f = (P[j] - h) / d[j]; half = d[j] / 2
                    else:
                        sgn = 0
                        if stree is not None:
                            dd, k = stree.query(h)
                            if dd < 250: sgn = -np.sign((strand[k] - h) @ n)      # strand pole = rear easement
                        if sgn == 0 and utree is not None:
                            dd, k = utree.query(h)
                            if dd < 150: sgn = np.sign((ugxy[k] - h) @ n)         # UG route = street ROW
                        if sgn == 0: continue
                        f = n * sgn; half = 45.0
                        if utree is not None:        # one-sided street: street lies beyond any front UG (ROW) route
                            for k in utree.query_ball_point(h, 150):
                                w = ugxy[k] - h; pr = w @ f
                                if 0 < pr < 150 and abs(w @ along) < 100: half = max(half, pr + 20)
                    self.front[keys[i]] = (f, half)
                    pts[st].append(h + f * min(max(half, 25), 170))
            for st, M in pts.items():
                M = np.unique(np.round(np.array(M), 1), axis=0)
                if len(M) < 2: continue
                D = np.hypot(*(M[:, None, :] - M[None, :, :]).transpose(2, 0, 1))
                T = minimum_spanning_tree(D).tocoo()
                for a_, b_, w in zip(T.row, T.col, T.data):
                    if w <= 250: self.street_lines[st].append((M[a_], M[b_])); segs.append((M[a_], M[b_]))
        self.street_segs = np.array(segs) if segs else np.zeros((0, 2, 2))
        self.log(f"street centerlines ({self.street_src}): {len(self.street_segs)} segments on {len(self.street_lines)} streets")

    def drop_may_cross(self, fst, d):
        """A drop may cross the street only when its route is on the street side / ROW:
        the drop structure is a street-side route structure, and for an off-strand drop pole
        the feeding strand pole (FST) is street side as well. Rear-easement drops never cross."""
        if not self.street_side.get(d, False): return False
        return d in self.G or self.street_side.get(fst, False)

    def crosses_street(self, a, b):
        """True if segment a-b (ft) properly intersects any street centerline segment."""
        S = self.street_segs
        if not len(S): return False
        p, r = a, b - a; q = S[:, 0]; t = S[:, 1] - S[:, 0]
        rxs = r[0] * t[:, 1] - r[1] * t[:, 0]
        qp = q - p
        with np.errstate(divide='ignore', invalid='ignore'):
            tt = (qp[:, 0] * t[:, 1] - qp[:, 1] * t[:, 0]) / rxs
            uu = (qp[:, 0] * r[1] - qp[:, 1] * r[0]) / rxs
        return bool(np.any((np.abs(rxs) > 1e-9) & (tt > 0.02) & (tt < 0.98) & (uu >= 0) & (uu <= 1)))

    def _build_graph(self):
        S = self.S; keys = list(S); xy = np.array([S[k]['xy'] for k in keys]); tree = cKDTree(xy)
        G = nx.Graph(); self.coord_nodes = {}
        def node_for(ref, pt_xy, pt_ll):
            if isinstance(ref, str) and ref in S: return ref
            d, i = tree.query(pt_xy)
            if d <= 10: return keys[i]
            for kk, v in self.coord_nodes.items():
                if np.hypot(*(v['xy'] - pt_xy)) < 3: return kk
            nk = f"vertex/{len(self.coord_nodes) + 1}"
            self.coord_nodes[nk] = dict(key=nk, layer='vertex', type='vertex', ll=pt_ll, xy=pt_xy, name=None, owner=None, spec=None)
            return nk
        for layer, rt in (('oh_route', 'OH'), ('ug_route', 'UG')):
            for _, r in self.L[layer].iterrows():
                for ln in lines_of(r.geom):
                    if len(ln) < 2: continue
                    a = self.P.fwd(ln); length = plen(a)
                    if length < 0.5: continue
                    u = node_for(r.get('in_structure'), a[0], ln[0]); v = node_for(r.get('out_structure'), a[-1], ln[-1])
                    if u == v: continue
                    uxy = (S.get(u) or self.coord_nodes[u])['xy']
                    if np.hypot(*(a[0] - uxy)) > np.hypot(*(a[-1] - uxy)): ln = ln[::-1]
                    if G.has_edge(u, v) and G[u][v]['len'] <= length: continue
                    G.add_edge(u, v, len=length, rt=rt, ll=ln, src=f"{layer}/{r.get('id')}",
                               bbf=str(r.get('design_id', '')).startswith('BBF'))
        self.S.update(self.coord_nodes)
        # EXISTING ROUTES ONLY: no stitched / proposed connections. Disconnected route islands are reported;
        # FSTs on an island the PFP cannot reach are removed from the plan (see _prune_unreachable).
        comps = sorted(nx.connected_components(G), key=len, reverse=True)
        main = set(comps[0]) if comps else set()
        for comp in comps[1:]:
            best = min(((np.hypot(*(self.S[u]['xy'] - self.S[v]['xy'])), u, v) for u in comp for v in main), default=None)
            gap = f' - nearest main-network structure {best[2]} is {best[0]:.0f} ft from {best[1]}' if best else ''
            self.qc.append(('WARN', f'route island ({len(comp)} nodes)', 'route component not connected to main network by existing OH/UG route' + gap))
        self.G = G
        self.log(f"route graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges, "
                 f"OH {sum(d['len'] for *_, d in G.edges(data=True) if d['rt']=='OH'):.0f} ft, "
                 f"UG {sum(d['len'] for *_, d in G.edges(data=True) if d['rt']=='UG'):.0f} ft")

    def _load_bbf(self):
        fc = self.L['fiber_cable']; lines = []
        if len(fc) and 'network_layer' in fc:
            f = fc[(fc.network_layer.astype(str) == 'Feeder') & (pd.to_numeric(fc.fiber_count, errors='coerce') >= 144)]
            for g in f.geom:
                for ln in lines_of(g): lines.append(self.P.fwd(ln))
        if not lines:
            for u, v, d in self.G.edges(data=True):
                if d['bbf']: lines.append(self.P.fwd(d['ll']))
        if lines:
            allxy = np.array([s['xy'] for s in self.S.values()])
            lo, hi = allxy.min(0) - 2000, allxy.max(0) + 2000
            clipped = []
            for ln in lines:
                m = np.all((ln >= lo) & (ln <= hi), axis=1)
                if m.sum() >= 2: clipped.append(ln[m])
            lines = clipped
        self.bbf = lines
        self.log(f"BBF/feeder polylines near PSA: {len(lines)}")

    def _load_addresses(self):
        A = self.L['address'].copy(); A = A[A.geom.notna()]
        if 'deleted' in A: A = A[A.deleted.isna() | (A.deleted.astype(str).isin(['0', 'nan', 'None', '', 'False']))]
        A['ll'] = A.geom.apply(lambda g: g[1]); A['xy'] = A.ll.apply(self.P.fwd)
        if self.boundary is not None:
            from matplotlib.path import Path
            inside = Path(self.boundary).contains_points(np.vstack(A.ll.values))
            A = A[inside]
        def cls(r):
            g = str(r.get('gc_classification') or '').strip().lower(); b = str(r.get('bain_use') or '').lower()
            if g in ('sfu',): return 'SFU'
            if g in ('sfu like', 'sfu_like', 'sfu_like_2_4'): return 'SFU_LIKE_2_4'
            if 'sfu_like_5_12' in g or g == 'sfu like 5-12': return 'SFU_LIKE_5_12'
            if g == 'mdu': return 'MDU'
            if g == 'bcl': return 'BCL'
            if g in ('prgc', 'pr', 'gc'): return 'PRGC'
            if 'res-sfu' in b: return 'SFU'
            if 'sfu-like' in b: return 'SFU_LIKE'
            if 'mdu' in b: return 'MDU'
            if 'business' in b or 'other' in b or 'shop' in b: return 'BCL'
            return 'SFU'
        A['cls'] = A.apply(cls, axis=1)
        A['bkey'] = A.ll.apply(lambda p: (round(p[0], 6), round(p[1], 6)))
        cnt = A.groupby('bkey').size(); A['units_at_pt'] = A.bkey.map(cnt)
        A.loc[A.cls == 'SFU_LIKE', 'cls'] = np.where(A.loc[A.cls == 'SFU_LIKE', 'units_at_pt'] <= 4, 'SFU_LIKE_2_4', 'SFU_LIKE_5_12')
        A['_akey'] = A.get('a_address', pd.Series(index=A.index, dtype=str)).astype(str).str.upper().str.replace(r'\s+(N|NE|NW|S|SE|SW|E|W)$', '', regex=True)
        bcl_n = A[A.cls == 'BCL'].groupby('_akey').size()
        A.loc[(A.cls == 'BCL') & (A._akey.map(bcl_n) == 1), 'cls'] = 'BCL_STANDALONE'
        A.loc[A.cls == 'BCL', 'cls'] = 'BCL_COMPLEX'
        def addr_text(r):
            no = str(r.get('a_saddno') or '').split('.')[0]
            parts = [no]
            full = str(r.get('a_address') or '')
            if full and full != 'None':
                s = full.upper()
                s = re.sub(r'\bN$', 'NE', s) if re.search(r'\bBLVD N$', s) else s
                return s
            for k in ('addr_street_direction', 'a_saddstr', 'a_saddsttyp', 'a_saddstsuf'):
                if r.get(k): parts.append(str(r.get(k)))
            return ' '.join(parts).upper()
        A['addr'] = A.apply(addr_text, axis=1)
        for k, v in SUFFIX_ABBR.items(): A['addr'] = A['addr'].str.replace(r'\b%s\b' % k, v, regex=True)
        A['street'] = A.addr.str.replace(r'^\S+\s+', '', regex=True)
        self.A = A.reset_index(drop=True)
        self.log(f"addresses in PSA: {len(A)} {dict(Counter(A.cls))}")

    # ---------- drops / FST clusters
    def plan_clusters(self):
        A, S, G, p = self.A, self.S, self.G, self.p
        served_cls = {'SFU', 'SFU_LIKE_2_4'}
        bld = A[A.cls.isin(served_cls | {'BCL_STANDALONE'})].groupby('bkey').agg(
            units=('id', 'size'), cls=('cls', 'first'), xy=('xy', 'first'), ll=('ll', 'first'),
            addr=('addr', 'first'), ids=('id', list)).reset_index()
        bld['bid'] = range(len(bld)); self.bld = bld
        # drop structures: structures on the route graph + off-strand poles (drop poles, 2nd span)
        onG = [k for k, s in S.items() if s['type'] in ('pole', 'hh', 'fp', 'ped') and k in G]
        offP = [k for k, s in S.items() if s['type'] == 'pole' and k not in G]
        dkeys = onG + offP
        dxy = np.array([S[k]['xy'] for k in dkeys]); dtree = cKDTree(dxy)
        fst_ok = {k for k in onG if S[k]['type'] in ('pole', 'hh', 'ped', 'fp')}
        gpoles = [k for k in onG if S[k]['type'] == 'pole']; gtree = cKDTree(np.array([S[k]['xy'] for k in gpoles]))
        self.sp = dict(nx.all_pairs_dijkstra_path_length(G, cutoff=max(1500, max(p['max_tail_4'], p['max_tail_6']) * 1.2), weight='len'))
        hop = dict(nx.all_pairs_shortest_path_length(G, cutoff=3))
        reach = defaultdict(dict)  # fst -> bid -> (total, drop_struct, droplen)
        def fst_options(d):
            st = S[d]['type']
            if d not in G:          # off-strand drop pole: one aerial drop span back to a strand pole
                return [(gpoles[i], float(np.hypot(*(S[gpoles[i]]['xy'] - S[d]['xy'])))) for i in gtree.query_ball_point(S[d]['xy'], p['max_span_ft'])]
            out = []
            for s_, pl in self.sp.get(d, {}).items():
                if s_ not in fst_ok: continue
                h = hop[d].get(s_, 99)
                if st == 'pole':
                    if S[s_]['type'] != 'pole' or h > 1: continue          # aerial drop <= 2 spans
                else:
                    if S[s_]['type'] == 'pole' and not (s_ == d or (G.has_edge(s_, d) and G[s_][d]['rt'] == 'UG')): continue
                    if h > 3 or pl > 350: continue                          # buried: FP chain back to FST HH
                    if S[s_]['type'] == 'fp' and s_ != d: continue
                out.append((s_, pl))
            return out
        fopt = {d: fst_options(d) for d in dkeys}
        for _, b in bld.iterrows():
            for i in dtree.query_ball_point(b.xy, max(p['aerial_drop_ft'], p['ug_drop_ft'])):
                d = dkeys[i]; st = S[d]['type']; dl = float(np.hypot(*(dxy[i] - b.xy)))
                if dl > (p['aerial_drop_ft'] if st == 'pole' else p['ug_drop_ft']): continue
                xs = self.crosses_street(dxy[i], b.xy)
                # street crossing: allowed only when the drop leaves a STREET-SIDE route structure;
                # a drop from a REAR-EASEMENT route never crosses a street
                if xs and not self.street_side.get(d, False): continue
                xd = self.strand_crossings(dxy[i], b.xy)
                if xd > p['max_strand_cross']: continue                  # drop may not cross > 2 strands
                for s_, pl in fopt[d]:
                    if d not in G and xd + self.strand_crossings(S[s_]['xy'], dxy[i]) > p['max_strand_cross']: continue
                    tot = pl + dl * 1.1
                    if tot > p['design_drop_ft']: continue
                    if not self.drop_may_cross(s_, d) and (xs or self.crosses_street(S[s_]['xy'], b.xy) or self.crosses_street(S[s_]['xy'], dxy[i])): continue  # rear-easement cluster stays on the FST's side of the street
                    cur = reach[s_].get(b.bid)
                    if cur is None or tot < cur[0]: reach[s_][b.bid] = (tot, d, dl)
        units = dict(zip(bld.bid, bld.units))
        cap = p['max_ports']
        unassigned = set(bld.bid)
        assign = {}; chosen = {}
        nopt = Counter(b for s_ in reach for b in reach[s_])      # how many FSTs can reach each building
        def take(s, pool):
            # buildings with the fewest FST options first, then nearest
            cand = [(d_, b) for d_, b in sorted([(reach[s][b][0], b) for b in reach[s] if b in pool], key=lambda x: (min(nopt[x[1]], 3), x[0]))]
            got, n = [], 0
            for dist, b in cand:
                if n + units[b] <= cap: got.append(b); n += units[b]
            return got, n
        # HH FIRST: where a UG route is available the terminal goes in the HH / ped / FP (buried drops);
        # phase 1 fills UG-structure FSTs, phase 2 serves the remaining buildings from poles or other structures.
        ugf = {s for s in reach if S[s]['type'] in ('hh', 'ped', 'fp')}; self.ug_fst = ugf
        for phase in (ugf, set(reach)):
            while True:
                best = None
                for s in phase:
                    if s in chosen: continue
                    got, n = take(s, unassigned)
                    if n == 0: continue
                    sc = n + sum(1.0 / nopt[b] for b in got) - 0.002 * sum(reach[s][b][0] for b in got) + (0.3 if S[s]['type'] == 'pole' else 0)
                    if best is None or sc > best[0]: best = (sc, s, got)
                if best is None: break
                _, s, got = best; chosen[s] = set(got)
                for b in got: assign[b] = s; unassigned.discard(b)
        # improvement: move buildings to closer chosen FST with room; dissolve weak FSTs
        def load(s): return sum(units[b] for b in chosen[s])
        for _ in range(4):
            moved = 0
            for b, s in list(assign.items()):
                cur = reach[s][b][0]
                for t in chosen:
                    if t != s and b in reach[t] and reach[t][b][0] < cur - 25 and load(t) + units[b] <= cap and not (s in ugf and t not in ugf):
                        chosen[s].discard(b); chosen[t].add(b); assign[b] = t; cur = reach[t][b][0]; s = t; moved += 1
            for s in sorted(chosen, key=load):
                if load(s) > 2 or not chosen[s] or s in ugf: continue      # never dissolve an HH terminal
                plan = {}; tmp = {t: load(t) for t in chosen if t != s}
                for b in chosen[s]:
                    opts = sorted([(reach[t][b][0], t) for t in tmp if b in reach[t] and tmp[t] + units[b] <= cap])
                    if not opts: plan = None; break
                    plan[b] = opts[0][1]; tmp[opts[0][1]] += units[b]
                if plan:
                    for b, t in plan.items(): chosen[t].add(b); assign[b] = t
                    chosen[s] = set(); moved += 1
            chosen = {s: v for s, v in chosen.items() if v}
            if not moved: break
        # mop-up: place any still-unassigned building (SFU first, then standalone BCL)
        #   1) chosen FST with a free port  2) free a port by moving one member to another FST with room
        #   3) open a new FST at the best unused candidate
        for b in sorted(set(bld.bid) - set(assign), key=lambda x: bld.cls[x] == 'BCL_STANDALONE'):
            if b in assign: continue
            opts = sorted([(reach[t][b][0], t) for t in chosen if b in reach[t] and load(t) + units[b] <= cap])
            if opts:
                chosen[opts[0][1]].add(b); assign[b] = opts[0][1]; continue
            done = False
            for _, t in sorted([(reach[t][b][0], t) for t in chosen if b in reach[t]]):
                for m in sorted(chosen[t], key=lambda x: -reach[t][x][0]):
                    alt = sorted([(reach[u][m][0], u) for u in chosen if u != t and m in reach[u] and load(u) + units[m] <= cap])
                    if alt and load(t) - units[m] + units[b] <= cap:
                        u = alt[0][1]; chosen[t].discard(m); chosen[u].add(m); assign[m] = u
                        chosen[t].add(b); assign[b] = t; done = True; break
                if done: break
            if done: continue
            pool = set(bld.bid) - set(assign)
            cands = [(s_, take(s_, pool)) for s_ in reach if s_ not in chosen and b in reach[s_]]
            cands = [(s_, g) for s_, (g, n) in cands if b in g]
            if cands:
                s_, g = max(cands, key=lambda x: sum(units[y] for y in x[1]))
                chosen[s_] = set(g)
                for y in g: assign[y] = s_
        self.reach, self.assign, self.fst_members = reach, assign, chosen
        un = []
        for _, b in bld.iterrows():
            if b.bid in assign: continue
            d, i = dtree.query(b.xy)
            reason = ('>1000 ft from support route - No Build: exceeds 1kft drop rule' if d > 1000
                      else f'no FST within design drop reach ({p["design_drop_ft"]} ft) - add support route / review in field')
            un.append(dict(bid=b.bid, addr=b.addr, cls=b.cls, units=b.units, nearest_struct=dkeys[i], dist_ft=round(d), reason=reason))
            self.qc.append(('ERROR' if d <= 1000 else 'INFO', b.addr, reason))
        self.unserved = pd.DataFrame(un)
        self.log(f"FSTs: {len(chosen)}; served buildings {len(assign)}/{len(bld)}; units {sum(units[b] for b in assign)}")

    # ---------- directional naming
    def direction(self, s_xy, addr_row, stype):
        A = self.A; st = addr_row['street']; h = addr_row['xy']
        same = A[(A.street == st)]
        pts = np.vstack(same.xy.values)
        near = pts[np.hypot(*(pts - h).T) < 500]
        v = s_xy - h
        if len(near) >= 4:
            c = near.mean(0); u, sv, vt = np.linalg.svd(near - c); along = vt[0]; perp = np.array([-along[1], along[0]])
            off = (near - c) @ perp; hoff = (h - c) @ perp
            left, right = off[off < -20], off[off > 20]
            if len(left) and len(right):
                street_off = (np.median(left) + np.median(right)) / 2
                to_street = np.sign(street_off - hoff)
                perp_s = (v @ perp) * to_street; along_s = abs(v @ along)
                if perp_s > abs(street_off - hoff) + 10: return 'O'
                if along_s > abs(perp_s) * 1.2 and along_s > 25: return 'S'
                return 'F' if perp_s > 0 else 'R'
        return 'R' if stype == 'pole' else 'F'

    def name_features(self):
        A, S = self.A, self.S
        axy = np.vstack(A.xy.values); atree = cKDTree(axy)
        used = Counter(); self.fst_name = {}; self.struct_newname = {}
        def uniq(dirc, addr, suffix=''):
            base = f"{dirc} {addr}"
            nm = base + suffix
            if used[nm]:
                no, rest = addr.split(' ', 1); nm = f"{dirc} {no}-{used[base+suffix]+1} {rest}{suffix}"
            used[base + suffix] += 1
            return nm
        for s, mem in self.fst_members.items():
            bxy = np.vstack([self.bld.xy[b] for b in mem]); j = int(np.argmin(np.hypot(*(bxy - S[s]['xy']).T)))
            b = list(mem)[j]; row = A[A.bkey == self.bld.bkey[b]].iloc[0]
            dirc = self.direction(S[s]['xy'], row, S[s]['type'])
            self.fst_name[s] = uniq(dirc, row['addr'])
        for k, s in S.items():
            if s['type'] not in ('pole', 'hh', 'fp', 'ped') or s['name']: continue
            d, i = atree.query(s['xy']); row = A.iloc[i]
            dirc = self.direction(s['xy'], row, s['type'])
            pre = {'pole': 'POLE', 'hh': 'HH', 'fp': 'FP', 'ped': 'PED'}[s['type']]
            self.struct_newname[k] = f"{pre} {dirc} {row['addr']}"

    # ---------- PFP
    def plan_pfp(self):
        S, G, p = self.S, self.G, self.p
        fsts = list(self.fst_members); ports = {s: fst_ports(sum(self.bld.units[b] for b in self.fst_members[s])) for s in fsts}
        self.fst_ports = ports
        cands = [k for k in G if S[k]['type'] in ('hh', 'ped', 'junction', 'vertex')]
        if not cands: cands = [k for k in G if S[k]['type'] == 'pole']
        if self.pfp_structure:
            cands = [self.pfp_structure]
        rows = []
        for c in cands:
            bd = dist_to_lines(S[c]['xy'], self.bbf) if self.bbf else 0.0
            if self.bbf and bd > p['bbf_radius_ft'] and not self.pfp_structure: continue
            dist, paths = nx.single_source_dijkstra(G, c, weight='len')
            rf = [f for f in fsts if f in dist]            # FSTs reachable over EXISTING routes only
            if not rf: continue
            miss = sum(ports[f] for f in fsts if f not in dist)
            load = Counter(); edges = set()
            for f in rf:
                pth = paths[f]
                for u, v in zip(pth, pth[1:]):
                    e = tuple(sorted((u, v))); edges.add(e); load[e] += ports[f]
            cable_ft = sum(G[u][v]['len'] for u, v in edges); fiber_ft = sum(G[u][v]['len'] * load[(u, v)] for u, v in edges)
            maxd = max(dist[f] for f in rf)
            ground = S[c]['type'] != 'pole'
            cost = miss * 100000 + cable_ft * 12 + fiber_ft * 0.08 + bd * 30 + (0 if ground else 2500) + \
                   (0 if S[c]['type'] in ('hh', 'ped') else 400)
            rows.append(dict(structure=c, type=S[c]['type'], bbf_dist_ft=round(bd), cable_ft=round(cable_ft),
                             fiber_ft=round(fiber_ft), max_fst_path_ft=round(maxd), unreachable_fst=len(fsts) - len(rf), cost_index=round(cost)))
        if not rows: raise SystemExit('No PFP candidate found (check BBF radius / route connectivity)')
        cdf = pd.DataFrame(rows).sort_values('cost_index').reset_index(drop=True)
        if self.bbf:
            fx = np.array([S[f]['xy'] for f in fsts]); far = max(dist_to_lines(x, self.bbf) for x in fx)
            cdf['depth_frac'] = (cdf.bbf_dist_ft / max(far, 1)).round(2)
        self.pfp_cands = cdf; self.pfp = cdf.structure.iloc[0]
        self._prune_unreachable()
        self.log(f"PFP -> {self.pfp} ({S[self.pfp]['type']}); top candidates:\n{cdf.head(5).to_string()}")

    def _prune_unreachable(self):
        """Existing routes only: FSTs on a route island with no OH/UG route to the PFP are dropped;
        their buildings are reported unserved (the fix is new support route in IQGeo, not a planner bridge)."""
        comp = nx.node_connected_component(self.G, self.pfp)
        drop = [s for s in self.fst_members if s not in comp]
        if not drop: return
        islands = [c for c in nx.connected_components(self.G) if self.pfp not in c]
        rows = []
        for s in drop:
            isl = next(c for c in islands if s in c)
            for b in self.fst_members[s]:
                r = self.bld.loc[b]
                rows.append(dict(bid=b, addr=r.addr, cls=r.cls, units=r.units, nearest_struct=s, dist_ft=round(self.reach[s][b][2]),
                                 reason=f'route island ({len(isl)} structures) - no existing OH/UG route to PFP; add support route'))
                self.assign.pop(b, None)
            del self.fst_members[s]; self.fst_ports.pop(s, None); self.fst_name.pop(s, None)
        for r in rows: self.qc.append(('ERROR', r['addr'], r['reason']))
        self.unserved = pd.concat([self.unserved, pd.DataFrame(rows)], ignore_index=True)
        self.log(f"removed {len(drop)} FSTs ({len(rows)} buildings) on route islands not connected to the PFP")

    # ---------- distribution: closures, cables, counts, coils, slack
    def plan_distribution(self):
        S, G, p = self.S, self.G, self.p
        root = self.pfp; fsts = list(self.fst_members); ports = self.fst_ports
        dist, paths = nx.single_source_dijkstra(G, root, weight='len')
        self.dist_root = dist
        # FST tail limit by terminal size: 4-port <= max_tail_4 (1250'), 6/8/12-port <= max_tail_6 (800')
        lim = lambda f: p['max_tail_4'] if ports[f] <= 4 else p['max_tail_6']
        MAXC = p['max_cables_per_closure']
        sp = self.sp
        # closure selection (set cover on ancestors within tail reach) - splice cases only on street side / in ROW
        base_ok = lambda k: S[k]['type'] in ('pole', 'hh', 'ped') and k != root
        anc_ok = lambda k: base_ok(k) and (self.street_side.get(k, False) or k in self.splice_ok_rear)
        def cover_sets(okf, any_node=False):
            cv = defaultdict(set)
            for f in fsts:
                for a in paths[f]:
                    if okf(a) and dist[f] - dist[a] + TAIL_ALLOW <= lim(f): cv[a].add(f)
                if any_node:    # ROW splice off the direct path: tail doubles back along the route
                    for a, L in sp.items():
                        if okf(a) and f in L and L[f] + TAIL_ALLOW <= lim(f): cv[a].add(f)
            return cv
        def greedy(unc, cover, closures):
            while unc:
                best = None
                for a, fs in cover.items():
                    g = fs & unc
                    if not g: continue
                    g = set(sorted(g, key=lambda f: dist[f] - dist[a])[:p['max_fst_per_closure']])
                    tail = sum(dist[f] - dist[a] for f in g)
                    sc = len(g) * 1000 - tail * 0.5 - dist[a] * 0.05
                    if best is None or sc > best[0]: best = (sc, a, g)
                if best is None: break
                _, a, g = best; closures.setdefault(a, set()).update(g); unc -= g
            return unc
        closures = {}
        unc = greedy(set(fsts), cover_sets(anc_ok), closures)
        if unc: unc = greedy(unc, cover_sets(anc_ok, any_node=True), closures)
        if unc:     # FSTs no street-side splice can reach within the tail limit -> nearest reachable splice, flagged
            unc = greedy(unc, cover_sets(base_ok), closures)
            for a in closures:
                if not self.street_side.get(a, False) and a not in self.splice_ok_rear:
                    self.qc.append(('WARN', a, 'splice closure not on street side / ROW - no ROW structure within tail reach; confirm access or add ROW pole/HH'))
        for f in unc:
            self.qc.append(('ERROR', self.fst_name[f], f'FST cannot be reached within {lim(f)} ft tail limit - place cable closer'))
            closures.setdefault(f, set()).add(f)
        # consolidate: fold a leaf closure into its upstream closure when every FST stays within tail reach
        changed = True
        while changed:
            changed = False
            for a in sorted(closures, key=lambda k: -dist[k]):
                ups = [u for u in paths[a][:-1] if u in closures]
                if not ups: continue
                u = ups[-1]
                downstream = [c for c in closures if c != a and a in paths[c][:-1]]
                if downstream: continue
                fs = closures[a]
                if all(f in paths and u in paths[f] and dist[f] - dist[u] + TAIL_ALLOW <= lim(f) for f in fs) and \
                        len(closures[u]) + len(fs) <= p['max_fst_per_closure']:
                    closures[u] |= fs; del closures[a]; changed = True; break
        # closure tree: each splice is fed by its own cable from the nearest upstream splice (or the PFP).
        # Where cables to different splices share a route they are overlashed - no splice at rear branch points.
        def parent(c):
            ups = [u for u in paths[c][:-1] if u in closures]
            return ups[-1] if ups else root
        def kids():
            k = defaultdict(list)
            for c in closures: k[parent(c)].append(c)
            return k
        # cables at a closure = 1 incoming + outgoing cables to child splices + FST tails
        def ncab(a, K): return (1 if a != root else 0) + len(K.get(a, [])) + len(closures[a])
        def tlen(c, f): return 0 if c == f else sp.get(c, {}).get(f, 1e9)
        stuck = set()
        for _ in range(500):
            for a in [a for a, fs in closures.items() if not fs]: del closures[a]
            K = kids()
            over = [a for a in closures if ncab(a, K) > MAXC and a not in stuck]
            if not over: break
            a = max(over, key=lambda k: ncab(k, K))
            fs = sorted(closures[a], key=lambda f: -tlen(a, f))
            moved = False
            # 1) re-home the longest tail on another closure that has a free port and is within tail reach
            for f in fs:
                opts = sorted((tlen(c, f), c) for c in closures if c != a and tlen(c, f) + TAIL_ALLOW <= lim(f) and ncab(c, K) + 1 <= MAXC)
                if opts:
                    closures[a].discard(f); closures[opts[0][1]].add(f); moved = True; break
            if moved: continue
            # 2) open a new street-side splice downstream of a that picks up >=2 of its tails
            best = None
            for f in fs:
                i = paths[f].index(a) if a in paths[f] else None
                if i is None: continue
                for n in paths[f][i + 1:]:
                    if not anc_ok(n) or n in closures: continue
                    g = [x for x in fs if n in paths[x] and dist[x] - dist[n] + TAIL_ALLOW <= lim(x)][:MAXC - 2]
                    if len(g) >= 2 and (best is None or (len(g), dist[n]) > (len(best[1]), dist[best[0]])): best = (n, g)
            if best:
                n, g = best; closures[n] = set(g)
                for x in g: closures[a].discard(x)
                continue
            stuck.add(a)
        for a in [a for a, fs in closures.items() if not fs]: del closures[a]
        K = kids()
        for a in closures:
            if ncab(a, K) > MAXC:
                self.qc.append(('ERROR', a, f'splice closure has {ncab(a, K)} cables (> {MAXC}) - add splice point / re-route'))
        C = nx.DiGraph()
        for a in closures:
            pth = paths[a]
            for u, v in zip(pth, pth[1:]): C.add_edge(u, v)
        self.C = C; self.closures = closures; self.parent_of = parent
        self.ncab = lambda a: ncab(a, kids())
        # coils (MDU / SFU-like 5-12 / BCL complex) to nearest street-side cable node
        self._plan_coils()
        K = kids()
        order = []
        def dfs(n):
            if n in closures: order.append(n)
            for k in sorted(K.get(n, []), key=lambda c: -dist[c]): dfs(k)
        dfs(root)
        cnt = 1; self.fst_counts = {}; self.coil_counts = {}
        for a in order:
            for f in sorted(closures[a], key=lambda f: dist[f]):
                self.fst_counts[f] = (cnt, cnt + ports[f] - 1); cnt += ports[f]
            for ci in self.coil_at.get(a, []):
                n = self.coils[ci]['fibers']; self.coil_counts[ci] = (cnt, cnt + n - 1); cnt += n
        self.total_counts = cnt - 1
        demand = Counter()
        for a in closures:
            demand[a] += sum(ports[f] for f in closures[a]) + sum(self.coils[ci]['fibers'] for ci in self.coil_at.get(a, []))
        down = {}
        def acc(n):
            s_ = demand[n] + sum(acc(k) for k in K.get(n, [])); down[n] = s_; return s_
        acc(root)
        def subtree(n):
            out = [n]
            for k in K.get(n, []): out += subtree(k)
            return out
        self.sections = []
        for c in order:
            par = parent(c); pth = paths[c][paths[c].index(par):]
            load_f = down[c]; size, spec = cable_for(load_f)
            sub = subtree(c)
            rng = [self.fst_counts[f] for a in sub for f in closures[a]] + [self.coil_counts[ci] for a in sub for ci in self.coil_at.get(a, [])]
            lo = min(r[0] for r in rng) if rng else None; hi = max(r[1] for r in rng) if rng else None
            ll = []; ft = 0; oh = ug = 0
            for u, v in zip(pth, pth[1:]):
                e = G[u][v]; seg = e['ll'] if np.allclose(e['ll'][0], S[u]['ll'], atol=1e-5) else e['ll'][::-1]
                ll.extend(seg if not ll else seg[1:]); ft += e['len']
                if e['rt'] == 'OH': oh += e['len']
                else: ug += e['len']
            self.sections.append(dict(nodes=pth, ll=np.array(ll), ft=ft, oh_ft=oh, ug_ft=ug, fibers=load_f, size=size, spec=spec,
                                      lo=lo, hi=hi))
        self.tails = []
        for a, fs in closures.items():
            for f in fs:
                if f == a: L = 0; pth = [a]
                else:
                    pth = nx.shortest_path(G, a, f, weight='len'); L = nx.path_weight(G, pth, 'len')
                t = std_tail(L + TAIL_ALLOW)  # riser/slack allowance
                if t > lim(f): self.qc.append(('ERROR', self.fst_name[f], f'FST tail {t} ft exceeds {lim(f)} ft limit for {ports[f]}-port FST'))
                ll = []
                for u, v in zip(pth, pth[1:]):
                    e = G[u][v]; seg = e['ll'] if np.allclose(e['ll'][0], S[u]['ll'], atol=1e-5) else e['ll'][::-1]
                    ll.extend(seg if not ll else seg[1:])
                self.tails.append(dict(fst=f, closure=a, path_ft=L, tail=t, ll=np.array(ll) if len(ll) > 1 else None))
        self._plan_slack()
        self.log(f"closures {len(closures)}, sections {len(self.sections)}, F2 counts 1-{self.total_counts}")

    def _plan_coils(self):
        A, S, G = self.A, self.S, self.G
        cable_nodes = [n for n in self.C.nodes if S[n]['type'] in ('pole', 'hh', 'ped') and self.street_side.get(n)] or \
                      [n for n in self.C.nodes if S[n]['type'] in ('pole', 'hh', 'ped')] or list(self.C.nodes)
        skeys = [k for k in G if S[k]['type'] in ('pole', 'hh', 'fp', 'ped')]
        sxy = np.array([S[k]['xy'] for k in skeys]); stree = cKDTree(sxy)
        grp = A[A.cls.isin(['MDU', 'SFU_LIKE_5_12', 'BCL_COMPLEX'])].copy()
        from scipy.cluster.hierarchy import fcluster, linkage
        grp['gkey'] = ''
        for c in grp.cls.unique():
            m = grp.cls == c; xy = np.vstack(grp.loc[m, 'xy'].values)
            lab = fcluster(linkage(xy, 'single'), 200, 'distance') if len(xy) > 1 else np.array([1])
            grp.loc[m, 'gkey'] = [f'{c}|{l}' for l in lab]
        self.coils = []; self.coil_at = defaultdict(list); self.coil_skipped = []
        dist_from = {}
        for gk, g in grp.groupby('gkey'):
            cls = g.cls.iloc[0]; n = len(g); addr = g.addr.value_counts().index[0] + (f' (+{g.addr.nunique()-1} addr)' if g.addr.nunique() > 1 else '')
            best = None
            for xy in g.xy.values:
                d0, i = stree.query(xy); s = skeys[i]
                if s not in dist_from: dist_from[s] = nx.single_source_dijkstra_path_length(G, s, weight='len')
                for c in cable_nodes:
                    if c in dist_from[s]:
                        dd = dist_from[s][c] + d0
                        sc = dd + (0 if c in self.closures else 150)   # prefer an existing splice point
                        if best is None or sc < best[2]: best = (dd, c, sc)
            limit = 500 if cls == 'BCL_COMPLEX' else 1000
            if best is None or best[0] > limit:
                self.coil_skipped.append(dict(complex=addr, cls=cls, cls_count=n, path_ft=None if best is None else round(best[0]),
                                              action=f'> {limit} ft from F2 - size in BBF only (not counted)'))
                continue
            fib = n if cls == 'SFU_LIKE_5_12' else mdu_coil_fibers(n, bcl=(cls == 'BCL_COMPLEX'))
            ci = len(self.coils)
            self.coils.append(dict(complex=addr, cls=cls, cls_count=n, path_ft=round(best[0]), node=best[1], fibers=fib))
            self.coil_at[best[1]].append(ci)
            if best[1] not in self.closures: self.closures[best[1]] = set()

    def _plan_slack(self):
        S = self.S; sl = []
        for sec in self.sections:
            nodes = sec['nodes']
            if sec['oh_ft'] > 0:
                nloops = int(sec['oh_ft'] // 1000)
                cum = [0]
                for u, v in zip(nodes, nodes[1:]): cum.append(cum[-1] + self.G[u][v]['len'])
                for k in range(nloops):
                    target = (k + 0.5) * 1000
                    j = int(np.argmin([abs(c - target) if S[n]['type'] == 'pole' else 1e9 for c, n in zip(cum, nodes)]))
                    sl.append(dict(node=nodes[j], ft=100, type='Aerial maintenance loop', cable=sec['spec']))
            for n in nodes[1:-1]:
                if S[n]['type'] in ('hh', 'ped') and self.G[n][nodes[nodes.index(n) - 1]]['rt'] == 'UG':
                    sl.append(dict(node=n, ft=50, type='Buried pass-through slack', cable=sec['spec']))
        for a in self.closures:
            sl.append(dict(node=a, ft=50 if S[a]['type'] != 'pole' else 25, type='Splice closure slack', cable=''))
        for c in self.coils:
            sl.append(dict(node=c['node'], ft=50, type=f"Coiled fiber loop ({c['fibers']}F) {c['complex']}", cable=''))
        self.slack = sl

    # ---------- summary, QC
    def summarize(self):
        A = self.A; bld = self.bld; S = self.S; p = self.p
        served_units = sum(bld.units[b] for b in self.assign)
        sp = splitter_ports(served_units)
        split = '1x64'
        if p['aop_loop_ft']:
            loop = p['aop_loop_ft'] + max(self.dist_root[f] for f in self.fst_members)
            split = '1x64' if loop < 45000 else ('1x32' if loop < 64000 else 'ROLT required')
            if split != '1x64': self.qc.append(('WARN', 'PSA', f'max loop {loop:.0f} ft -> {split}'))
        cab = 288 if self.total_counts <= 288 else (432 if self.total_counts <= 432 else 864)
        pfp_row = self.A.iloc[int(np.argmin(np.hypot(*(np.vstack(self.A.xy.values) - S[self.pfp]['xy']).T)))]
        pdir = self.direction(S[self.pfp]['xy'], pfp_row, S[self.pfp]['type'])
        self.pfp_name = f"{pdir} {pfp_row['addr']} PFP"
        m = re.match(r'(\d+)\s+(.*)', pfp_row['addr'])
        words = [w for w in (m.group(2) if m else pfp_row['addr']).split() if w not in ('N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW')]
        self.pon = f"PON{m.group(1) if m else ''}{''.join(w[0] for w in words)}"
        for sec in self.sections:
            sec['name'] = f"{self.pon}, {sec['lo']}-{sec['hi']}" if sec['lo'] else self.pon
        for s, mem in self.fst_members.items():
            n = sum(bld.units[b] for b in mem)
            if n > 6: self.qc.append(('APPROVAL', self.fst_name[s], f'{fst_ports(n)}-port FST exceeds 6-port standard - engineer+GM approval'))
            for b in mem:
                tot, d, dl = self.reach[s][b]
                if tot > 1000: self.qc.append(('ERROR', bld.addr[b], f'drop {tot:.0f} ft > 1000 ft'))
        dl = [self.reach[s][b][2] for s, mem in self.fst_members.items() for b in mem]
        for s, mem in self.fst_members.items():
            if S[s]['type'] != 'pole': continue
            alt = [t for t in getattr(self, 'ug_fst', ()) if any(b in self.reach[t] for b in mem)]
            if alt:
                self.qc.append(('INFO', self.fst_name[s], f'pole FST although UG structure(s) {", ".join(sorted(alt)[:3])} reach part of this cluster - UG FST full or taken'))
        for s, mem in self.fst_members.items():
            for b in mem:
                d = self.reach[s][b][1]
                if not self.drop_may_cross(s, d) and (self.crosses_street(S[s]['xy'], bld.xy[b]) or self.crosses_street(S[d]['xy'], bld.xy[b])):
                    self.qc.append(('ERROR', self.fst_name[s], f'rear-easement drop cluster crosses street to {bld.addr[b]}'))
        for s_, mem in self.fst_members.items():
            for b in mem:
                d = self.reach[s_][b][1]
                x = self.strand_crossings(S[d]['xy'], bld.xy[b]) + (self.strand_crossings(S[s_]['xy'], S[d]['xy']) if d not in self.G else 0)
                if x > p['max_strand_cross']: self.qc.append(('ERROR', bld.addr[b], f'drop crosses {x} strands (> {p["max_strand_cross"]})'))
        for sec in self.sections:
            if sec['fibers'] > sec['size']: self.qc.append(('ERROR', sec['name'], 'fiber demand exceeds cable size'))
        names = list(self.fst_name.values()) + [self.pfp_name]
        for nm, c in Counter(names).items():
            if c > 1: self.qc.append(('ERROR', nm, 'duplicate equipment name (IQGeo hard stop)'))
        if self.bbf and 'depth_frac' in self.pfp_cands:
            df = self.pfp_cands.depth_frac.iloc[0]
            if not (0.33 <= df <= 0.5):
                self.qc.append(('INFO', self.pfp_name, f'PFP depth from BBF = {df:.2f} of PSA (guideline 1/3-1/2); chosen on cost - confirm in field'))
        cable_ft = sum(s['ft'] for s in self.sections); oh = sum(s['oh_ft'] for s in self.sections); ug = sum(s['ug_ft'] for s in self.sections)
        tail_ft = sum(t['tail'] for t in self.tails)
        mat = Counter(); [mat.update({s['spec']: s['ft']}) for s in self.sections]
        term = Counter(f"EVOLV{self.fst_ports[t['fst']]}{t['tail']}RAW" for t in self.tails)
        self.summary = dict(
            PSA=self.psa, PFP_name=self.pfp_name, PFP_structure=self.pfp, PFP_lat=round(S[self.pfp]['ll'][1], 7),
            PFP_lon=round(S[self.pfp]['ll'][0], 7), PON_cable=self.pon, PFP_cabinet_size=cab,
            splitter=split, splitter_ports=sp, splitters=sp // 64, CL_served_drop=served_units,
            CL_coiled=sum(c['cls_count'] for c in self.coils), coil_fibers=sum(c['fibers'] for c in self.coils),
            FST_count=len(self.fst_members), FST_avg_CL=round(served_units / max(1, len(self.fst_members)), 2),
            splice_closures=len(self.closures), F2_counts_used=f"{self.pon}, 1-{self.total_counts}",
            dist_cable_ft=round(cable_ft), aerial_ft=round(oh), buried_ft=round(ug), fst_tail_ft=tail_ft,
            avg_drop_ft=round(float(np.mean(dl)), 1) if dl else None, max_drop_ft=round(float(np.max(dl)), 1) if dl else None,
            unserved_buildings=len(self.unserved),
            materials='/'.join(f"{k}={v:.0f}'" for k, v in sorted(mat.items())),
            terminals='/'.join(f"{k}={v}" for k, v in sorted(term.items())))
        s = self.summary
        s['WHAT'] = (f"PLACE APPROXIMATELY {s['aerial_ft']}' OF AERIAL AND {s['buried_ft']}' OF BURIED {cable_for(max(x['fibers'] for x in self.sections))[0]}F OR SMALLER "
                     f"FIBER CABLE. TO SERVE APPROXIMATELY: {s['CL_served_drop']} LU PLACE THE FOLLOWING MAJOR MATERIALS: {s['materials']} "
                     f"PLACE THE FOLLOWING TERMINALS: {s['terminals']} F2 COUNTS USED: {s['F2_counts_used']}")
        s['WHERE'] = f"PFP ADDRESS: {self.pfp_name} LAT/LON: {s['PFP_lat']} N, {abs(s['PFP_lon'])} W PFP Size: {cab} Splitter: 64"
        for k, v in s.items(): self.log(f"  {k}: {v}")

    # ---------- outputs
    def cluster_polygon(self, s):
        pts = [self.S[s]['xy']] + [self.bld.xy[b] for b in self.fst_members[s]] + \
              [self.S[self.reach[s][b][1]]['xy'] for b in self.fst_members[s]]
        ang = np.linspace(0, 2 * np.pi, 10, endpoint=False); circ = np.c_[np.cos(ang), np.sin(ang)] * 20
        P = np.vstack([p + circ for p in pts]); h = ConvexHull(P); ring = P[h.vertices]
        ring = np.vstack([ring, ring[:1]]); return self.P.inv(ring)

    def write(self, out):
        os.makedirs(out, exist_ok=True); S = self.S; bld = self.bld; tag = re.sub(r'[^A-Za-z0-9_-]', '_', self.psa)
        W = GpkgWriter(os.path.join(out, f'{tag}_LLD_plan.gpkg'))
        s = self.summary
        W.add('plan_pfp', 'Point', [(S[self.pfp]['ll'], dict(name=self.pfp_name, structure=self.pfp, type='PFP', psa=self.psa,
               pon=f"{self.pon}, 1-{self.total_counts}", cabinet_size=s['PFP_cabinet_size'], splitter=s['splitter'],
               splitter_ports=s['splitter_ports'], splitters=s['splitters']))])
        W.add('plan_pfp_candidates', 'Point', [(S[r.structure]['ll'], dict(rank=i + 1, **{k: (v.item() if hasattr(v, 'item') else v) for k, v in r.items()}))
               for i, r in self.pfp_cands.head(10).iterrows()])
        tail_of = {t['fst']: t for t in self.tails}
        fr = []
        for f, mem in self.fst_members.items():
            n = sum(bld.units[b] for b in mem); t = tail_of.get(f, {})
            lo, hi = self.fst_counts.get(f, (None, None))
            fr.append((S[f]['ll'], dict(name=self.fst_name[f], housing=f, housing_type=S[f]['type'],
                       housing_name=S[f]['name'] or self.struct_newname.get(f), ports=self.fst_ports[f], cl=n,
                       spec=f"EVOLV{self.fst_ports[f]}{t.get('tail', '')}RAW", tail_ft=t.get('tail'), tail_path_ft=round(t.get('path_ft', 0)),
                       closure=t.get('closure'), counts=f"{self.pon}, {lo}-{hi}")))
        W.add('plan_fst', 'Point', fr)
        W.add('plan_drop_cluster', 'Polygon', [([self.cluster_polygon(f)], dict(term_name=self.fst_name[f], cl=sum(bld.units[b] for b in m), ports=self.fst_ports[f]))
               for f, m in self.fst_members.items()])
        dr = []
        for f, mem in self.fst_members.items():
            for b in mem:
                tot, d, dl = self.reach[f][b]
                dr.append((np.array([S[d]['ll'], bld.ll[b]]), dict(fst=self.fst_name[f], from_structure=d,
                           route=('OH' if S[d]['type'] == 'pole' else 'UG'), address=bld.addr[b], units=int(bld.units[b]),
                           drop_ft=round(dl), fst_to_cl_ft=round(tot),
                           strands_crossed=self.strand_crossings(S[d]['xy'], bld.xy[b]) + (self.strand_crossings(S[f]['xy'], S[d]['xy']) if d not in self.G else 0),
                           route_side=('street' if self.drop_may_cross(f, d) else 'rear'),
                           crosses_street=int(self.crosses_street(S[d]['xy'], bld.xy[b])))))
        W.add('plan_drop_route', 'LineString', dr)
        W.add('plan_fst_tail', 'LineString', [(t['ll'], dict(fst=self.fst_name[t['fst']], closure=t['closure'], tail_ft=t['tail'],
               path_ft=round(t['path_ft']), spec=f"{self.fst_ports[t['fst']]}F Tail")) for t in self.tails if t['ll'] is not None])
        W.add('plan_distribution_cable', 'LineString', [(sec['ll'], dict(name=sec['name'], specification=sec['spec'], fiber_count=sec['size'],
               fibers_used=sec['fibers'], length_ft=round(sec['ft']), aerial_ft=round(sec['oh_ft']), buried_ft=round(sec['ug_ft']),
               from_node=sec['nodes'][0], to_node=sec['nodes'][-1])) for sec in self.sections])
        def cl_spec(a):
            thru = max([sec['size'] for sec in self.sections if a in (sec['nodes'][0], sec['nodes'][-1])] or [48])
            return 'FOSC400A8' if thru <= 72 else ('FOSC450B6' if thru <= 288 else 'FOSC450C63')
        W.add('plan_splice_closure', 'Point', [(S[a]['ll'], dict(housing=a, housing_type=S[a]['type'], spec=cl_spec(a),
               fsts=', '.join(self.fst_name[f] for f in fs), n_fst=len(fs), cables=self.ncab(a), street_side=int(self.street_side.get(a, False)),
               dist_to_street_ft=round(self.dist_street.get(a, -1)), coils=len(self.coil_at.get(a, []))))
               for a, fs in self.closures.items()])
        W.add('plan_coil', 'Point', [(S[c['node']]['ll'], dict(complex=c['complex'], cls=c['cls'], cls_count=c['cls_count'],
               fibers=c['fibers'], path_ft=c['path_ft'], counts=f"{self.pon}, {self.coil_counts[i][0]}-{self.coil_counts[i][1]}",
               note=f"{c['fibers']} FIBERS ({self.pon},{self.coil_counts[i][0]}-{self.coil_counts[i][1]}) LEFT IN FUTURE LOOP AT {S[c['node']]['name'] or self.struct_newname.get(c['node'], c['node'])} FOR {c['cls']}"))
               for i, c in enumerate(self.coils)])
        W.add('plan_slack', 'Point', [(S[x['node']]['ll'], dict(node=x['node'], length_ft=x['ft'], type=x['type'], cable=x['cable'])) for x in self.slack])
        ar = []
        mem_of = {b: f for f, m in self.fst_members.items() for b in m}
        for _, a in self.A.iterrows():
            b = bld.index[bld.bkey == a.bkey]
            b = int(bld.bid[b[0]]) if len(b) else None
            f = mem_of.get(b) if a.cls in ('SFU', 'SFU_LIKE_2_4', 'BCL_STANDALONE') else None
            ar.append((a.ll, dict(address_id=str(a['id']), address=a.addr, unit=a.get('unit') if isinstance(a.get('unit'), str) else None,
                       cls=a.cls, fst=self.fst_name.get(f), plan_status=('Drop-fed' if f else ('Coiled/Future' if a.cls in ('MDU', 'SFU_LIKE_5_12', 'BCL_COMPLEX') else 'Unserved')))))
        W.add('plan_address_assignment', 'Point', ar)
        if self.struct_newname:
            W.add('plan_structure_names', 'Point', [(S[k]['ll'], dict(structure=k, suggested_name=v)) for k, v in self.struct_newname.items()])
        if len(self.street_segs):
            W.add('plan_street_centerline', 'LineString', [(self.P.inv(np.array(sg)), dict(street=st, source=self.street_src)) for st, ss in self.street_lines.items() for sg in ss])
        if self.boundary is not None:
            W.add('plan_psa_boundary', 'Polygon', [([self.boundary], dict(psa=self.psa))])
        W.close()
        self._write_xlsx(os.path.join(out, f'{tag}_LLD_report.xlsx'), fr, dr)
        self._write_kml(os.path.join(out, f'{tag}_LLD_plan.kml'))
        self._plot(os.path.join(out, f'{tag}_LLD_map.png'))
        return tag

    def _write_xlsx(self, path, fr, dr):
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment
        from openpyxl.utils import get_column_letter
        wb = Workbook(); ws = wb.active; ws.title = 'Summary'
        hdr = PatternFill('solid', fgColor='1F3864'); hf = Font(color='FFFFFF', bold=True)
        ws.append(['Item', 'Value'])
        for k, v in self.summary.items(): ws.append([k, v])
        ws.append([]); ws.append(['Parameter', 'Value'])
        for k, v in self.p.items(): ws.append([k, v])
        def sheet(name, df):
            w = wb.create_sheet(name); w.append(list(df.columns))
            for r in df.itertuples(index=False): w.append([None if (isinstance(x, float) and np.isnan(x)) else x for x in r])
        sheet('FST Schedule', pd.DataFrame([d for _, d in fr]).sort_values('counts'))
        sheet('Drops', pd.DataFrame([d for _, d in dr]))
        sheet('Cable Sections', pd.DataFrame([{k: v for k, v in s.items() if k not in ('ll', 'nodes')} | dict(from_node=s['nodes'][0], to_node=s['nodes'][-1]) for s in self.sections]))
        sheet('Splice Closures', pd.DataFrame([dict(housing=a, type=self.S[a]['type'], cables=self.ncab(a), street_side=self.street_side.get(a, False), dist_to_street_ft=round(self.dist_street.get(a, -1)), n_fst=len(fs), fsts=', '.join(self.fst_name[f] for f in fs)) for a, fs in self.closures.items()]))
        sheet('Coils', pd.DataFrame(self.coils + self.coil_skipped) if (self.coils or self.coil_skipped) else pd.DataFrame(columns=['complex']))
        sheet('Slack', pd.DataFrame(self.slack))
        sheet('PFP Candidates', self.pfp_cands.head(15))
        sheet('Unserved', self.unserved if len(self.unserved) else pd.DataFrame(columns=['addr']))
        sheet('QC', pd.DataFrame(self.qc, columns=['severity', 'item', 'message']).sort_values('severity'))
        if self.struct_newname: sheet('Structure Names', pd.DataFrame(list(self.struct_newname.items()), columns=['structure', 'suggested_name']))
        for w in wb.worksheets:
            for c in w[1]: c.fill = hdr; c.font = hf
            for i, col in enumerate(w.columns, 1):
                w.column_dimensions[get_column_letter(i)].width = min(60, max(10, max(len(str(c.value or '')) for c in col) + 2))
            w.freeze_panes = 'A2'
        wb['Summary'].column_dimensions['B'].width = 90
        for r in wb['Summary'].iter_rows(min_row=2):
            r[1].alignment = Alignment(wrap_text=True, vertical='top')
        wb.save(path)

    def _write_kml(self, path):
        S = self.S
        def esc(s): return str(s).replace('&', '&amp;').replace('<', '&lt;')
        def coords(a): return ' '.join(f'{x:.7f},{y:.7f},0' for x, y in a)
        k = ['<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>',
             f'<name>{esc(self.psa)} LLD plan</name>',
             '<Style id="pfp"><IconStyle><color>ff0000ff</color><scale>1.4</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/star.png</href></Icon></IconStyle></Style>',
             '<Style id="fst"><IconStyle><color>ff00a5ff</color><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>',
             '<Style id="sc"><IconStyle><color>ffff00ff</color><Icon><href>http://maps.google.com/mapfiles/kml/shapes/square.png</href></Icon></IconStyle></Style>',
             '<Style id="cab"><LineStyle><color>ffff0000</color><width>4</width></LineStyle></Style>',
             '<Style id="tail"><LineStyle><color>ff00ffff</color><width>2</width></LineStyle></Style>',
             '<Style id="drop"><LineStyle><color>ff00ff00</color><width>1</width></LineStyle></Style>',
             '<Style id="dc"><LineStyle><color>ff00a5ff</color><width>1</width></LineStyle><PolyStyle><color>3300a5ff</color></PolyStyle></Style>']
        k.append(f'<Placemark><name>{esc(self.pfp_name)}</name><styleUrl>#pfp</styleUrl><description>{esc(self.summary["WHERE"])}</description><Point><coordinates>{coords([S[self.pfp]["ll"]])}</coordinates></Point></Placemark>')
        k.append('<Folder><name>FST</name>')
        for f in self.fst_members:
            k.append(f'<Placemark><name>{esc(self.fst_name[f])}</name><styleUrl>#fst</styleUrl><Point><coordinates>{coords([S[f]["ll"]])}</coordinates></Point></Placemark>')
        k.append('</Folder><Folder><name>Drop clusters</name>')
        for f in self.fst_members:
            k.append(f'<Placemark><name>{esc(self.fst_name[f])}</name><styleUrl>#dc</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>{coords(self.cluster_polygon(f))}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>')
        k.append('</Folder><Folder><name>Distribution cable</name>')
        for s in self.sections:
            k.append(f'<Placemark><name>{esc(s["name"])} ({s["spec"]})</name><styleUrl>#cab</styleUrl><LineString><coordinates>{coords(s["ll"])}</coordinates></LineString></Placemark>')
        k.append('</Folder><Folder><name>FST tails</name>')
        for t in self.tails:
            if t['ll'] is not None:
                k.append(f'<Placemark><name>{esc(self.fst_name[t["fst"]])} {t["tail"]}ft</name><styleUrl>#tail</styleUrl><LineString><coordinates>{coords(t["ll"])}</coordinates></LineString></Placemark>')
        k.append('</Folder><Folder><name>Splice closures</name>')
        for a in self.closures:
            k.append(f'<Placemark><name>SC {esc(S[a]["name"] or a)} ({self.ncab(a)} cables)</name><styleUrl>#sc</styleUrl><Point><coordinates>{coords([S[a]["ll"]])}</coordinates></Point></Placemark>')
        k.append('</Folder><Folder><name>Drops</name>')
        for f, mem in self.fst_members.items():
            for b in mem:
                d = self.reach[f][b][1]
                k.append(f'<Placemark><name>{esc(self.bld.addr[b])}</name><styleUrl>#drop</styleUrl><LineString><coordinates>{coords([S[d]["ll"], self.bld.ll[b]])}</coordinates></LineString></Placemark>')
        k.append('</Folder></Document></kml>')
        open(path, 'w').write('\n'.join(k))

    def _plot(self, path):
        import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
        S, G = self.S, self.G
        fig, ax = plt.subplots(figsize=(18, 13))
        if self.boundary is not None:
            b = self.P.fwd(self.boundary); ax.plot(b[:, 0], b[:, 1], 'k--', lw=1)
        for u, v, d in G.edges(data=True):
            a = self.P.fwd(d['ll']); ax.plot(a[:, 0], a[:, 1], '-', color={'OH': '#f4b183', 'UG': '#a9d18e'}.get(d['rt'], '#ccc'), lw=3, zorder=1)
        for ln in self.bbf:
            ax.plot(ln[:, 0], ln[:, 1], '-', color='#7f7f7f', lw=5, alpha=.4, zorder=0)
        for sg in self.street_segs:
            ax.plot(sg[:, 0], sg[:, 1], '-', color='#bfbfbf', lw=1, zorder=0)
        cmap = plt.get_cmap('tab20')
        for i, f in enumerate(self.fst_members):
            poly = self.P.fwd(self.cluster_polygon(f)); ax.fill(poly[:, 0], poly[:, 1], color=cmap(i % 20), alpha=.25, zorder=2)
            ax.text(*S[f]['xy'], self.fst_name[f].split(' ', 1)[0] + ' ' + self.fst_name[f].split(' ')[1], fontsize=6, zorder=9)
        for f, mem in self.fst_members.items():
            for b in mem:
                d = self.reach[f][b][1]; a = np.array([S[d]['xy'], self.bld.xy[b]]); ax.plot(a[:, 0], a[:, 1], '-', color='#70ad47', lw=.6, zorder=3)
        for sec in self.sections:
            a = self.P.fwd(sec['ll']); lw = 1.5 + math.log2(sec['size'] / 48 + 1) * 1.5
            ax.plot(a[:, 0], a[:, 1], '-', color='#1f4e79', lw=lw, zorder=4)
            m = a[len(a) // 2]; ax.text(m[0], m[1], f"{sec['size']}F", fontsize=7, color='#1f4e79', zorder=9)
        for t in self.tails:
            if t['ll'] is not None:
                a = self.P.fwd(t['ll']); ax.plot(a[:, 0], a[:, 1], ':', color='#c00000', lw=1.2, zorder=4)
        axy = np.vstack(self.A.xy.values)
        for c, col in [('SFU', '#404040'), ('SFU_LIKE_2_4', '#7030a0'), ('BCL_STANDALONE', '#bf9000'), ('MDU', '#9e480e'), ('SFU_LIKE_5_12', '#d06bd0'), ('BCL_COMPLEX', '#f4c542')]:
            m = (self.A.cls == c).values
            if m.any(): ax.scatter(axy[m, 0], axy[m, 1], s=7, color=col, label=c, zorder=5)
        fx = np.array([S[f]['xy'] for f in self.fst_members]); ax.scatter(fx[:, 0], fx[:, 1], s=60, facecolors='none', edgecolors='#ff6600', lw=1.5, label='FST', zorder=6)
        cx = np.array([S[a]['xy'] for a in self.closures]); ax.scatter(cx[:, 0], cx[:, 1], s=45, marker='s', color='m', label='splice closure', zorder=7)
        if self.coils:
            kx = np.array([S[c['node']]['xy'] for c in self.coils]); ax.scatter(kx[:, 0], kx[:, 1], s=90, marker='o', facecolors='none', edgecolors='#9e480e', lw=2, label='coil', zorder=7)
        ax.scatter(*S[self.pfp]['xy'], s=400, marker='*', color='red', label='PFP', zorder=10)
        ext = np.vstack([np.vstack(self.A.xy.values)] + ([self.P.fwd(self.boundary)] if self.boundary is not None else []))
        ax.set_xlim(ext[:, 0].min() - 150, ext[:, 0].max() + 150); ax.set_ylim(ext[:, 1].min() - 150, ext[:, 1].max() + 150)
        ax.set_aspect('equal'); ax.legend(loc='upper right', fontsize=8)
        ax.set_title(f"{self.psa} planned LLD - {self.pfp_name} | {self.summary['FST_count']} FST | {self.summary['CL_served_drop']} CL drop-fed | {self.summary['F2_counts_used']}")
        ax.set_xticks([]); ax.set_yticks([])
        plt.savefig(path, dpi=110, bbox_inches='tight'); plt.close(fig)

    def run(self, out):
        self.load(); self.plan_clusters(); self.name_features(); self.plan_pfp(); self.plan_distribution(); self.summarize()
        return self.write(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('gpkg'); ap.add_argument('--out', default='lld_plan')
    ap.add_argument('--psa', help='PSA code (e.g. 1002PA) to pick the design boundary')
    ap.add_argument('--max-ports', type=int, default=6, help='6 = guideline; 8 = with Gigapower approval')
    ap.add_argument('--max-tail-4', type=int, default=1250, help='max FST tail ft for 4-port FST')
    ap.add_argument('--max-tail-6', type=int, default=800, help='max FST tail ft for 6/8/12-port FST')
    ap.add_argument('--max-cables-per-closure', type=int, default=8, help='incl. in/out distribution cables and FST tails')
    ap.add_argument('--max-fst-per-closure', type=int, default=6, help='initial tail cap per closure (refined by cable limit)')
    ap.add_argument('--row-ft', type=float, default=60, help='pole counts as street side / ROW if within this distance of the street centerline')
    ap.add_argument('--max-strand-cross', type=int, default=2, help='max aerial strands a drop may cross')
    ap.add_argument('--max-span-ft', type=float, default=300, help='drop span off-strand pole -> strand pole')
    ap.add_argument('--aerial-drop-ft', type=float, default=200); ap.add_argument('--ug-drop-ft', type=float, default=150)
    ap.add_argument('--design-drop-ft', type=float, default=400, help='FST->CL design limit (hard rule 1000)')
    ap.add_argument('--pfp-structure', help='force PFP at structure key e.g. manhole/123')
    ap.add_argument('--bbf-radius-ft', type=float, default=400)
    ap.add_argument('--roads', help='road centerline shapefile (.zip or .shp, lon/lat) e.g. TIGER tl_2025_35001_roads.zip')
    ap.add_argument('--road-classes', default=','.join(STREET_MTFCC), help='MTFCC classes treated as streets (alleys S1730 excluded by default)')
    ap.add_argument('--approve-rear-splice', action='append', default=[], help='structure key allowed as a rear-easement splice (repeatable)')
    ap.add_argument('--aop-loop-ft', type=float, help='fiber distance AOP->PSA edge for splitter ratio check')
    a = ap.parse_args()
    Planner(a.gpkg, psa=a.psa, max_ports=a.max_ports, max_tail_4=a.max_tail_4, max_tail_6=a.max_tail_6,
            max_cables_per_closure=a.max_cables_per_closure, max_fst_per_closure=a.max_fst_per_closure,
            row_ft=a.row_ft, max_strand_cross=a.max_strand_cross,
            aerial_drop_ft=a.aerial_drop_ft, max_span_ft=a.max_span_ft, ug_drop_ft=a.ug_drop_ft, design_drop_ft=a.design_drop_ft,
            pfp_structure=a.pfp_structure, bbf_radius_ft=a.bbf_radius_ft, aop_loop_ft=a.aop_loop_ft,
            approve_rear=a.approve_rear_splice, roads=a.roads,
            road_classes=[c for c in a.road_classes.split(',') if c]).run(a.out)

if __name__ == '__main__':
    main()
```