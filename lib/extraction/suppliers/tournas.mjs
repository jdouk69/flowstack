import {printedDecimal} from '../suggestions.mjs';
import {parseAkronPage} from './akron.mjs';
import {tournasAmountBasis} from '../amount-basis.mjs';
import {parseErgobetonPage} from './ergobeton.mjs';
const fold=text=>text.normalize('NFKD').replace(/\p{M}/gu,'').toUpperCase();
const date=raw=>{const m=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(!m)return null;const s=`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;return Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s?s:null;};
const evidence=(page,text,extra={})=>({source_page:page.page,printed_evidence:text,...extra});
// Adapter for the inspected Tournas portrait template. All output is unreviewed.
// Fixed regions refer to boxes verified in Tournas_merged_2026-07-26.pdf page 26.
function box(page,left,right,bottom,top){return (page.fragments||[]).filter(f=>f.x/page.width>=left&&f.x/page.width<=right&&f.y/page.height>=bottom&&f.y/page.height<=top).sort((a,b)=>b.y-a.y||a.x-b.x);}
export function parseTournasPage(page){
 const rows=page.text.split('\n').map(text=>text.split('\t').map(cell=>cell.trim()).filter(Boolean));
 if(fold(page.text).includes('ΚΑΡΤΕΛΕΣ ΠΕΛΑΤΩΝ')){
  const header=rows.find(row=>/^1\s+\d+$/.test(row[0]||''));
  const entries=rows.filter(row=>date(row[0]||'')&&row.length>=8).map(row=>{const money=row.slice(-6).map(printedDecimal);return {...evidence(page,row.join('\t')),date:date(row[0]),document_reference:row[1],description:row.slice(2,-6).join(' ')||null,charge:money[0],credit:money[1],cumulative_charge:money[2],cumulative_credit:money[3],balance_charge:money[4],balance_credit:money[5],status:'needs_review'};});
  const unparsed=rows.filter(row=>date(row[0]||'')&&(row.length<8||row.slice(-6).some(cell=>printedDecimal(cell)===null)));
  return {source_page:page.page,document_type:'account_statement',supplier_name:rows.find(row=>fold(row.join(' ')).startsWith('ΤΟΥΡΝΑΣ'))?.join(' ')||null,account_number:header?.[0]?.split(/\s+/)[1]||null,customer_information:header?.slice(1,-1).join(' ')||null,entries,line_items:[],warnings:[...unparsed.map(row=>'Unparsed statement row: '+row.join(' · ')),'Statement entries are separate from purchases. Charges, credits and balance columns must be checked against the source; reconciliation has not run.']};
 }
 const header=rows.find(row=>row.length===3&&date(row[2])&&/ΤΙΜΟΛΟΓΙΟ|ΑΠΟΔΕΙΞΗ/.test(fold(row[0]))&&/^[\wΑ-Ω-]+$/u.test(row[1]));
 if(!header)return {source_page:page.page,document_type:page.text.trim()?'unsupported':'ocr_required',line_items:[],entries:[],warnings:[page.text.trim()?'This page does not match the verified invoice template. Use source review; no invoice inferred.':'No selectable text. OCR or manual entry required.']};
 const account=rows.find(row=>fold(row[0]||'')==='ΚΩΔ.ΠΕΛΑΤΗ');
 const customer=rows.find(row=>fold(row[0]||'')==='ΕΠΩΝΥΜΙΑ');
 const customerEnd=customer?.findIndex(cell=>fold(cell)==='ΤΡΟΠΟΣ ΠΛΗΡΩΜΗΣ');
 const customerName=customerEnd>2?customer.slice(2,customerEnd).join(' '):null;
 // Use printed labels only. Missing artwork labels never create inferred roles.
 const labelled=(label)=>{const found=rows.filter(r=>fold(r[0]||'').replace(/\s*:\s*$/,'')===label);if(found.length!==1)return null;const row=found[0];const start=row[1]===':'?2:1;const rest=row.slice(start);const stop=rest.findIndex(cell=>/:$/.test(cell)||['ΑΡ.ΑΥΤΟΚΙΝΗΤΟΥ','ΤΟΠΟΣ ΠΡΟΟΡΙΣΜΟΥ','ΤΡΟΠΟΣ ΠΛΗΡΩΜΗΣ'].includes(fold(cell)));return (stop<0?rest:rest.slice(0,stop)).join(' ')||null;};
 const vehicleRow=rows.find(r=>r.some(cell=>fold(cell).replace(/\s*:\s*$/,'')==='ΑΡ.ΑΥΤΟΚΙΝΗΤΟΥ'));
 const vehicleIndex=vehicleRow?.findIndex(cell=>fold(cell).replace(/\s*:\s*$/,'')==='ΑΡ.ΑΥΤΟΚΙΝΗΤΟΥ');
 const vehicle=vehicleRow?vehicleRow.slice(vehicleIndex+1).filter(cell=>cell!==':').join(' ')||null:null;
 const deliverer=labelled('Ο ΠΑΡΑΔΟΥΣ');
 const line_items=[],warnings=[];
 for(const row of rows){
  if(!/^\d{2}\.\d{2}\.\d{3}$/.test(row[0]||''))continue;
  const tail=row.slice(-5),values=tail.map(printedDecimal),unit=row.at(-6),description=row.slice(1,-6).join(' ');
  if(row.length<8||!description||!unit||values.some(value=>value===null)){warnings.push('Unparsed item row: '+row.join(' · '));continue;}
  line_items.push({...evidence(page,row.join('\t')),position:line_items.length+1,product_code:row[0],printed_name:description,description,unit,quantity:values[0],unit_price:values[1],discount_printed:values[2],discount_basis:null,line_amount:values[3],vat_rate:values[4],vat_amount:null,gross_line_amount:null,value_origin:'printed',status:'needs_review'});
 }
 const amountInBox=(bottom,top)=>{const candidates=box(page,.80,.93,bottom,top).filter(f=>printedDecimal(f.text)!==null);return candidates.length===1?{value:printedDecimal(candidates[0].text),evidence:evidence(page,candidates[0].text,{x:candidates[0].x,y:candidates[0].y})}:null;};
 // Reject other page shapes rather than extrapolating these verified template boxes.
 const fixedLayout=page.width>=590&&page.width<=600&&page.height>=835&&page.height<=845;
 const receiverParts=fixedLayout?box(page,.20,.39,.120,.142).filter(f=>printedDecimal(f.text)===null):[];
 const supplierParts=box(page,0,1,.90,1).filter(f=>/^ΤΟΥΡΝΑΣ(?:\s|$)/u.test(fold(f.text)));
 const printedCurrency=(page.fragments||[]).filter(f=>f.text.trim()==='€');
 const subtotal=fixedLayout?amountInBox(.187,.198):null,vat=fixedLayout?amountInBox(.168,.179):null,total=fixedLayout?amountInBox(.128,.142):null;
 tournasAmountBasis(header[0],{subtotal:subtotal?.value,vat:vat?.value,invoice_total:total?.value},line_items,page.page);
 if(page.currency_check_warning)warnings.push(page.currency_check_warning);
 if(!line_items.length)warnings.push('No complete item rows extracted. Verify every purchased item manually.');
 if(!fixedLayout)warnings.push('Different page layout: receiver and totals require manual entry.');
 warnings.push('This is unreviewed text extraction, not approval. Printed prices may be rounded. Discount basis and missing VAT/gross line amounts are not inferred. Check all rows, receiver and totals against the original.');
 return {source_page:page.page,document_type:/ΠΑΡΟΧΗΣ/.test(fold(header[0]))?'service_invoice':/ΑΠΟΔΕΙΞΗ/.test(fold(header[0]))?'retail_receipt':'invoice',document_type_printed:header[0],supplier_name:supplierParts.length===1?supplierParts[0].text:null,supplier_classification:'tournas',invoice_number:header[1],invoice_date:date(header[2]),account_number:account?.[2]||null,customer_information:customerName,project_information:labelled('ΔΙΕΥΘΥΝΣΗ'),vehicle_registration:vehicle,deliverer,receiver_status:'unknown',receiver:receiverParts.map(f=>f.text).join(' ')||null,receiver_evidence:receiverParts.map(f=>evidence(page,f.text,{x:f.x,y:f.y})),subtotal:subtotal?.value??null,vat:vat?.value??null,invoice_total:total?.value??null,totals_evidence:{subtotal:subtotal?.evidence??null,vat:vat?.evidence??null,invoice_total:total?.evidence??null},currency:printedCurrency.length?'€':page.currency_evidence?.currency??null,currency_evidence:printedCurrency.length?{method:'printed-text',source_page:page.page,printed:'€'}:page.currency_evidence??null,line_items,entries:[],warnings};
}
export function analyzePages(pages,template='generic'){
 const versions={tournas:'tournas-printed-basis-2',akron:'akron-printed-discounts-2',ergobeton:'ergobeton-softone-text-1'};
 return {template,adapter_version:versions[template]||'generic-text-preview-1',status:'needs_review',documents:pages.map(page=>page.extraction_method==='ocr'?{source_page:page.page,document_type:'ocr_preview',line_items:[],entries:[],warnings:['OCR text is unverified; numbers, characters and table order may be incorrect. Compare every value with the scan.','Structured OCR invoice capture is not implemented. No invoice items or statement entries were imported.']}:template==='akron'?parseAkronPage(page):template==='tournas'?parseTournasPage(page):template==='ergobeton'?parseErgobetonPage(page):{source_page:page.page,document_type:page.text.trim()?'unclassified':'ocr_required',line_items:[],entries:[],warnings:['Structured parsing is not implemented for this supplier. Original text is retained for manual review.']})};
}
