import {classifyPrintedSupplier} from './suppliers/index.mjs';
const labels={supplier_name:['supplier','supplier name','προμηθευτης'],invoice_number:['invoice number','invoice no','invoice #','αριθμος τιμολογιου'],invoice_date:['invoice date','ημερομηνια τιμολογιου'],account_information:['account number','customer number','αριθμος λογαριασμου','κωδικος πελατη'],customer_information:['customer','customer name','πελατης'],project_information:['project','project name','εργο'],subtotal:['subtotal','net amount','καθαρη αξια'],vat:['vat amount','ποσο φπα'],invoice_total:['invoice total','grand total','συνολο τιμολογιου','πληρωτεο'],currency:['currency','νομισμα']};
const fold=value=>value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().trim().replace(/\s+/g,' ');
export function printedDecimal(raw){
 const value=raw.trim().replace(/^(?:€|EUR)\s*/i,'').replace(/\s*(?:€|EUR)$/i,'');
 if(/^-?\d{1,18}(?:[.,]\d{1,6})?$/.test(value))return value;
 if(/^-?\d{1,3}(?:\.\d{3})+,\d{1,6}$/.test(value))return value.replaceAll('.','');
 if(/^-?\d{1,3}(?:,\d{3})+\.\d{1,6}$/.test(value))return value.replaceAll(',','');
 return null;
}
function date(raw){
 let value=raw.trim();const match=value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(match)value=`${match[3]}-${match[2]}-${match[1]}`;
 return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value?value:null;
}
export function suggestFields(pages){
 const found={},warnings=[];
 for(const page of pages)for(const line of page.text.split('\n')){
  // Require a complete labelled row, not a nearby arbitrary number or filename.
  const match=line.match(/^\s*([^:\t]+?)\s*(?::\s*|\t+)([^\n]+?)\s*$/);if(!match)continue;
  const field=Object.keys(labels).find(key=>labels[key].includes(fold(match[1])));if(!field)continue;
  const printed=match[2].trim();if(!printed||printed.length>1000)continue;
  const value=['subtotal','vat','invoice_total'].includes(field)?printedDecimal(printed):field==='invoice_date'?date(printed):printed;
  if(value===null){warnings.push(`${field.replaceAll('_',' ')} on page ${page.page} needs manual entry.`);continue;}
  (found[field]??=[]).push({field,value,printed,page:page.page,evidence:line,certainty:'unverified'});
 }
 const candidates=[];
 for(const [field,matches] of Object.entries(found)){
  if(new Set(matches.map(match=>match.value)).size>1){warnings.push(`Conflicting ${field.replaceAll('_',' ')} values: enter this field manually. This PDF may contain multiple documents.`);continue;}
  candidates.push(matches[0]);
 }
 const supplier=candidates.find(candidate=>candidate.field==='supplier_name');const key=classifyPrintedSupplier(supplier?.value);
 if(key)candidates.push({...supplier,field:'supplier_key',value:key});
 const empty=pages.filter(page=>!page.text.trim()).map(page=>page.page);
 if(empty.length)warnings.push(`No selectable text on page(s) ${empty.join(', ')}. OCR or manual entry is required; those pages were not analyzed.`);
 warnings.push('Suggestions are unverified. Check every field and purchased item against the original PDF. Table columns and reading order may differ from the source.');
 return {candidates,warnings};
}
export function validatePages(body){
 if(!body||!Number.isInteger(body.revision)||body.revision<0)throw Error('Refresh this preview before saving.');
 if(!['generic','tournas','akron','ergobeton'].includes(body.template))throw Error('Choose a supported template.');
 if(!Array.isArray(body.pages)||body.pages.length<1||body.pages.length>100)throw Error('Read between 1 and 100 complete PDF pages.');
 let length=0,fragments=0;const pages=body.pages.map((entry,index)=>{
  if(!entry||entry.page!==index+1||typeof entry.text!=='string'||entry.text.length>50000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(entry.text)||!Number.isFinite(entry.width)||!Number.isFinite(entry.height)||entry.width<=0||entry.height<=0||entry.width>10000||entry.height>10000||!Array.isArray(entry.fragments)||entry.fragments.length>5000)throw Error('Invalid page text.');
  length+=entry.text.length;fragments+=entry.fragments.length;
  const parts=entry.fragments.map(f=>{if(!f||typeof f.text!=='string'||f.text.length>2000||!Number.isFinite(f.x)||!Number.isFinite(f.y)||Math.abs(f.x)>20000||Math.abs(f.y)>20000)throw Error('Invalid source fragment.');length+=f.text.length;return {text:f.text,x:f.x,y:f.y};});
  if(entry.extraction_method&& !['text','ocr'].includes(entry.extraction_method))throw Error('Invalid extraction method.');
  const provenance=entry.extraction_method==='ocr'?{extraction_method:'ocr',ocr_engine:entry.ocr_engine==='tesseract-6-ell-eng-v1'?entry.ocr_engine:'unverified-ocr',ocr_confidence:Number.isFinite(entry.ocr_confidence)&&entry.ocr_confidence>=0&&entry.ocr_confidence<=100?entry.ocr_confidence:null}:{};
  let currency_evidence;
  if(entry.currency_evidence){const c=entry.currency_evidence;if(c.currency!=='EUR'||c.printed!=='€'||c.method!=='footer-image-ocr'||c.source_page!==entry.page||!Number.isFinite(c.confidence)||c.confidence<80||c.confidence>100||typeof c.printed_total_ocr!=='string'||!/^\d[\d.,]{1,30}$/.test(c.printed_total_ocr))throw Error('Invalid printed currency evidence.');currency_evidence={currency:c.currency,printed:c.printed,method:c.method,source_page:c.source_page,confidence:c.confidence,printed_total_ocr:c.printed_total_ocr,needs_source_review:true};}
  return {page:entry.page,text:entry.text,width:entry.width,height:entry.height,fragments:parts,...provenance,...(currency_evidence?{currency_evidence}:{}),...(typeof entry.currency_check_warning==='string'?{currency_check_warning:entry.currency_check_warning.slice(0,500)}:{})};
 });
 if(length>1000000||fragments>50000)throw Error('PDF text exceeds the saved-text limit.');
 return {pages,revision:body.revision,template:body.template};
}
