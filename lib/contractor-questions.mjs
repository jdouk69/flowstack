// Presentation only: never mutates the stored/source assessment, question or ID.
import {productDisplay} from './finding-display.mjs';
const fold=s=>String(s||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replaceAll('ς','σ');
export function purchasePromptPresentation(group,prompt){
 const latest=[...(prompt.evidence||[])].sort((a,b)=>String(b.invoice_date||'').localeCompare(String(a.invoice_date||''))||String(b.invoice_id).localeCompare(String(a.invoice_id)))[0]||{};
 return {kind:'product',item:group.name,reason:prompt.reason,color:prompt.color,questions:prompt.review_questions||[],evidence:prompt.evidence||[],invoice_id:latest.invoice_id,invoice_number:latest.invoice_number,date:latest.invoice_date,account:latest.account_information};
}
export function contractorQuestions(f){
 if(f.kind!=='product')return [...(f.questions||[])];
 const s=fold(f.item),item=productDisplay(f).english;
 const row=(f.evidence||[]).find(e=>e.invoice_id===f.invoice_id)||f.evidence?.at(-1)||{};
 const context='For '+item+' on invoice #'+f.invoice_number+' ('+f.date+', account '+(row.account_information||f.account||'not captured')+'), recorded quantity '+(row.quantity??'not captured')+' '+(row.unit||'units')+': ';
 const prior=(f.evidence||[]).filter(e=>e.invoice_id&&e.invoice_id!==f.invoice_id);
 if(/unit prices changed/i.test(f.reason))return [context+'explain the printed price comparison with '+prior.map(e=>'invoice #'+e.invoice_number+' ('+e.invoice_date+'), price '+e.unit_price+' per '+(e.unit||'unverified unit')).join('; ')+'. Provide the supplier price/discount record and confirm product specification, pack size and VAT basis before treating these as equivalent costs.'];
 if(/στοκο/.test(s))return [context+'which finishing surfaces or rooms used this filler, and is any material left over? Provide the work location or material-use record. This is a consumable, not reusable equipment; the original assessment is retained.'];
 if(/γαντζο/.test(s))return [context+'where were these conduit hooks installed, and which conduit run did they support? Provide the installation location or a site photo. These are fittings, not PPE; the original assessment is retained.'];
 if(/μασκα|γαντι/.test(s))return [context+'what does the invoiced unit represent (individual items, pairs or packs), and which workers or tasks used them? If clarification is needed, provide the issue or work record. Ordinary gloves and masks do not establish a concerning purchase.'];
 const comparison=prior.length?' The same exact product wording appears on '+prior.map(e=>'invoice #'+e.invoice_number+' ('+e.invoice_date+', account '+(e.account_information||'not captured')+'), quantity '+e.quantity+' '+(e.unit||'units')).join('; ')+'. Matching wording does not confirm the same project or specification. Confirm whether the earlier item remained usable, or this purchase served another worker or replaced it; provide the relevant issue/replacement record.':' No prior equivalent purchase is established by this finding.';
 const task=/μπαλαντεζ/.test(s)?'which site task required this extension reel, who currently holds it, and where is it kept?':/μυστρ/.test(s)?'which plastering task used this trowel, who currently holds it, and where is it kept?':/σπατουλ/.test(s)?'which finishing task used this spatula, who currently holds it, and where is it kept?':'which project task required it, who currently holds it, and where is it kept?';
 return [context+task+' Provide the site location or tool-allocation record.'+comparison];
}
