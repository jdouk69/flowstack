import {RECEIVER_STATES} from './invoice-evidence.mjs';
const fields=['supplier_name','invoice_number','account_information','customer_information','project_information','document_type','invoice_series','printed_document_identifier','receiver','deliverer','vehicle_registration','field_evidence'];
const amounts=['subtotal','subtotal_before_discount','invoice_discount_printed','vat','invoice_total'];
export function validateInvoiceCapture(body){
 if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Invalid invoice details.');
 if(!Number.isInteger(body.revision)||body.revision<0)throw Error('Refresh this invoice before saving.');
 const text=(value,label,limit=1000)=>{if(value==null||value==='')return null;if(typeof value!=='string'||value.length>limit||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))throw Error(`Invalid ${label}.`);return value.trim()||null;};
 const decimal=(value,label)=>{const result=text(value,label,30);if(result!==null&&!/^-?\d{1,18}([.,]\d{1,6})?$/.test(result))throw Error(`${label}: enter the printed number without a currency symbol or thousands separators.`);return result;};
 const invoice={};for(const field of fields)invoice[field]=text(body[field],field.replaceAll('_',' '),field==='field_evidence'?4000:1000);
 invoice.receiver_status=text(body.receiver_status,'receiver source status',20)||'unknown';
 if(!RECEIVER_STATES.includes(invoice.receiver_status))throw Error('Choose a receiver source status.');
 if(invoice.receiver_status==='shown'&&!invoice.receiver)throw Error('Enter the receiver exactly as printed.');
 if(['blank','unreadable'].includes(invoice.receiver_status)&&invoice.receiver)throw Error('Clear the receiver name when the original is confirmed blank or unreadable. Do not substitute the deliverer.');
 invoice.supplier_key=text(body.supplier_key,'supplier',30);if(invoice.supplier_key&&!['tournas','akron','ergobeton'].includes(invoice.supplier_key))throw Error('Choose a known supplier or leave it unclassified.');
 for(const field of amounts)invoice[field]=decimal(body[field],field.replaceAll('_',' '));
 invoice.invoice_date=text(body.invoice_date,'invoice date',10);if(invoice.invoice_date&&(!/^\d{4}-\d{2}-\d{2}$/.test(invoice.invoice_date)||!Number.isFinite(Date.parse(invoice.invoice_date))||new Date(invoice.invoice_date).toISOString().slice(0,10)!==invoice.invoice_date))throw Error('Enter the printed invoice date.');
 invoice.currency=text(body.currency,'currency',10);
 const page=value=>{if(value==null||value==='')return null;const n=Number(value);if(!Number.isInteger(n)||n<1||n>1000)throw Error('Enter a valid original source page.');return n;};
 invoice.source_page=page(body.source_page);
 const names=body.printed_names??[];if(!Array.isArray(names)||names.length>50)throw Error('Enter at most 50 printed names.');invoice.printed_names=names.map(name=>{const value=text(name,'printed name',200);if(!value)throw Error('Remove blank printed names.');return value;});
 if(!Array.isArray(body.line_items)||body.line_items.length>200)throw Error('Enter at most 200 separate line items.');
 const lines=body.line_items.map((line,position)=>{if(!line||typeof line!=='object'||Array.isArray(line))throw Error('Invalid line item.');const result={position:position+1};for(const field of ['printed_name','description','unit','product_code','discount_basis','line_amount_basis','unit_price_basis','amount_basis_evidence','printed_evidence'])result[field]=text(line[field],`item ${position+1} ${field}`,['description','printed_evidence'].includes(field)?2000:300);for(const field of ['quantity','unit_price','line_amount','discount_printed','discount_amount_printed','vat_rate','vat_amount','gross_line_amount'])result[field]=decimal(line[field],`item ${position+1} ${field}`);for(const f of ['line_amount_basis','unit_price_basis'])if(result[f]&&!['net','gross','unknown'].includes(result[f]))throw Error('Choose net, gross or unknown amount basis.');result.source_page=page(line.source_page);result.value_origin=text(line.value_origin,'value origin',30)||'printed';if(!['printed','calculated','mixed'].includes(result.value_origin))throw Error('Choose printed, calculated or mixed value origin.');if(!result.printed_name&&!result.description)throw Error(`Item ${position+1} needs its printed name or description.`);return result;});
 return {revision:body.revision,invoice,lines};
}
