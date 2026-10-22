import {printedDecimal} from '../suggestions.mjs';
const fold=value=>value.normalize('NFKD').replace(/\p{M}/gu,'').toUpperCase().trim();
const date=value=>{const m=value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(!m)return null;const s=`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;return Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s?s:null;};
const unsupported=(page,message,type=page.text.trim()?'unsupported':'ocr_required')=>({source_page:page.page,document_type:type,line_items:[],entries:[],warnings:[message]});
// Inspected Akron SoftOne originals: A4 and Letter variants. Header artwork is
// an image, not selectable text; it is deliberately not fabricated as a value.
export function parseAkronPage(page){
 const fragments=page.fragments||[],rows=page.text.split('\n').map(line=>line.split('\t').map(s=>s.trim()).filter(Boolean));
 if(!page.text.trim())return unsupported(page,'No selectable text. OCR or manual entry required.');
 if(rows.some(row=>fold(row[0]||'').startsWith('ΑΡΙΘΜΟΣ ΠΡΟΣΦΟΡΑΣ:')))return unsupported(page,'Quotation / offer: not an invoiced purchase. Retained separately; no purchase rows imported.','quotation');
 const headers=rows.filter(row=>/^ΤΙΜΟΛΟΓΙΟ /u.test(fold(row[0]||''))&&row.length===5&&/^\d{6}$/.test(row[1])&&/^(?:ΤΔΑΜ|ΤΔΑ|ΤΙΜΜ)\d+$/.test(row[2])&&date(row[3]));
 if(headers.length!==1||!/(?:ΑΡΙΘΜΟΣ ΓΕΜΗ 075018558002|ΑΡΙΘΜΟΣ ΓΕΜΗ 075018558000)/u.test(page.text))return unsupported(page,'This page does not match the inspected Akron invoice template. Statements, delivery notes and other layouts remain separate; use source review.');
 const header=headers[0],anchors=fragments.filter(f=>f.text===header[1]);
 if(anchors.length!==1)return unsupported(page,'Ambiguous invoice header position. Use manual review.');
 const anchor=anchors[0],scale=anchor.x/330,headerY=anchor.y;
 if(!((page.width===595&&page.height===842)||(page.width===612&&page.height===792))||scale<.97||scale>1.01)return unsupported(page,'Unverified page layout. No table columns inferred.');
 const moneyLabels=fragments.filter(f=>fold(f.text)==='ΚΑΘΑΡΗ ΑΞΙΑ:'&&f.x/scale>370);
 if(moneyLabels.length!==1)return unsupported(page,'Missing or ambiguous totals region. No partial invoice imported.');
 const bottom=moneyLabels[0].y+20;
 const table=fragments.filter(f=>f.y>bottom&&f.y<headerY-125);
 const codes=table.filter(f=>f.x/scale<90&&/^\d{2}\.\d{5}$/.test(f.text)).sort((a,b)=>b.y-a.y);
 const warnings=[],line_items=[];
 const ev=parts=>parts.sort((a,b)=>b.y-a.y||a.x-b.x).map(f=>f.text).join('\t');
 for(let i=0;i<codes.length;i++){
  const code=codes[i],row=table.filter(f=>Math.abs(f.y-code.y)<=2);
  const cell=(left,right)=>row.filter(f=>f.x/scale>=left&&f.x/scale<right);
  const numeric=(left,right)=>{const parts=cell(left,right);return parts.length===1?printedDecimal(parts[0].text):null;};
  const lower=i+1<codes.length?codes[i+1].y+2:bottom;
  const batchRows=table.filter(f=>fold(f.text)==='ΠΑΡΤΙΔΑ:'&&f.y<=code.y+2&&f.y>lower);
  const desc=table.filter(f=>f.x/scale>=90&&f.x/scale<300&&f.y<=code.y+2&&f.y>lower&&!batchRows.some(batch=>Math.abs(batch.y-f.y)<=2)).sort((a,b)=>b.y-a.y||a.x-b.x);
  const description=desc.map(f=>f.text).join(' ')||null,unitParts=cell(300,330);
  const unit=unitParts.length===1?unitParts[0].text:null,quantity=numeric(330,390),unit_price=numeric(390,435),line_amount=numeric(495,545),vat_rate=numeric(545,580);
  const discountParts=cell(435,458),discountAmountParts=cell(458,495);
  const discount_printed=discountParts.length===1?printedDecimal(discountParts[0].text):null;
  const discount_amount_printed=discountAmountParts.length===1?printedDecimal(discountAmountParts[0].text):null;
  if(!description||!unit||quantity===null||unit_price===null||line_amount===null||vat_rate===null||(discountParts.length&&discount_printed===null)||(discountAmountParts.length&&discount_amount_printed===null)){
   warnings.push('Unparsed item row: '+ev([...row,...desc]));continue;
  }
  line_items.push({source_page:page.page,position:line_items.length+1,product_code:code.text,printed_name:description,description,unit,quantity,unit_price,line_amount,line_amount_basis:'net',unit_price_basis:'net',amount_basis_evidence:`Page ${page.page}: inspected Akron invoice table; separate net line amount, monetary discount and VAT-rate columns.`,vat_rate,discount_printed,discount_basis:discount_printed===null?null:'%',discount_amount_printed,vat_amount:null,gross_line_amount:null,printed_evidence:ev([...new Set([...row,...desc])]),value_origin:'printed',status:'needs_review'});
 }
 // Unexpected non-batch text in the code column signals a row we may have missed.
 if(table.some(f=>f.x/scale<90&&!/^\d{2}\.\d{5}$/.test(f.text)&&fold(f.text)!=='ΠΑΡΤΙΔΑ:'))warnings.push('Unparsed item row: Unrecognized item code or table text. Verify the complete table before import.');
 const labelled=label=>{const matching=fragments.filter(f=>fold(f.text)===label);if(matching.length!==1)return null;const f=matching[0],parts=fragments.filter(p=>Math.abs(p.y-f.y)<=2&&p.x>f.x+30&&p.x/scale>=495);return parts.length===1?{value:printedDecimal(parts[0].text),evidence:ev([f,...parts])}:null;};
 const subtotal=labelled('ΑΞΙΑ ΜΕΤΑ ΤΗΝ ΕΚΠΤ.:'),beforeDiscount=labelled('ΚΑΘΑΡΗ ΑΞΙΑ:'),invoiceDiscount=labelled('ΕΚΠΤΩΣΗ:'),vat=labelled('ΦΠΑ:'),total=labelled('ΓΕΝΙΚΟ ΣΥΝΟΛΟ:');
 const currencyParts=fragments.filter(f=>/^(?:€|EUR)$/i.test(f.text.trim()));
 const customer=rows.find(row=>fold(row[0]||'')==='ΕΠΩΝΥΜΙΑ'),account=rows.find(row=>fold(row[0]||'')==='ΚΩΔΙΚΟΣ:');
 // Receiver box is visually verified in these templates. A punctuation marker
 // is an empty box; email sender, issue/dispatch name and comments are not used.
 const receiverParts=fragments.filter(f=>f.x/scale>=490&&f.x/scale<580&&f.y>=headerY-610&&f.y<=headerY-596&&f.text.trim()!=='.').sort((a,b)=>b.y-a.y||a.x-b.x);
 const supplierParts=fragments.filter(f=>f.y>headerY+20&&/^ΑΚΡΟΝ(?:\s|$)/u.test(fold(f.text)));
 if(!line_items.length)warnings.push('No complete item rows extracted. Verify every purchased item manually.');
 if(!supplierParts.length)warnings.push('Supplier header is image artwork. Enter the exact printed supplier name after opening the original; no name was inferred from email or workflow.');
 warnings.push('Unreviewed extraction. Check every item, receiver and total against the original. Blank discounts, currency and line VAT/gross amounts remain unknown; displayed prices may be rounded.');
 return {source_page:page.page,document_type:'invoice',document_type_printed:header[0],supplier_classification:'akron',supplier_name:supplierParts.length===1?supplierParts[0].text:null,invoice_number:header[2],printed_invoice_number:header[1],invoice_date:date(header[3]),account_number:account?.[1]||null,customer_information:customer?.[1]||null,receiver:receiverParts.map(f=>f.text).join(' ')||null,receiver_evidence:receiverParts.map(f=>({source_page:page.page,printed_evidence:f.text,x:f.x,y:f.y})),subtotal:subtotal?.value??null,subtotal_before_discount:beforeDiscount?.value??null,invoice_discount_printed:invoiceDiscount?.value??null,vat:vat?.value??null,invoice_total:total?.value??null,currency:currencyParts.length?'EUR':null,currency_evidence:currencyParts.length?{method:'printed-text',source_page:page.page,printed:currencyParts.map(f=>f.text).join(' ')}:null,totals_evidence:{subtotal:subtotal?.evidence??null,vat:vat?.evidence??null,invoice_total:total?.evidence??null},line_items,entries:[],warnings};
}
