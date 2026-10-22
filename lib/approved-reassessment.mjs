import {loadFindings} from './finding-review.mjs';
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',value))].map(x=>x.toString(16).padStart(2,'0')).join('');
const parsed=row=>{try{return JSON.parse(row?.data||'null');}catch{return null;}};
const counts=findings=>({ORANGE:findings.filter(f=>f.unresolved&&f.color==='ORANGE').length,RED:findings.filter(f=>f.unresolved&&f.color==='RED').length});
export async function authorizedApproval(req,security,now=Date.now()){
 const token=req.headers.get('X-FlowStack-Approval');if(!token||token.length>256||now>Date.parse(security.expires_at))return false;
 return await hash(new TextEncoder().encode(token))===security.token_sha256;
}
export async function reassessmentOperation(req,{db,bucket,manifest,now=()=>new Date().toISOString()}){
 if(!['GET','POST'].includes(req.method))return json({error:'Method not allowed'},405);
 const {owner,batch_id,candidates}=manifest;
 if(candidates.length!==22||new Set(candidates.map(c=>c.finding_id)).size!==22||candidates.filter(c=>c.corrected_color==='YELLOW'&&c.disposition==='reassessed').length!==20||candidates.filter(c=>c.corrected_color===null&&c.disposition==='superseded').length!==2)return json({error:'Approved manifest does not contain the exact 22 outcomes.'},409);
 const batchId='finding-reassessment-batch:'+batch_id;
 const existing=parsed(await db.prepare("SELECT data FROM records WHERE id=? AND owner=? AND entity='FindingReassessmentBatch'").bind(batchId,owner).first());
 const withdrawal=parsed(await db.prepare("SELECT data FROM records WHERE id=? AND owner=? AND entity='FindingReassessmentWithdrawal'").bind('finding-reassessment-withdrawal:'+batch_id,owner).first());
 if(withdrawal)return json({batch_id,withdrawn:true,reapplied:false});
 // Recovery appends a withdrawal audit event. It never deletes or rewrites the batch.
 if(req.method==='POST'&&existing){let recovery;try{recovery=await req.clone().json();}catch{}if(recovery?.action==='withdraw'&&recovery.batch_id===batch_id){const time=now();await db.prepare("INSERT INTO records(id,owner,entity,data,created,updated) VALUES(?,?,'FindingReassessmentWithdrawal',?,?,?) ON CONFLICT(id) DO NOTHING").bind('finding-reassessment-withdrawal:'+batch_id,owner,JSON.stringify({batch_id,withdrawn_at:time,reason:'Explicit withdrawal of this approved overlay batch; original findings and all reassessment evidence retained.'}),time,time).run();return json({batch_id,withdrawn:true,originals_restored:true});}}
 const loaded=await loadFindings(new Request(req.url),{db,owner});if(loaded.error)return loaded.error;
 const conflicts=[];for(const c of candidates){const f=loaded.findings.find(f=>f.id===c.finding_id);if(!f||f.invoice_id!==c.invoice_id||f.source_document_id!==c.source_document_id||(f.reassessment?.original.color??f.color)!=='ORANGE'||f.reason!==c.original.reason||loaded.invoices.find(i=>i.id===c.invoice_id)?.revision!==c.invoice_revision)conflicts.push(c.finding_id);}
 if(conflicts.length)return json({error:'Approved source findings changed. Nothing was applied.',conflicts},409);
 const saved=(await db.prepare("SELECT id,data FROM records WHERE owner=? AND entity='FindingReassessment' AND json_extract(data,'$.batch_id')=? ORDER BY id").bind(owner,batch_id).all()).results;
 if(existing){if(saved.length!==22||saved.some(row=>!candidates.some(c=>'finding-reassessment:'+batch_id+':'+c.finding_id===row.id)))return json({error:'Stored batch is incomplete or inconsistent; no automatic repair.'},409);return json({batch_id,already_applied:true,applied:22,counts:counts(loaded.findings),candidates:saved.map(row=>parsed(row)),findings:loaded.findings});}
 // Recheck the actual private original bytes, not just a document link.
 const verified=new Set();for(const c of candidates){if(verified.has(c.source_document_id))continue;const row=await db.prepare("SELECT data FROM records WHERE id=? AND owner=? AND entity='Document'").bind(c.source_document_id,owner).first();const doc=parsed(row);if(!doc?.key||doc.hash!==c.source_sha256||doc.md5!==c.source_md5)return json({error:'Original PDF metadata changed.',document_id:c.source_document_id},409);const object=await bucket.get(doc.key);if(!object||await hash(await object.arrayBuffer())!==c.source_sha256)return json({error:'Original PDF bytes failed verification.',document_id:c.source_document_id},409);verified.add(c.source_document_id);}
 const proposed=candidates.map(c=>({candidate:c.candidate,finding_id:c.finding_id,invoice_id:c.invoice_id,invoice_number:c.original.invoice_number,position:c.original.evidence.find(e=>e.position)?.position??null,original_color:'ORANGE',corrected_color:c.corrected_color,disposition:c.disposition,source_document_id:c.source_document_id,source_sha256:c.source_sha256}));
 const before=counts(loaded.findings);const ids=new Set(candidates.map(c=>c.finding_id));const expected=counts(loaded.findings.filter(f=>!ids.has(f.id)));
 if(req.method==='GET')return json({batch_id,dry_run:true,candidate_count:22,outcomes:{YELLOW:20,superseded:2},before_counts:before,expected_after_counts:expected,verified_pdf_count:verified.size,candidates:proposed,findings:loaded.findings});
 let body;try{const raw=await req.text();if(raw.length>1024)throw Error();body=JSON.parse(raw);}catch{return json({error:'Invalid bounded approval request'},400);}
 if(body.action!=='apply'||body.batch_id!==batch_id)return json({error:'Only the exact approved batch may be applied.'},400);
 const time=now(),marker=crypto.randomUUID();
 const revisions=[...new Set(candidates.map(c=>c.invoice_id))].map(id=>({id,revision:loaded.invoices.find(i=>i.id===id).revision}));
 const reviews=(await db.prepare("SELECT id,data FROM records WHERE owner=? AND entity='FindingReview' ORDER BY id").bind(owner).all()).results;
 const sourceGuard="COALESCE((SELECT revision FROM invoice_ledger WHERE owner=?),0)=? AND NOT EXISTS(SELECT 1 FROM json_each(?) s LEFT JOIN invoices i ON i.id=json_extract(s.value,'$.id') AND i.owner=? WHERE i.id IS NULL OR i.revision<>json_extract(s.value,'$.revision')) AND (SELECT COUNT(*) FROM records WHERE owner=? AND entity='FindingReview')=? AND NOT EXISTS(SELECT 1 FROM json_each(?) r LEFT JOIN records x ON x.id=json_extract(r.value,'$.id') AND x.owner=? WHERE x.id IS NULL OR x.data<>json_extract(r.value,'$.data'))";
 const bindings=[owner,loaded.ledger,JSON.stringify(revisions),owner,owner,reviews.length,JSON.stringify(reviews),owner];
 const batch={batch_id,status:'applied',marker,reassessed_at:time,approved_outcomes:{YELLOW:20,superseded:2},finding_ids:proposed.map(c=>c.finding_id),before_counts:before,expected_after_counts:expected};
 const statements=[db.prepare("INSERT INTO records(id,owner,entity,data,created,updated) SELECT ?,?,'FindingReassessmentBatch',?,?,? WHERE "+sourceGuard+" AND NOT EXISTS(SELECT 1 FROM records WHERE owner=? AND entity='FindingReassessment' AND json_extract(data,'$.finding_id') IN (SELECT value FROM json_each(?))) ON CONFLICT(id) DO NOTHING").bind(batchId,owner,JSON.stringify(batch),time,time,...bindings,owner,JSON.stringify(batch.finding_ids))];
 for(const c of candidates){const data={...c,batch_id,status:'applied',reassessed_at:time,original:loaded.findings.find(f=>f.id===c.finding_id)};statements.push(db.prepare("INSERT INTO records(id,owner,entity,data,created,updated) SELECT ?,?,'FindingReassessment',?,?,? WHERE EXISTS(SELECT 1 FROM records WHERE id=? AND owner=? AND entity='FindingReassessmentBatch' AND json_extract(data,'$.marker')=?)").bind('finding-reassessment:'+batch_id+':'+c.finding_id,owner,JSON.stringify(data),time,time,batchId,owner,marker));}
 // D1 batches are transactional: a constraint/error rolls back all 23 inserts.
 await db.batch(statements);
 const done=parsed(await db.prepare('SELECT data FROM records WHERE id=? AND owner=?').bind(batchId,owner).first());if(!done)return json({error:'Source/review revision changed; no batch applied.'},409);
 const written=(await db.prepare("SELECT id FROM records WHERE owner=? AND entity='FindingReassessment' AND json_extract(data,'$.batch_id')=?").bind(owner,batch_id).all()).results;if(written.length!==22)return json({error:'Batch verification failed',batch_id},500);
 const final=await loadFindings(new Request(req.url),{db,owner});return json({batch_id,applied:22,outcomes:{YELLOW:20,superseded:2},reassessed_at:done.reassessed_at,before_counts:before,counts:counts(final.findings),candidates:proposed,findings:final.findings});
}
