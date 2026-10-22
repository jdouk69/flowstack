import {combinedReportUrl} from '@/lib/report-batches.mjs';
import {INVOICE_BATCH_LIMIT,awaitingInvoice,selectAwaitingInvoices,runInvoiceBatch} from '@/lib/invoice-batch-runner.mjs';
import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {request} from '@/api/base44Client';
import {readStoredPdf} from '@/lib/extraction/pdf-text.mjs';
import {Button} from '@/components/ui/button';
import {Card,CardContent} from '@/components/ui/card';
import {useResultReveal} from '@/hooks/useResultReveal';
export default function InvoiceBatchProcessing({invoices,onFinished,resultsOnly=false,parentBusy=false}){
 const [selected,setSelected]=useState([]),[template,setTemplate]=useState('tournas'),[confirmed,setConfirmed]=useState(false),[jobs,setJobs]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState('');
 const active=useRef(null),mounted=useRef(true),guard=useRef(false),results=useRef(null),reveal=useResultReveal();
 const candidates=invoices.filter(awaitingInvoice);
 useEffect(()=>{const eligible=new Set(invoices.filter(awaitingInvoice).map(i=>i.id));setSelected(ids=>ids.filter(id=>eligible.has(id)));setConfirmed(false);},[invoices]);
 const refresh=async()=>{const data=await request('/invoice-batches');if(mounted.current)setJobs(data.batches);};
 useEffect(()=>{mounted.current=true;refresh().catch(e=>{if(mounted.current)setError(e.message);});return()=>{mounted.current=false;active.current?.abort();};},[]);
 const run=async existing=>{
  if(guard.current||parentBusy)return;guard.current=true;setBusy(true);setError('');const controller=new AbortController();active.current=controller;
  try{
   let batch=existing;
   if(!batch){if(!confirmed||!selected.length)throw Error('Select invoices and confirm their supplier before processing.');batch=(await request('/invoice-batches',{method:'POST',signal:controller.signal,body:JSON.stringify({invoice_ids:selected,template,confirmed:true})})).batch;setSelected([]);}
   await refresh();
   await runInvoiceBatch({batch,request,readPdf:readStoredPdf,signal:controller.signal,onProgress:({item,index,total,page,pages})=>{if(mounted.current)setProgress(page?`Invoice ${index} of ${total}: reading ${item.name}, page ${page} of ${pages}…`:`Invoice ${index} of ${total}: processing ${item.name}…`);},onSaved:()=>refresh()});
   await refresh();if(mounted.current){setProgress(controller.signal.aborted?'Stopped. Saved results remain below; continue this batch when ready.':'Run finished. Review the saved results below. Nothing was approved.');reveal(results);onFinished?.();}
  }catch(e){if(mounted.current)setError(e.name==='AbortError'?'Stopped. Refresh saved batches to find any work already saved.':e.message);}
  finally{guard.current=false;if(mounted.current)setBusy(false);if(active.current===controller)active.current=null;}
 };
 return <Card className="mb-5"><CardContent className="p-4 space-y-3">
  {!resultsOnly&&<><h2 className="font-semibold text-lg">Process invoices together</h2><p className="text-sm">Choose up to 100 queued originals from the loaded invoice list below. Use the workflow filter to keep supplier documents together, and load more invoices if needed. They must use the same supported supplier template. Keep this page open during processing.</p>
  <div className="flex flex-wrap gap-3"><label>Supplier <select className="border rounded-lg p-2 bg-background" disabled={busy||parentBusy} value={template} onChange={e=>{setTemplate(e.target.value);setConfirmed(false);}}><option value="tournas">Tournas</option><option value="akron">Akron</option><option value="ergobeton">Ergobeton SoftOne</option></select></label><Button variant="outline" disabled={busy||!candidates.length} onClick={()=>{setSelected(selectAwaitingInvoices(invoices));setConfirmed(false);}}>{candidates.length>INVOICE_BATCH_LIMIT?'Select first 100 queued invoices':`Select all ${candidates.length} queued invoices`}</Button><Button variant="outline" disabled={busy||!selected.length} onClick={()=>setSelected([])}>Clear selection</Button></div>
  {candidates.length>0?<details><summary className="cursor-pointer">Choose invoices · {selected.length} selected</summary><div className="max-h-64 overflow-y-auto space-y-2 mt-2">{candidates.map(i=><label key={i.id} className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy||selected.length>=INVOICE_BATCH_LIMIT&&!selected.includes(i.id)} checked={selected.includes(i.id)} onChange={e=>{setConfirmed(false);setSelected(ids=>e.target.checked?[...ids,i.id]:ids.filter(id=>id!==i.id));}}/><span className="break-words">{i.source_name}</span></label>)}</div></details>:<p className="text-sm">Add originals to the invoice queue from Documents to start a batch.</p>}
  <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy||parentBusy} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>These invoices use the selected supplier template. Save extracted rows as unapproved drafts for my review.</label>
  <div className="flex flex-wrap gap-3"><Button disabled={busy||!confirmed||!selected.length} onClick={()=>run(null)}>Process {selected.length||'selected'} invoices</Button>{busy&&<Button variant="outline" onClick={()=>active.current?.abort()}>Stop after saved work</Button>}<Button variant="outline" disabled={busy||parentBusy} onClick={()=>refresh().catch(e=>setError(e.message))}>Refresh saved batches</Button></div>
  </>}
  {resultsOnly&&<Button variant="outline" disabled={busy||parentBusy} onClick={()=>refresh().catch(e=>setError(e.message))}>Refresh saved results</Button>}
  {error&&<p role="alert" className="text-red-700">{error}</p>}{progress&&<p role="status">{progress}</p>}
  <h3 ref={results} tabIndex={-1} className="font-semibold">Saved processing batches</h3>
  {jobs.map(job=><details key={job.id} open={jobs[0]?.id===job.id} className="border rounded-lg p-3"><summary className="cursor-pointer">{job.template} · {job.items.length} invoices · {job.items.filter(i=>i.status==='saved').length} saved · {job.created}</summary><div className="space-y-3 mt-3">{job.items.map(item=><div key={item.invoice_id} className="text-sm border-t pt-2"><p className="break-words font-medium">{item.name}</p><p>{item.status.replaceAll('_',' ')}{item.flag?' · '+item.flag:''}{item.line_count!=null?' · '+item.line_count+' item rows':''}</p><p>{item.reason||'Waiting to process. If another run is active, wait before resuming.'}</p><Link className="underline text-primary" to={'/invoices/'+item.invoice_id}>Review invoice</Link></div>)}{job.items.some(i=>!['saved','preserved'].includes(i.status))&&<Button variant="outline" disabled={busy||parentBusy} onClick={()=>run(job)}>Continue this saved batch</Button>}<div className="flex flex-wrap gap-3"><Link className="underline text-primary" to="/audit">Open review queue</Link><Link className="underline text-primary" to={combinedReportUrl([job.id])}>Open combined report</Link></div></div></details>)}
  <p className="text-xs text-muted-foreground">One-page Tournas, Akron and inspected Ergobeton SoftOne originals only. Scans and unsupported PDFs remain for attention. Previously captured invoices and review decisions are preserved. Checks may need rerunning after invoice history changes; review and approval stay explicit. Latest 10 batches shown.</p>
 </CardContent></Card>;
}
