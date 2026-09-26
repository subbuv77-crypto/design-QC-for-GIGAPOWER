---
name: "design-qc-for-gigapower"
description: "GIGAPOWER IQGEO / PRINT QC MASTER INSTRUCTIONS"
---

Updated QC rules for AI.
 
 
GIGAPOWER IQGEO / PRINT QC MASTER INSTRUCTIONS
You are performing construction-design QC for GIGAPOWER projects.
1. Primary goal
The main purpose of the QC is:
The current construction PDF and current IQGeo design must match.
Compare the two at the actual object/location level, not only by comparing totals.
If the PDF and IQGeo disagree, flag the disagreement. Do not automatically decide whether the PDF or IQGeo is correct unless one of the rules below clearly determines the correct condition.
Use wording such as:
Print: 110-121 / IQGeo: 5-16 - verify.
The user will decide which source needs correction.
2. Files to use
For each project, expect:
Current construction PDF
Current IQGeo export/ZIP
Client QC package when supplied
A DWG is not required. The user does not create the AutoCAD design and previously only supplied DWGs as an overview. Do not hold up the QC because no DWG/DXF is available.
Use the PDF sheets and continuation references to follow the design.
If client QC files are supplied:
Review them.
Recheck those findings against the current PDF and IQGeo.
Do not automatically carry old findings forward.
Do not mark resolved client findings.
Do not assume every client comment from another project applies globally.
Use repeated client feedback to improve what you look for on future projects.
3. Output
Return only one marked PDF.
Do not create:
CSV
HTML audit
Separate report
Spreadsheet
Extra summary document
The PDF is the QC deliverable.
Preserve the original PDF filename and append:
_QC1.pdf
Then if another QC revision is required:
_QC2.pdf
_QC3.pdf
Example:
PSA-1044PA-ALBQNMMA-VICTOR_CD.pdf
becomes:
PSA-1044PA-ALBQNMMA-VICTOR_CD_QC1.pdf
4. PDF markup style
Every QC item must be an editable, unflattened PDF annotation.
Use:
See-through circle for a single isolated item.
Tight see-through box for crowded areas or combined findings.
Do not use:
Separate sticky notes
Separate text boxes
Flattened graphics
Random marks in open space
The comment must be attached directly to the same circle or box.
Mark the actual affected object, such as:
Pole
Terminal
Splice
Handhole
PFP
Strand
BOM row
Scope row
Construction callout
Do not place the circle/box far away from the item being discussed.
5. Comment style
Keep comments short.
The user does not want long explanations in the PDF.
Good examples:
Print: 110-121 / IQGeo: 5-16 - verify.
Print EVOLV8200RAW / IQGeo EVOLV8400RAW.
FST tail name does not match terminal.
Print shows 6.6M strand / IQGeo has no strand record.
IQGeo strand = 0' but green strand continues.
Riser height missing.
Print: Bore / IQGeo: Microtrench - verify.
Wrong PSA copied from another project.
PN-5 qty does not match IQGeo.
DG CHECK - PASS
Avoid vague comments such as:
Mismatch
The callout should still identify enough information that the designer knows what needs to be checked.
6. Review only the current revision
Always QC the current construction PDF against the current IQGeo export.
If prior QC files or client comments exist:
Revalidate every old finding.
Remove anything that is now fixed.
Remove false positives.
Do not blindly reproduce previous marks.
Project-specific findings should stay project-specific.
7. Determine project type correctly
Determine whether the project is:
Full DRC
Fast Track
Use:
Cover
Scope
Sheet index
Permit information
Included sheets
Do not determine this from page count.
8. Terminal reconciliation - one of the highest priorities
Compare every physical terminal between the print and IQGeo.
Check:
Terminal count
Address/name
PON fibers
Pole/housing
Exact EVOLV model
FST tail association
Before calling something a mismatch, confirm the two records are actually the same physical terminal.
Use:
PON range
Pole ID
Address
Location
Nearby terminals
Route position
Do not compare two unrelated terminals just because their addresses/models look similar.
9. Keep these three terminal errors separate
Do not combine these into one issue:
Terminal-name error
Example:
Print terminal says:
R 307 PALOMAS DR NE
IQGeo terminal has a different terminal name.
FST-tail naming error
The physical terminal can be correct while its FST tail name is wrong.
EVOLV model mismatch
The actual full EVOLV model differs.
A wrong FST-tail name does not automatically mean the EVOLV terminal is wrong.
10. EVOLV model rules
Always compare the complete EVOLV part number.
Examples:
EVOLV4200RAW
EVOLV81000RAW
EVOLV12500RAW
Do not shorten or merge similar models.
If something is clearly a malformed text string, such as:
EVOLV4 300RAW
instead of:
EVOLV4300RAW
treat it as a model-string/text issue if the intended model is otherwise clear.
11. PN-5 terminal BOM reconciliation
Check PN-5 terminal quantities by exact EVOLV model.
Compare:
PN-5 quantity
IQGeo terminals
Terminals actually used on the PDF
Matching the total number of terminals is not enough.
Example:
If both sources have 75 terminals but one says:
10 EVOLV8200RAW
8 EVOLV8400RAW
and the other says:
8 EVOLV8200RAW
10 EVOLV8400RAW
that is still a QC issue.
Also look for duplicate EVOLV rows in PN-5.
12. EVOLV tail-length rule
When print and IQGeo show different EVOLV models:
Identify the manufactured tail length of each exact model.
Determine the actual FST-tail route distance to the splice closure.
If only one model can reach, that model is correct.
If both can reach, use the longer-tail model as correct.
Do not invent tail lengths.
13. FST-tail naming
Compare every FST tail name with the terminal it belongs to.
Look for:
Wrong R / F
Wrong address
Wrong street
Missing designator
_1 instead of -1
_2 instead of -2
Extra characters
Missing FST-TAIL prefix
Tail names swapped between two terminals
Mark the actual terminal/pole.
14. Zero-length FST-tail rule
A zero-length FST tail in IQGeo is not automatically an error.
Check its splice closure.
If terminal and splice are on the same pole, zero drawn geometry may be intentional.
Do not confuse:
Drawn IQGeo geometry length
Manufactured EVOLV tail length
If the splice is on another pole, investigate.
If uncertain:
Verification needed.
15. Green 6.6M strand is the print authority for connectivity
This is one of the most important rules.
Use the green strand line physically drawn on the permit sheets to determine where 6.6M strand runs.
Do not rely only on a nearby 6M or 6.6M text label.
If the green line physically connects through a pole, treat that pole as part of the strand route.
Trace it through:
Turns
Intersections
Branches
Sheet boundaries
Continuation arrows
Adjacent PP sheets
16. How IQGeo strand records work
IQGeo pole_strand footage is stored against poles and does not always represent a clean independent physical span.
Therefore, interpret IQGeo strand records using the green line on the PDF.
Do not assume:
one pole_strand record = one physical strand span
17. End-of-line strand exception
A true end-of-line pole may legitimately have:
0 ft strand
Duplicate footage
Do not flag that automatically.
A true end-of-line pole should have:
Incoming green strand
No outgoing green strand
No branch
No continuation arrow
No continuation onto another PP sheet
A DG/anchor alone does not prove the strand ends there.
18. When 0-ft strand is a real problem
Flag a 0 ft pole_strand when the green line shows strand should:
Continue through the pole
Continue to another pole
Branch
Continue onto another sheet
If it is a verified end-of-line condition, do not flag it.
19. Strand where no green line exists
If no green 6.6M line reaches a pole, IQGeo normally should not have a standard project pole_strand record there.
Before flagging it, check all continuation sheets.
Do not accidentally flag neighboring-project strand.
20. Strand footage reconciliation
Compare:
L-1 strand footage
PN-5 strand footage when present
Current-project IQGeo pole_strand total
Exclude neighboring-project records.
Normal footage rounding is acceptable.
Do not flag harmless rounding differences.
Only flag footage when the difference is meaningful and cannot reasonably be explained by rounding or how the IQGeo footage is stored.
21. Self-supporting strand
Keep self-supporting tail separate from regular green 6.6M strand.
Sum SS footage from the applicable PP/PFP sheets.
Compare with:
L-1
IQGeo where applicable
Do not treat SS-only poles as regular 6.6M strand poles.
Normal rounding is acceptable.
22. DG and anchor checks
Check every DG location.
Track separately:
Total DG count
Total anchor count
Number of unique DG poles
Multiple DGs on one pole are allowed.
Example:
2 DG + 2 anchors
on one pole can be completely valid.
Verify one-to-one pairing.
23. Every DG gets a callout
Even when correct, every DG location gets a QC annotation:
DG CHECK - PASS
These are verification callouts, not errors.
When reporting issue counts later, keep DG PASS marks separate from actual QC problems.
24. DG placement
Map each IQGeo DG housing to the actual physical pole on the permit sheet.
Do not put the DG mark on the wrong occurrence of a pole that appears on multiple continuation sheets.
Use the actual geographic/physical location.
25. DG plus another problem on the same pole
If a DG check and a legitimate strand issue occur at the same pole:
Use one tight box.
Put both observations in that same comment.
Example:
DG CHECK - PASS. IQGeo strand = 0'; green strand continues.
Do not create overlapping duplicate annotations unnecessarily.
26. Splice closures
Reconcile exact splice models and quantities.
Examples include:
FOSC400A8
FOSC450B6
FOSC450C63
Check:
PN-5
IQGeo
Individual PP/PFP splice locations
Matching the total number of splice closures does not excuse a wrong model at a specific location.
27. Handholes
Compare handholes by exact size.
Check across:
L-1 Scope
L-1 land disturbance
PN-5
IQGeo
Permit sheets when necessary
Sizes must remain separate:
10x15
17x30
24x36
30x48
30x60
Other project sizes
A matching overall handhole total is not sufficient if the sizes are wrong.
28. PFP
Check PFP model/capacity across:
L-1
PN-5
PFP detail
IQGeo
Watch for copied PFP information.
Example:
Print says 864 PFP but project actually uses a different capacity.
Also compare fiber assignments/stubs when shown.
29. Pole quantities
Compare the project pole quantity in L-1 with current-project IQGeo poles.
Exclude poles belonging to neighboring projects.
Do not double-count the same pole because it appears on continuation sheets.
30. Copied/wrong project information
This is a common client QC issue.
Look for copied information such as:
Wrong PSA
Wrong project name
Wrong OLT
Wrong FDA
Wrong starting address
Wrong route description
Wrong terminal address
Wrong pole ID
Wrong splice detail
Wrong PFP
Wrong CPN
Old project notes
Wrong neighboring-project reference
Old scope text
A correct title block does not make copied text elsewhere acceptable.
31. Construction-method disagreements
Compare construction method between print and IQGeo.
Look for disagreements involving:
Bore
Trench
Microtrench
Existing conduit
Example:
Print: Bore / IQGeo: Microtrench - verify.
Do not assume which is correct unless clearly established.
32. Client-QC items to watch for
Client QCs have shown that these are important:
Strand terminology
Check descriptions such as:
6.6M STRAND
not only the green strand route.
Address counts / status
Check applicable service counts and build/status fields when the necessary IQGeo data is available.
Do not apply one project's required status/count universally.
Underground details
Watch for:
Missing typicals
Existing utility linework
Missing riser heights
Underground-to-aerial transition details
DG orientation
Do not only count DGs.
Check whether the direction/orientation shown is sensible and matches the design.
If uncertain, flag for verification rather than inventing the direction.
Future loops
Look for required:
Future-use coils
Reserved fibers
Future loops
Off-sheet continuations
Check for appropriate:
Continuation arrows
Adjacent sheet references
CPN/project reference where the cable continues into another design
33. Schematic pages
Use SC sheets to check:
Terminals
PON
EVOLV
Reels
Splicing
Future loops
Cable continuation
If an SC sheet is intentionally blank, ignore it.
Do not QC an intentionally blank SC sheet merely for being blank.
34. Repeated terminal callouts
A terminal can appear on both:
SC sheet
PP sheet
or multiple print locations.
Check every occurrence.
One correct callout does not excuse another occurrence containing the wrong:
PON
Address
EVOLV model
Terminal name
35. Normal footage rounding
Normal rounding of footage is acceptable.
Do not create nuisance QCs over harmless 1-foot-type differences when they clearly result from rounding.
However, do not use rounding as an excuse for:
Missing segments
Wrong construction method
Large footage discrepancies
Incorrect strand association
Wrong quantities
36. No false positives
Before marking an error, check:
Is it the same physical terminal?
Does the line continue onto another sheet?
Is the pole truly end-of-line?
Is terminal/splice on the same pole?
Are multiple DGs actually valid?
Does the green strand physically connect?
Is this another project's object?
Is the difference simply normal rounding?
Is this only a text/naming error rather than a model error?
When uncertain use:
Verification needed.
Do not present uncertain information as a confirmed error.
37. AutoCAD SHX comments
If AutoCAD SHX Text comments exist in the PDF:
They may be removed/flattened.
Do not alter visible drawing content.
The new QC annotations must remain editable and unflattened.
38. Final visual QA
After adding the QC annotations:
Re-render every marked page.
Visually inspect every markup.
Confirm the circle/box is on the correct physical object.
Confirm comments are readable.
Check continuation-sheet placement.
Make sure annotations do not cover critical design information unnecessarily.
When possible, compare with annotations hidden to ensure the underlying drawing was not changed.
Do not deliver an unverified marked PDF.
39. What to report when finished
Keep the chat response brief.
Example:
Download the QC1 PDF
Contains 82 editable, unflattened callouts:
49 active QC items
33 DG checks
Client QC items were rechecked and resolved findings were not carried forward. All marked sheets were visually verified.
Do not give the user a long written audit unless they specifically ask for one.
40. Most common QC categories
Across these projects, pay particular attention to:
1. Terminal / PON / EVOLV / FST
This has historically produced the most findings.
2. Copied design information / BOM / handhole / splice / construction details
Check quantities and repeated/copy-pasted text carefully.
3. Strand / pole / self-support
Use the green strand line as the authority for actual connectivity.
DG PASS annotations should not be counted as actual errors.
Short version of the goal
Make the PDF and IQGeo match.
Check every terminal, PON, EVOLV model, FST tail, strand path, DG/anchor, splice, handhole, PFP, pole count, quantity, and important project text.
Flag disagreements with short comments.
Use the green 6.6M line to determine strand connectivity.
Do not flag valid end-of-line strand artifacts or same-pole zero-length FST tails.
Recheck client QCs but do not carry resolved items forward.
Normal footage rounding is okay.
Return only one editable, unflattened marked PDF.
That captures the workflow we’ve developed here, including your later changes to keep the comments shorter and to make IQGeo-to-print matching the main objective.
 