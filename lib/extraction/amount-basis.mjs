import {decimal,formatDecimal,reconcileLineTotals} from '../invoice-audit.mjs';
// Only the inspected receipt layout is eligible for VAT-inclusive lines. A
// supplier name or matching grand total alone never changes the amount basis.
export function tournasAmountBasis(type,totals,lines,page){
 if(!lines.length)return;
 const receipt=/ΑΠΟΔΕΙΞΗ/.test(type.normalize('NFKD').replace(/\p{M}/gu,'').toUpperCase());
 const s=decimal(totals.subtotal),v=decimal(totals.vat),t=decimal(totals.invoice_total);
 const candidate=receipt?'gross':'net';
 const check=reconcileLineTotals(totals,lines.map(line=>({...line,line_amount_basis:candidate})));
 // Basis is a property of this inspected document template, not a reward for
 // passing arithmetic. Keep a real mismatch visible instead of hiding it by
 // calling a known basis unknown. Invoices never inherit receipt gross basis.
 const valid=/ΤΙΜΟΛΟΓΙΟ|ΑΠΟΔΕΙΞΗ/.test(type.normalize('NFKD').replace(/\p{M}/gu,'').toUpperCase())&&s!==null&&v!==null&&t!==null&&check&&!check.uncertain;
 const basis=valid?candidate:'unknown';
 for(const line of lines){line.line_amount_basis=basis;line.unit_price_basis=basis;line.amount_basis_evidence=valid?`Page ${page}: inspected ${receipt?'receipt':'invoice'} template uses ${candidate} line amounts. Printed lines ${formatDecimal(check.sum)}; printed ${candidate} total ${formatDecimal(check.target)}; difference ${formatDecimal(check.difference)}. Confirm the original.`:'The printed line VAT basis could not be established from this page. Verify the original.';}
}
