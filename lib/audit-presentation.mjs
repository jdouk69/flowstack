import {issueType,reviewState} from './findings-workspace.mjs';
import {FINDING_STATES} from './finding-status.mjs';
export const reviewLabel=f=>FINDING_STATES[reviewState(f)]||({not_reviewed:'Not reviewed',invoice_reviewed:'Invoice reviewed',superseded:'Superseded',archived:'Archived snapshot'}[reviewState(f)]||reviewState(f));
export function currencyPresentation(f){
 let fields={};try{fields=JSON.parse(f.source_signature?.invoice?.field_evidence||'{}');}catch{}
 const e=fields.currency;
 if(f.currency)return {code:f.currency,label:f.currency,status:'Recorded currency',evidence:e||null};
 if(e&&['EUR','USD','GBP'].includes(e.currency)&&e.needs_source_review===false&&e.source_page&&e.printed)return {code:e.currency,label:e.currency,status:'Source-supported display only',evidence:e};
 return {code:null,label:'Unverified',status:'Currency not verified on the saved invoice',evidence:e||null};
}
export const issueLabel=f=>({line_calculation:'Quantity / price check',subtotal_mismatch:'Subtotal check',duplicate_identity:'Possible duplicate invoice',missing_fields:'Missing captured details',printed_price_rounding:'Price precision',printed_amount_rounding:'Amount precision',discount_percentage_rounding:'Discount precision',total_mismatch:'VAT / total check',price_change:'Price comparison',receiver_unverified:'Receiver verification'}[issueType(f)]||(f.kind==='product'?'Product use / classification':'Recorded check'));
export function shortConcern(f){
 if(f.reassessment)return f.superseded?'Earlier calculation warning superseded; original retained.':({printed_price_rounding:'Printed price precision needs clarification.',printed_amount_rounding:'Printed amount precision needs clarification.',discount_percentage_rounding:'Printed percentage and monetary discount differ.'}[f.reassessment.corrected_code]||'Source-backed reassessment; precision uncertainty retained.');
 const code=issueType(f);
 if(code==='duplicate_identity')return 'Matching invoice number; compare document type, series and dates.';
 if(code==='line_calculation')return 'Quantity, price or discount differs from the captured line amount.';
 if(code==='subtotal_mismatch')return 'Captured line totals need comparison with net subtotal and VAT.';
 if(code==='missing_fields')return 'Required printed details are missing or uncertain.';
 if(f.kind==='product'){const s=String(f.item||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();return /στοκο/.test(s)?'Consumable filler; original equipment prompt retained in history.':/γαντζο/.test(s)?'Conduit fitting, not PPE; original prompt retained in history.':/μασκα|γαντι/.test(s)?'Ordinary PPE; clarify units or use only where necessary.':/unit prices changed/i.test(f.reason)?'Compare equivalent products, units and price basis.':'Clarify project task, tool location and allocation.';}
 return 'Review the recorded evidence and source invoice.';
}
