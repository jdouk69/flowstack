# InboxVault baseline comparison — 6 October 2026

Result: **Sites is not yet a complete replacement for the original Base44 app.** Further audit expansion is paused until document collection and saving pass the acceptance gate below.

## Evidence and limits

- Read current default-branch source from https://github.com/jdouk69/flowstack, including Rules, Welcome, CreateRuleWizard, FileBrowser, downloadPdfs, previewResults, listWorkflowFiles, mergePdfs, contentDedupe, resolveWorkflowFolder, Supplier and RunHistory. The retained list/merge/preview/folder-resolution/entity references match the current GitHub files apart from trailing newline.
- Compared Sites frontend actions with their actual API handlers, not just page names.
- Reran all 47 unit tests and the ephemeral Worker/D1/R2 integration suite. All passed. The suite validates storage, exact downloaded bytes, duplicate and concurrent uploads, same-name collisions, attachment types, merge ordering/page counts, history, CRUD and account isolation. These are fixture tests, not real Google Drive writes.
- Owner's screenshot confirms AkronGpt search returned 19 emails and 19 matching attachments. The screenshot explicitly shows read-only preview; it does not demonstrate saving.
- Live records inspection found the owner's Excel upload `ΠΡΟΥΠΟΛΟΓΙΣΜΟΣ ΕΡΓΟΥ DOYKAKIS 19-9-24. 2.xlsx`, 16,167 bytes, saved on 2026-10-06 at 22:32:49 UTC / 15:32:49 America/Los_Angeles. Workflow is empty: **Unassigned**. A corresponding upload history record exists. No real file download was performed from the owner's signed-in session.
- Recent Worker error-log query returned no events. This does not establish that every browser interaction succeeds.
- No authenticated Base44 website/browser comparison was performed: an original live app URL/session was not supplied, and supported managed browser QA was unavailable. Original code establishes implemented behavior; I cannot confirm its current production behavior by clicking it.
- Base44 production, original GitHub repository, existing Drive files and audit spreadsheets were not modified.

## Comparison

| Original behavior | Sites frontend / backend / saving | Status and acceptance needed |
|---|---|---|
| Login and owner-scoped workflows | ChatGPT sign-in replaces Base44 authentication; owner scoped APIs | Adapted; fixture anonymous denial/account isolation pass; live owner has used app |
| Workflow creation/edit/delete | Original wizard and CRUD shape reused; retained filter types/extensions | Fixture CRUD passes; visual phone coverage incomplete |
| Sender email search | Search Gmail uses saved Supplier record | Real Akron search confirmed in screenshot; fixture query and owner guards pass |
| Company-name and advanced Gmail filters | Same modes; multiword sender quoted, advanced query grouped before attachment constraint | Adapted query grouping; fixtures pass; real-provider acceptance still needed for these modes |
| Preview counts and samples | Up to 300 message IDs and 50 MIME trees; estimates/lower bounds marked | Working partial parity; Base44 source searches all pages; Sites bounds are explicit |
| Run one supplier / Run all suppliers | Run workflow uses resumable per-workflow downloadPdfs; Dashboard Run all executes saved workflows serially with resumable batches | Single-workflow and serial multi-workflow fixtures pass; live Run all acceptance pending |
| Attachment selection/types | Workflow file-type selection preserved | Nested and inline Gmail collection uses saved file-type filters; fixtures pass; live acceptance pending |
| Save Gmail attachments | Run workflow writes private R2 originals and verified Drive copies | Fixture byte preservation / Drive contract pass; real Google write acceptance pending |
| Drive destination name and bound folder ID | Saved-ID / history / unique-name resolver binds folder; pending generated IDs make creation retry safe | Fixture ambiguity and denied-folder checks pass; actual folder permissions pending |
| Recover destination from original run history | Original source resolves saved ID/history/name safely | Implemented for current owner history; no original Base44 history imported or assumed |
| Actual Google Drive storage/export | OAuth grants saved; connection test separate | Implemented copy path; live writing remains unverified, not proven by authorization |
| Existing Drive files | Original FileBrowser server lists destination Drive folder | Browse Drive folder lists paged Drive files; View Files retains local originals. Selected or all original PDFs (1–20) can be imported to local Documents with exact-byte checks; fixture verification passes |
| Browse stored local originals | Documents paging, filename search and workflow/type filters | Fixture tests pass; owner's manual upload visible in live metadata; signed-in download still unverified |
| Original browser sort by name/date/modified/size | Original Drive browser reused with name/date/modified/size sorting and source dates | Fixture listing passes; phone interaction pending |
| Manual uploads | Sites addition; now select files → choose destination → Save files | Backend fixture upload/download passes; owner upload metadata found; new frontend needs phone acceptance |
| Byte-identical file dedupe | SHA-256 in local storage per owner/workflow; original Drive uses MD5 per destination folder | Adapted; repeat collection fixtures pass; owner lease serializes destination writes; real rerun pending |
| Same filename, different bytes | Local alternate filename preserves file extension | Fixture local and Drive same-name collision paths pass; originals retained |
| Email received and PDF metadata creation dates | Original stores labelled source dates in Drive metadata | Original date helpers reused in collection/Drive metadata; email receipt never becomes PDF creation or invoice date |
| Exact original download | Local stored-byte download API, supported attachments | Fixture byte-for-byte tests pass; Google original-to-stored-byte acceptance pending |
| Merge local selected PDFs | Select 2–20 in selection order, max 20 MB input, output stored locally | Fixture passes; differs from original all-folder name-sorted merge |
| Merge Drive PDFs back into destination | Original excludes previous `_merged_` files and creates dated supplier filename | Implemented: all eligible originals in name order, or selected originals in click order; bounded merge, originals preserved, same-input output reuse and retry-safe Drive copy. Live verification pending |
| Difficult/encrypted PDF | Original merge may skip problematic PDFs; Sites explicitly rejects merge and preserves original | Deliberate change, not identical behavior; fixture rejection/source preservation passes |
| History of collection counts/errors/Drive folder | History records uploads, merges and resumable collection, new local/Drive counts, skips/errors and folder links | Fixture counters/failure details pass; live counts pending |
| Supplier last-run/status | Original updates last_run and active/error after collection | Completed runs update last_run and active/error; preview remains read-only | Fixture completion behavior passes; live pending |
| Theme/settings/mobile layout | Original components largely retained, Google setup added | Source reviewed; full phone/browser interaction not independently tested |
| Processing limits | Local upload 10 MB; merge 20 PDFs/20 MB; text preview 100 pages | Explicit Sites limits; not equivalent to original unrestricted source loops |

## Collection increment verified with fixtures

Run workflow is now reachable; Save & Run is enabled in the wizard. Each request processes a small resumable batch. A closed app does not schedule further batches; rerunning resumes saved progress. Original files remain accessible if Drive writes fail. Lost upload responses retry the same generated Drive ID. The regression suite exercises real ephemeral D1/R2 storage with fake Google responses; it does not prove the owner’s live Drive accepts writes. Real Akron / phone acceptance is still required.

## Existing upload clarification / fix

The prior upload saved immediately upon selection; the destination was determined by the page's workflow filter. This hid the saving choice and could leave files in Unassigned while a supplier folder was being viewed. New UI stages the selected files and presents a separate destination selector and **Save files** button. It reports the actual destination, keeps failed files available for retry, and offers **Show saved files**. Existing stored files are unchanged. Workflow links now update the active folder even when navigating within the already-mounted Documents page.

## Gate before further audit building

1. Restore baseline Google destination resolution: saved folder IDs, history evidence, explicit ambiguity/inaccessibility errors, and owner-scoped binding. Never choose or create a replacement folder after a provider error.
2. Implement Run workflow / attachment download using the saved criteria, preserving exact original bytes and source message/attachment IDs, email received date and distinct PDF metadata creation date. Keep analysis separate so a difficult invoice never breaks collection.
3. Save to the intended Drive destination and expose stored originals under View Files. Verify permissions for the actual folder rather than assuming drive.file authorizes arbitrary existing Drive files.
4. Run the real Akron workflow: compare search count with collected attachments, open/download each stored original, inspect its Drive parent and compare original/stored bytes. Record actual run history, errors and last-run/status.
5. Repeat and concurrently repeat the same run: no duplicate original files; same-name different content retained; no silent partial success. Provider failures must report partial/failure honestly while keeping completed saves.
6. Restore Drive browsing and sorting, source-date display and Drive-backed merge parity; retain the explicit difficult-PDF/size-limit behavior for review.
7. Verify real phone actions: workflow edit/save, upload selection/destination/save, file refresh/open/download, merge, history links, cancellation/retry/navigation.
8. Only after this baseline passes: resume invoice extraction/grouping/reconciliation features. Full OCR/audit acceptance remains a separate checklist in FLOWSTACK_REQUIREMENTS.md.

This comparison is a gap report, not a claim that migration is complete.

## Drive merge/import acceptance

Fixture tests additionally verify exact source bytes, selected merge page order, owner and folder boundaries, previous-output exclusion, repeat output reuse, uncertain upload retry, and explicit unreadable/changed-source failures. Drive browser header/link/PDF count fields now match the retained component contract. In Browse Drive folder, select PDFs to import or merge; with no selection the action uses all eligible original PDFs within the explicit limits. Imported originals stay accessible under View Files. The legacy mergePdfs handler is restored. Live collection, import and merge acceptance remains pending.

## Run-all and explicit Drive export increment

- Owner reported collection working. Read-only live metadata now shows stored supplier PDF Document records with Drive folder references, unlike the earlier empty collection snapshot. This is evidence of saved records; not independent verification of every live byte or phone interaction.
- Dashboard Run all workflows preserves each saved filter and folder, runs jobs serially, and aggregates final snapshots without counting continued batches twice. Closing the app stops future batches; manual retry resumes durable jobs. At most 500 loaded workflows can be run from this screen; larger datasets need paginated workflow discovery.
- Documents → Copy to Drive lets the owner choose a workflow destination for uploads and local merges. Generated IDs are persisted before upload, identical folder content is reused, and retries after a lost response do not create another copy. Destination references are separate from original workflow/source/review fields. Originals and audit decisions stay unchanged.
- New fixture tests cover batch totals, interruption, owner/origin rejection, source preservation, multiple destinations and lost-response export recovery. Phone testing and real Drive export acceptance remain pending.

Customer PDF sharing increment: dedicated Google Drive copy, explicit read-only unlisted anyone permission, copyable provider download/view URL, verified revocation and retry safety. Source records/bytes and owner-private site unchanged. No automatic expiry; native anyone-permission expiry is unsupported. Live recipient test and 70 MB processing remain pending. Merge/select-all controls now visible before selection in Documents and Drive browser.


## Existing large Drive PDF sharing
Added workflow-folder PDF references and server-side dedicated customer copies. Reference registration does not read PDF bytes or claim local storage; sharing verifies MD5, size and private My Drive parent before enabling unlisted anyone-reader permission. Repeated linking/copy retries retain IDs. Reference-only files cannot enter local merging/extraction. Tests use 70 MB metadata fixtures, not actual 70 MB bytes. Actual Google copy authorization, signed-out customer downloads and real 70 MB delivery remain unverified. Large-file merging remains deferred.


## Customer-link rechecking
Check Drive link re-reads the dedicated copy and permissions without changing the original. Detects externally removed public access, deleted/unavailable or checksum-changed copies, broader public permissions and reader download restrictions. Copy customer link checks current Drive settings before clipboard copying in Documents and both merge results. Check failures remain explicit; a provider error is not treated as revoked access or a successful test. Checks retain history and last-check timestamps. Revocation remains available for blocked/incomplete copies. Automated fixture verification does not prove anonymous download or actual 70 MB delivery.


## Verify saved file
Documents provides an owner-only read-only storage check for the original plus one selected recorded Drive copy. Verifies local bytes against SHA-256/MD5 and size (up to 24 MB); verifies recorded Drive size/type/MD5/parent. Missing checksum yields size-only, not full verification. Provider failures remain not-checked/unavailable, and no Drive copy is reported as not-saved. Large Drive references require no R2 read. Multiple recorded destinations can be checked individually. No files, workflows, audit decisions, or provider data are modified. Live owner execution still required; does not re-read Gmail or prove signed-out download.


## Filtered Drive merge parts
Drive browser offers a reviewed plan of all filtered originals in visible order, with at most 20 originals and an 18 MB input target per part (10 MB individual import cap). Single-file groups remain original references; no source is silently omitted. Part filenames identify their part number. The server validates planned file IDs, MD5 and sizes before any preservation/merge. Parts run serially while the view is open; Stop waits for the in-flight part, and later parts pause. The same open plan resumes at the remaining part. After reopening, replanning unchanged sources reuses existing deterministic DriveMergeJob outputs; completed files/history persist, but the overall browser plan is not a durable background job. New/changed sources may generate different groups. Page-count/output-size/unreadable-source errors stop later work, retain completed results and require a revised smaller selection where appropriate. No automatic public sharing. This is multiple PDFs, not single 70 MB merging; live Google/phone acceptance remains pending.

## Read-only live verification — 2026-10-07 UTC / October 6 Pacific

This supersedes the earlier statement that live Drive saving had no independent verification. The original migration is still **not fully accepted**: Akron completion, a whole-run repeat, signed-out customer downloading, live ZIP creation and phone interaction coverage remain pending. Audit expansion is paused for this acceptance work.

Evidence collected through owner-authorized Sites database reads, connected Gmail and connected Google Drive (both profiles confirmed jimdoukakis@gmail.com). No workflows, Gmail messages, Drive files, permissions, invoices or existing audit data were changed.

- Read all 366 projected `records` rows using server-returned pagination offsets: 172 Documents, 3 Suppliers, 8 RunHistory, 170 CollectionOutcome, 2 CollectionJob, 2 DriveExport, 3 DriveShare, 4 ShareEvent and 2 encrypted GooglePrivate records. One large CollectionJob value was truncated by the bounded reader and was not reconstructed or interpreted.
- Tournas completed collection: 129 PDFs saved locally / 129 Drive saves, zero recorded errors. Ergobeton GPT completed collection: 39 PDFs saved locally / 39 Drive saves, 2 duplicate skips, zero recorded errors. Akron Gpt remains `new`, with no completed collection history.
- Independently read current Google metadata for all 168 recorded originals: every accessible file's size, PDF MIME and parent match its FlowStack record. Metadata wrapper does not return MD5 or trash fields even when requested; these checks do not prove all file bytes or current untrashed status.
- Downloaded 60 originals used by the three existing merges from Drive. Each downloaded byte length and MD5 matches the stored collection record. This proves those Drive originals, not a fresh read of R2 originals.
- Downloaded one original Tournas Gmail attachment and one original Ergobeton Gmail attachment using the exact MIME attachment reference. Each is byte-for-byte identical to its downloaded Drive copy and its recorded checksum. This is two samples, not every Gmail attachment.
- Downloaded two existing Drive merge exports (20 originals ->24 pages; 20 originals ->20 pages) plus all three dedicated customer PDFs (24, 20 and 20 pages). Downloaded MD5 values match the recorded customer-copy MD5. The first two Drive exports are byte-identical to their respective dedicated copies.
- Verified all three existing merged PDFs against their 60 recorded sources in recorded selection order: exact decompressed page-content streams, image-resource bytes and numeric page dimensions match page-by-page, with no omitted or reordered source pages. Numeric page dimensions were compared numerically (0 and 0.0 are equivalent). This structural comparison is not a full mobile visual review.
- Current Drive metadata for the two workflow merge exports shows owner-only permissions. All three separate customer copies show unlisted anyone-reader permission plus owner permission. Authenticated downloads succeed. This does not independently prove signed-out downloading or absence of additional provider download restrictions.
- Recent production Worker error query (last 180 minutes) returned no events. No-error logs do not prove every interaction works. CustomerPackage records are absent at this inspection, so real ZIP uploading/customer downloading is still untested.

Next acceptance actions: run Akron Gpt from the signed-in Sites session, rerun a completed supplier workflow to verify actual duplicate skipping/no new originals, verify a saved original's R2 checksum with the existing Verify saved file action, create one real ZIP package, and download a customer link in a browser signed out of Google. These actions require visitor authentication/browser interaction not available through the currently published Site's tools. The published Site has no MCP endpoint; independent Google connector reads do not test FlowStack's current OAuth refresh or invoke its collection handler.
