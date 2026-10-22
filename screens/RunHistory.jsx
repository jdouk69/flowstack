import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {base44,request} from '@/api/base44Client';
import {Card,CardContent} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import Skeleton from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import OriginalPdfLink from '@/components/OriginalPdfLink';
import {History as HistoryIcon,ExternalLink,CheckCircle,AlertCircle,FileStack,Clock3,Play} from 'lucide-react';

const dateTime=value=>value?new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'Time not recorded';
const readable=value=>String(value||'').replaceAll('_',' ');
function issueAdvice(item){
 const text=String(item||'').toLowerCase();
 if(text.includes('sheet'))return {title:'Spreadsheet update needs a retry',next:'Review the spreadsheet connection and sync status, then retry the saved update.',to:'/suppliers'};
 if(text.includes('google')||text.includes('drive')||text.includes('gmail'))return {title:'Google access needs attention',next:'Check the saved workflow connection, then rerun this workspace when it is ready.',to:'/rules'};
 if(text.includes('invoice')||text.includes('pdf')||text.includes('read')||text.includes('extract'))return {title:'A file needs review',next:'Open Needs attention to inspect the saved PDF and follow the suggested next step.',to:'/attention'};
 return {title:'This run needs attention',next:'Open Needs attention to review saved files and available next steps.',to:'/attention'};
}
function runStatus(run){
 if(run.status==='running')return {label:'Running',style:'border-blue-200 bg-blue-50 text-blue-900'};
 if(run.status==='completed_with_errors')return {label:'Finished · needs attention',style:'border-amber-200 bg-amber-50 text-amber-950'};
 if(run.status==='failed')return {label:'Stopped · action needed',style:'border-red-200 bg-red-50 text-red-900'};
 if(run.status==='completed'&&(run.finding_details?.length||run.needs_review))return {label:'Completed · review needed',style:'border-amber-200 bg-amber-50 text-amber-950'};
 if(run.status==='completed')return {label:'Completed successfully',style:'border-emerald-200 bg-emerald-50 text-emerald-900'};
 return {label:readable(run.status)||'Status not available',style:'border-slate-200 bg-slate-50 text-slate-800'};
}
function WorkflowRunCard({run,supplierName,isLatest=false}){
 const badge=runStatus(run),when=run.completed||run.updated||run.started||run.created,errors=Array.isArray(run.errors)?run.errors:[];
 const found=[`${run.collected??0} PDFs collected`,`${run.analyzed??0} invoices analyzed`,`${run.preserved??0} existing captures kept`].join(' · ');
 return <Card className="overflow-hidden">
  <CardContent className="space-y-4 p-4 sm:p-5">
   <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
    <div className="min-w-0"><h2 className="font-semibold">{isLatest?'Latest check · ':''}Invoice check · {supplierName}</h2><p className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground"><Clock3 className="h-3.5 w-3.5"/>{dateTime(when)}</p></div>
    <span className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-sm font-semibold ${badge.style}`}>{badge.label}</span>
   </div>
   <div className="rounded-lg bg-slate-50 p-3 text-sm"><p className="font-medium">What this run found</p><p className="mt-1 text-muted-foreground">{found}</p>
    {run.pdf_details?.length>0&&<div className="mt-3 border-t border-slate-200 pt-3"><p className="font-medium">PDFs from this run</p><ul className="mt-1 space-y-1.5">{run.pdf_details.slice(0,10).map(pdf=><li key={pdf.document_id} className="flex flex-col gap-1 break-words sm:flex-row sm:items-center sm:justify-between"><span className="min-w-0">{pdf.name}{pdf.pages?` · ${pdf.pages} pages`:''}</span><OriginalPdfLink documentId={pdf.document_id} className="inline-flex min-h-9 w-fit shrink-0 items-center font-semibold text-blue-700 underline">Open PDF</OriginalPdfLink></li>)}</ul>{run.pdf_details.length>10&&<p className="mt-2 text-xs text-muted-foreground">Showing 10 of {run.pdf_details.length} PDFs. Open Combine PDFs to browse the complete collection.</p>}</div>}
   </div>
   {run.finding_details?.length>0&&<section className="rounded-lg border border-amber-200 bg-amber-50/60 p-3" aria-label="Findings from this run">
    <h3 className="font-semibold text-amber-950">Latest findings · {run.finding_details.length}</h3>
    <div className="mt-2 space-y-2">{run.finding_details.slice(0,5).map((item,index)=><div key={`${item.invoice_id}-${index}`} className="border-t border-amber-200 pt-2 text-sm"><p className="font-medium">{item.supplier} · Invoice {item.invoice_number}{item.invoice_date?` · ${item.invoice_date}`:''}</p><p className="mt-1 break-words text-amber-950">{item.reasons?.map(reason=>`${reason.color}: ${reason.reason}`).join(' · ')||'Open the invoice to see its review notes.'}</p><div className="mt-1 flex flex-wrap gap-x-4 gap-y-1"><Link className="inline-flex min-h-9 items-center font-semibold text-blue-700 underline" to={`/invoices/${item.invoice_id}`}>View invoice details</Link>{item.source_document_id&&<OriginalPdfLink documentId={item.source_document_id} className="inline-flex min-h-9 items-center font-semibold text-blue-700 underline">Open original PDF</OriginalPdfLink>}</div></div>)}</div>
    {run.finding_details.length>5&&<p className="mt-2 text-xs text-muted-foreground">{run.finding_details.length-5} more findings from this run.</p>}
   </section>}
   {errors.length>0&&<section className="rounded-lg border border-red-200 bg-red-50/60 p-3" aria-label="Errors from this run">
    <h3 className="inline-flex items-center gap-2 font-semibold text-red-950"><AlertCircle className="h-4 w-4"/>Run issues · {errors.length}</h3>
    <div className="mt-2 space-y-2">{errors.slice(0,3).map((item,index)=>{const advice=issueAdvice(item);return <div key={index} className="border-t border-red-200 pt-2 text-sm"><p className="font-medium">{advice.title}</p><p className="mt-1 text-red-950">{advice.next}</p><details className="mt-1"><summary className="cursor-pointer text-xs font-medium">Show original error</summary><p className="mt-1 break-words text-xs text-muted-foreground">{item}</p></details><Link className="mt-1 inline-flex min-h-9 items-center font-semibold text-blue-700 underline" to={advice.to}>Open related page</Link></div>;})}</div>
    {errors.length>3&&<details className="mt-2 border-t border-red-200 pt-2"><summary className="cursor-pointer text-sm font-medium">Show {errors.length-3} more errors</summary><ul className="mt-2 list-disc space-y-1 break-words pl-5 text-sm">{errors.slice(3).map((item,index)=><li key={index}>{item}</li>)}</ul></details>}
   </section>}
   {run.status==='running'&&<p className="text-sm text-blue-900">Currently {readable(run.stage)||'starting'} · updated {dateTime(run.updated||run.started)}</p>}
   <div className="flex flex-wrap items-center gap-3 border-t pt-3"><Button asChild variant="outline" size="sm"><Link to="/run-check"><Play className="mr-2 h-4 w-4"/>Open invoice check</Link></Button>{run.finding_details?.length>0&&<Link className="text-sm font-medium text-blue-700 underline" to="/attention">See all items needing attention</Link>}</div>
  </CardContent>
 </Card>;
}

export default function RunHistory(){
 const [history,setHistory]=useState([]),[runs,setRuns]=useState([]),[supplierNames,setSupplierNames]=useState({}),[loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{let active=true;Promise.all([base44.entities.RunHistory.list('-run_date',100),request('/automation'),base44.entities.Supplier.list('',500)]).then(([rows,automation,suppliers])=>{if(!active)return;setHistory(rows.map(run=>({...run,emails_found:run.emails_found??0,pdfs_saved:run.pdfs_saved??0,files_saved:run.files_saved??run.pdfs_saved??0,errors:run.errors??0,identical_content_skipped:run.identical_content_skipped??run.duplicates_skipped??0,status:run.status==='success'?'completed':run.status})));setRuns(automation.runs||[]);setSupplierNames(Object.fromEntries(suppliers.map(item=>[item.id,item.name||'Supplier workspace'])));}).catch(e=>{if(active)setError(e.message||'Could not load run history.');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
 const activity=history.filter(run=>run.operation!=='Invoice check');
 return <div className="mx-auto max-w-5xl p-6 sm:p-8 lg:p-12">
  <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><h1 className="text-2xl font-bold">Run History</h1><p className="mt-1 text-sm text-muted-foreground">Each invoice check shows its own status, results, findings, and next steps.</p></div><Button asChild variant="outline"><Link to="/documents"><FileStack className="mr-2 h-4 w-4"/>Combine PDFs</Link></Button></div>
  <Card className="mb-6 border-blue-200 bg-blue-50/60"><CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold text-blue-950">Need one PDF for a full year?</p><p className="text-sm text-blue-900">Open Combine PDFs to choose and merge saved originals. The tool shows its current per-merge limit and lets you make and combine batches.</p></div><Button asChild><Link to="/documents">Open Combine PDFs</Link></Button></CardContent></Card>
  {error&&<p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-900">Could not load history: {error}</p>}
  <section aria-labelledby="invoice-run-history" className="space-y-3"><div className="flex items-center justify-between"><div><h2 id="invoice-run-history" className="text-lg font-semibold">Invoice check runs</h2><p className="text-sm text-muted-foreground">Status and links below belong to that specific run.</p></div></div>
   {loading?<Card><CardContent className="space-y-3 p-4">{[1,2,3].map(i=><Skeleton key={i} className="h-16 w-full"/>)}</CardContent></Card>:runs.length?runs.map((run,index)=><WorkflowRunCard key={run.id} run={run} isLatest={index===0} supplierName={supplierNames[run.supplier_id]||run.supplier_name||'All workspaces'}/>):<Card><CardContent className="py-10"><EmptyState icon={HistoryIcon} title="No invoice checks yet" description="Completed and in-progress invoice checks will appear here."/></CardContent></Card>}
  </section>
  <section aria-labelledby="other-activity" className="mt-8 space-y-3"><div><h2 id="other-activity" className="text-lg font-semibold">Other document activity</h2><p className="text-sm text-muted-foreground">Uploads, Gmail collection, Drive copies, and PDF merges.</p></div>
   {!loading&&activity.length===0?<p className="rounded-lg border p-4 text-sm text-muted-foreground">No other document activity recorded.</p>:<Card><CardContent className="p-0"><div className="hidden overflow-x-auto sm:block"><table className="w-full text-sm"><thead className="border-b bg-muted/30"><tr>{['Date','Workspace','Activity','Result','Issues','Link'].map(label=><th key={label} className="p-3 text-left font-medium text-muted-foreground">{label}</th>)}</tr></thead><tbody>{activity.map(run=><tr key={run.id} className="border-b last:border-0"><td className="whitespace-nowrap p-3">{dateTime(run.run_date)}</td><td className="p-3">{run.supplier_name||'Manual upload'}</td><td className="p-3">{run.operation||'Collection'}</td><td className="p-3">{run.files_saved??run.pdfs_saved??0} files saved{run.operation==='Gmail collection'?` · ${run.drive_saved??0} Drive copies`:''}</td><td className="p-3">{run.errors?<span className="inline-flex items-center gap-1 text-red-700"><AlertCircle className="h-3.5 w-3.5"/>{run.errors}</span>:<span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle className="h-3.5 w-3.5"/>None</span>}</td><td className="p-3">{run.drive_folder_link&&<a href={run.drive_folder_link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline">Open folder <ExternalLink className="h-3 w-3"/></a>}</td></tr>)}</tbody></table></div>
   <div className="divide-y sm:hidden">{activity.map(run=><div key={run.id} className="space-y-1 p-4 text-sm"><p className="font-medium">{run.supplier_name||'Manual upload'} · {run.operation||'Collection'}</p><p className="text-muted-foreground">{dateTime(run.run_date)}</p><p>{run.files_saved??run.pdfs_saved??0} files saved · {run.errors?`${run.errors} issue(s)`:'No errors recorded'}</p>{run.drive_folder_link&&<a href={run.drive_folder_link} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 text-primary underline">Open folder <ExternalLink className="h-3 w-3"/></a>}</div>)}</div></CardContent></Card>}
  </section>
 </div>;
}
