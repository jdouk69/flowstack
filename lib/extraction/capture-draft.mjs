import {analyzePages} from './suppliers/tournas.mjs';
// A read-only suggestion bridge, never an invoice write or approval.
export function extractionCaptureDraft(source, saved) {
 if(saved&&JSON.parse(saved.pages).some(page=>page.extraction_method==='ocr'))throw Error('OCR text is a preview only. Review the scan and enter invoice rows manually; automatic OCR invoice capture is not supported yet.');
 if(!saved)throw Error('Read the PDF and save an extraction preview first.');
 const pages=JSON.parse(saved.pages),analysis=JSON.parse(saved.analysis);
 if(source.merged||source.pages!==1||pages.length!==1)throw Error('This bridge supports one-page individual invoices only. Multi-page or merged PDFs require document grouping before import; use the individual original.');
 if(!['tournas','akron','ergobeton'].includes(analysis.template))throw Error('Structured suggestions are available only for inspected Tournas, Akron and one-page Ergobeton text invoices.');
 const document=analyzePages(pages,analysis.template).documents[0];
 if(!['invoice','service_invoice','retail_receipt'].includes(document.document_type)||!document.line_items.length)throw Error('The PDF reader could not extract invoice rows. This does not mean the file is not an invoice. Use Review with ChatGPT to check the original and return the results file.');
 if(document.line_items.length>200||document.warnings.some(w=>w.startsWith('Unparsed item row:')))throw Error('Some item rows could not be read completely. Correct extraction before transferring; no partial invoice draft was prepared.');
 const fields={supplier_key:analysis.template,supplier_name:document.supplier_name,invoice_number:document.invoice_number,invoice_date:document.invoice_date,account_information:document.account_number,customer_information:document.customer_information,project_information:document.project_information??null,document_type:document.document_type_printed,receiver:document.receiver,receiver_status:'unknown',deliverer:document.deliverer??null,vehicle_registration:document.vehicle_registration??null,field_evidence:document.currency_evidence?JSON.stringify({currency:document.currency_evidence}):null,source_page:document.source_page,subtotal:document.subtotal,subtotal_before_discount:document.subtotal_before_discount??null,invoice_discount_printed:document.invoice_discount_printed??null,vat:document.vat,invoice_total:document.invoice_total,currency:document.currency};
 const line_items=document.line_items.map(line=>Object.fromEntries(['printed_name','description','product_code','quantity','unit','unit_price','line_amount','discount_printed','discount_basis','discount_amount_printed','line_amount_basis','unit_price_basis','amount_basis_evidence','vat_rate','vat_amount','gross_line_amount','source_page','printed_evidence','value_origin'].map(field=>[field,line[field]??null])));
 fields.printed_document_identifier=document.printed_document_identifier||document.printed_invoice_number||document.invoice_number;
 // Preserve the complete extracted number; never guess a series split.
 fields.invoice_series=document.invoice_series??null;
 return {fields,line_items,printed_names:[],preview_revision:saved.revision,warnings:document.warnings};
}
