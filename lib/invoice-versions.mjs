const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
const fields=['id','source_document_id','supplier_key','supplier_name','invoice_date','invoice_number','account_information','customer_information','project_information','printed_names','subtotal','subtotal_before_discount','invoice_discount_printed','vat','invoice_total','currency','document_type','invoice_series','printed_document_identifier','receiver','deliverer','receiver_status','vehicle_registration','field_evidence','audit_rule_version','source_page','analysis_status','analysis_error','audit_status','audit_flag','audit_reasons','duplicate_of','identity_key','audit_ledger_revision','review_note','reviewed_at','approved_at','capture_method','revision','created','updated'];
const lineFields=['id','position','printed_name','description','quantity','unit','unit_price','line_amount','source_references','product_code','discount_printed','discount_basis','discount_amount_printed','line_amount_basis','unit_price_basis','amount_basis_evidence','vat_rate','vat_amount','gross_line_amount','source_page','printed_evidence','value_origin'];
const publicInvoice=invoice=>Object.fromEntries(fields.map(field=>[field,invoice[field]??null]));
const publicLines=lines=>lines.map(line=>Object.fromEntries(lineFields.map(field=>[field,line[field]??null])));
// Both writes are guarded by the successful mutation's token and belong in its transaction.
// A legacy baseline is labelled honestly; prior unsaved/deleted history cannot be recovered.
export function invoiceVersionStatements(db,{owner,id,token,previous,previousLines,action,note=null,time}){
 const guard="EXISTS(SELECT 1 FROM invoices WHERE owner=? AND id=? AND capture_token=?)";
 const baseline=JSON.stringify({invoice:publicInvoice(previous),line_items:publicLines(previousLines)});
 const old=db.prepare("INSERT INTO invoice_versions(owner,invoice_id,revision,action,note,data,created) SELECT ?,?,?,?,NULL,?,? WHERE "+guard+" ON CONFLICT(owner,invoice_id,revision) DO NOTHING").bind(owner,id,previous.revision,'existing_state',baseline,time,owner,id,token);
 const object=names=>"json_object("+names.map(field=>"'"+field+"',"+field).join(',')+")";
 const fresh=db.prepare("INSERT INTO invoice_versions(owner,invoice_id,revision,action,note,data,created) SELECT owner,id,revision,?,?,json_object('invoice',"+object(fields)+",'line_items',json(COALESCE((SELECT json_group_array(json(row_json)) FROM (SELECT "+object(lineFields)+" AS row_json FROM invoice_line_items WHERE owner=? AND invoice_id=? ORDER BY position)), '[]'))),? FROM invoices WHERE owner=? AND id=? AND capture_token=?").bind(action,note,owner,id,time,owner,id,token);
 return [old,fresh];
}
export async function invoiceVersions(req,{db,owner,id}){
 const invoice=await db.prepare('SELECT id FROM invoices WHERE owner=? AND id=?').bind(owner,id).first();if(!invoice)return json({error:'Invoice not found'},404);
 if(req.method!=='GET')return json({error:'Version history is read-only.'},405);
 const params=new URL(req.url).searchParams,raw=params.get('revision');
 if(raw!==null){if(!/^\d{1,10}$/.test(raw))return json({error:'Invalid version revision'},400);const version=await db.prepare('SELECT revision,action,note,data,created FROM invoice_versions WHERE owner=? AND invoice_id=? AND revision=?').bind(owner,id,Number(raw)).first();if(!version)return json({error:'Saved version not found'},404);return json({version:{...version,data:JSON.parse(version.data)}});}
 const before=params.get('before');if(before!==null&&!/^\d{1,10}$/.test(before))return json({error:'Invalid version cursor'},400);
 const rows=(await db.prepare('SELECT revision,action,note,created FROM invoice_versions WHERE owner=? AND invoice_id=?'+(before!==null?' AND revision<?':'')+' ORDER BY revision DESC LIMIT 51').bind(owner,id,...(before!==null?[Number(before)]:[])).all()).results;
 return json({versions:rows.slice(0,50),next_before:rows.length>50?rows[49].revision:null});
}
