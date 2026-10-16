# IQGeo Tools v1.1 (Chrome extension)

One extension containing the IQGeo bulk-update tools. Each tool works exactly as its separate extension did:

| Tool | What it does | Details |
|---|---|---|
| **Design CSV Updater** (v3.4) | Update attributes of any feature type from the design export (zip) or CSVs; clean extra spaces | `docs/design_csv.md` |
| **Address CSV Updater** (v1.0) | Update demand point (or other) addresses from a CSV report; remove extra spaces | `docs/address_csv.md` |
| **Wall Box Address Updater** (v2.0) | Match wall boxes to address points by coordinates and copy the address | `docs/wallbox_address.md` |
| **Name Address Updater** (v1.2) | Fill manhole / pole addresses from the feature name; postal code from the PSA address file or USPS | `docs/name_address.md` |
| **Delete Conflict Fixer** (v1.1) | Clear *Conflict: Update / Delete* by keeping the design's delete | below |

## Install
1. Remove (or turn off) the four separate extensions in `chrome://extensions`, so you don't have two copies of a tool.
2. **Developer mode** on → **Load unpacked** → this `iqgeo_tools` folder.
3. Log in to IQGeo, open the map tab, click the **IQGeo Tools** icon and pick a tool.

Opening a tool hides the other tool panels, so they don't stack on top of each other. A hidden tool keeps its files, preview and any
run in progress; pick it again in the popup to show it. Clicking the tool that is already showing hides it.

## New in every tool
- **■ Stop** (next to Apply) – enabled while Preview / Check, Apply or Restore is running. It finishes the requests already in
  progress (up to *Parallel* features) and starts nothing new.
  - Stopped **Preview**: Apply stays disabled, because only part of the features were checked. Run Preview again.
  - Stopped **Apply**: features already saved are in the undo log (downloaded as usual); the log says how many were not attempted.
    Those were not changed. Run Preview again to see what is left.
  - Stopped **Restore**: the log says how many features were not restored. Run Restore again with the same undo log
    (restoring a feature twice is harmless).
- **Clear file selection** (under the file inputs) – empties the file inputs and forgets everything loaded from them: the features,
  the address file (Name tool), the field / feature type lists, the preview and the undo log in the panel. It also clears
  *Design to edit in* and *Only features with Design Created =*, because those are filled from the files – check them after
  loading the next design. Download the undo log first if you still need it. Disabled while a run is in progress (Stop first).

## Delete Conflict Fixer (v1.1)
For a Check Design conflict **Master Change: Update / Delta Change: Delete**: the design deleted a feature that someone else
changed in master afterwards. The fixer keeps the design's delete:
1. Open it on the IQGeo tab. *Design to fix* is read from the title bar (e.g. `design/PSA-2023PA-ALBUNMTL-VICTOR`) – check it.
2. Enter the id(s) (e.g. `877682`), or `type/id`. Bare ids are tried against the listed feature types in master (read only).
3. **1. Preview** – shows the type found, the master name (e.g. `69`), who changed it in master and when, and whether it is
   deleted in the design. Make sure it is the conflicting feature.
4. **2. Keep the delete** – for each feature: the current master version is put into the design (`PUT …?delta=`), then deleted
   in the design (`DELETE …?delta=`), so the design's delete is now based on the current master version. It then checks the
   feature is gone in the design and that master is unchanged. Master is never written.
5. Run **Check Design → Conflicts** in IQGeo again; the conflict should be gone.

If the delete step fails after the PUT, the feature is back in the design – the log says so; delete it in IQGeo by hand.

## Permissions
`activeTab`, `scripting` (open the panel on the IQGeo tab), `storage` (USPS key/secret and cache, Name tool only) and host access
to `apis.usps.com` / `apis-tem.usps.com` (USPS lookup, Name tool only). IQGeo itself is reached from the page with your login.

## Files
- `manifest.json`, `popup.html`, `popup.js` – the extension and the tool picker
- `background.js` – USPS lookups (Name tool)
- `tools/design_csv.js`, `tools/address_csv.js`, `tools/wallbox_address.js`, `tools/name_address.js` + `tools/namerules.js` – the tools
- `docs/` – each tool's own instructions
