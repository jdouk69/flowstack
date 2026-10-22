export const AUDIT_RULE_VERSION='printed-amount-basis-discounts-v2';
// Printed values remain strings. Calculations use integer millionths, never floats.
export const normalize=value=>String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleUpperCase('en');
export const decimal=value=>{if(value==null||value==='')return null;const s=String(value).replace(',','.');if(!/^-?\d{1,18}(\.\d{1,6})?$/.test(s))return null;const negative=s.startsWith('-'),[whole,fraction='']=s.replace(/^-/,'').split('.');return (BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0')))*(negative?-1n:1n);};
export const formatDecimal=value=>{const negative=value<0n;const abs=negative?-value:value;const fraction=String(abs%1000000n).padStart(6,'0').replace(/0+$/,'');return (negative?'-':'')+String(abs/1000000n)+(fraction?'.'+fraction:'');};
export const supplierIdentity=invoice=>invoice.supplier_key?'classified:'+invoice.supplier_key:invoice.supplier_name?'printed:'+normalize(invoice.supplier_name):null;
// A versioned identity is calculated from source fields, including legacy rows.
// Existing approved keys are never backfilled or changed by this helper.
export function invoiceIdentity(invoice){const supplier=supplierIdentity(invoice),number=normalize(invoice.invoice_number);return supplier&&number?JSON.stringify(['v2',supplier,normalize(invoice.document_type),normalize(invoice.invoice_series),number]):null;}
export function sameInvoice(a,b){return !!a.document_type&&!!b.document_type&&!!invoiceIdentity(a)&&invoiceIdentity(a)===invoiceIdentity(b);}
export async function matchingInvoices(db,owner,invoice){
 const rows=(await db.prepare("SELECT * FROM invoices WHERE owner=? AND id<>? AND audit_status<>'excluded' LIMIT 5001").bind(owner,invoice.id).all()).results;
 if(rows.length>5000)throw Object.assign(Error('Invoice identity history exceeds the safe processing limit. No incomplete comparison was used.'),{status:413});
 return rows.filter(row=>sameInvoice(invoice,row));
}
const magnitude=value=>value<0n?-value:value;
// Bounds come from the precision actually printed, not an arbitrary tolerance.
export const printedQuantum=value=>{if(decimal(value)===null)return null;const precision=String(value).replace(',','.').split('.')[1]?.length??0;return 10n**BigInt(6-precision);};
const CALC_SCALE=1000000000000000000000000n,CALC_FACTOR=1000000000000000000n;
export const formatCalculation=value=>{const negative=value<0n,abs=negative?-value:value,fraction=String(abs%CALC_SCALE).padStart(24,'0').replace(/0+$/,'');return (negative?'-':'')+String(abs/CALC_SCALE)+(fraction?'.'+fraction:'');};
export function lineCalculation(line){
 const quantity=decimal(line.quantity),price=decimal(line.unit_price),amount=decimal(line.line_amount),discount=decimal(line.discount_printed),money=decimal(line.discount_amount_printed);
 const percentage=line.discount_basis==='%'&&discount!==null&&discount>=0n&&discount<=100000000n;
 const validMoney=money!==null&&money>=0n;
 // Products of six-place inputs and percentage discounts remain exact to 24
 // places; do not round intermediate results down to monetary millionths.
 let scaled=quantity!==null&&price!==null?quantity*price*1000000000000n:null;
 const before=scaled;
 if(scaled!==null&&validMoney)scaled-=money*CALC_FACTOR;
 else if(scaled!==null&&percentage)scaled=scaled*(100000000n-discount)/100000000n;
 const unknownDiscount=(money!==null&&!validMoney)||(discount!==null&&discount!==0n&&!percentage&&!validMoney);
 let priceBound=quantity===null||price===null?0n:magnitude(quantity)*printedQuantum(line.unit_price)*500000000000n;
 if(percentage&&!validMoney)priceBound=priceBound*(100000000n-discount)/100000000n;
 const scaledBound=priceBound+(amount!==null?printedQuantum(line.line_amount)*CALC_FACTOR/2n:0n)+(validMoney?printedQuantum(line.discount_amount_printed)*CALC_FACTOR/2n:0n);
 const percentScaled=before!==null&&percentage?before*(100000000n-discount)/100000000n:null;
 const scaledDifference=scaled!==null&&amount!==null?scaled-amount*CALC_FACTOR:null;
 return {expected:scaled===null?null:scaled/CALC_FACTOR,expectedText:scaled===null?null:formatCalculation(scaled),roundingBound:scaledBound/CALC_FACTOR,roundingBoundText:formatCalculation(scaledBound),unknownDiscount,percentage,validMoney,percentageExpected:percentScaled===null?null:percentScaled/CALC_FACTOR,percentageExpectedText:percentScaled===null?null:formatCalculation(percentScaled),amount,difference:scaledDifference===null?null:scaledDifference/CALC_FACTOR,differenceText:scaledDifference===null?null:formatCalculation(-scaledDifference),possibleRounding:scaledDifference!==null&&magnitude(scaledDifference)<=scaledBound,exceedsCent:scaledDifference!==null&&magnitude(scaledDifference)>10000n*CALC_FACTOR,discountDisagreement:scaled!==null&&percentScaled!==null&&magnitude(percentScaled-scaled)>10000n*CALC_FACTOR,discountDifferenceText:scaled!==null&&percentScaled!==null?formatCalculation(percentScaled-scaled):null};
}
export function reconcileLineTotals(invoice,lines){
 if(!lines.length||lines.some(line=>decimal(line.line_amount)===null))return null;
 const bases=new Set(lines.map(line=>line.line_amount_basis||'net'));
 if(bases.size!==1||bases.has('unknown'))return {uncertain:true};
 const basis=[...bases][0],target=decimal(basis==='gross'?invoice.invoice_total:invoice.subtotal);
 if(target===null)return null;
 const sum=lines.reduce((a,line)=>a+decimal(line.line_amount),0n),discount=decimal(invoice.invoice_discount_printed);
 if(discount!==null&&(discount<0n||basis==='gross'))return {uncertain:true};
 const expected=sum-(discount??0n),difference=expected-target;
 const targetQuantum=printedQuantum(basis==='gross'?invoice.invoice_total:invoice.subtotal);
 // Real Tournas originals 158, 2489 and 687 show one-decimal line amounts
 // beside two-decimal totals. Final cents may be omitted rather than rounded.
 // Retain the shortened printed value; this is only a review interval, never
 // a reconstructed line amount or a claim that the invoice reconciles.
 const shortened=lines.some(line=>printedQuantum(line.line_amount)>targetQuantum);
 const bound=lines.reduce((a,line)=>{const q=printedQuantum(line.line_amount),half=q/2n,omitted=q>targetQuantum?q-targetQuantum:0n;return a+(omitted>half?omitted:half);},0n)+targetQuantum/2n+(discount!==null?printedQuantum(invoice.invoice_discount_printed)/2n:0n);
 return {basis,sum,expected,target,difference,bound,discount,shortened};
}
const rank={GREEN:0,YELLOW:1,ORANGE:2,RED:3};
export function auditInvoice(invoice,lines,history,historyLines){
 const reasons=[];const add=(color,code,reason,evidence=[])=>reasons.push({color,code,reason,evidence});
 const key=invoiceIdentity(invoice);
 const duplicates=key?history.filter(row=>row.id!==invoice.id&&row.audit_status!=='excluded'&&sameInvoice(invoice,row)):[];
 if(duplicates.length)add('ORANGE','duplicate_identity','Another source PDF has the same supplier identity and invoice number. Resolve this match before approval.',duplicates.map(row=>({invoice_id:row.id,invoice_number:row.invoice_number,invoice_date:row.invoice_date,invoice_total:row.invoice_total,source_document_id:row.source_document_id})));
 if(!['shown','blank'].includes(invoice.receiver_status))add('YELLOW','receiver_unverified','The receiver box has not been confirmed as a printed name or a blank field. Check Ο ΠΑΡΑΛΑΒΩΝ separately from Ο ΠΑΡΑΔΟΥΣ; no receiver is inferred.');
 const missing=['supplier_name','invoice_number','document_type','invoice_date','currency','invoice_total'].filter(field=>!invoice[field]);
 if(missing.length)add('YELLOW','missing_fields','Printed fields are missing or uncertain: '+missing.join(', ')+'.');
 const uncertain=history.filter(row=>row.id!==invoice.id&&row.audit_status!=='excluded'&&supplierIdentity(row)===supplierIdentity(invoice)&&normalize(row.invoice_number)===normalize(invoice.invoice_number)&&(!row.document_type||!invoice.document_type));
 if(uncertain.length)add('YELLOW','uncertain_identity','The same supplier/number appears on a record with an unknown document type. Compare the original type and series before treating it as the same invoice.',uncertain.map(row=>({invoice_id:row.id,invoice_number:row.invoice_number,document_type:row.document_type,source_document_id:row.source_document_id})));
 if(!lines.length)add('YELLOW','missing_items','No individual purchased items have been captured.');
 if(lines.some(line=>decimal(line.quantity)===null||!line.unit))add('YELLOW','incomplete_quantities','Some line items have no recorded quantity or unit; quantity comparisons are incomplete.');
 const subtotal=decimal(invoice.subtotal),vat=decimal(invoice.vat),total=decimal(invoice.invoice_total);
 if(subtotal===null||vat===null||lines.some(line=>decimal(line.unit_price)===null||decimal(line.line_amount)===null))add('YELLOW','incomplete_arithmetic','Some printed financial values are missing; not all arithmetic checks could run.');
 if([subtotal,vat,total,...lines.flatMap(line=>[decimal(line.quantity),decimal(line.unit_price),decimal(line.line_amount)])].some(value=>value!==null&&value<0n))add('YELLOW','negative_values','Negative values may represent a credit or return. Confirm their document-specific treatment before approval.');
 if(subtotal!==null&&vat!==null&&total!==null&&magnitude(subtotal+vat-total)>10000n)add('ORANGE','total_mismatch','Printed subtotal plus VAT differs from the printed invoice total by more than 0.01.',[{subtotal:invoice.subtotal,vat:invoice.vat,invoice_total:invoice.invoice_total,difference:formatDecimal(subtotal+vat-total)}]);
 const reconciliation=reconcileLineTotals(invoice,lines);
 if(reconciliation?.uncertain)add('YELLOW','amount_basis_unverified','The printed line amounts have an unknown or mixed VAT basis, or an unsupported invoice discount. Verify the original before reconciling them with net or gross totals.');
 else if(reconciliation&&magnitude(reconciliation.difference)>10000n){const rounding=magnitude(reconciliation.difference)<=reconciliation.bound;add(rounding?'YELLOW':'ORANGE',rounding?'printed_amount_rounding':'subtotal_mismatch','Printed '+reconciliation.basis+' lines total '+formatDecimal(reconciliation.sum)+(reconciliation.discount!==null?' minus the printed invoice discount '+invoice.invoice_discount_printed:'')+'; the corresponding printed '+reconciliation.basis+' total is '+formatDecimal(reconciliation.target)+'. Difference: '+formatDecimal(reconciliation.difference)+(rounding?(reconciliation.shortened?'. Some line amounts show fewer decimal places than the total; omitted final digits or rounding could explain this. Confirm with the source or supplier. The printed amounts were not repaired.':'. This falls within the combined precision of the printed amounts; verify rounding, not purchasing misconduct.'):'. This exceeds the printed-amount precision interval; check missing rows, discounts and capture against the source.'),[{line_amount_sum:formatDecimal(reconciliation.sum),line_amount_basis:reconciliation.basis,invoice_discount_printed:invoice.invoice_discount_printed??null,expected_total:formatDecimal(reconciliation.expected),printed_target:formatDecimal(reconciliation.target),subtotal:invoice.subtotal,invoice_total:invoice.invoice_total,difference:formatDecimal(reconciliation.difference),rounding_bound:formatDecimal(reconciliation.bound),shortened_printed_amounts:reconciliation.shortened}]);}
 if(decimal(invoice.subtotal_before_discount)!==null&&decimal(invoice.invoice_discount_printed)!==null&&subtotal!==null){const diff=decimal(invoice.subtotal_before_discount)-decimal(invoice.invoice_discount_printed)-subtotal;if(magnitude(diff)>10000n)add('ORANGE','invoice_discount_mismatch','The printed amount before invoice discount minus the printed monetary invoice discount does not match the printed net subtotal.',[{subtotal_before_discount:invoice.subtotal_before_discount,invoice_discount_printed:invoice.invoice_discount_printed,subtotal:invoice.subtotal,difference:formatDecimal(diff)}]);}
 const previous=new Map(history.filter(row=>row.audit_status==='approved'&&row.id!==invoice.id&&row.invoice_date&&invoice.invoice_date&&row.invoice_date<=invoice.invoice_date&&historicalAccountMatches(invoice,row)).map(row=>[row.id,row]));
 for(const line of lines){
  const label=normalize(line.printed_name||line.description),unit=normalize(line.unit);
  const quantity=decimal(line.quantity),price=decimal(line.unit_price),amount=decimal(line.line_amount);
  const {expected,expectedText,percentage,validMoney,unknownDiscount,roundingBound,roundingBoundText,percentageExpected,percentageExpectedText,possibleRounding,exceedsCent,differenceText,discountDisagreement,discountDifferenceText}=lineCalculation(line);
  if(unknownDiscount)add('YELLOW','discount_basis','Item '+line.position+': its printed discount cannot be applied unambiguously. Review its basis before comparing net amounts.',[{position:line.position,discount_printed:line.discount_printed,discount_basis:line.discount_basis}]);
  const precision=String(line.unit_price??'').replace(',','.').split('.')[1]?.length??0;
  if(validMoney&&discountDisagreement)add('YELLOW','discount_percentage_rounding','Item '+line.position+': the printed monetary discount was used. Its rounded percentage produces a different amount; verify the two printed discount columns without changing either.',[{position:line.position,discount_printed:line.discount_printed,discount_amount_printed:line.discount_amount_printed,calculated_net:expectedText,percentage_calculation:percentageExpectedText,line_amount:line.line_amount,difference:discountDifferenceText}]);
  if(expected!==null&&amount!==null&&!unknownDiscount&&exceedsCent)add(possibleRounding?'YELLOW':'ORANGE',possibleRounding?'printed_price_rounding':'line_calculation','Item '+line.position+': quantity × unit price'+(validMoney?' minus its printed monetary discount':percentage?' after its printed percentage discount':'')+(possibleRounding?' can differ from its printed line amount because the displayed values have limited precision. Verify rounding; this is not a documented purchase inconsistency.':' differs from its printed line amount beyond the displayed-value rounding interval. Verify the original, discounts and price basis before treating it as a significant discrepancy.'),[{position:line.position,quantity:line.quantity,unit_price:line.unit_price,discount_printed:line.discount_printed??null,discount_basis:line.discount_basis??null,discount_amount_printed:line.discount_amount_printed??null,line_amount_basis:line.line_amount_basis??null,calculated_net:expectedText,line_amount:line.line_amount,difference:differenceText,rounding_bound:roundingBoundText,printed_price_precision:precision}]);
  if(!label||!unit)continue;
  const matches=historyLines.filter(old=>previous.has(old.invoice_id)&&normalize(old.printed_name||old.description)===label&&normalize(old.unit)===unit);
  const evidence=old=>({invoice_id:old.invoice_id,position:line.position,prior_position:old.position,invoice_number:previous.get(old.invoice_id).invoice_number,quantity:old.quantity,unit:old.unit,unit_price:old.unit_price,supplier_name:previous.get(old.invoice_id).supplier_name,invoice_date:previous.get(old.invoice_id).invoice_date});
  const priceMatches=matches.filter(old=>normalize(previous.get(old.invoice_id).currency)===normalize(invoice.currency)&&invoice.currency&&(old.unit_price_basis??null)===(line.unit_price_basis??null)&&decimal(old.unit_price)!==null&&decimal(old.unit_price)!==price);
  if(price!==null&&priceMatches.length){const old=priceMatches.sort((a,b)=>previous.get(b.invoice_id).invoice_date.localeCompare(previous.get(a.invoice_id).invoice_date)||a.id.localeCompare(b.id))[0];add('YELLOW','price_change','Item '+line.position+': its unit price differs from a previous approved invoice with the same exact item text, unit, and currency.',[{position:line.position,current_unit_price:line.unit_price,...evidence(old)}]);}
  // Quantity/frequency thresholds await source-backed configuration; no invented cutoff.
  const cross=matches.filter(old=>supplierIdentity(previous.get(old.invoice_id))!==supplierIdentity(invoice));
  if(cross.length)add('YELLOW','cross_supplier','Item '+line.position+': the same exact item text and unit were purchased from another supplier. Similar wording alone does not establish equivalent products.',cross.slice(0,10).map(evidence));
 }
 const flag=reasons.reduce((color,item)=>rank[item.color]>rank[color]?item.color:color,'GREEN');
 return {flag,reasons,duplicate_of:duplicates[0]?.id||null,identity_key:key,history_count:previous.size};
}
export function historicalAccountMatches(invoice,previous){
 if(supplierIdentity(invoice)!==supplierIdentity(previous))return Boolean(invoice.project_information&&previous.project_information&&normalize(invoice.project_information)===normalize(previous.project_information));
 return Boolean(invoice.account_information&&previous.account_information&&normalize(invoice.account_information)===normalize(previous.account_information));
}
export function approvalMissing(invoice,lines){return ['supplier_name','invoice_number','document_type','invoice_date','currency','invoice_total'].filter(field=>!invoice[field]).concat(!lines.length?['individual line items']:[],!['shown','blank'].includes(invoice.receiver_status)?['receiver source verification']:[]);}
