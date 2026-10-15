# IQGeo Design CSV Updater v3.2 (Chrome extension)

Updates attributes of **every feature type** in an IQGeo design in one run, from the design's CDIF export
(`design_YYYYMMDD_HHMMSS.zip`) or from individual CSV files. Replaces the wall-box-only v2.
A second mode, **Clean extra spaces**, fixes extra spaces in text fields for all features in the design.

## Install
1. Chrome → `chrome://extensions` → turn on **Developer mode**.
2. **Load unpacked** → select this folder. Remove v1/v2 to avoid confusion.
3. Log in to IQGeo, open the map tab, click the extension icon → **Open design CSV updater on this page**.

## Workflow
1. Export the design from IQGeo (CDIF zip).
2. Unzip, edit the attribute values you want in any of the CSVs (wall_box, pole, fiber_cable, splice_closure, …),
   and zip the folder again — or keep the files loose.
3. In the panel:
   - **Design to edit in** – filled automatically from `delta_created` (e.g. `design/PSA-1043PA-ALBQNMMA-VICTOR`). Check it.
   - **Choose files** – pick the zip, or select several `.csv` files together with their `.fields` files.
   - **Feature types** – untick types you didn't edit; Preview is faster.
   - **Test connection** – reads one feature to prove the REST endpoint works.
   - **1. Preview changes** – compares every attribute with live IQGeo. Lists each changed field with a count
     and an example. Nothing is saved. **Download change report** gives a CSV of every change and every invalid value.
   - Untick any field you don't want written.
   - **2. Apply ticked changes** – saves the first feature, reads it back to verify, then does the rest.
     The undo log downloads automatically when it finishes.
   - Run **Preview** again afterwards — it should report 0 changes for what was applied.
4. **Restore from undo log…** puts the old values back.

## Clean extra spaces (second mode)
Replaces the separate *IQGeo Batch Space Cleaner*, but works from the design export instead of the results list,
and saves through the REST API instead of clicking through IQGeo's editor (much faster, no editor windows).

1. Click the **Clean extra spaces** tab at the top of the panel.
2. Load the design export zip (same as above) and check the design name.
   **Only features with Design Created =** is filled with the design name (e.g. `PSA-1043PA-ALBQNMMA-VICTOR`).
   Only features whose *Design Created* (`delta_created`) equals it are checked and fixed; `design/` in front is optional.
   It is checked in the export and again on the live feature. Types with no Design Created field (routes, slack)
   are left out while the filter is set — the log lists them. Clear the box to clean all features.
3. **1. Check spaces** – the export is scanned to find features whose text fields have extra spaces; only those are read
   from IQGeo and checked against their live values. Tick **Check every feature in IQGeo** to read all features instead
   (slower, catches spaces added after the export).
   Examples show `·` = space, `⇥` = tab, `↵` = line break, `◦` = hidden space character (no-break / zero-width).
4. Untick any field you want left alone, then **2. Fix ticked fields**. Same safety as updates: first feature verified,
   features changed since the check are skipped, undo log downloaded automatically.
5. Run **Check spaces** again – it should find nothing.

Cleaning = remove spaces at the start/end; turn tabs, double spaces, no-break and zero-width spaces into one space;
turn line breaks into one space (or keep them with **Keep line breaks in multi-line fields**). A value that is only
spaces becomes empty. Only text fields are cleaned. These are never touched: IDs and codes
(`glid`, `sn_asset_id`, `cbl_sn_id`, `lat_lon`), `specification` and other references, `labor_costs`, `mapping`,
`*_info` fields, and any value that looks like JSON. The same protected fields and feature types as below apply.

## Rules
- Only values that differ from IQGeo are written; you don't have to delete untouched columns or rows.
- Everything is written into the one design entered in the panel (`PUT {base}/feature/{type}/{id}?delta={design}`).
  Preview refuses to run without a design, so master data is never edited by accident.
- Blank cells are ignored unless **Blank CSV cells clear the value** is ticked.
- Never written: `id`, geometry, timestamps, audit fields (`created_at`, `update_user`, `delta_created`, `design_id`, …),
  and reference fields (`housing`, `root_housing`, `in_structure`, `cable`, …). `specification` *is* writable; the export's `anchor_spec/` style prefix is ignored, so `anchor_spec/ANCHOR` = `ANCHOR`.
- Network-model types managed by IQGeo Comms (`mywcom_fiber_segment`, `mywcom_fiber_connection`,
  `mywcom_line_of_count*`, `mywcom_route_junction`) are listed but never updated. `mywcom_fiber_slack` is editable.
- Values are checked against the `.fields` types: whole numbers, numbers, true/false (`True`, `TRUE`, `yes`, `1`…),
  dates (`YYYY-MM-DD` or Excel `M/D/YYYY`), and string max length (e.g. `addr_state` ≤ 2). Invalid values are skipped and listed.
- Each feature is re-read just before it is saved. If someone changed that field in IQGeo after your Preview,
  the feature is skipped (shown as FAILED) instead of overwriting their edit.
- Duplicate ids in a CSV: the first row is used, the others are ignored.

## Editing in Excel
Excel can silently change values: leading zeros (`01` → `1` in `shelf`, `slot`), long numbers, dates.
Number precision, `TRUE/FALSE` and `M/D/YYYY` dates are handled, but leading zeros are not —
if Preview shows a field you didn't touch, untick it. Save as **CSV UTF-8**.

## If something fails
Copy the log text (HTTP status and message). Common causes: wrong base URL path prefix, a different REST path,
a CSRF/permission rule, or the design name format.
