import {sql} from 'drizzle-orm';
import {sqliteTable,text,integer,primaryKey,uniqueIndex,index} from "drizzle-orm/sqlite-core";
export const records=sqliteTable("records",{id:text("id").primaryKey(),owner:text("owner").notNull(),entity:text("entity").notNull(),data:text("data").notNull(),created:text("created").notNull(),updated:text("updated").notNull()});
export const documentContent=sqliteTable('document_content',{
 owner:text('owner').notNull(),workflow:text('workflow').notNull(),hash:text('hash').notNull(),documentId:text('document_id').notNull(),
},table=>[primaryKey({columns:[table.owner,table.workflow,table.hash]})]);
// Unknown invoice values remain null until extracted or explicitly reviewed.
// Decimal values use strings to retain printed precision without float rounding.
export const invoices=sqliteTable('invoices',{
 id:text('id').primaryKey(),owner:text('owner').notNull(),sourceDocumentId:text('source_document_id').notNull(),
 supplierKey:text('supplier_key'),supplierName:text('supplier_name'),invoiceDate:text('invoice_date'),invoiceNumber:text('invoice_number'),
 accountInformation:text('account_information'),customerInformation:text('customer_information'),projectInformation:text('project_information'),printedNames:text('printed_names'),
 documentType:text('document_type'),invoiceSeries:text('invoice_series'),printedDocumentIdentifier:text('printed_document_identifier'),receiver:text('receiver'),sourcePage:integer('source_page'),
 deliverer:text('deliverer'),receiverStatus:text('receiver_status'),vehicleRegistration:text('vehicle_registration'),fieldEvidence:text('field_evidence'),auditRuleVersion:text('audit_rule_version'),
 subtotal:text('subtotal'),subtotalBeforeDiscount:text('subtotal_before_discount'),invoiceDiscountPrinted:text('invoice_discount_printed'),vat:text('vat'),invoiceTotal:text('invoice_total'),currency:text('currency'),
 analysisStatus:text('analysis_status').notNull().default('awaiting_analysis'),analysisError:text('analysis_error'),
 auditStatus:text('audit_status').notNull().default('not_started'),auditFlag:text('audit_flag'),auditReasons:text('audit_reasons'),duplicateOf:text('duplicate_of'),
 created:text('created').notNull(),updated:text('updated').notNull(),
 identityKey:text('identity_key'),auditLedgerRevision:integer('audit_ledger_revision'),reviewNote:text('review_note'),reviewedAt:text('reviewed_at'),approvedAt:text('approved_at'),
 captureMethod:text('capture_method'),captureToken:text('capture_token'),revision:integer('revision').notNull().default(0),
},table=>[uniqueIndex('invoice_source_owner').on(table.owner,table.sourceDocumentId),index('invoice_owner_created').on(table.owner,table.created,table.id),uniqueIndex('invoice_approved_identity').on(table.owner,table.identityKey).where(sql`audit_status = 'approved'`)]);
export const invoiceLineItems=sqliteTable('invoice_line_items',{
 id:text('id').primaryKey(),owner:text('owner').notNull(),invoiceId:text('invoice_id').notNull(),position:integer('position').notNull(),
 printedName:text('printed_name'),description:text('description'),quantity:text('quantity'),unit:text('unit'),unitPrice:text('unit_price'),lineAmount:text('line_amount'),sourceReferences:text('source_references'),productCode:text('product_code'),discountPrinted:text('discount_printed'),discountBasis:text('discount_basis'),discountAmountPrinted:text('discount_amount_printed'),lineAmountBasis:text('line_amount_basis'),unitPriceBasis:text('unit_price_basis'),amountBasisEvidence:text('amount_basis_evidence'),vatRate:text('vat_rate'),vatAmount:text('vat_amount'),grossLineAmount:text('gross_line_amount'),sourcePage:integer('source_page'),printedEvidence:text('printed_evidence'),valueOrigin:text('value_origin'),
},table=>[uniqueIndex('invoice_line_position').on(table.owner,table.invoiceId,table.position),index('invoice_line_owner').on(table.owner,table.invoiceId)]);

export const invoiceLedger=sqliteTable('invoice_ledger',{owner:text('owner').primaryKey(),revision:integer('revision').notNull().default(0)});

export const invoiceEvents=sqliteTable('invoice_events',{id:text('id').primaryKey(),owner:text('owner').notNull(),invoiceId:text('invoice_id').notNull(),action:text('action').notNull(),note:text('note'),created:text('created').notNull()},table=>[index('invoice_event_owner').on(table.owner,table.invoiceId)]);

export const documentAnalysis=sqliteTable('document_analysis',{owner:text('owner').notNull(),documentId:text('document_id').notNull(),pages:text('pages').notNull(),analysis:text('analysis').notNull(),revision:integer('revision').notNull(),marker:text('marker').notNull(),created:text('created').notNull(),updated:text('updated').notNull()},table=>[primaryKey({columns:[table.owner,table.documentId]})]);
export const documentAnalysisVersions=sqliteTable('document_analysis_versions',{owner:text('owner').notNull(),documentId:text('document_id').notNull(),revision:integer('revision').notNull(),pages:text('pages').notNull(),analysis:text('analysis').notNull(),created:text('created').notNull()},table=>[primaryKey({columns:[table.owner,table.documentId,table.revision]})]);

export const invoiceVersions=sqliteTable('invoice_versions',{owner:text('owner').notNull(),invoiceId:text('invoice_id').notNull(),revision:integer('revision').notNull(),action:text('action').notNull(),note:text('note'),data:text('data').notNull(),created:text('created').notNull()},table=>[primaryKey({columns:[table.owner,table.invoiceId,table.revision]})]);
