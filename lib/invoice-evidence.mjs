// A blank field is not proof of an empty printed receiver box.
export const RECEIVER_STATES=['unknown','shown','blank','unreadable'];
export function receiverLabel(invoice){
 if(invoice.receiver_status==='blank')return 'No receiver shown';
 if(invoice.receiver_status==='unreadable')return 'Receiver unreadable — verify original';
 return invoice.receiver||'Receiver not verified';
}
export const EVIDENCE_FIELDS=['deliverer','receiver_status','vehicle_registration','field_evidence'];
