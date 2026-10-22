export async function advanceManualAudit({send,onProgress,signal,supplierId=null,options={}}){
 let runId;
 for(let step=0;step<10000;step++){
  if(signal?.aborted)throw Error('Audit paused on this device. Saved steps can be resumed.');
  const result=await send({...(!runId?options:{}),...(runId?{run_id:runId}:{}),...(supplierId?{supplier_id:supplierId}:{})});
  if(result.id)runId=result.id;
  onProgress(result);
  if(!result.needs_continue)return result;
 }
 throw Error('Audit paused at its safe step limit. Resume to continue from saved progress.');
}

export function manualAuditMessage(result){
 if(!result)return '';
 if(result.status==='already_running')return result.message||'Another audit step is running. Wait for it to finish, then resume.';
 if(result.status==='needs_retry')return `Audit paused. ${result.step_errors?.[0]||'A step could not finish.'} Use Resume audit to retry from saved progress.`;
 if(result.status==='failed')return result.error||'Audit could not start.';
 if(result.status==='completed_with_errors')return 'Audit finished with issues. Review the errors below; not every stage succeeded.';
 if(result.status==='completed')return `Audit completed: ${result.collected||0} PDFs collected, ${result.analyzed||0} invoices analyzed, ${result.preserved||0} existing captures preserved.`;
 if(result.stage==='collecting')return `Checking Gmail — ${result.current_supplier||'supplier workflows'} · ${result.emails_checked||0} emails checked · ${result.collected||0} PDFs collected.`;
 if(result.stage==='masters')return `Preparing vendor master — ${result.current_supplier||'vendor'}.`;
 if(result.stage==='reports')return `Generating audit PDFs — ${result.current_supplier||'vendor'}.`;
 if(result.stage==='queueing')return 'Collection complete. Preparing the invoice processing queue…';
 if(result.stage==='syncing')return `Checking Google Sheets synchronization — ${result.current_document||'current invoice'}.`;
 if(result.stage==='analyzing')return `Processing ${Math.min((result.document_index||0)+1,result.queued||0)} of ${result.queued||0} documents — ${result.current_document||'preparing next source'}.`;
 return 'Audit started. Preparing saved workflows…';
}
