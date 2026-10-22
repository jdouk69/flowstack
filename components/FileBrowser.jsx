import {useNavigate} from 'react-router-dom';
import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {planPdfParts,runMergeParts} from '@/lib/merge-parts.mjs';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import Skeleton from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import { X, Search, FileText, Image as ImageIcon, File, ExternalLink, Merge, AlertCircle, FolderOpen, Loader2, CheckCircle2, HardDrive, RefreshCw, AlertTriangle } from 'lucide-react';

const FILE_TYPE_CATEGORIES = [
  { value: 'all', label: 'All Files' },
  { value: 'pdf', label: 'PDFs' },
  { value: 'image', label: 'Images' },
  { value: 'document', label: 'Documents' },
  { value: 'other', label: 'Other' },
];

const SORT_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'created_date', label: 'Created Date' },
  { value: 'modified_date', label: 'Modified Date' },
  { value: 'size', label: 'Size' },
];

function getFileCategory(mimeType, isPdf) {
  if (isPdf) return 'pdf';
  if (mimeType && mimeType.startsWith('image/')) return 'image';
  if (mimeType && (mimeType.includes('word') || mimeType.includes('spreadsheet') || mimeType.includes('presentation') || mimeType.includes('document'))) return 'document';
  return 'other';
}

function getFileIcon(mimeType, isPdf) {
  if (isPdf) return <FileText className="h-5 w-5 text-red-500" />;
  if (mimeType && mimeType.startsWith('image/')) return <ImageIcon className="h-5 w-5 text-blue-500" />;
  return <File className="h-5 w-5 text-muted-foreground" />;
}

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function FileBrowser({ open, onClose, supplierId }) {
  const { toast } = useToast();
  const navigate=useNavigate();
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState([]);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [merging, setMerging] = useState(false);
  const [mergeResult, setMergeResult] = useState(null);
  const [selectedIds,setSelectedIds]=useState([]),[actionNotice,setActionNotice]=useState(''),[shareAfterMerge,setShareAfterMerge]=useState(false),[customerShare,setCustomerShare]=useState(null),[batchAnchor,setBatchAnchor]=useState(null);

  const [partsJob,setPartsJob]=useState(null);const stopParts=useRef(false),partsRunning=useRef(false),partView=useRef(0);
  useEffect(()=>()=>{stopParts.current=true;partView.current++;},[open,supplierId]);
  const loadFiles = useCallback(async () => {
    if (!supplierId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('listWorkflowFiles', { supplier_id: supplierId });
      setFiles(res.data.files || []);
      setMeta({
        workflow_name: res.data.workflow_name||res.data.supplier_name,
        folder_name: res.data.folder_name,
        folder_link: res.data.folder_link||res.data.drive_folder_link,
        total_files: res.data.total_files,
        total_pdfs: res.data.total_pdfs??res.data.pdf_count,
      });
    } catch (e) {
      const errData = e.response?.data;
      if (errData?.error === 'FOLDER_NOT_FOUND') {
        setError({ type: 'folder_not_found', message: errData.message });
      } else if (errData?.error === 'AMBIGUOUS_FOLDER') {
        setError({ type: 'ambiguous', message: errData.message });
      } else if (e.response?.status === 401 || (e.message && e.message.toLowerCase().includes('unauthorized'))) {
        setError({ type: 'not_connected', message: 'Google Drive is not connected. Connect your account in Settings.' });
      } else if (!e.response || (e.message && e.message.includes('Network Error'))) {
        setError({ type: 'network', message: 'Network error. Check your connection and try again.' });
      } else {
        setError({ type: 'generic', message: errData?.message || errData?.error || e.message || 'Something went wrong' });
      }
    }
    setLoading(false);
  }, [supplierId]);

  useEffect(() => {
    if (open && supplierId) {
      setSearch('');
      setFilterType('all');
      setSortBy('name');
      setPartsJob(null);setSelectedIds([]);setActionNotice('');setCustomerShare(null);setShareAfterMerge(false);setBatchAnchor(null);
      setMergeResult(null);
      loadFiles();
    }
  }, [open, supplierId]);

  const perform = async action => {
    if(merging)return;setMerging(true);setError(null);setMergeResult(null);setActionNotice('');
    try {
      const response=await base44.functions.invoke(action,{supplier_id:supplierId,...(selectedIds.length?{ids:selectedIds}:{})});
      if(action==='mergePdfs'){
        setMergeResult(response.data);setCustomerShare(null);
        if(shareAfterMerge){try{const shared=await base44.functions.invoke('shareDocument',{document_id:response.data.document.id,action:'create',confirmed:true});setCustomerShare(shared.data.share);}catch(e){setActionNotice('Merge is saved; customer link failed: '+e.message);}}
      }
      else setActionNotice(`${response.data.files_saved} original PDFs imported; ${response.data.duplicates_skipped} identical copies already stored; ${response.data.errors} errors. ${response.data.error_details?.map(e=>`${e.filename}: ${e.reason}`).join(' · ')||''}`);
      setSelectedIds([]);await loadFiles();
    } catch(e){setError({type:'merge_failed',message:e.response?.data?.error||e.message});}
    finally{setMerging(false);}
  };
  const linkPdf=async file=>{if(merging)return;setMerging(true);setActionNotice('');try{const r=await base44.functions.invoke('linkDrivePdf',{supplier_id:supplierId,file_id:file.id});setActionNotice((r.data.already_linked?'Reference already saved. ':'Drive reference saved. ')+'Open Documents to create or manage its customer link. The original stays in Drive; large-file merging and analysis are not available for references.');}catch(e){setActionNotice('Could not save Drive reference: '+e.message);}finally{setMerging(false);}};
  const planParts=()=>{try{const plan=planPdfParts(eligible);setPartsJob({plan,supplier_id:supplierId,next_index:0,results:[],status:'planned',error:null});setActionNotice('');}catch(e){setActionNotice(e.message);}};
  const startParts=async()=>{
    if(partsRunning.current||merging||!partsJob)return;partsRunning.current=true;stopParts.current=false;setMerging(true);setMergeResult(null);setPartsJob(previous=>({...previous,status:'running',error:null}));
    const job=partsJob,view=partView.current;const updateJob=fn=>{if(view===partView.current)setPartsJob(fn);};
    try{const outcome=await runMergeParts({parts:job.plan.parts,start:job.next_index,shouldStop:()=>stopParts.current||view!==partView.current,execute:async part=>{
      updateJob(previous=>({...previous,progress:`Processing part ${part.number} of ${job.plan.parts.length}…`}));
      const expected_files=part.items.map(f=>({id:f.id,md5:f.md5,size:f.size}));
      const r=await base44.functions.invoke(part.kind==='original'?'linkDrivePdf':'mergePdfs',{supplier_id:job.supplier_id,expected_files,...(part.kind==='original'?{file_id:part.items[0].id}:{ids:part.items.map(f=>f.id),part_number:part.number})});
      return {number:part.number,kind:part.kind,document:r.data.document,drive_link:r.data.drive_file_link||r.data.document.drive_file_link,reused:r.data.already_merged||r.data.already_linked||false};
    },onResult:(result,index)=>updateJob(previous=>({...previous,next_index:index+1,results:[...previous.results.filter(r=>r.number!==result.number),result]}))});
    updateJob(previous=>({...previous,next_index:outcome.next_index,status:outcome.complete?'complete':'stopped',progress:outcome.complete?'All planned parts saved.':'Stopped after the current part. Resume this plan to continue.'}));
    }catch(e){updateJob(previous=>({...previous,status:'failed',error:`Part ${e.part_index+1} stopped: ${e.message}. Completed parts remain saved.`,progress:''}));}
    finally{partsRunning.current=false;setMerging(false);if(view===partView.current)await loadFiles();}
  };
  const handleMerge = ()=>perform('mergePdfs');
  const createCustomerLink=async()=>{if(merging||!mergeResult?.document)return;setMerging(true);try{const r=await base44.functions.invoke('shareDocument',{document_id:mergeResult.document.id,action:'create',confirmed:true});setCustomerShare(r.data.share);}catch(e){setActionNotice('Merge is saved; customer link failed: '+e.message);}finally{setMerging(false);}};
  const copyCustomerLink=async()=>{if(merging)return;setMerging(true);try{const r=await base44.functions.invoke('shareDocument',{document_id:mergeResult.document.id,action:'check'});setCustomerShare(r.data.share);if(r.data.share?.status!=='active')throw Error(r.data.share?.verification_reason||'Customer link is not active.');await navigator.clipboard.writeText(r.data.share.download_link||r.data.share.view_link);toast({title:'Drive settings checked; customer link copied'});}catch(e){setActionNotice('Customer link was not copied: '+e.message);}finally{setMerging(false);}};

  const handleClose = () => {
    stopParts.current=true;
    setFiles([]);
    setMeta(null);
    setError(null);
    setMergeResult(null);
    onClose();
  };

  const filtered = files
    .filter(f => {
      if (filterType !== 'all' && getFileCategory(f.mime_type, f.is_pdf) !== filterType) return false;
      if (search && !f.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'name': return a.name.localeCompare(b.name);
        case 'created_date': return new Date(b.created_date || 0) - new Date(a.created_date || 0);
        case 'modified_date': return new Date(b.modified_date || 0) - new Date(a.modified_date || 0);
        case 'size': return (b.size || 0) - (a.size || 0);
        default: return 0;
      }
    });

  useEffect(()=>{setBatchAnchor(null);if(!partsRunning.current)setPartsJob(null);},[search,filterType,sortBy,supplierId]);
  const pdfCount = files.filter(f => f.is_pdf&&!f.merged).length;
  const eligible=filtered.filter(f=>f.is_pdf&&!f.merged);
  const nextBatchStart=batchAnchor?eligible.findIndex(f=>f.id===batchAnchor)+1:0,nextBatchCount=batchAnchor?Math.min(20,Math.max(0,eligible.length-nextBatchStart)):0;
  const chooseBatch=start=>{const batch=eligible.slice(start,start+20);setSelectedIds(batch.map(f=>f.id));setBatchAnchor(batch.at(-1)?.id||null);};
  const mergeInputs=selectedIds.length?files.filter(f=>selectedIds.includes(f.id)):files.filter(f=>f.is_pdf&&!f.merged);
  const canMerge = mergeInputs.length>=2&&mergeInputs.length<=20&&mergeInputs.reduce((n,f)=>n+Number(f.size||0),0)<=20*1024*1024;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={(e) => { if (e.target === e.currentTarget && !merging) handleClose(); }}
        >
          <motion.div
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="bg-background rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col relative"
            role="dialog"
            aria-modal="true"
          >
            {/* Header */}
            <div className="flex items-start justify-between p-5 border-b shrink-0">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold truncate">{meta?.workflow_name || 'Files'}</h2>
                {meta && (
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5">
                    <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{meta.folder_name}</span>
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {!loading && !error && files.length > 0 && (
                  <button onClick={loadFiles} className="text-muted-foreground hover:text-foreground transition-colors p-2 rounded-lg hover:bg-accent" aria-label="Refresh">
                    <RefreshCw className="h-4 w-4" />
                  </button>
                )}
                <button onClick={handleClose} className="text-muted-foreground hover:text-foreground transition-colors p-2 rounded-lg hover:bg-accent" aria-label="Close">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Stats */}
            {meta && !error && (
              <div className="grid grid-cols-2 gap-3 p-5 pb-3 shrink-0">
                <div className="rounded-xl bg-muted/50 p-3">
                  <p className="text-2xl font-bold">{meta.total_files}</p>
                  <p className="text-xs text-muted-foreground">Total Files</p>
                </div>
                <div className="rounded-xl bg-muted/50 p-3">
                  <p className="text-2xl font-bold text-red-500">{meta.total_pdfs}</p>
                  <p className="text-xs text-muted-foreground">PDFs</p>
                </div>
              </div>
            )}

            {/* Toolbar */}
            {!loading && !error && files.length > 0 && (
              <div className="px-5 pb-3 flex flex-col sm:flex-row gap-2 shrink-0">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search files..." disabled={merging}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Select disabled={merging} value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="w-full sm:w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FILE_TYPE_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select disabled={merging} value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SORT_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>Sort: {s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {!loading&&!error&&pdfCount>0&&<div className="px-5 pb-3 shrink-0 space-y-2">
              <p className="text-xs text-muted-foreground">{selectedIds.length?`${selectedIds.length} PDFs selected in click order`:'No selection: all original PDFs in name order'} · 20 PDFs / 20 MB / 1,000 pages maximum per merge; 10 MB per import. Link in FlowStack saves a Drive reference without importing bytes and supports sharing larger existing PDFs. Previous merges are excluded. Select next advances after a batch merge in this open view. Changing search, sorting or filters restarts batch selection. Select all uses the current search/filter; selections follow the visible sort order. Use a smaller selection when limits are exceeded.</p>
              <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={merging||!eligible.length} onClick={()=>chooseBatch(0)}>{eligible.length>20?'Select first 20 PDFs':'Select all PDFs'}</Button><Button variant="outline" disabled={merging||!nextBatchCount||nextBatchStart===0} onClick={()=>chooseBatch(nextBatchStart)}>Select next {nextBatchCount||20} PDFs</Button><Button variant="ghost" disabled={merging||!selectedIds.length} onClick={()=>setSelectedIds([])}>Clear selection</Button><Button variant="outline" disabled={merging||(selectedIds.length||pdfCount)>20} onClick={()=>perform('importDriveFiles')}>Import {selectedIds.length?'selected':'all originals'} to FlowStack</Button><Button disabled={merging||!canMerge} onClick={handleMerge} className="gap-2"><Merge className="h-4 w-4"/>{merging?'Processing…':`Merge ${selectedIds.length?'selected':'all originals'} & save to Drive`}</Button></div>
              <Button variant="outline" disabled={merging||!eligible.length} onClick={planParts}>Plan filtered PDFs in parts</Button><p className="text-xs text-muted-foreground">Uses all {eligible.length} filtered originals in the visible sort order, regardless of checkbox selection. Creates several files, not one large PDF. Review the plan before starting.</p>
              <label className="flex gap-2 text-xs"><input type="checkbox" checked={shareAfterMerge} disabled={merging} onChange={e=>setShareAfterMerge(e.target.checked)}/>Single merge only: create customer link when merging finishes — anyone with the link can download its separate Drive copy.</label>
              <Button variant="ghost" disabled={merging} onClick={()=>{onClose();navigate('/documents?workflow='+supplierId);}}>View stored originals and local merges</Button>
            </div>}
            <div className="mx-5 mb-3 rounded-lg border p-3 space-y-2"><p className="text-sm">Sending many PDFs? Create one customer ZIP package and keep the original filenames.</p><Button variant="outline" disabled={merging} onClick={()=>{handleClose();navigate('/shared-packages?workflow='+encodeURIComponent(supplierId));}}>Create customer package</Button></div>
            {partsJob&&<div className="mx-5 mb-3 p-3 border rounded-lg max-h-60 overflow-y-auto space-y-2"><h3 className="font-semibold">Merge in parts</h3><p className="text-xs">{partsJob.plan.source_count} originals · {partsJob.plan.parts.length} planned parts · 18 MB input target / 20 originals per part. Each original must be at most 10 MB. Page count and final output limits are checked during merging. Single-file parts remain original Drive references.</p><details><summary className="text-sm cursor-pointer">Review filenames and parts</summary>{partsJob.plan.parts.map(part=><div key={part.number} className="text-xs py-2 border-b"><strong>Part {part.number}: {part.items.length} originals · {(part.size/1024/1024).toFixed(2)} MB · {part.kind==='original'?'keep original':'merge'}</strong><ul>{part.items.map(f=><li key={f.id} className="break-words">{f.name}</li>)}</ul></div>)}</details><p role="status" className="text-sm">{partsJob.progress||(partsJob.status==='planned'?'Plan ready; no files changed yet.':`${partsJob.results.length} of ${partsJob.plan.parts.length} parts saved.`)}</p>{partsJob.error&&<p role="alert" className="text-sm text-red-700">{partsJob.error}</p>}<div className="flex flex-wrap gap-2">{partsJob.status!=='complete'&&<Button size="sm" disabled={merging} onClick={startParts}>{partsJob.next_index?'Resume remaining parts':'Start planned parts'}</Button>}{partsJob.status==='running'&&<Button size="sm" variant="outline" onClick={()=>{stopParts.current=true;setPartsJob(previous=>({...previous,progress:'Stopping after the current part saves…'}));}}>Stop after current part</Button>}<Button size="sm" variant="outline" disabled={merging} onClick={()=>{handleClose();navigate('/documents?workflow='+encodeURIComponent(partsJob.supplier_id));}}>Find saved parts and customer links</Button></div><ul className="space-y-2">{partsJob.results.map(result=><li key={result.number} className="text-xs break-words"><strong>Part {result.number}: {result.document.name}</strong> · {result.kind==='original'?'original reference saved':'merged and saved to Drive'}{result.reused?' · reused existing output':''}<div className="flex flex-wrap gap-3 mt-1">{result.drive_link&&<a className="underline" href={result.drive_link} target="_blank" rel="noopener noreferrer">Open Drive file</a>}<a className="underline" href={'/api/flow/documents/'+result.document.id} target="_blank" rel="noopener noreferrer">{result.kind==='original'?'Open original':'Download part'}</a></div></li>)}</ul><p className="text-xs text-muted-foreground">Keep this view open to process the next part. Closing stops future parts; an in-flight part may finish. Saved outputs remain in Documents and Drive. Retry the same plan to reuse completed merges. New or changed sources can produce a different plan. Customer links are created separately in Documents; this action does not make files public.</p></div>}
            {actionNotice&&<div><Button variant="outline" className="mx-5 mb-2" onClick={()=>{handleClose();navigate('/documents?workflow='+encodeURIComponent(supplierId));}}>Open workflow documents</Button><p role="status" className="mx-5 mb-3 p-3 rounded-lg bg-emerald-50 text-emerald-800 text-sm break-words">{actionNotice}</p></div>}

            {/* Merge warning */}
            {merging && (
              <div className="px-5 pb-3 shrink-0">
                <div role="alert" className="flex gap-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">Keep Flowstack open until the merge finishes.</p>
                    <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">Closing the app or leaving this screen may interrupt the merge. Please keep this page open and your device unlocked.</p>
                    <p className="text-xs text-amber-600 dark:text-amber-500 mt-1 sm:hidden">For best results, do not switch apps while the merge is running.</p>
                  </div>
                </div>
              </div>
            )}

            {/* Merge success */}
            {mergeResult && (
              <div className="mx-5 mb-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 flex flex-wrap items-center gap-3 shrink-0">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">Merge complete</p>
                  <p className="text-xs text-emerald-700 dark:text-emerald-400 truncate">{mergeResult.merged_filename} ({mergeResult.pdf_count} PDFs)</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" variant="outline" asChild>
                    <a href={mergeResult.drive_folder_link} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3.5 w-3.5" /> Open
                    </a>
                  </Button>
                  <Button size="sm" asChild><a href={'/api/flow/documents/'+mergeResult.document.id}>Download PDF</a></Button><Button size="sm" disabled={merging} onClick={handleClose}>Done</Button>
                </div>
                <div className="w-full space-y-2">{customerShare?.status==='active'?<><label className="block text-xs">Customer download link<input aria-label="Merged customer link" className="block w-full border rounded-lg bg-background p-2 mt-1" readOnly value={customerShare.download_link||customerShare.view_link} onFocus={e=>e.target.select()}/></label><Button size="sm" disabled={merging} onClick={copyCustomerLink}>Copy customer link</Button><p className="text-xs">Manage or revoke this link in Documents → Share PDF link. No automatic expiry.</p></>:<><p className="text-xs">A customer link creates a separate read-only copy accessible to anyone with the link.</p><Button size="sm" disabled={merging} onClick={createCustomerLink}>Create customer download link</Button></>}</div>
              </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-5 pb-5">
              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
                </div>
              ) : error ? (
                <div className="py-12">
                  <EmptyState
                    icon={error.type === 'not_connected' ? HardDrive : error.type === 'folder_not_found' || error.type === 'ambiguous' ? FolderOpen : AlertCircle}
                    title={
                      error.type === 'not_connected' ? 'Drive not connected' :
                      error.type === 'folder_not_found' ? 'Folder not found' :
                      error.type === 'ambiguous' ? 'Multiple folders found' :
                      error.type === 'network' ? 'Network error' :
                      error.type === 'merge_failed' ? 'Merge failed' :
                      'Something went wrong'
                    }
                    description={error.message}
                    action={
                      error.type !== 'merge_failed' ? (
                        <Button variant="outline" size="sm" onClick={loadFiles} className="gap-2">
                          <RefreshCw className="h-3.5 w-3.5" /> Try Again
                        </Button>
                      ) : null
                    }
                  />
                </div>
              ) : filtered.length === 0 ? (
                <div className="py-12">
                  <EmptyState
                    icon={FolderOpen}
                    title={files.length === 0 ? 'No files yet' : 'No matching files'}
                    description={files.length === 0 ? 'Run this workflow to download attachments from Gmail to this Drive folder.' : 'Try adjusting your search or filter.'}
                    action={files.length === 0 && meta ? (
                      <Button variant="outline" size="sm" asChild>
                        <a href={meta.folder_link} target="_blank" rel="noopener noreferrer" className="gap-2">
                          <ExternalLink className="h-3.5 w-3.5" /> Open Drive Folder
                        </a>
                      </Button>
                    ) : null}
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  {filtered.map(file => (
                    <div key={file.id} className="flex flex-wrap items-center gap-3 p-3 rounded-xl border bg-card hover:bg-accent/50 transition-colors">
                      <input type="checkbox" aria-label={`Select Drive PDF ${file.name}`} checked={selectedIds.includes(file.id)} disabled={merging||!file.is_pdf||file.merged||selectedIds.length>=20&&!selectedIds.includes(file.id)} onChange={e=>setSelectedIds(previous=>e.target.checked?[...previous,file.id]:previous.filter(id=>id!==file.id))}/>
                      <div className="shrink-0">{getFileIcon(file.mime_type, file.is_pdf)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{file.name}{file.merged?' · Merged output':''}</p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-0.5">
                          <span>{formatSize(file.size)}</span>
                          {file.source_dates?.email_received || file.source_dates?.pdf_creation_date ? (
                            <>
                              {file.source_dates.email_received && (
                                <>
                                  <span className="hidden sm:inline">·</span>
                                  <span>Email received: {formatDate(file.source_dates.email_received)}</span>
                                </>
                              )}
                              {file.source_dates.pdf_creation_date && (
                                <>
                                  <span className="hidden sm:inline">·</span>
                                  <span>PDF metadata creation date: {formatDate(file.source_dates.pdf_creation_date)}</span>
                                </>
                              )}
                            </>
                          ) : (
                            <>
                              <span className="hidden sm:inline">·</span>
                              <span>{formatDate(file.modified_date)}</span>
                            </>
                          )}
                        </div>
                      </div>
                      {file.is_pdf&&<Button size="sm" variant="outline" disabled={merging} onClick={()=>linkPdf(file)}>Link in FlowStack</Button>}<Button size="sm" variant="ghost" asChild className="shrink-0">
                        <a href={file.web_view_link} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline ml-1">Open</span>
                        </a>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
