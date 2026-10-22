const empty=value=>value==null||String(value).trim()==='';
export const invoiceFieldId=(field,lineIndex)=>lineIndex===undefined?'invoice-field-'+field:'invoice-item-'+(lineIndex+1)+'-'+field;
export function invoiceMissingFields(invoice={},lines=[]){
 const missing=[];
 const add=(field,label,lineIndex)=>missing.push({field,label,...(lineIndex===undefined?{}:{lineIndex}),id:invoiceFieldId(field,lineIndex)});
 for(const [field,label] of [['supplier_name','Supplier name'],['invoice_number','Invoice number'],['document_type','Document type'],['invoice_date','Invoice date'],['subtotal','Net subtotal'],['vat','VAT amount'],['invoice_total','Invoice total'],['currency','Currency'],['field_evidence','Source evidence'],['source_page','Original PDF page']])if(empty(invoice[field]))add(field,label);
 if(!['shown','blank'].includes(invoice.receiver_status))add('receiver_status','Receiver box needs verification');
 if(invoice.receiver_status==='shown'&&empty(invoice.receiver))add('receiver','Receiver name');
 if(!lines.length)add('line_items','Individual line items');
 lines.forEach((line,lineIndex)=>{
  const item='Item '+(lineIndex+1)+' — ';
  if(empty(line.printed_name)&&empty(line.description))add('printed_name',item+'item name or description',lineIndex);
  for(const [field,label] of [['quantity','quantity'],['unit','unit'],['unit_price','unit price'],['line_amount','printed line amount'],['source_page','original PDF page'],['printed_evidence','source row evidence']])if(empty(line[field]))add(field,item+label,lineIndex);
  for(const [field,label] of [['line_amount_basis','line amount VAT basis'],['unit_price_basis','unit price VAT basis']])if(!['net','gross'].includes(line[field]))add(field,item+label+' needs verification',lineIndex);
 });
 return missing;
}
