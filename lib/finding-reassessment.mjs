// Immutable financial source and original finding IDs stay untouched.
export async function applyReassessmentOverlays(db,owner,findings,archived=[]){
 const withdrawn=(await db.prepare("SELECT data FROM records WHERE owner=? AND entity='FindingReassessmentWithdrawal' LIMIT 10001").bind(owner).all()).results;
 if(withdrawn.length>10000)throw Error('Reassessment recovery history exceeds the listing limit.');
 const stopped=new Set(withdrawn.map(r=>{try{return JSON.parse(r.data).batch_id;}catch{return null;}}));
 const rows=(await db.prepare("SELECT data FROM records WHERE owner=? AND entity='FindingReassessment' ORDER BY created,id LIMIT 10001").bind(owner).all()).results;
 if(rows.length>10000)throw Error('Reassessment history exceeds the complete listing limit.');
 for(const row of rows){let a;try{a=JSON.parse(row.data);}catch{continue;}if(a.status!=='applied'||stopped.has(a.batch_id))continue;
  let f=findings.find(f=>f.id===a.finding_id)||archived.find(f=>f.id===a.finding_id);
  if(!f&&a.original?.id===a.finding_id){f={...structuredClone(a.original),source_changed:true,unresolved:false};archived.push(f);}
  if(!f)continue;
  // Binding the immutable original signature prevents an overlay moving to new evidence.
  if(a.original?.id!==f.id||a.original?.color!==f.color||a.original?.reason!==f.reason||!['YELLOW',null].includes(a.corrected_color)||!['reassessed','superseded'].includes(a.disposition))continue;
  f.reassessment={batch_id:a.batch_id,disposition:a.disposition,corrected_color:a.corrected_color,corrected_code:a.corrected_code,explanation:a.explanation,evidence:a.evidence,uncertainty:a.uncertainty,rule_version:a.rule_version,reassessed_at:a.reassessed_at,original:a.original};
  if(a.disposition==='superseded'){f.superseded=true;f.unresolved=false;}
  else f.color=a.corrected_color;
 }
}
