import {printedDecimal} from '../suggestions.mjs';
const fold=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').replace(/\s+/g,' ').trim().toUpperCase();
const evidence=(page,text)=>({source_page:page.page,printed_evidence:text});
function parseDate(raw){
 const m=String(raw||'').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(!m)return null;
 const value=`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
 return Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value?value:null;
}
const cells=page=>page.text.split('\n').map(line=>line.split('\t').map(cell=>cell.trim()).filter(Boolean));
const field=(rows,label)=>{
 const matches=[];
 for(const row of rows)for(let i=0;i<row.length;i++)if(fold(row[i])===label){const value=row[i+1];if(value)matches.push({value,evidence:row.join('\t')});}
 return matches.length===1?matches[0]:null;
};
const amountField=(rows,labels)=>{
 const matches=[];
 for(const row of rows)for(let i=0;i<row.length;i++)if(labels.includes(fold(row[i]))){const value=printedDecimal(row[i+1]||'');if(value!==null)matches.push({value,evidence:row.join('\t')});}
 return matches.length===1?matches[0]:null;
};
/** Inspected one-page SoftOne Greek invoice export. All extracted values remain unreviewed. */
export function parseErgobetonPage(page){
 const rows=cells(page),lines=page.text.split('\n').map(line=>line.trim()).filter(Boolean);
 if(page.extraction_method==='ocr')return {source_page:page.page,document_type:'ocr_preview',line_items:[],entries:[],warnings:['OCR text is unverified. Ergobeton structured capture currently requires selectable PDF text; no invoice rows were imported.']};
 if(!page.text.trim())return {source_page:page.page,document_type:'ocr_required',line_items:[],entries:[],warnings:['No selectable text. OCR or manual review is required.']};
 const headers=[];
 for(const line of lines){
  const parts=line.split('\t').map(s=>s.trim()).filter(Boolean);
  if(fold(parts[0])!=='ΤΙΜΟΛΟΓΙΟ')continue;
  const seriesIndex=parts.findIndex((part,index)=>index>0&&/^A[_-]ΤΙΜ$/iu.test(part));
  if(seriesIndex<0||!/^\d{1,12}$/.test(parts[seriesIndex+1]||''))continue;
  const dateIndex=parts.findIndex((part,index)=>index>seriesIndex+1&&/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(part));
  if(dateIndex<0)continue;
  const invoiceDate=parseDate(parts[dateIndex]);if(!invoiceDate)continue;
  headers.push({series:parts[seriesIndex],number:parts[seriesIndex+1],date:invoiceDate,evidence:line});
 }
 if(headers.length!==1)return {source_page:page.page,document_type:'unsupported',line_items:[],entries:[],warnings:['This page does not contain one unambiguous SoftOne invoice header. No invoice fields or rows were imported.']};
 const header=headers[0],warnings=[],line_items=[];
 const codeRows=[];
 for(let index=0;index<rows.length;index++)if(/^\d{2}\.\d{2}\.\d{3}$/.test(rows[index][0]||''))codeRows.push({row:rows[index],index});
 for(const {row} of codeRows){
  // Inspected SoftOne columns: code, description, unit, quantity, unit price,
  // pre-discount amount, printed discount percent, net amount, VAT rate.
  const numbers=row.slice(-6),description=row.slice(1,-7).join(' ').trim();
  const parsed=numbers.map(printedDecimal),unit=row.at(-7);
  if(row.length<9||!description||!unit||parsed.some(value=>value===null)){
   warnings.push('Unparsed item row: '+row.join('\t'));continue;
  }
  const [quantity,unitPrice,preDiscount,discount,netAmount,vatRate]=parsed;
  line_items.push({source_page:page.page,position:line_items.length+1,product_code:row[0],printed_name:description,description,unit,quantity,unit_price:unitPrice,line_amount:netAmount,line_amount_basis:'net',unit_price_basis:'net',discount_printed:discount,discount_basis:'%',discount_amount_printed:null,vat_rate:vatRate,vat_amount:null,gross_line_amount:null,printed_evidence:evidence(page,row.join('\t')).printed_evidence,value_origin:'printed',status:'needs_review',amount_basis_evidence:`Page ${page.page}: printed row ${row.join(' · ')}; pre-discount amount ${preDiscount}, discount percent ${discount}, net line amount ${netAmount} and VAT rate ${vatRate} are separate printed columns.`});
 }
 if(!codeRows.length)warnings.push('No item rows found. This may be a different document type or layout; no invoice items were imported.');
 if(warnings.some(w=>w.startsWith('Unparsed item row:')))warnings.push('At least one printed item row could not be read completely. No partial invoice draft may be transferred.');
 const account=field(rows,'ΚΩΔ. ΠΕΛ.'),customer=field(rows,'ΠΕΛΑΤΗΣ'),net=amountField(rows,['ΚΑΘΑΡΗ ΑΞΙΑ']),vat=amountField(rows,['Φ.Π.Α','ΦΠΑ']),total=amountField(rows,['ΠΛΗΡΩΤΕΟ ΠΟΣΟ']);
 const currencyPrinted=(page.fragments||[]).filter(fragment=>/^(?:€|EUR)$/i.test(fragment.text.trim()));
 if(!currencyPrinted.length)warnings.push('Currency symbol was not found in selectable text. Currency remains unknown; verify it on the original before approval.');
 warnings.push('Unreviewed Ergobeton extraction. Check the invoice number, date, account, every item, net subtotal, VAT and payable total against the original. Supplier legal name, receiver, delivery details and line VAT amounts remain unknown unless separately confirmed.');
 return {source_page:page.page,document_type:'invoice',document_type_printed:'Τιμολόγιο',supplier_classification:'ergobeton',supplier_name:null,invoice_number:header.number,printed_invoice_number:header.number,invoice_series:header.series,printed_document_identifier:`${header.series} ${header.number}`,invoice_date:header.date,account_number:account?.value||null,customer_information:customer?.value||null,receiver:null,receiver_status:'unknown',subtotal:net?.value??null,vat:vat?.value??null,invoice_total:total?.value??null,currency:currencyPrinted.length?'EUR':null,currency_evidence:currencyPrinted.length?{method:'printed-text',source_page:page.page,printed:currencyPrinted.map(fragment=>fragment.text).join(' ')}:null,totals_evidence:{subtotal:net?.evidence??null,vat:vat?.evidence??null,invoice_total:total?.evidence??null},line_items,entries:[],warnings};
}
