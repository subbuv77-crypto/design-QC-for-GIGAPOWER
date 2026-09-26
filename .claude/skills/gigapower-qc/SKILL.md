---
name: "gigapower-qc"
description: "Run a Gigapower fiber construction-document QC: compare the CD PDF against its IQGeo export (including cable reel PON details) and produce a QC workbook plus a marked-up _QC#.pdf."
---

# Gigapower CD vs IQGeo QC

Use this skill when the user sends a construction-document (CD) PDF and an IQGeo export (.gpkg, sometimes with a VITRUVI QC_Detail.xlsx) for a PSA and asks for QC.

A QC run has three layers, and all three are required:

1. **Project QC rules**: the project instructions plus sections 3a–3h below.
2. **Gigapower QC Checklist (3.24.2025)**: every checklist item gets a result (section 3i).
3. **Gigapower Fiber Design Guidelines v17.0**: design-rule violations are raised as findings (section 3j).

## 0. Inputs and setup

1. Identify the files:
   - the CD PDF, e.g. `PSA-XXXXPA-<CLLI>-VICTOR_CD.pdf`
   - the IQGeo export (`design_*.gpkg`)
   - optionally, the VITRUVI QC_Detail.xlsx
   - optionally, a prior QC workbook, marked-up PDF, or correction note
2. If the PDF or the GPKG is missing, ask for it before starting. Don't run a PDF-only or GPKG-only QC unless the user says to.
3. Read these project docs with the Projects tool (`project_read`):
   - `claude/Gigapower QC Checklist (3.24.2025).md`: the full checklist, with source tags [CD] / [IQ] / [CD+IQ] / [MAN].
   - `claude/Gigapower Design Guideline QC Rules (v17.0).md`: the guideline thresholds.
   - Any correction or status note for this PSA, such as `claude/PSA-XXXXPA QC corrections.md`. Retracted findings and prior false positives must not come back.

   If a newer checklist or guideline file is attached to the conversation, use it instead and tell the user which version was applied. If the project docs can't be read, use the summaries embedded in 3i and 3j below.
4. Work on copies in the working directory. Never modify the uploads.
5. Tools:
   - PyMuPDF (`fitz`) for PDF text, rendering, and annotations
   - `sqlite3` or `geopandas` for the GPKG
   - `openpyxl` for the workbook
   - Check for each tool first and install it if missing (`pip install --break-system-packages`).
6. Create a task list covering the stages below. Include "Cable reel PON check", "Checklist sweep" and "Guideline rule checks" as their own tasks.

## 1. Revision and scope

- Work out the QC round:
  - No prior QC for this PSA → QC1.
  - Otherwise, the next number after the highest `_QC#` seen.
- If this is QC2 or later, list every prior finding and recheck each one against the new files. Mark it Resolved, Still Open, or Retracted (false positive). Don't carry anything forward automatically.
- Confirm whether the project is **Full DRC** or **Fast Track** from:
  - the project information / cover
  - the plan index
  - the sheets actually included

  Never decide scope from page count alone. Checklist items for sheets that don't exist in scope are marked N/A (with the reason).
- Build a page audit: every PDF page, with its sheet ID (Cover, C-1, PN-1..n, L-1, SC-#, PFP-#, PP-#, DT-#, permit sheets). Render each page and review both its text and the rendered image.

## 2. IQGeo inventory (from the GPKG)

Filter every table to the selected design (`design_id` = the PSA design). Record:

- cabinet name, spec, PON, fiber range, splitters (type and count)
- fiber_tap (terminals) with full EVOLV spec strings and port counts
- FST tails (fiber_cable with FST-TAIL names) with path endpoints, geometry length, and spec tail length
- splice_closure records and their housings
- drop clusters
- pole count
- anchors, down guys, and the housing pole of each
- manholes / HH / FP by size, including nearby records tagged to other PSAs
- UG routes and their method, UG length, conduit length and size
- OH route length
- pole_strand records: count, total length, and any zero-length records
- cable specs: fiber type (ribbon), count, material code
- cable reels (fiber_cable segments between splice points): name, PON cable name, spec, fiber count, length, start/end structure, and the PON / fiber range each reel carries and drops at each terminal. PON assignments may live in fiber_tap attributes, connection/splice tables, or port records depending on the export, so list the GPKG tables and columns first and find where they are; don't assume column names.
- coils and slack loops, and their MDU/BCL associations
- addresses / demand points: count, build_status, no_build_reason

If a VITRUVI QC_Detail.xlsx was provided, treat its issues as leads to verify, not as confirmed findings.

## 3. Checks

### 3a. Terminals and EVOLV models

- Compare the terminals on the print (SC sheets, PP/PFP callouts, PN-5) against IQGeo:
  - counts
  - terminal/tap names
  - fiber ranges
  - port counts
  - full EVOLV model strings
- Before comparing models, confirm both sides refer to the same physical terminal. Resolve naming and identification problems first.
- Classify each discrepancy as one of:
  - **terminal-name error**
  - **FST-tail naming error**
  - **actual EVOLV model mismatch**

  Matching models are never a model mismatch just because a tail name is wrong.
- Tail-length adjudication:
  - Use the exact model strings and the authoritative catalog tail lengths.
  - If both tails reach the splice can, the longer-tail model is correct.
  - Never invent catalog lengths. If the data is insufficient, report "verification needed".

### 3b. FST-tail names

- Compare the terminal identity in each FST-tail name with the terminal actually at the tail's path endpoint. Look for:
  - a wrong street or house number
  - a missing R/F/S prefix
  - extra characters or spaces
- Exclude PFP IN TAIL, PFP STUB-1 OUT, and PFP STUB-2 OUT.
- Report each one with the affected terminal, the IQGeo tail name, and the specific discrepancy.

### 3c. Zero-geometry FST tails

For each tail whose start coordinate equals its end coordinate:

- **Splice closure on the same pole as the terminal** → do not flag it for zero length alone.
- **Different pole** → investigate the route geometry and flag it if a correction is needed.
- **Association unclear** → report "verification needed", not a confirmed error.

Don't confuse drawn geometry length with the terminal model's manufactured tail length.

### 3d. Quantities and BOM

- **PN-5 FST part-number table:**
  - check for duplicate EVOLV rows
  - reconcile every full model string and its quantity against the terminal inventory
  - never shorten or merge distinct strings
- **PN-5 splice and handhole BOM** vs the IQGeo splice_closure and manhole records.
- **L-1:**
  - PFP size and quantity vs the cabinet spec
  - pole count
  - strand and self-support footage
  - UG footage and method (bore vs microtrench)
  - total footage and work-type percentages
  - handhole counts
  - land disturbance
  - the LU block count
- For each conflict, state the exact quantities and where each one comes from.

### 3e. Strand and self-supporting

- Compare the printed 6M strand footage and callouts with IQGeo pole_strand records.
- Review zero-foot pole_strand records separately from FST tails. The same-pole exception does **not** apply to strand records.
- Recheck self-supporting/strand problem areas using the current files. Don't repeat previously retracted strand callouts.

### 3f. Down guys and anchors

- Check DG and anchor pairing at every pole. Multiple DGs with a matching number of anchors on one pole is fine.
- Report three counts separately:
  - total DGs
  - total anchors
  - number of unique poles with DGs
- Map each DG to its P-# / PNM pole ID on the correct permit sheet. Don't use a continuation-sheet location by mistake.
- Every DG location gets a markup, even when it passes. Word passing ones as a check, not an error.
- DG feasibility (Street View) is a [MAN] checklist item. Mark it Verify.

### 3g. Drafting and copied data

- Look for:
  - foreign PONs, addresses, or project names copied from other jobs
  - wrong directionals
  - stray punctuation in sheet references
  - template and grammar errors on the PN sheets

### 3h. Cable reel PON details vs IQGeo

Every cable reel's PON details on the print must match IQGeo. A reel that shows the right footage but the wrong PONs will be spliced wrong in the field, so this is checked reel by reel, not just as a flow sanity check.

1. **Build the print reel table.** From every place a reel is labelled — SC schematic reel attributes, PFP-1 cable labels, PP-sheet reel callouts, and any reel table on PN/L-1 — record per reel:
   - reel ID / cable name and PON cable name (e.g. `PON953MA`)
   - fiber count and spec
   - from → to (structure / pole / HH) and footage
   - the PON range the reel carries (start–end)
   - the PONs / fiber range dropped at each terminal on it, and PONs assigned to future loops or coils

   If the same reel is labelled on more than one sheet, compare those labels with each other too; a schematic that disagrees with its own PP sheet is a finding even if one of them matches IQGeo.
2. **Build the IQGeo reel table** with the same fields from the section 2 inventory.
3. **Pair reels by physical path** (endpoint structures and route), not by name alone, so a naming error isn't mistaken for a PON error. Resolve pairing first, then compare:
   - reel / cable name and PON cable name
   - fiber count and spec
   - footage (state both values; flag any difference beyond rounding to the foot)
   - the PON range carried by the reel
   - each terminal's PON / fiber range, terminal by terminal
   - future-loop and coil PON assignments
   - continuity across splice points: pass-through PONs keep the same numbers from reel to reel, and a PON dropped upstream doesn't reappear downstream
4. **Classify each discrepancy** as one of: reel missing in one source, reel name / PON cable name mismatch, fiber count or spec mismatch, footage mismatch, reel PON range mismatch, terminal PON mismatch, future-loop PON mismatch, or PON continuity break.
5. **Severity:** a PON range, terminal PON or continuity mismatch that would splice a customer onto the wrong PON is **Critical**; fiber count/spec or footage conflicts are **High**; name-only mismatches are **Medium**.
6. If IQGeo doesn't hold the PON assignment data needed for a reel, mark that reel **Verify** (with what's missing) rather than Pass or Fail.

Each discrepancy is a finding with the exact PDF value and IQGeo value, and gets a markup on the reel callout or schematic label where it appears. This check complements the checklist's "Reel PON flow" items in 3i (no duplicates, lowest PON at the farthest terminal); both must be done.

### 3i. Checklist sweep (QC_Checklist_3.24.2025)

Go through **every item** in the three checklist tabs:

1. **General QC Items:** Cover, Project Notes, PN-4, Legend/SOW (L-1), Scope of Work, LU block, Schematics, PFP sheet, PP sheets.
2. **Design Engineer Items:** PFP-1 items 1–21 and PP pages items 1–52.
3. **IQGeo Items:** CLs, PFP checks, Distribution.

For each item, record one of:

- **Pass**
- **Fail**, with the Finding ID
- **N/A**, with the reason (e.g. the sheet isn't in Fast Track scope, or there are no MDUs)
- **Verify**, for [MAN] items that can't be confirmed from the files. Examples:
  - competitors in the area
  - DG feasibility in Street View
  - PFP traffic, door swing, and driveway clearance
  - flowerpot green space
  - data-validation / trace-report screenshots
  - private-property encroachment

  Never mark a Verify item as Pass.

Every Fail must also appear in the Findings tab and, where it has a location on the print, as a PDF markup.

Checks that are easy to miss:

- **Title blocks:** check every sheet for project name, CLLI, OLT LOC, revision/date/comments, the NM811 logo, the current sheet name, and company logos matching the cover.
- **Cover sheet:**
  - PFP address = the route start = the IQGeo cabinet address
  - SOW has the PSA number, the matching street names, and a space after each comma
  - print boundaries match the PP sheets
- **Schematics:**
  - terminal port indicators and page numbers
  - reel attributes and footages
  - future loops with PON assignments
  - the material list
  - "SEE SHEET" references
- **PFP-1:**
  - tie-down and grounding
  - station markers start at the PFP
  - **any PON crossing 432→433 needs a jumper**
  - DOP arrows and 50' loops on all cables
  - a north arrow
- **PP sheets:**
  - attributes at the top left
  - callouts tied to the correct features
  - typicals only for roads on that sheet
  - station markers at every road crossing
  - span footages
  - HH detail numbers, sizes, and tie-downs
  - drop lines
  - FRC codes
  - splice credits
  - grounding notes
  - "END OF DESIGN"
  - no text over text or arrows
  - no double symbols
- **Reel PON flow:**
  - no duplicate PONs
  - no PON count duplicated between terminals
  - **the lowest PON number starts at the farthest terminal**
- **IQGeo:**
  - drop clusters match the FST names **exactly**
  - terminal names match the CD
  - the distribution cluster matches the PFP name
  - the lowest distribution panel is on PFP tail 1
  - AOP FDP function = OSP (not FOT)
  - no duplicate cables or conduit
  - fiber type is ribbon
  - all terminals trace to the PFP distribution panel
  - **lead-pole terminals have tails ≥ 50' (not 25')**
  - no unnecessary 12-port terminals
  - strand and DGs are entered

### 3j. Guideline rule checks (Fiber Design Guidelines v17.0)

Raise a finding, citing "Guidelines v17 §x", for any violation found in the CD or IQGeo. Check at least these:

- **PFP:**
  - one splitter type only
  - splitter ports equipped vs CLs minus MDUs: 1–100 → 64; 101–250 → 128; 251–450 → 192; 451+ → 256
  - splitter ratio vs the longest reach: E1 Charles 1x64 < 45 kft, 1x32 45–64 kft; Corning 1x64 < 43.4 kft; > 64 kft needs a ROLT
  - PSA held to 85% capacity
  - the PFP size in the CD (e.g. 432 vs 864) matches the IQGeo cabinet spec and the load
- **PON cable name:** comes from the PFP address, e.g. `S 953 MCFARLAN AVE PFP` → `PON953MA`.
- **PSA name format:** route + feeder (+ lateral) + PA/PB (MA/MB for pre-wired MDU).
- **FST:**
  - **≤ 6 ports** (12-port only with approval, e.g. ETTC)
  - USPS-style name with a directional/location prefix
  - spacing of 1 terminal per ≥ 4 CLs
  - standard tail lengths **100' / 300' / 500'** (anything longer needs engineer approval)
  - buried = EVOLV heads with tails spliced in an HH; aerial = aerial EVOLV
- **Drops:**
  - max **1000'** from FST to CL (otherwise No Build with the "exceeds 1kft drop rule" reason)
  - aerial ≤ **2 spans**; buried ≤ **2 lots**
  - FST HH to next FP averages ≤ **250'**
  - runs over 200' or with hard bends need a mid-path HH/FP
  - every CL has a green path
- **Loops:**
  - aerial: one **100' maintenance loop per 1000'** of continuous cable, near mid-span
  - buried coils: **50'** in pass-through HHs, **25'** at the end of a run
- **Handholes:**
  - minimum size for the cable, armored ribbon: 24/48/72-ct → 17x30; 144/216-ct → 24x36; 432/864/1728-ct → 36x60
  - load tier fits the location (Tier 15+ in a driveway or parking lot; Tier 8 on public sidewalks)
  - flowerpots only for FSTs without splice closures and for drops
- **Cable:** armored ribbon, in conduit (not direct buried outside Orlando), no FlexNAP unless approved.
- **CL rules:**
  - F2 at 1:1
  - SFU-like 5–12 → coil at the nearest HH
  - MDU coils only within **1000'** and BCL coils within **500'**, measured along a permittable path
  - coil fibers: ≤ 50 CLs at 1:1; 51–132 → 5 (BCL 6); 133–408 → 12; 409–840 → 18
  - each coil documented in IQGeo with its boundary association
  - PR/GC not counted unless sold
  - ETTC within 1500' → 12 fibers (macro) / 6 (small cell)
- **No Build:**
  - `no_build_reason` is populated only for valid reasons (denied access, significant roadblock, competing contract, > 1kft drop)
  - otherwise build_status is left alone

Don't raise a guideline finding when the data needed to judge it isn't in the files. Mark it **Verify** instead.

## 4. QC workbook

File name: `<PSA>_QC WORKBOOK_QC#.xlsx`. Read the xlsx skill first if one is available. Tabs:

1. **Summary:**
   - verdict (PASS / SEND BACK)
   - PDF, GPKG, round, and scope (Full DRC / Fast Track)
   - pages reviewed
   - testing report status
   - finding counts by severity
   - checklist totals (Pass / Fail / N/A / Verify)
   - the checklist and guideline versions applied
   - PASS/FAIL lines for: Route/PFP location, SC terminal check, PP/PFP terminal check, Cable reel PON vs IQGeo, Pole/Guy check, Combined aerial
   - primary send-back reasons
2. **Findings:** ID | Severity (Critical/High/Medium/Low) | Review Area | Source (Project Rule / Checklist item ref / Guideline §) | PDF Sheet | PDF Page | Finding | PDF Value | IQGeo Value | Required Correction | Review Focus
3. **Checklist:** columns Tab | Section | Item # | Task | Source tag | Result (Pass/Fail/N/A/Verify) | Finding ID | Remarks. Use the checklist's own wording and order, with every item present.
4. **Reel PON Check:** one row per reel: Reel / Cable name | PDF Sheet(s) | PDF Page(s) | Paired IQGeo record | Fibers PDF / IQGeo | Footage PDF / IQGeo | PON range PDF / IQGeo | Terminal PONs PDF / IQGeo | Future-loop PONs PDF / IQGeo | Result (Pass / Fail / Verify) | Finding ID(s).
5. **Prior Findings** (QC2 and later): prior ID | prior finding | status (Resolved / Still Open / Retracted) | evidence.
6. **Page Audit:** every page, its sheet, review status, and the number of findings on it.
7. **IQGeo Inventory:** the section 2 values.

Severity guide:

- **Critical:**
  - wrong equipment or PFP size
  - foreign data copied in
  - a PON flow or splicing error that breaks service, including a reel or terminal PON that doesn't match IQGeo
  - a guideline violation that makes the design unbuildable (e.g. a drop over 1000', a wrong splitter ratio)
- **High:**
  - quantity or method conflicts that affect construction
  - wrong terminal models or ports
  - an undersized HH
  - missing tie-down or grounding
  - a nonstandard tail without approval
- **Medium:**
  - reconciliation and IQGeo data issues
  - naming issues
  - a missing loop or station marker
  - title-block errors
- **Low:** drafting, spelling, and text-legibility cleanup.

## 5. Marked-up PDF

File name: the original PDF's exact base name + `_QC#.pdf`. Example: `PSA-1028PA-ALBQNMME-VICTOR_CD.pdf` → `PSA-1028PA-ALBQNMME-VICTOR_CD_QC1.pdf`.

1. **AutoCAD SHX Text annotations** (subject or title "AutoCAD SHX Text"):
   - Remove or flatten them so the visible drawing doesn't change.
   - Render every page before and after at the same DPI and pixel-diff the results.
   - If a page's visible content changed, bake that page's SHX appearances into the content instead of deleting them.
   - Never flatten the QC comments.
2. **QC markups:** add them as editable PDF annotations with a red border, no fill (see-through), and the finding ID plus text in the annotation contents.
   - A **circle** for an isolated item.
   - A **tight box** where circles would overlap or crowd.
   - If a DG check and a zero-foot strand finding fall on the same pole, **one combined box** whose text states both observations separately.
3. Place every markup on the actual affected pole, terminal, callout, title block, or note, never in empty space. Confirm the sheet and the pole ID (P-# / PNM) before placing. IQGeo-only findings with no print location go in the workbook only.

## 6. Verify before delivering

- Render every page that has markups and look at each one:
  - is it on the right object?
  - is it readable?
  - does it overlap anything?
- Fix any problems, then re-render.
- Confirm:
  - the QC annotations are still editable annotations
  - no SHX annotations remain
  - the drawing's visible content is unchanged
- Confirm the Checklist tab has every checklist item with a result, and every Fail links to a Finding.
- Confirm every reel on the print has a row in the Reel PON Check tab, and every reel row marked Fail links to a Finding.
- Recount the findings in the workbook against the PDF markups.
- Recheck every quantity and count by rerunning the code, not from memory.
- Only then call the deliverable complete. If anything is still pending, say so plainly.

## 7. Deliver

- Send the workbook and the `_QC#.pdf`. Summarise in a few lines:
  - verdict and counts
  - checklist totals
  - the top send-back reasons
  - the Verify items needing a manual check
- Save a short correction or status note for the PSA to the project so the next round can recheck it.