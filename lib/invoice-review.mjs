import {invoiceVersionStatements} from './invoice-versions.mjs';
import {AUDIT_RULE_VERSION,auditInvoice,invoiceIdentity,approvalMissing,sameInvoice,matchingInvoices} from './invoice-audit.mjs';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
export async function invoiceReview(req,{db,owner,id,action}){
 const invoice=await db.prepare('SELECT * FROM invoices WHERE id=? AND owner=?').bind(id,owner).first();if(!invoice)return json({error:'Invoice not found'},404);
 if(Number(req.headers.get('content-length')||0)>10000)return json({error:'Review note is too large'},413);
 let body;try{body=await req.json();}catch{return json({error:'Invalid review request'},400);}
 if(body.revision!==invoice.revision)return json({error:'This invoice changed. Reload it before continuing.'},409);
 if(['approved','excluded'].includes(invoice.audit_status))return json({error:'This record is locked. Its original PDF and review history remain available.'},409);
 await db.prepare('INSERT INTO invoice_ledger(owner,revision) VALUES (?,0) ON CONFLICT(owner) DO NOTHING').bind(owner).run();
 const ledger=(await db.prepare('SELECT revision FROM invoice_ledger WHERE owner=?').bind(owner).first()).revision;
 const lines=(await db.prepare('SELECT * FROM invoice_line_items WHERE owner=? AND invoice_id=? ORDER BY position').bind(owner,id).all()).results;
 const token=crypto.randomUUID(),now=new Date().toISOString();
 const event=(type,note)=>db.prepare("INSERT INTO invoice_events(id,owner,invoice_id,action,note,created) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM invoices WHERE id=? AND owner=? AND capture_token=?)").bind(crypto.randomUUID(),owner,id,type,note,now,id,owner,token);
 const increment=db.prepare('UPDATE invoice_ledger SET revision=revision+1 WHERE owner=? AND EXISTS(SELECT 1 FROM invoices WHERE id=? AND owner=? AND capture_token=?)').bind(owner,id,owner,token);
 let update,statements;
 if(action==='audit'){
  if(!['manual','extraction','chatgpt'].includes(invoice.capture_method))return json({error:'Capture invoice details before running audit checks.'},409);
  const history=(await db.prepare('SELECT * FROM invoices WHERE owner=? AND id<>? LIMIT 5001').bind(owner,id).all()).results;
  const historyLines=(await db.prepare("SELECT l.* FROM invoice_line_items l JOIN invoices i ON i.id=l.invoice_id AND i.owner=l.owner WHERE l.owner=? AND i.audit_status='approved' LIMIT 20001").bind(owner).all()).results;
  if(history.length>5000||historyLines.length>20000)return json({error:'Audit history exceeds the current processing limit. No incomplete audit was saved.'},413);
  const audit=auditInvoice(invoice,lines,history,historyLines);
  update=db.prepare("UPDATE invoices SET identity_key=?,audit_flag=?,audit_reasons=?,duplicate_of=?,audit_ledger_revision=?,audit_rule_version=?,audit_status='needs_review',review_note=NULL,reviewed_at=NULL,capture_token=?,revision=revision+1,updated=? WHERE id=? AND owner=? AND revision=? AND (SELECT revision FROM invoice_ledger WHERE owner=?)=?").bind(audit.identity_key,audit.flag,JSON.stringify(audit.reasons),audit.duplicate_of,ledger,AUDIT_RULE_VERSION,token,now,id,owner,body.revision,owner,ledger);
  statements=[update,event('audit',audit.flag+'; compared '+audit.history_count+' approved invoices. '+audit.reasons.map(reason=>reason.reason).join(' '))];
 }else if(action==='reopen'){
  update=db.prepare("UPDATE invoices SET audit_status='needs_review',audit_flag=NULL,audit_reasons=NULL,duplicate_of=NULL,audit_ledger_revision=NULL,review_note=NULL,reviewed_at=NULL,capture_token=?,revision=revision+1,updated=? WHERE id=? AND owner=? AND revision=?").bind(token,now,id,owner,body.revision);statements=[update,increment,event('reopen','Reopened for corrections; prior audit invalidated.')];
 }else if(action==='exclude'){
  const target=await db.prepare("SELECT * FROM invoices WHERE id=? AND owner=? AND audit_status<>'excluded'").bind(String(body.duplicate_of||''),owner).first();
  const key=invoiceIdentity(invoice);if(!target||target.id===id||!key||!sameInvoice(invoice,target))return json({error:'Choose a matching supplier, printed document type, series and invoice-number record to retain. Unknown types cannot be excluded as duplicates.'},400);
  const references=await db.prepare("SELECT id FROM invoices WHERE owner=? AND duplicate_of=? AND audit_status='excluded' LIMIT 1").bind(owner,id).first();if(references)return json({error:'Another excluded duplicate references this record. Retain this record as the canonical invoice.'},409);
  const note=String(body.note||'').trim();if(!note||note.length>3000)return json({error:'Enter a reason for excluding this duplicate.'},400);
  update=db.prepare("UPDATE invoices SET audit_status='excluded',duplicate_of=?,review_note=?,reviewed_at=?,capture_token=?,revision=revision+1,updated=? WHERE id=? AND owner=? AND revision=? AND EXISTS(SELECT 1 FROM invoices WHERE id=? AND owner=? AND revision=? AND audit_status<>'excluded') AND NOT EXISTS(SELECT 1 FROM invoices WHERE owner=? AND duplicate_of=? AND audit_status='excluded')").bind(target.id,note,now,token,now,id,owner,body.revision,target.id,owner,target.revision,owner,id);statements=[update,increment,event('exclude',note+' Retained invoice: '+target.id)];
 }else if(action==='review'||action==='approve'){
  if(invoice.audit_rule_version!==AUDIT_RULE_VERSION||invoice.audit_flag==null||invoice.audit_ledger_revision!==ledger||invoice.identity_key!==invoiceIdentity(invoice))return json({error:'Run audit checks again: invoice data, identity rules or history changed.'},409);
  const duplicate=(await matchingInvoices(db,owner,invoice))[0];
  if(duplicate)return json({error:'Resolve the matching invoice first. Correct its identity or explicitly exclude a duplicate.'},409);
  if(action==='review'){
   const missing=approvalMissing(invoice,lines);if(missing.length)return json({error:'Capture these required fields before review: '+missing.join(', ')+'.'},409);
   const note=String(body.note||'').trim();if(body.confirmed!==true||note.length>3000||invoice.audit_flag!=='GREEN'&&!note)return json({error:'Confirm you checked the source PDF and enter a note explaining any audit flags.'},400);
   update=db.prepare("UPDATE invoices SET audit_status='reviewed',review_note=?,reviewed_at=?,capture_token=?,revision=revision+1,updated=? WHERE id=? AND owner=? AND revision=? AND audit_ledger_revision=(SELECT revision FROM invoice_ledger WHERE owner=?)").bind(note,now,token,now,id,owner,body.revision,owner);statements=[update,event('review',note||'Source PDF and captured details confirmed.')];
  }else{
   if(invoice.audit_status!=='reviewed'||!invoice.identity_key)return json({error:'Complete human review before approval.'},409);
   update=db.prepare("UPDATE invoices SET audit_status='approved',analysis_status='analyzed',approved_at=?,capture_token=?,revision=revision+1,updated=? WHERE id=? AND owner=? AND revision=? AND audit_status='reviewed' AND audit_ledger_revision=(SELECT revision FROM invoice_ledger WHERE owner=?) AND NOT EXISTS(SELECT 1 FROM invoices other WHERE other.owner=? AND other.identity_key=invoices.identity_key AND other.id<>invoices.id AND other.audit_status<>'excluded')").bind(now,token,now,id,owner,body.revision,owner,owner);statements=[update,increment,event('approve','Approved after source review; included in approved reports.')];
  }
 }else return json({error:'Unknown review action'},404);
 statements.push(...invoiceVersionStatements(db,{owner,id,token,previous:invoice,previousLines:lines,action,note:action==='audit'?null:String(body.note||'').trim()||null,time:now}));
 try{const result=await db.batch(statements);if(!result[0].meta.changes)return json({error:'Invoice data or history changed. Reload and rerun the audit.'},409);}catch(error){if(String(error).includes('UNIQUE constraint'))return json({error:'A matching invoice was already approved. This invoice was not approved.'},409);throw error;}
 const result=await db.prepare('SELECT * FROM invoices WHERE id=? AND owner=?').bind(id,owner).first();return json({invoice:result});
}
