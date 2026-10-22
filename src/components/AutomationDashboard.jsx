import {Link} from 'react-router-dom';
import {useCallback,useEffect,useState,useRef} from 'react';
import {advanceManualAudit,manualAuditMessage} from '@/lib/manual-audit-client.mjs';
import {request} from '@/api/base44Client';
import {Button} from '@/components/ui/button';
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card';
import {AlertTriangle,CheckCircle2,Clock3,Loader2,Play,RefreshCw} from 'lucide-react';

const dateTime=value=>value?new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'Not yet recorded';
const money=rows=>(rows||[]).map(row=>/^[A-Z]{3}$/.test(row.currency||'')?new Intl.NumberFormat(undefined,{style:'currency',currency:row.currency,maximumFractionDigits:2}).format(row.amount):`${Number(row.amount).toLocaleString(undefined,{maximumFractionDigits:2})} ${row.currency}`).join(' · ')||'No totals captured';
const stages=[['collecting','Checking Gmail'],['masters','Preparing master'],['queueing','Selecting invoices'],['analyzing','Reviewing invoices'],['syncing','Updating spreadsheet'],['reports','Creating reports'],['complete','Finished']];
const stageLabel=stage=>stages.find(([key])=>key===stage)?.[1]||'Starting';
const explainIssue=item=>{const text=String(item||'');const lower=text.toLowerCase();if(lower.includes('one-page individual invoices only')||lower.includes('multi-page')||lower.includes('merged pdf'))return {title:'This file has multiple pages or combines documents',next:'If it combines invoices, upload each original invoice separately. A single multi-page invoice needs manual review and capture.',to:'/attention'};if(lower.includes('no supported invoice')||lower.includes('complete item rows')||lower.includes('scans')||lower.includes('unsupported layouts'))return {title:'FlowStack could not read every invoice line',next:'Open Needs attention, compare the extraction or OCR preview with the original PDF, then capture the verified details manually.',to:'/attention'};if(lower.includes('sheets'))return {title:'The spreadsheet update needs a retry',next:'The invoice file is kept in FlowStack. Open Suppliers to review the workbook connection and retry the sync.',to:'/suppliers'};if(lower.includes('google')||lower.includes('drive')||lower.includes('gmail'))return {title:'The Google connection needs attention',next:'Open Workflows or Settings to check the Google connection, then rerun the workflow.',to:'/rules'};return {title:'This step needs attention',next:'Open Needs attention to see the saved file and review its original.',to:'/attention'};};
const statusText=(latest,busy,locked,resumable)=>{
 if(busy||locked||latest?.status==='running')return 'Running';
 if(resumable)return 'Paused · ready to resume';
 if(latest?.status==='completed_with_errors')return 'Finished · needs attention';
 if(latest?.status==='completed')return 'Finished';
 if(latest?.status==='failed')return 'Stopped';
 return 'Not run yet';
};
const statusStyle=(latest,busy,locked,resumable)=>{
 if(busy||locked||latest?.status==='running')return 'border-blue-200 bg-blue-50 text-blue-900';
 if(resumable||latest?.status==='completed_with_errors'||latest?.status==='failed')return 'border-amber-200 bg-amber-50 text-amber-950';
 if(latest?.status==='completed')return 'border-emerald-200 bg-emerald-50 text-emerald-950';
 return 'border-slate-200 bg-slate-50 text-slate-700';
};

export default function AutomationDashboard({supplierId,supplierName}){
 const [status,setStatus]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[lastResult,setLastResult]=useState(null),[checkedAt,setCheckedAt]=useState(null);
 const [auditMode,setAuditMode]=useState('incremental'),[dateFrom,setDateFrom]=useState(''),[dateTo,setDateTo]=useState('');
 const active=useRef(null);
 const refresh=useCallback(async()=>{try{const data=await request('/automation'+(supplierId?'?supplier_id='+encodeURIComponent(supplierId):''));setStatus(data);setCheckedAt(data.checked_at||new Date().toISOString());setError('');}catch(e){setError(e.message||'Automation status unavailable.');}},[supplierId]);
 const pollDelay=busy?15000:status?.running?5000:30000;
 useEffect(()=>{const poll=()=>{if(document.visibilityState==='visible')refresh();};poll();const timer=setInterval(poll,pollDelay);document.addEventListener('visibilitychange',poll);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',poll);};},[refresh,pollDelay]);
 useEffect(()=>()=>{active.current?.abort();},[]);
 const runNow=async()=>{if(active.current)return;const controller=new AbortController();active.current=controller;setBusy(true);setError('');setLastResult({status:'running',stage:'starting',started:new Date().toISOString(),supplier_name:supplierName});try{const options={audit_mode:auditMode,...(auditMode==='date_range'?{date_from:dateFrom,date_to:dateTo}:{})};await advanceManualAudit({signal:controller.signal,options,supplierId,send:body=>request('/automation',{method:'POST',body:JSON.stringify(body),signal:controller.signal}),onProgress:setLastResult});await refresh();}catch(e){setError(e.message||'The audit connection was interrupted. Saved progress can be resumed.');}finally{active.current=null;setBusy(false);}};
 const savedRun=supplierId?status?.last_selected_workspace_run:status?.last_all_vendor_run;
 const latest=lastResult?.status==='already_running'?savedRun:lastResult||savedRun;
 const resumable=!busy&&latest&&['running','needs_retry'].includes(latest.status)&&!status?.running;
 const runLocked=!busy&&!!status?.running;
 const message=!busy&&resumable&&!lastResult?'The previous run paused before completion. Its saved progress is ready to resume.':runLocked?'Another audit step is active. Wait for it to finish before starting or resuming a run.':manualAuditMessage(lastResult||latest);
 const dateRangeValid=!!dateFrom&&!!dateTo&&dateFrom<=dateTo;
 const finished=latest&&['completed','completed_with_errors','failed'].includes(latest.status);
 const snapshotScope=supplierName||'all active workspaces';
 const failures=status?.failed_jobs||0,sheetFailures=status?.failed_sheets||0;
 const scopeSuffix=supplierName?` for ${supplierName}`:' across all workspaces';
 return <div className="space-y-5">
  <Card className="overflow-hidden border-primary/20 shadow-sm">
   <CardHeader className="space-y-4 border-b bg-slate-50/70 pb-4">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
     <div className="min-w-0">
      <CardTitle className="text-lg">Invoice check{supplierName?` · ${supplierName}`:''}</CardTitle>
      <p className="mt-1 text-sm text-muted-foreground">{supplierName?`This run uses only ${supplierName}’s saved Gmail workflow, Drive folder, and master spreadsheet.`:'This run checks each active supplier workflow once.'}</p>
     </div>
     <Button size="lg" disabled={busy||runLocked||(auditMode==='date_range'&&!dateRangeValid)} onClick={runNow} aria-busy={busy||runLocked} className="min-h-12 h-auto w-full gap-2 whitespace-normal bg-blue-700 px-5 text-base font-bold text-white shadow-sm hover:bg-blue-800 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 sm:w-auto sm:shrink-0">
      {busy||runLocked?<Loader2 className="h-5 w-5 animate-spin"/>:<Play className="h-5 w-5"/>}{runLocked?'Invoice check running…':busy?'Processing…':resumable?'Resume this run':auditMode==='date_range'?'Run selected date range':auditMode==='full'?'Run full rescan':'Run invoice check now'}
     </Button>
    </div>
    <div className="grid gap-3 rounded-lg border bg-background p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
     <label className="grid gap-1 text-sm font-medium">Files to check<select className="h-10 rounded-md border bg-background px-3 font-normal" value={auditMode} disabled={busy||runLocked||!!resumable} onChange={e=>setAuditMode(e.target.value)}><option value="incremental">New, unfinished, or failed files (recommended)</option><option value="date_range">Files with email received dates in a range</option><option value="full">All dates (full rescan)</option></select></label>
     {auditMode==='date_range'&&<><label className="grid gap-1 text-sm">From<input aria-label="Email received from" type="date" className="h-10 rounded-md border bg-background px-3" value={dateFrom} disabled={busy||runLocked||!!resumable} onChange={e=>setDateFrom(e.target.value)}/></label><label className="grid gap-1 text-sm">Through<input aria-label="Email received through" type="date" className="h-10 rounded-md border bg-background px-3" value={dateTo} disabled={busy||runLocked||!!resumable} onChange={e=>setDateTo(e.target.value)}/></label></>}
    </div>
    {auditMode==='date_range'&&<p className="text-xs text-muted-foreground">The range uses the date the email was received. Existing approved invoices remain approved.</p>}
    <p className="text-xs text-muted-foreground">The run does not approve invoices. Keep this page open while it runs. Scheduled runs are currently off.</p>
   </CardHeader>
   <CardContent className="space-y-4 p-4 sm:p-5">
    {latest&&<div role="status" aria-live="polite" className={`flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between ${statusStyle(latest,busy,runLocked,resumable)}`}>
      <div className="flex items-center gap-2 font-semibold">{busy||runLocked||latest.status==='running'?<Loader2 className="h-4 w-4 animate-spin"/>:latest.status==='completed'?<CheckCircle2 className="h-4 w-4"/>:<AlertTriangle className="h-4 w-4"/>}{statusText(latest,busy,runLocked,resumable)}</div>
      <p className="inline-flex items-center gap-1 text-xs font-normal"><Clock3 className="h-3.5 w-3.5"/>{finished?`Finished ${dateTime(latest.completed||latest.updated)}`:`Updated ${dateTime(latest.updated||latest.started)}`}</p>
    </div>}
    {latest?.status==='running'&&<div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={`Run stages. Current step: ${stageLabel(latest.stage)}`}>{stages.filter(([key])=>key!=='complete').map(([key,label])=>{const order=stages.findIndex(([stage])=>stage===key),current=stages.findIndex(([stage])=>stage===latest.stage),done=current>order;const active=current===order;return <div key={key} className={`rounded-md border px-2 py-2 text-xs ${active?'border-blue-300 bg-blue-50 font-semibold text-blue-900':done?'border-emerald-200 bg-emerald-50 text-emerald-800':'border-slate-200 bg-slate-50 text-slate-500'}`} aria-current={active?'step':undefined}>{done?'✓ ':''}{label}</div>;})}</div>}
    {latest?.status==='running'&&<p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-950">{manualAuditMessage(latest)||'Run started. Preparing saved workflows…'}</p>}
    {!latest&&!status&&!error&&<p className="text-sm text-muted-foreground">Loading the latest run status…</p>}
    {message&&<p className={`rounded-md p-3 text-sm ${resumable?'bg-amber-50 text-amber-950':'bg-slate-50 text-slate-700'}`}>{message}{lastResult?.status==='already_running'&&lastResult.lock_expires&&<span className="block mt-1">The active lock expires at {dateTime(lastResult.lock_expires)}. No duplicate run was started.</span>}</p>}
    {error&&<p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">Could not refresh run status: {error}</p>}
    {latest&&<div className="grid grid-cols-2 gap-3 rounded-lg border bg-slate-50/60 p-3 sm:grid-cols-4">
     <div><p className="text-xs text-muted-foreground">PDFs collected</p><p className="text-lg font-semibold">{latest.collected??0}</p></div>
     <div><p className="text-xs text-muted-foreground">Invoices analyzed</p><p className="text-lg font-semibold">{latest.analyzed??0}</p></div>
     <div><p className="text-xs text-muted-foreground">Findings from this run</p><p className="text-lg font-semibold">{latest.findings??0}</p></div>
     <div><p className="text-xs text-muted-foreground">Existing captures kept</p><p className="text-lg font-semibold">{latest.preserved??0}</p></div>
    </div>}
    {latest?.finding_details?.length>0&&<section aria-label="Invoice findings from this run" className="rounded-lg border border-amber-300 bg-amber-50/70 p-3 sm:p-4">
     <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="inline-flex items-center gap-2 font-semibold text-amber-950"><AlertTriangle className="h-4 w-4"/>Invoice findings from this run</h3><span className="text-xs text-amber-900">These are review flags, not run-stage errors.</span></div>
     <div className="mt-3 space-y-3">{latest.finding_details.slice(0,5).map((invoice,index)=><div key={`${invoice.invoice_id}-${index}`} className="border-t border-amber-200 pt-3 text-sm"><p className="font-medium">{invoice.supplier} · Invoice {invoice.invoice_number}{invoice.invoice_date?` · ${invoice.invoice_date}`:''}</p>{invoice.reasons.map((reason,reasonIndex)=><div key={reasonIndex} className="mt-2"><p className="font-medium">{reason.color}: {reason.reason}</p></div>)}<Link className="mt-2 inline-block font-semibold text-blue-700 underline" to={'/invoices/'+invoice.invoice_id}>Open invoice and source</Link></div>)}</div>
     {latest.finding_details.length>5&&<p className="mt-3 border-t border-amber-200 pt-3 text-sm">{latest.finding_details.length-5} more invoice{latest.finding_details.length===6?'':'s'} with findings are part of this run.</p>}
    </section>}
    {latest?.errors?.length>0&&<section aria-label="Errors from this run" className="rounded-lg border border-amber-300 bg-amber-50/70 p-3 sm:p-4">
     <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="inline-flex items-center gap-2 font-semibold text-amber-950"><AlertTriangle className="h-4 w-4"/>Issues from this run <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs">{latest.errors.length}</span></h3><span className="text-xs text-amber-900">{supplierName||'All selected workflows'} · {dateTime(latest.updated||latest.completed||latest.started)}</span></div>
     <div className="mt-3 space-y-3">{latest.errors.slice(0,3).map((item,index)=>{const explanation=explainIssue(item);return <div key={index} className="border-t border-amber-200 pt-3 text-sm"><p className="font-medium">{explanation.title}</p><p className="mt-1 text-amber-950">{explanation.next}</p><details className="mt-2"><summary className="cursor-pointer text-xs font-medium">Show original error</summary><p className="mt-1 break-words text-xs text-muted-foreground">{item}</p></details><Link className="mt-2 inline-block font-semibold text-blue-700 underline" to={explanation.to}>Open related page</Link></div>;})}</div>
     {latest.errors.length>3&&<details className="mt-3 border-t border-amber-200 pt-3"><summary className="cursor-pointer text-sm font-medium">Show {latest.errors.length-3} more issues from this run</summary><ul className="mt-2 list-disc space-y-2 break-words pl-5 text-sm">{latest.errors.slice(3).map((item,index)=><li key={index}>{item}</li>)}</ul></details>}
    </section>}
    {latest?.status==='completed'&&<p className="inline-flex items-center gap-2 text-sm font-medium text-emerald-800"><CheckCircle2 className="h-4 w-4"/>All run stages finished successfully.</p>}
    <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground"><span>Status checked for {snapshotScope}{checkedAt?` at ${dateTime(checkedAt)}`:''}</span><Button variant="outline" size="sm" onClick={refresh} className="gap-2"><RefreshCw className="h-3.5 w-3.5"/>Refresh status</Button></div>
   </CardContent>
  </Card>

  {!!(failures||sheetFailures)&&<details className="rounded-lg border bg-background">
   <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold"><span className="flex flex-wrap items-center justify-between gap-2"><span>Saved issues{scopeSuffix} · not necessarily from the latest run</span><span className="text-xs font-normal text-muted-foreground">Checked {dateTime(checkedAt)}</span></span></summary>
   <div className="grid gap-3 border-t p-4 sm:grid-cols-2">
    {failures>0&&<div className="rounded-md border border-amber-200 bg-amber-50/60 p-3"><p className="font-semibold">{failures} file{failures===1?'':'s'} need import or review attention</p><p className="mt-1 text-sm text-muted-foreground">This is a saved backlog count{supplierName?` for ${supplierName}`:' across all workspaces'}, not a count of errors created by the run above.</p><Link to="/attention" className="mt-2 inline-flex min-h-10 items-center font-semibold text-blue-700 underline">Review files needing attention</Link></div>}
    {sheetFailures>0&&<div className="rounded-md border border-amber-200 bg-amber-50/60 p-3"><p className="font-semibold">{sheetFailures} spreadsheet update{sheetFailures===1?'':'s'} failed</p><p className="mt-1 text-sm text-muted-foreground">This saved sync backlog may include earlier runs{supplierName?` for ${supplierName}`:' from any workspace'}.</p><Link to="/suppliers" className="mt-2 inline-flex min-h-10 items-center font-semibold text-blue-700 underline">Review spreadsheet sync</Link></div>}
   </div>
  </details>}

  <details className="rounded-lg border bg-background">
   <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold">Saved workload and open findings{supplierName?` · ${supplierName}`:' · all workspaces'} <span className="ml-2 text-xs font-normal text-muted-foreground">Separate from the latest run</span></summary>
   <div className="space-y-4 border-t p-4">
    {status&&<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
     <div className="rounded-md bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Saved invoice totals</p><p className="break-words text-sm font-semibold">{money(status.total_invoiced_by_currency)}</p><p className="mt-1 text-xs text-muted-foreground">All saved records{supplierName?` for ${supplierName}`:''}</p></div>
     <div className="rounded-md bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Invoices waiting to process</p><p className="text-lg font-semibold">{status.waiting_processing??0}</p></div>
     <div className="rounded-md bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Invoices awaiting review</p><p className="text-lg font-semibold">{status.outstanding_reviews??0}</p></div>
     <div className="rounded-md bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Last successful run</p><p className="text-sm font-semibold">{dateTime(status.last_successful_manual_run||status.last_successful_run)}</p></div>
    </div>}
    {status?.priority_findings?.length>0?<div className="space-y-2"><h3 className="text-sm font-semibold">Open findings in saved invoices</h3><p className="text-xs text-muted-foreground">These findings may come from earlier runs; each link opens the saved invoice.</p>{status.priority_findings.map((item,index)=><div key={index} className="rounded-lg border border-amber-300/70 bg-amber-50/50 p-3 text-sm"><div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"/><div><p className="font-medium">{item.color} · {item.supplier} · Invoice {item.invoice_number}{item.invoice_date?` · ${item.invoice_date}`:''}</p><p className="mt-1">{item.reason}</p><p className="mt-1 text-muted-foreground">Next step: {item.question}</p><Link className="mt-2 inline-block font-semibold text-blue-700 underline" to={'/invoices/'+item.invoice_id}>Open invoice and source</Link></div></div></div>)}</div>:<p className="text-sm text-muted-foreground">No saved priority findings in this scope.</p>}
    {status&&<details className="text-xs text-muted-foreground"><summary className="cursor-pointer font-medium">Technical run history</summary><div className="mt-2 flex flex-wrap gap-x-6 gap-y-2"><span>Last manual run: {dateTime(status.last_manual_run?.completed||status.last_manual_run?.started)}{status.last_manual_run?` — ${status.last_manual_run.status.replaceAll('_',' ')}`:''}</span><span>Last successful unattended run: {dateTime(status.last_successful_unattended_run)}</span><span>Run scope: {supplierName||'all active workspaces'}</span></div></details>}
   </div>
  </details>
 </div>;
}
