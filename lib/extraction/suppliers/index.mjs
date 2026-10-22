// Supplier adapters stay separate from shared parsing and audit rules.
// No template guesses or account defaults: classify only a printed supplier field.
const normalized=value=>value.normalize('NFKD').replace(/\p{M}/gu,'').trim().toUpperCase();
export function classifyPrintedSupplier(value){
 const name=normalized(value||'');
 if(/^(TOURNAS|ΤΟΥΡΝΑΣ)(?:\s|$)/u.test(name))return 'tournas';
 if(/^(AKRON|ΑΚΡΟΝ)(?:\s|$)/u.test(name))return 'akron';
 if(/^(ERGOBETON|ΕΡΓΟΜΠΕΤΟΝ)(?:\s|$)/u.test(name))return 'ergobeton';
 return null;
}
