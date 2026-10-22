import {decimal,normalize} from './invoice-audit.mjs';
const headers=[['supplier_name','Supplier'],['document_type','Document type'],['invoice_series','Series',false,true],['invoice_number','Invoice number'],['invoice_date','Date'],['currency','Currency'],['customer_information','Customer'],['project_information','Project / address'],['subtotal','Net subtotal',true],['vat','VAT',true],['invoice_total','Total',true]];
const lineFields=[['printed_name','Item name'],['product_code','Product code'],['quantity','Quantity',true],['unit','Unit'],['unit_price','Unit price',true],['line_amount','Printed line amount',true],['line_amount_basis','Line amount basis'],['unit_price_basis','Price basis'],['discount_printed','Discount %',true,true],['discount_amount_printed','Discount amount',true,true],['discount_basis','Discount basis',false,true],['vat_rate','VAT rate',true],['vat_amount','Printed item VAT',true,true]];
export function compareValue(left,right,numeric=false,optional=false){
 const missing=v=>v==null||String(v).trim()===''||String(v).toLowerCase()==='unknown';
 if(missing(left)||missing(right))return optional&&missing(left)&&missing(right)?'not_recorded':'missing';
 if(numeric){const a=decimal(left),b=decimal(right);return a===null||b===null?'missing':a===b?'match':'different';}
 return normalize(left)===normalize(right)?'match':'different';
}
export function compareInvoices(left,right){
 const row=(field,label,numeric,optional,a,b)=>({label,left:a[field],right:b[field],status:compareValue(a[field],b[field],numeric,optional)});
 const fields=headers.map(([field,label,numeric,optional])=>row(field,label,numeric,optional,left.invoice,right.invoice));
 const items=Array.from({length:Math.max(left.line_items.length,right.line_items.length)},(_,index)=>({position:index+1,rows:lineFields.map(([field,label,numeric,optional])=>row(field,label,numeric,optional,left.line_items[index]||{},right.line_items[index]||{}))}));
 const all=[...fields,...items.flatMap(i=>i.rows)];
 return {fields,items,differences:all.filter(r=>r.status==='different').length,missing:all.filter(r=>r.status==='missing').length,lineCountMatch:left.line_items.length===right.line_items.length,hasItems:left.line_items.length>0&&right.line_items.length>0};
}
