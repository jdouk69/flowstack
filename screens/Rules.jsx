import {useResultReveal} from '@/hooks/useResultReveal';
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Skeleton from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import DownloadFlow from '@/components/DownloadFlow';
import { Plus, Play, Pencil, Trash2, Folder, Clock, FolderOpen } from 'lucide-react';
import VendorAudit from '@/components/VendorAudit';
import {request} from '@/api/base44Client';
import FileBrowser from '@/components/FileBrowser';

const searchTypeLabels = {
  sender_email: 'Sender Email',
  company_name: 'Company Name',
  gmail_search: 'Advanced Gmail Search',
};

const statusConfig = {
  new: { label: 'New', className: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400' },
  active: { label: 'Active', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400' },
  error: { label: 'Needs Attention', className: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400' },
};

export default function Rules() {
  const reveal=useResultReveal(),results=useRef(null),feedback=useRef(null);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloadSupplierId, setDownloadSupplierId] = useState(null);
  const [collectionMode,setCollectionMode]=useState('full'),[retryFailed,setRetryFailed]=useState(false);
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  const [fileBrowserSupplierId, setFileBrowserSupplierId] = useState(null);
  const [auditBusy,setAuditBusy]=useState(false);
  const [auditSupplier,setAuditSupplier]=useState(null),[masterBusy,setMasterBusy]=useState(null),[masterError,setMasterError]=useState('');
  const setupMaster=async s=>{setMasterBusy(s.id);setMasterError('');try{await request('/vendor-master/'+encodeURIComponent(s.id),{method:'POST',body:'{}'});await load();}catch(e){setMasterError(e.message);}finally{setMasterBusy(null);}};
  const [syncBusy,setSyncBusy]=useState(null),[syncFeedback,setSyncFeedback]=useState('');
  const retrySheets=async s=>{if(syncBusy)return;setSyncBusy(s.id);setSyncFeedback('Retrying saved invoice syncs…');let count=0;try{for(let i=0;i<500;i++){const r=await request('/vendor-sync/'+encodeURIComponent(s.id),{method:'POST',body:'{}'});if(r.done){setSyncFeedback(`${s.name}: ${count} saved invoice sync(s) verified. ${r.message}`);break;}count++;setSyncFeedback(`${s.name}: ${count} saved invoice sync(s) verified; continuing…`);}await load();}catch(e){setSyncFeedback(`${s.name}: ${count} sync(s) verified. Retry stopped: ${e.message}`);await load();}finally{setSyncBusy(null);}};
  const navigate = useNavigate();
  const [searching,setSearching]=useState(null),[searchResult,setSearchResult]=useState(null),[searchError,setSearchError]=useState('');const searchGuard=useRef(false),searchController=useRef(null);
  useEffect(()=>()=>searchController.current?.abort(),[]);
  const searchWorkflow=async supplier=>{
    if(searchGuard.current)return;searchGuard.current=true;const controller=new AbortController();searchController.current=controller;setSearching(supplier.id);setSearchError('');setSearchResult(null);
    try{const response=await base44.functions.invoke('previewResults',{supplier_id:supplier.id},{signal:controller.signal});if(!controller.signal.aborted){setSearchResult({...response.data,workflow_name:supplier.name});reveal(results);}}
    catch(e){if(!controller.signal.aborted){setSearchError(e.message);reveal(feedback);}}
    finally{searchGuard.current=false;if(!controller.signal.aborted)setSearching(null);}
  };


  const load = async () => {
    try {
      setSuppliers(await base44.entities.Supplier.list());
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id) => {
    if (!confirm('Delete this rule?')) return;
    await base44.entities.Supplier.delete(id);
    load();
  };

  const openDownload = (id,mode='full',retry=false) => {
    setCollectionMode(mode);setRetryFailed(retry);
    setDownloadSupplierId(id);
    setDownloadOpen(true);
  };

  const openFileBrowser = (id) => {
    setFileBrowserSupplierId(id);
    setFileBrowserOpen(true);
  };

  return (
    <div className="workflow-page w-full min-w-0 p-4 sm:p-8 lg:p-12 max-w-6xl mx-auto">
      <div className="flex flex-wrap gap-4 items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Workflows</h1>
          <p className="text-muted-foreground text-sm mt-1">Saved recipes for organizing your documents</p>
        </div>
        <Button onClick={() => navigate('/rules/new')} className="gap-2">
          <Plus className="h-4 w-4" /> Create Workflow
        </Button>
      </div>

      <p className="text-sm text-muted-foreground mb-4">Search Gmail checks your saved workflow and previews matching attachments. Run complete audit processes this vendor and updates its own master spreadsheet. Collect PDFs only keeps the original collection action available.</p>
      {syncFeedback&&<p role="status" className="mb-4 rounded-lg border bg-blue-50 p-3 break-words">{syncFeedback}</p>}
      {masterError&&<p role="alert" className="text-red-700 mb-3">{masterError}</p>}
      {searchError&&<p ref={feedback} role="alert" className="p-3 mb-4 border rounded-lg text-red-700">{searchError}</p>}
      {searchResult&&<Card className="mb-5"><CardContent className="p-5 space-y-3"><h2 ref={results} tabIndex={-1} className="font-semibold">Gmail search: {searchResult.workflow_name}</h2><p>{searchResult.emails_found_is_lower_bound?'At least ':''}{searchResult.emails_found} matching emails · {searchResult.files_found_is_estimate?'Estimated ':''}{searchResult.files_found} matching attachments</p><p className="text-sm break-all">Query: {searchResult.query}</p><p className="text-sm text-muted-foreground">Read-only preview. No emails or files changed. {searchResult.files_found_is_estimate&&`Attachment count estimated from ${searchResult.emails_sampled} emails.`} {searchResult.search_truncated&&'Search capped at 300 messages; narrow the query for a complete count.'}</p>{searchResult.sample_emails.map((email,i)=><div className="text-sm border-t pt-2 break-words" key={i}><strong>{email.subject}</strong><p>{email.from} · {email.date}</p></div>)}</CardContent></Card>}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0">
          {[1, 2, 3, 4].map(i => (
            <Card key={i}><CardContent className="min-w-0 p-4 sm:p-5"><Skeleton className="h-32 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : suppliers.length === 0 ? (
        <Card>
          <CardContent className="py-16">
            <EmptyState
              icon={Plus}
              title="No workflows yet"
              description="Create your first download workflow to automatically save email attachments from Gmail to Google Drive."
              action={<Button onClick={() => navigate('/rules/new')} className="gap-2"><Plus className="h-4 w-4" /> Create Your First Workflow</Button>}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0">
          {suppliers.map(s => {
            const searchValue = s.search_type === 'sender_email' ? s.email : s.keyword;
            const status = statusConfig[s.status] || statusConfig.new;
            return (
              <Card key={s.id} className="min-w-0 w-full max-w-full hover:shadow-md transition-shadow">
                <CardContent className="min-w-0 p-4 sm:p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold break-words [overflow-wrap:anywhere]">{s.name}</h3>
                      <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full mt-1 ${status.className}`}>
                        {status.label}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1.5 text-sm mb-4">
                    <div className="flex min-w-0 items-start gap-2 text-muted-foreground">
                      <span className="text-xs font-medium shrink-0 pt-0.5">Search</span>
                      <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{searchTypeLabels[s.search_type] || 'Sender Email'}: {searchValue || '—'}</span>
                    </div>
                    <div className="flex min-w-0 items-start gap-2 text-muted-foreground">
                      <Folder className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 break-words [overflow-wrap:anywhere]">{s.drive_folder_name}</span>
                    </div>
                    <div className="flex min-w-0 items-start gap-2 text-muted-foreground">
                      <Clock className="h-3.5 w-3.5 shrink-0" />
<span className="min-w-0 break-words">Last completed attempt: {s.last_run ? new Date(s.last_run).toLocaleString() : 'Never run'}</span>
                    </div>
                    <p className="text-xs text-muted-foreground break-words">Successful checkpoint: {s.last_successful_check?new Date(s.last_successful_check).toLocaleString():'Not established — next check starts with all matching messages'}</p>
                  </div>

                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="gap-2 flex-1 min-w-0" disabled={!!searching} onClick={()=>searchWorkflow(s)}>
                      <Play className="h-3.5 w-3.5" /> {searching===s.id?'Searching…':'Search Gmail'}
                    </Button>
                    <Button size="sm" variant="outline" aria-label={`Edit ${s.name}`} onClick={() => navigate(`/rules/${s.id}/edit`)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="outline" aria-label={`Delete ${s.name}`} onClick={() => handleDelete(s.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {auditSupplier?.id===s.id?<VendorAudit key={s.id} supplier={s} onBusyChange={setAuditBusy} onClose={()=>{setAuditSupplier(null);load();}}/>:<Button size="lg" className="w-full mt-3 bg-blue-700 text-white font-bold" disabled={auditBusy||!!syncBusy} onClick={()=>setAuditSupplier(s)}>Run complete audit</Button>}
                  {auditBusy&&auditSupplier?.id!==s.id&&<p role="status" className="mt-2 text-sm">An audit is running for {auditSupplier?.name}. Wait for it to finish.</p>}
                  {s.sheet_sync?.last_verified?<p className="mt-3 text-sm text-emerald-800 break-words">Last verified Sheets sync: {new Date(s.sheet_sync.last_verified.completed).toLocaleString()} · Invoice {s.sheet_sync.last_verified.invoice} · {s.sheet_sync.last_verified.verified?.invoice_line_rows!=null?`${s.sheet_sync.last_verified.verified.invoice_line_rows} invoice lines verified; `:''}{s.sheet_sync.last_verified.verified?.line_item_rows??0} new line rows added</p>:<p className="mt-3 text-sm text-amber-800">No verified successful Sheets sync recorded</p>}
                  {s.sheet_sync?.last_attempt?.status==='failed'&&<p className="mt-1 text-sm text-red-700 break-words">Last Sheets attempt failed: {s.sheet_sync.last_attempt.error}</p>}
                  <Button size="sm" variant="outline" className="w-full mt-2" disabled={!!syncBusy||auditBusy||!s.master_url} onClick={()=>retrySheets(s)}>{syncBusy===s.id?'Retrying master syncs…':'Retry failed master syncs'}</Button>
                  {s.master_url?<a href={s.master_url} target="_blank" rel="noreferrer" className="block my-2 text-blue-700 underline font-semibold">Open vendor master</a>:<div className="my-2"><p className="text-amber-800">Master setup pending</p><Button size="sm" variant="outline" disabled={masterBusy===s.id} onClick={()=>setupMaster(s)}>{masterBusy===s.id?'Creating master…':'Set up vendor master'}</Button>{s.master_error&&<p className="text-sm text-red-700 break-words">{s.master_error}</p>}</div>}
                  <Button size="sm" className="w-full gap-2 mt-2" disabled={!!searching||downloadOpen} onClick={()=>openDownload(s.id)}><Play className="h-3.5 w-3.5"/>Collect PDFs only</Button>
                  <Button size="sm" variant="outline" className="w-full gap-2 mt-2" disabled={!!searching||downloadOpen} onClick={()=>openDownload(s.id,'incremental')}>Check new invoices</Button>
                  {s.status==='error'&&<Button size="sm" variant="outline" className="w-full mt-2" disabled={!!searching||downloadOpen} onClick={()=>openDownload(s.id,'full',true)}>Retry failed collection items</Button>}
                  <Button size="sm" variant="secondary" className="w-full gap-2 mt-2" onClick={() => navigate(`/documents?workflow=${s.id}`)}>
                    <FolderOpen className="h-3.5 w-3.5" /> View Files
                  </Button>
                  <Button size="sm" variant="outline" className="w-full gap-2 mt-2" onClick={()=>openFileBrowser(s.id)}>Browse Drive folder</Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <DownloadFlow
        open={downloadOpen}
        onClose={() => { setDownloadOpen(false); setDownloadSupplierId(null); }}
        supplierId={downloadSupplierId}
        mode={collectionMode}
        retryFailed={retryFailed}
        suppliers={suppliers}
        onComplete={load}
      />

      <FileBrowser
        open={fileBrowserOpen}
        onClose={() => { setFileBrowserOpen(false); setFileBrowserSupplierId(null); }}
        supplierId={fileBrowserSupplierId}
      />
    </div>
  );
}
