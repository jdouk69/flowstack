# FlowStack current handoff — 2026-10-08

## Latest focused milestone — Needs Your Attention (2026-10-08)

Baseline retained: published version 53, source 0ee9d6783d96fce8ee0b64791d36d1ac6fe09b19. Jim authorized only dashboard/finding review. The previous saved version is retained; publication creates a new private version.

- Existing main dashboard now has a Needs Your Attention card. It lists unresolved ORANGE/RED findings and separate counts, using saved invoice audit reasons and existing purchase-history prompts. Counts represent findings, not invoices. No new audit classification, thresholds, extraction or historical import.
- Each row shows supplier/classification, invoice number/date, item or explicitly invoice-level concern, printed amount with line/invoice scope, currency (unknown remains unknown), explanation and a link to Audit detail. Detail links to original invoice/PDF, compared source records, exact captured evidence, uncertainty and a suggested contractor question.
- Audit hosts the same shared component with Yellow/Orange/Red and an optional closed/snapshot view. Green remains in purchase history. Existing invoice queue and capture/review controls stay intact.
- Four finding review statuses: Needs Explanation and Disputed stay unresolved; Explained / Acceptable and Resolved close that finding. Notes are required; all changes append history. These decisions neither approve an invoice nor change its color.
- Reuses existing owner-scoped D1 records as FindingReview and FindingReviewEvent. No schema migration or separate database. Source invoice/line/review/version/master tables are never written by this endpoint. Existing reviewed/approved invoice findings remain read-only/closed under their prior decisions; product comparison prompts remain separate from invoice approval.
- Stable evidence fingerprints prevent an old closure silently covering changed source facts. Old review snapshots/history stay accessible. Atomic source/review revision guards reject conflicting edits, and history paginates without deleting earlier events.
- Existing product-history builder accepts optional complete display limits for this view; its usual screens keep their original 20-result defaults and identical classification logic. Counts fail explicitly if complete safe invoice/line/label limits are exceeded; no partial zero is presented.

Validation for this milestone: 156/156 automated tests passed, production build passed, built-Worker integration checks passed, and git diff --check passed.

Relevant implementation: components/FindingAttention.jsx; lib/finding-review.mjs; lib/finding-status.mjs; small additions to screens/Welcome.jsx, screens/Invoices.jsx and authenticated app/api/flow route. Tests: tests/finding-review.test.mjs and built-Worker route checks. Production financial records and source PDFs were not changed during development or QA.

Browser/iPhone tap/scroll behavior, live owner decision save and real source-PDF opening are not verified in this environment. Synthetic fixtures prove review persistence, filtering, conflicts and source protection, not original invoice correctness. October PDF acceptance and historical reconciliation remain pending, outside this authorization. Do not start them automatically.

This file is the project checkpoint for a new chat. Inspect current saved Sites source before further changes. Jim approved one bounded correctness milestone after the full Tournas functionality reconciliation; this is not authorization to import historical financial records or overwrite master reports.

## Project and preserved foundation

Project: appgprj_6ac53aa0da8c8191948bd1c765b471a2
Private URL: https://flowstack.jimdoukakis.chatgpt.site
Baseline: version 52, commit f5d675ee2750df0306334e7c075de96c3e52b6da.
Existing standalone collection, original PDF storage, document browsing/merge, invoice capture, history, review and workbook snapshots remain the foundation. Base44 production is untouched.

## This milestone

- Nullable invoice evidence fields: deliverer, receiver_status, vehicle_registration, field_evidence, audit_rule_version; additive migration 0009. No historical backfill.
- Receiver states: unknown, shown, blank, unreadable. Explicit blank displays “No receiver shown”. Blank/unreadable cannot coexist with a supplied receiver name. A giver is never substituted. New review/approval requires confirmed shown or blank; OCR/text suggestions remain unknown until reviewed.
- Source notes and role fields persist in atomic invoice revisions, CSV and new workbook snapshots. Older clients omitting them preserve saved values. Approved/excluded historical records remain locked.
- Exact account filtering in reports and purchase history; Tournas account 8891 shortcut. Quantity buckets and reusable/price comparisons separate supplier accounts; unknown accounts are not silently combined. Cross-supplier invoice comparisons require an explicitly recorded shared project, not equal account numbers.
- Decimal arithmetic preserves printed amounts. A discrepancy within the displayed unit-price precision interval generates Yellow possible-rounding clarification, not Orange established arithmetic discrepancy. Larger differences remain review prompts, not accusations.
- Audit rule version makes old draft audit/review stale and requires a fresh audit before approval. Historical approved/excluded decisions are not changed.
- Tournas labelled giver/address/vehicle suggestions remain unreviewed. Automatic extraction of all Greek artwork labels, other names/roles, translations and complex layouts is not claimed complete.

## Read-only reconciliation snapshot

177 invoices: 138 captured, 39 not started, none approved/reviewed/excluded at inspection. Tournas 110 invoices / 406 lines: account 8891 87 invoices / 323 lines; account 8655 23 invoices. Akron 28 captured invoices / 55 lines. No structured Ergobeton. 220 documents and three workflows.

Historical master: 43 invoice numbers, 111 lines, 89 Green / 19 Yellow / 3 Orange, 22 Needs Attention. All 43 invoice numbers occur in captured Tournas records, but this does NOT establish a reconciled historical import or restored historical audit decisions. Captures initially lacked supplier/currency and printed-role fields. Preserve both source records and historical workbook decisions until reconciled.

Historical master: https://docs.google.com/spreadsheets/d/1kWKSJBUTms912f1kZyGmNkpasVNDMX62Iz3HnqkYPCc/edit
Category source: https://docs.google.com/spreadsheets/d/1dpTPxBEPbTtRm1HikFeTwnDtQhYvXRQ4XV_pejZ69TQ/edit
Detailed quantity workbook reference: 13dJy8zYGIuDawZvdo_d4ceD_Dwp_i38o
Purchase-summary reference: 1HQUn5xQtThr75HGKIj0sU8pRL8Pr33_Y
These are reference sources, never authorized overwrite targets.

## October acceptance: still incomplete

Authorized original-text reads support #4850: four lines, 432.24; #4892: five lines, 647.75; service #1457: one line, 62.00. Combined 1141.99. #4850 has a draft capture; #4892 and #1457 need source validation/current-database checks before importing. Text alone does not verify exact header/receiver layout. Downloading raw source PDFs through the available Drive export path returned HTTP 403, including refreshed downloads. Do not claim the real three-PDF extraction regression passed. Synthetic fixtures prove safeguards, not original invoice correctness.

PDF references:
- #4850: https://drive.google.com/file/d/1GD0ojIQYrrotBfaWcTytfgoEzjD7DPNO/view ; document 9d11bdee-b7a7-4c27-ac22-b31288f84264
- #4892: https://drive.google.com/file/d/1FjjKyX1v_UHGtE3PhOVGMwT5NvcJm0tJ/view ; document eb12787e-81f1-4776-956f-a9f34b00f75c
- #1457: https://drive.google.com/file/d/1y5h1C9rQ8W2uYqOFmxWyhFj9h-odzJf7/view ; document 2811139b-f2ba-4e4c-84ec-4b90d21a005c

## Next sequence

1. Obtain readable original PDF bytes through the existing authorized Sites source path or owner-provided originals; verify October roles, identifiers and ten original lines visually, then run the adapter regression without production writes.
2. Reconcile the 43-invoice / 111-line historical master with current capture revisions; prepare a reviewable mapping and conflict list before any approved import.
3. Correct Greek product category/equivalence and line-specific findings. Invoice-level colors still propagate to rows. Historic reel, hatchet and apron concerns are not yet faithfully reproduced. Thresholds require source-backed configuration/approval, not invented percentages.
4. Finish statement/payment/credit coverage and reconciliation; never double-count statement charges as purchases.
5. Add verified background scheduling/quiet notifications and native XLSX/PDF plus master synchronization after reconciled source/permissions/approval rules.

Collection remains manual/browser-driven with durable successful checkpoints, 48-hour overlap and safe retry. No unattended scheduler or new-invoice notifications are operational. No master Google Sheet/PDF synchronization exists. Native reports, full structured OCR/multi-page/Ergobeton acceptance and mobile acceptance remain incomplete.

## Safety and verification

This milestone does not run live collection, edit/approve production invoices, delete originals, write Google Sheets, or change historical reports. Tests use isolated D1/R2 and explicitly synthetic provider/invoice fixtures. Validation: 149/149 automated tests passed; production build and built-Worker integration checks passed; git diff --check passed. These do not establish live Google integration or real October source acceptance. Saved final version/deployment and exact validation results are recorded in the separate user-facing handoff after publication.

For the next chat: attach the user-facing handoff and ask to inspect this project's current saved version, then continue only the approved next milestone. Do not restart the app or assume historical ChatGPT output is verified database data.
