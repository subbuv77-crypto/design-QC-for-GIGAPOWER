# IQGeo Name Address Updater v1.2 (Chrome extension)

Fills and corrects the address attributes of **manholes and poles** from the feature **name**
(e.g. `POLE R 1021 ARIZONA ST SE`, `F 1310 RIDGECREST LOOP SE HH`). Same model as the Wall Box Address Updater:
saves through IQGeo's REST API, with preview, field-level selection, read-back verification, undo log and change report.
No address-point file is needed – the name is the source. Optionally, the **Postal code** can be taken from the PSA address export (v1.2).

## Install
1. Chrome → `chrome://extensions` → **Developer mode** on → **Load unpacked** → this folder.
2. Log in to IQGeo, open the map tab, click the extension icon → **Open name address updater on this page**.

## Use
1. **Manholes / poles** – the design export zip (reads `structures/manhole.csv` and `pole.csv` plus `.fields`), or one or
   more CSVs with an `id` column (`pole/123` or just `123`; the type is taken from the file name, else from
   *Feature type for bare ids*). The current name is read live from IQGeo; the CSV `name` is only a fallback.
2. Check **Design to edit in** and **Only features with Design Created =** (both filled automatically; clear the second to include all).
3. *(Optional, recommended)* **Address file for Postal code** – load the PSA address export CSV (e.g.
   `PSA_3024PA_ALBQNMMA_VICTOR.<date>.csv`, or a zip containing it). See "Postal code from the address file" below.
4. *(Optional)* tick **Look up Postal code + plus 4 from USPS** and enter your USPS Consumer Key / Secret
   (see "USPS lookup" below), then **Test USPS**.
5. Check the address defaults: City `Albuquerque`, State `NM`, Postal code `87108`, County `Bernalillo`, Country `USA`.
6. Options: **Overwrite existing values that do not match the name** (off = only fill blanks); **Clear Postal Code plus 4
   when the house number or street changes**; **Name case** (Title: `St`, `Albuquerque` / UPPER: `ST`, `ALBUQUERQUE`).
7. **Test connection** → **1. Preview** (lists every field that will change with a count and an example; nothing is saved) →
   untick any field you don't want → **2. Apply ticked changes**. The first feature is saved and read back before the rest;
   the undo log downloads automatically. **Restore from undo log…** puts old values back. Run Preview again – it should find 0 changes.

## Name rules
`[POLE|FP|HH] <letter>[-][n] <number>[-n] <street name> <type> [direction] [HH]`
(prefix may be `F`, `F-`, `F-1`, `F1`; a house-number suffix like `3124-1` / `3124-2`, `3025-A` / `2709-B` or `2709B` is ignored → house number `3124` / `3025` / `2709`; e.g. `POLE O1 3200 CARLOTA RD NW`, `POLE O-1 3200 CARLOTA RD NW`, `POLE F- 1900 Cherry Ln NW`, `POLE R 1913 GABALDON CT`; case does not matter)

| Field | Value |
|---|---|
| addr_house_number | number (`1125-3` → `1125`, `3025-A` → `3025`) |
| addr_street_direction | SE / SW / NE / NW / N / S / E / W |
| addr_street_name | Title Case (`RIDGECREST` → `Ridgecrest`) |
| addr_street_name_suffix | ST→St, DR→Dr, AVE→Ave, BLVD→Blvd, PL→Pl, RD→Rd, LOOP→Loop, CT, LN, WAY, CIR, TER, PKWY, HWY, TRL, PLZ |
| addr_city / state / postal_code / county / country | the defaults in the panel |
| addr_full | `1021 Arizona St SE, Albuquerque, NM 87108, USA` |

- `addr_postal_code_plus_4` cannot be derived from a name. With the USPS lookup on, it is filled from USPS; with it off
  it is never filled, only cleared when the address changes (the old +4 belonged to another address).
- **Names without a direction** (`... GABALDON CT`): the direction is left blank, as the name says. Use *Name has no direction → Keep the direction already in IQGeo* to keep an existing one (it is then also used for USPS and `addr_full`).
- `PI` as a street type is read as `Pl` (typo). A truncated type such as a lone `C` is treated as part of the street name – fix the name if that is wrong.
- `addr_unit`, house number suffix and thoroughfare are never touched.
- **No street type** (`CALLE DE DANIEL NW`, `DON PEDRO NW`): the last word is not a known type, so the whole text becomes the street name
  (`Calle De Daniel`) and `addr_street_name_suffix` is left blank (an old suffix in IQGeo is cleared). Known types: see `TYPES` in `namerules.js`.
- Features whose name does not match the overall pattern (`<prefix> <number> <street> ...`) are **skipped and listed** in the report (never guessed).
- Stray spaces already in IQGeo are fixed (marked REMOVE SPACES). Field lengths are checked against `.fields`
  (state ≤ 2, postal code ≤ 5, …).
- Features edited in IQGeo after Preview are skipped instead of overwritten.

The rules in `namerules.js` produce exactly the values in the manhole_filled.csv / pole_filled.csv files
(237 rows checked, 0 differences).

## Postal code from the address file (v1.2)
The export's address columns are used: `a_saddstr` (street name), `a_saddsttyp` (type), `a_saddstsuf` (direction),
`a_saddno` (house number), `a_szip5` (ZIP) and `a_szip` (ZIP-plus4). If those are empty the `gis_streetname` / `gis_streettype` /
`gis_streetdirection` / `gis_streetnr` / `gis_postcode` columns are used instead. Case does not matter, and types are normalised (`STREET`/`ST` → `St`).

For each pole or manhole, the street name, type and direction from its name are matched against the file:
1. **Same house number** in the file: that address's ZIP, plus its +4 (`a_szip` `87102-1120` → `1120`).
2. **Only one ZIP on the street**: that ZIP. The +4 is cleared when the ZIP changes.
3. **Street has several ZIPs** (e.g. Commercial St NE has both 87102 and 87107): the ZIP of the
   **nearest house number on the same side of the street** (odd/even). The report adds `ADDRESS FILE NOTE … nearest house number … – check`.
4. **No match** (e.g. `CANDELARIA RD NW` when the file only has `CANDELARIA RD NE`, or `COMMERCIAL CT` vs `COMMERCIAL ST`): USPS is asked
   if the USPS lookup is on, otherwise the default postal code from the panel is kept. The report lists every such feature.

- A name without a direction matches the street with any direction.
- The address file is used first. USPS is only asked for features the file does not match, which saves API calls.
- With *Clear Postal Code plus 4…* ticked, the +4 is also cleared whenever the postal code changes, because the old +4 belonged to the old ZIP.
- The panel shows how many features were matched, how many used the nearest house number, and how many were not matched.
  The change report shows which rule set each `addr_postal_code` value.

Checked against `pole.csv` of PSA-3024PA-ALBQNMMA-VICTOR: 190 of 192 poles matched (95 change 87107 → 87102), 2 not matched.

## USPS lookup (v1.1)
Uses the USPS **Addresses 3.0** API (`GET /addresses/v3/address`, OAuth 2.0 client credentials).
1. Register at <https://developer.usps.com>, **Add App**, and add the **Addresses** API to it. Copy the Consumer Key and Consumer Secret.
2. In the panel tick *Look up Postal code + plus 4 from USPS*, paste key and secret, choose Production (or Test), click **Test USPS**
   (it checks the USPS documentation example, 3120 M St NW, Washington DC → ZIP 20007).
3. **Preview** asks USPS once per distinct street address (name → `1021 Arizona St SE`, city, state), one request at a time.
   - USPS confirmed the address (DPV not `N`): `addr_postal_code` and `addr_postal_code_plus_4` come from USPS, and `addr_full` uses that ZIP.
   - USPS could not confirm it: the default postal code from the panel is kept, the +4 is left alone, and the report says
     `USPS NOTE: address not confirmed by USPS`.
   - USPS spells the street differently from the name (e.g. name `RIDGECREST LOOP`, USPS `RIDGECREST PL`): the name still wins
     for street fields, and the report lists a `USPS NOTE` so you can decide.
   - Rate limit (HTTP 429) or a login problem: lookups stop, the remaining features use the default postal code, and the panel says so.
     Wait and Preview again – answers already received are cached in the extension (production only), so only the rest is asked.
4. Key/secret go only to `apis.usps.com` (or `apis-tem.usps.com` for Test) from the extension's background worker. They are saved
   in this browser (`chrome.storage.local`) only if you tick *Remember*.

Extension changes in 1.2: `namerules.js` (`isAddrFile`, `buildAddrIndex`, `lookupZip`) and `content.js` (Address file input). No new permissions.

Extension changes in 1.1: new `background.js`, and `manifest.json` now requests the `storage` permission and host access to the two USPS API hosts.
After updating, reload the extension in `chrome://extensions`.
