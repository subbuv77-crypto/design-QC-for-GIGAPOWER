# IQGeo Wall Box Address Updater v2 (Chrome extension)

Upgrade of the *IQGeo Wall Box Address Filler* v1 to the updater model used by the Design CSV Updater:
same address matching rules, but it saves through IQGeo's REST API instead of typing into the editor, and adds
design-zip upload, a field-level preview, read-back verification, an undo log and a change report.

## Install
1. Remove the old *Wall Box Address Filler* (v1) to avoid confusion.
2. Chrome → `chrome://extensions` → **Developer mode** on → **Load unpacked** → this folder.
3. Log in to IQGeo, open the map tab, click the extension icon → **Open wall box address updater on this page**.

## Use
1. **Wall boxes** – the design export zip (it reads `structures/wall_box.csv` and `wall_box.fields`), or a wall box CSV
   with an `id` column (`wall_box/2847600` or `2847600`). Coordinates come from the `location` column, or from IQGeo.
2. **Address export CSV** – e.g. `PSA_3010PA_ALBQNMMA_VICTOR.<date>.csv`. Coordinates: `demand_point_lat/lon`,
   else `a_lat/a_lon`, else `gis_latitude/longitude`.
3. Check **Design to edit in** and **Only wall boxes with Design Created =** (both filled automatically;
   clear the second box to include every wall box).
4. Options (same as v1): **Overwrite existing values** (off = only fill blanks), **Skip wall boxes whose house number
   or street would change**, **Max distance** (1 m).
5. **Test connection** → **1. Preview**. Lists each address field that will change with a count and an example, and a
   summary of skipped wall boxes. **Download change report** = one row per wall box field, with the distance to the
   address point and the address id; skipped wall boxes are listed with the reason. Nothing is saved.
6. Untick any field you don't want → **2. Apply ticked changes**. The first wall box is saved and read back before the
   rest; the undo log downloads automatically. **Restore from undo log…** puts old values back.
7. Run **Preview** again – it should find 0 changes.

## Fields and rules (unchanged from v1)
House Number, Street Direction, Street Name (Title Case), Street Name Suffix (UPPER), City (UPPER), State,
Postal Code, Postal Code plus 4, County (UPPER), Country (USA), Unit, Full Address
(`4602 Carlton St NW, Albuquerque, NM 87107, USA`).
A value is never blanked because the address point lacks it. Extra spaces are removed from every value written,
and extra spaces already in IQGeo are fixed (marked REMOVE SPACES in the report).

## New in v2
- REST API (`GET/PUT {base}/feature/wall_box/{id}?delta={design}`) – no editor windows, runs in parallel,
  you can keep using IQGeo.
- Field-level selection, read-back check of the first save, wall boxes edited after Preview are skipped
  instead of overwritten, undo log + restore, change report.
- Design Created filter; field lengths checked against `wall_box.fields` (e.g. state ≤ 2, postal code ≤ 5).
- Flags wall boxes that share a spot with another wall box.
