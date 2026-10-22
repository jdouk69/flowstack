// Presentation only: never replace hashed finding fields or saved audit evidence.
import {decimal,formatDecimal} from './invoice-audit.mjs';
import {constructionTranslation} from './product-translations.mjs';
const translations=new Map(Object.entries({
 'ΣΙΔΕΡΑ':'Steel', 'ΜΕΤΑΦΟΡΑ':'Transport service', 'ΣΥΡΜΑ ΜΑΥΡΟ ΧΟΝΔΡΟ':'Thick black wire',
 'ΣΥΡΜΑ ΜΑΥΡΟ Νο 7 (2 kg/κουλ)':'Black wire No. 7 — 2 kg per coil',
 'ΑΤΣΑΛΟΚΑΡΦΟ ΡΙΓΩΤΟ Φ 3,5x50mm':'Ribbed steel nail — diameter 3.5 × 50 mm',
 'ΤΣΙΜΕΝΤΟ ΜΑΥΡΟ 32.5R 40kg/τεμ':'Cement labelled “black”, 32.5R — 40 kg per unit',
 'ΣΑΚΟΣ 0.5m3 ΓΙΑ ΑΔΡΑΝΗ':'Aggregate sack — 0.5 m³',
 'ΑΜΜΟΣ ΝΤΑΜΑΡΙΣΙΑ ΣΕ ΣΑΚΟ 0.50m3':'Quarry sand in a sack — 0.50 m³',
 'ΑΜΜΟΣ ΛΑΤΟΜΕΙΟΥ':'Quarry sand', 'ΧΑΛΙΚΙ ΣΕ ΣΑΚΟ 0.50m3':'Gravel in a sack — 0.50 m³',
 'ΨΗΦΙΔΑ ΣΕ 0.5m3 BIG BAG':'Chippings in a 0.5 m³ big bag',
 'ΡΗΤΙΝΗ SINMAST S2 1kg ΡΕΥΣΤΗ':'Liquid SINMAST S2 resin — 1 kg',
 'ΚΩΝΟΣ THRUTY SK14':'THRUTY SK14 cone',
 'ΣΩΛΗΝΑΚΙ THRUTY 14/19 25cm':'THRUTY 14/19 tube — 25 cm',
 'ΣΩΛΗΝΑΚΙ THRUTY 14/19 30cm':'THRUTY 14/19 tube — 30 cm',
 'ΚΟΛΛΑ ΠΛΑΚ.FINOMIX KP500W 25kg':'FINOMIX KP500W tile adhesive — 25 kg',
 'ΚΟΛΛΑ ΠΛΑΚ.FINOMIX KP300W 25kg':'FINOMIX KP300W tile adhesive — 25 kg',
 'ΧΑΡΤΟΤΑΙΝΙΑ 38mm':'Paper tape — 38 mm', 'ΧΑΡΤΟΤΑΙΝΙΑ 50mm':'Paper tape — 50 mm',
 'ΓΑΖΑ ΓΥΨΟΣΑΝΙΔΑΣ 90m, KNAUF':'KNAUF plasterboard joint tape — 90 m',
 'ΒΙΔΑ ΓΥΨ KNAUF ΤΝ 25, 1000τεμ/πακ':'KNAUF TN 25 plasterboard screws — 1,000 per pack',
 'ΒΙΔΑ ΓΥΨ KNAUF ΤΝ 35, 1000τεμ/πακ':'KNAUF TN 35 plasterboard screws — 1,000 per pack',
 'ΓΥΨ/ΔΑ KNAUF 12.50mm 1.20 x 2.50':'KNAUF plasterboard — 12.50 mm, 1.20 × 2.50',
 'ΑΣΒΕΣΤΗΣ Α-3 30Κg':'A-3 lime — 30 kg', 'ΑΣΒΕΣΤΗΣ Α-3 35kg':'A-3 lime — 35 kg'
}));
export function productDisplay(f){
 const original=f.item??'';
 if(original==='Invoice-level concern')return {english:'Invoice-level check',original:null,uncertain:false};
 const construction=constructionTranslation(original);if(construction)return {...construction,original,uncertain:!!construction.uncertainty};
 const english=translations.get(original.trim().replace(/\s+/g,' '));
 if(english)return {english,original,uncertain:false};
 if(original&& !/[\u0370-\u03ff\u1f00-\u1fff]/u.test(original))return {english:original,original:null,uncertain:false};
 const code=f.evidence?.find(e=>e.product_code)?.product_code;
 return {english:code?'Product '+code+' — English translation needs review':'Product — English translation needs review',original,uncertain:true};
}
const captureCodes=new Set(['line_calculation','printed_price_rounding','printed_amount_rounding','amount_basis_unverified','discount_percentage_rounding','invoice_discount_mismatch','subtotal_mismatch','total_mismatch','missing_fields','receiver_unverified','incomplete_quantities','incomplete_arithmetic','missing_items','discount_basis','negative_values']);
export const findingCategory=f=>f.kind==='invoice'&&captureCodes.has(f.key?.[1])?'capture':'purchase';
export function findingCounts(findings){const result={capture:{ORANGE:0,RED:0},purchase:{ORANGE:0,RED:0}};for(const f of findings)if(f.unresolved&&['ORANGE','RED'].includes(f.color))result[findingCategory(f)][f.color]++;return result;}
const value=v=>v==null||v===''?'Not captured':String(v);
const number=v=>{const n=decimal(v);if(n===null)return value(v);const s=formatDecimal(n);const [whole,fraction='']=s.split('.');return whole+'.'+fraction.padEnd(2,'0');};
const difference=(printed,expected)=>{const a=decimal(printed),b=decimal(expected);if(a===null||b===null)return null;const d=a-b;return (d>0n?'+':'')+formatDecimal(d);};
export function findingExplanation(f){
 if(f.reassessment)return {summary:f.reassessment.explanation,details:(f.reassessment.evidence||[]).flatMap(e=>Object.entries(e).map(([k,v])=>[k.replaceAll('_',' '),value(v)])),currency:f.currency||'Currency not captured',category:findingCategory(f)};
 const code=f.key?.[1],details=[];let summary=f.reason||'Review this recorded observation against the original documents.';
 if(f.kind==='product'){
  const s=String(f.item||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replaceAll('ς','σ');
  if(/στοκο/.test(s))summary='This product is finishing filler, a consumable material, not reusable equipment. The original Yellow assessment is preserved; clarify material use only if project records leave it unexplained.';
  else if(/γαντζο/.test(s))summary='This product is a conduit hook/fitting, not personal protective equipment. The original Yellow assessment is preserved; check its installation location if clarification is needed.';
  if(summary!==f.reason)details.push(['Original assessment (unchanged)',f.reason],['Correction scope','Product wording only; finding ID, color, review and financial values unchanged.']);
 }
 if(['line_calculation','printed_price_rounding'].includes(code)){
  const e=f.evidence?.find(e=>e.calculated_net!=null)||{};const line=f.evidence?.find(e=>e.printed_name)||{};
  const diff=e.difference??difference(e.line_amount,e.calculated_net);
  summary=diff!==null?'Quantity '+value(e.quantity)+' × unit price '+number(e.unit_price)+(e.discount_amount_printed!=null?' minus printed monetary discount '+number(e.discount_amount_printed):' (printed discount '+(e.discount_printed==null?'not captured':value(e.discount_printed)+(e.discount_basis==='%'?'%':e.discount_basis?' '+e.discount_basis:decimal(e.discount_printed)===0n?'':' — basis unconfirmed'))+')')+'. The printed line amount is '+number(e.line_amount)+'; the recorded calculation is '+number(e.calculated_net)+'. Difference: '+diff+'. Check rounding, discount and capture accuracy before treating this as a purchasing concern.':'The captured quantity and price need checking against the printed line amount. The available evidence does not establish the cause.';
  details.push(['Quantity',value(e.quantity)+' '+(line.unit||'')],['Unit price',number(e.unit_price)],['Printed discount',e.discount_printed==null?'Not captured':value(e.discount_printed)+(e.discount_basis==='%'?'%':e.discount_basis?' '+e.discount_basis:decimal(e.discount_printed)===0n?' (zero)':' (basis unconfirmed)')],['Recorded calculated amount',number(e.calculated_net)],['Printed line amount',number(e.line_amount)],['Printed minus calculated',diff??'Cannot calculate from available evidence']);
  if(e.discount_amount_printed!=null)details.push(['Printed monetary discount',number(e.discount_amount_printed)]);if(e.line_amount_basis)details.push(['Printed amount basis',e.line_amount_basis]);
 }else if(code==='subtotal_mismatch'){
  const e=f.evidence?.find(e=>e.line_amount_sum!=null)||{},i=f.source_signature?.invoice||{};const diff=difference(e.line_amount_sum,e.subtotal);
  summary=e.printed_target!=null?'Printed '+value(e.line_amount_basis)+' lines total '+number(e.line_amount_sum)+(e.invoice_discount_printed!=null?' minus invoice discount '+number(e.invoice_discount_printed):'')+'; the comparison total is '+number(e.expected_total)+' versus '+number(e.printed_target)+' printed. Difference: '+value(e.difference)+'. Verify the original rows, discounts and VAT basis.':'Captured lines total '+number(e.line_amount_sum)+'; the printed net subtotal is '+number(e.subtotal)+'. Difference: '+(diff??'not available')+'. Check whether the line amounts include VAT, or whether rows, discounts or charges were captured incorrectly.';
  details.push(['Captured line sum',number(e.line_amount_sum)],['Printed net subtotal',number(e.subtotal)],['Printed VAT',number(i.vat)],['Printed invoice total',number(i.invoice_total)],['Line sum minus net subtotal',diff??'Not available']);
 }else if(code==='discount_percentage_rounding'){
  const e=f.evidence?.find(e=>e.discount_amount_printed!=null)||{};
  summary='The printed monetary discount is '+number(e.discount_amount_printed)+'; using it gives '+number(e.calculated_net)+', compared with the printed line amount '+number(e.line_amount)+'. The rounded '+value(e.discount_printed)+'% gives '+number(e.percentage_calculation)+'. Keep both printed discounts; this difference is a calculation check.';
  details.push(['Printed monetary discount',number(e.discount_amount_printed)],['Printed percentage',value(e.discount_printed)+'%'],['Calculation using money',number(e.calculated_net)],['Calculation using percentage',number(e.percentage_calculation)],['Printed line amount',number(e.line_amount)],['Percentage calculation minus monetary calculation',value(e.difference)]);
 }else if(code==='printed_amount_rounding'){
  const e=f.evidence?.find(e=>e.line_amount_sum!=null)||{};
  summary='Printed '+value(e.line_amount_basis)+' line amounts total '+number(e.line_amount_sum)+'. After the printed invoice discount '+(e.invoice_discount_printed==null?'(none captured)':number(e.invoice_discount_printed))+', the comparison total is '+number(e.expected_total)+' versus '+number(e.printed_target)+' printed. Difference '+value(e.difference)+' fits the printed-precision interval '+value(e.rounding_bound)+(e.shortened_printed_amounts?'. Some printed amounts show fewer decimal places; omitted final digits could explain this. Confirm the source or ask the supplier. No amount was repaired.':'. Verify rounding against the source.');
  details.push(['Printed lines total',number(e.line_amount_sum)],['Printed invoice discount',e.invoice_discount_printed==null?'None captured':number(e.invoice_discount_printed)],['Comparison total',number(e.expected_total)],['Corresponding printed total',number(e.printed_target)],['Exact difference',value(e.difference)],['Printed-precision bound',value(e.rounding_bound)]);
 }else if(code==='total_mismatch'){
  const e=f.evidence?.find(e=>e.subtotal!=null)||{};
  summary='The printed subtotal '+number(e.subtotal)+' plus VAT '+number(e.vat)+' does not match the printed total '+number(e.invoice_total)+'. Check the original totals and captured values.';
  details.push(['Subtotal',number(e.subtotal)],['VAT',number(e.vat)],['Printed total',number(e.invoice_total)],['Subtotal + VAT minus total',value(e.difference)]);
 }else if(code==='duplicate_identity')summary='Another document has a matching saved invoice identity. Compare both original document types, series and dates before deciding whether there is a duplicated charge.';
 else if(code==='missing_fields')summary='Some required printed details are missing or uncertain. Verify them on the original invoice; this is a capture check, not evidence of a suspicious purchase.';
 else if(code==='receiver_unverified')summary='The receiving-person box has not been verified. Check it separately from the delivery-person box; do not substitute the deliverer for a blank receiver.';
 return {summary,details,currency:f.currency||'Currency not captured',category:findingCategory(f)};
}
