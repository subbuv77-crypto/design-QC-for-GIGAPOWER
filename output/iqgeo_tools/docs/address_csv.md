# IQGeo Address CSV Updater (Chrome extension)

Separate plugin from the Design CSV Updater. Takes a CSV report with one row per feature (e.g. the PSA demand point
report `PSA_3010PA_ALBQNMMA_VICTOR.<date>.csv`) and, in one run:
- **updates** the ticked attributes in IQGeo with the CSV values, and
- **removes extra spaces** from address fields (spaces at start/end, double spaces, tabs, line breaks,
  no-break and zero-width spaces), both in the CSV values and in values already in IQGeo.

## Install
1. Chrome → `chrome://extensions` → turn on **Developer mode**.
2. **Load unpacked** → select this folder.
3. Log in to IQGeo, open the map tab, click the extension icon → **Open address CSV updater on this page**.

## Use
1. **CSV file** – choose the report.
2. Check the settings that fill in automatically:
   - **Design to edit in** – from `design_job_name` (e.g. `design/PSA-3010PA-ALBQNMMA-VICTOR`).
   - **IQGeo feature type** (`demand_point`) and **ID column** (`id`). The panel shows the IQGeo id of the first row,
     e.g. `demand_point/957085`. If your IQGeo uses another feature type or id, change them here.
3. **Fields** – address fields are pre-ticked (`a_address`, `a_saddno`, `a_saddstr`, `a_saddsttyp`, `a_saddstsuf`,
   `a_scity`, `a_county`, `a_state2`, `a_szip`, `a_szip5`, `unit`, all `gis_street*`, `gis_city`, `gis_postcode`,
   `gis_unit_*` …). Tick any other field you also want updated (e.g. `build_status`, `gc_classification`).
4. Options:
   - **Update the ticked fields with the CSV values** – on by default.
   - **Remove extra spaces in address fields** – on by default. With only this ticked, the plugin just cleans spaces
     in IQGeo without changing any other value.
   - **Skip rows where deleted = Yes** – on by default.
   - **Blank CSV cells clear the value** – off by default (blanks are ignored).
5. **Test connection** – reads the first feature and tells you how many ticked fields exist on it.
6. **1. Preview** – reads every feature and lists each field that will change, with a count and an example
   (`·` = space, `⇥` = tab, `↵` = line break, `◦` = hidden space). **Download change report** = CSV of every change,
   marked UPDATE or REMOVE SPACES. Nothing is saved.
7. Untick any field you don't want, then **2. Apply ticked changes** – the first feature is saved and read back
   before the rest; the undo log downloads automatically.
8. Run **Preview** again – it should find 0 changes. **Restore from undo log…** puts old values back.

## Safety rules
- Writes go into the design entered in the panel (`PUT {base}/feature/{type}/{id}?delta={design}`); Preview won't
  run without one.
- Report columns joined from other tables (`design_*`, `demand_*`, `fst_*`, `dist_cluster_*`, `drop_cluster_*`,
  `mdu_boundary_*`, `prgc_boundary_*`, `term_fed_*`, `coiled_*`) and ids (`id`, `glid`, `ll_uuid`, `sn_asset_id`,
  `iqg_updated_fields`) are never written. A ticked field the IQGeo feature doesn't have is ignored and listed.
- Only values that differ are written. Each feature is re-read just before saving; if someone changed that field
  after your Preview, it is skipped (FAILED in the log).
- Number and true/false fields are written as numbers/booleans when IQGeo stores them that way.
