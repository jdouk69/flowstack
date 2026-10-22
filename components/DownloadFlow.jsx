import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {runWorkflows} from '@/lib/run-workflows.mjs';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { X, Download, FolderOpen, AlertCircle, Merge, AlertTriangle, WifiOff, History } from 'lucide-react';

export default function DownloadFlow({ open, onClose, supplierId, suppliers = [], onComplete, mode='full', retryFailed=false }) {
  const navigate = useNavigate();
  const [phase, setPhase] = useState('idle');
  const [result, setResult] = useState(null);
  const [mergeResult, setMergeResult] = useState(null);
  const [error, setError] = useState(null);
  const [supplierName, setSupplierName] = useState('');
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const abortRef = useRef(false),retryActionRef=useRef('collection');
  const phaseDialog=useRef(null);
  useEffect(()=>{if(open&&['confirm','complete','merge_complete','error','network_error'].includes(phase)){const frame=requestAnimationFrame(()=>phaseDialog.current?.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'}));return()=>cancelAnimationFrame(frame);}},[open,phase]);
  const confirmDialogRef = useRef(null);
  const keepWaitingRef = useRef(null);
  useEffect(()=>()=>{abortRef.current=true;},[]);

  const isActive = phase === 'connecting' || phase === 'searching' || phase === 'merging';
  const isDownloadActive = phase === 'connecting' || phase === 'searching';

  // Initialize to confirmation screen when opened
  useEffect(() => {
    if (open && supplierId) {
      abortRef.current = false;
      setPhase('confirm');
      setResult(null);
      setMergeResult(null);
      setError(null);
      setShowLeaveConfirm(false);
      const supplier = suppliers.find(s => s.id === supplierId);
      setSupplierName(supplier?.name || 'All Suppliers');
    }
  }, [open, supplierId]);

  const startDownload = () => {
    retryActionRef.current='collection';
    setPhase('connecting');
    const timer = setTimeout(() => {
      if (!abortRef.current) setPhase('searching');
    }, 800);

    (async () => {
      try {
        const data=await runWorkflows({workflows:supplierId==='all'?suppliers:suppliers.filter(s=>s.id===supplierId),invoke:input=>base44.functions.invoke('downloadPdfs',input),onProgress:setResult,cancelled:()=>abortRef.current,mode,retryFailed});
        clearTimeout(timer);
        if (abortRef.current || !data) return;
        setResult(data);
        setPhase('complete');
        if (onComplete) onComplete();
      } catch (e) {
        clearTimeout(timer);
        if (abortRef.current) return;
        const isNetwork = !e.response || (e.message && e.message.includes('Network Error'));
        if (isNetwork) {
          setPhase('network_error');
        } else {
          setError(e.response?.data?.error || e.message || 'Something went wrong');
          setPhase('error');
        }
      }
    })();
  };

  // beforeunload + popstate guard during active download
  useEffect(() => {
    if (!isDownloadActive) return;

    const beforeUnloadHandler = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const popStateHandler = () => {
      setShowLeaveConfirm(true);
      window.history.pushState(null, '', window.location.href);
    };

    window.addEventListener('beforeunload', beforeUnloadHandler);
    window.addEventListener('popstate', popStateHandler);
    window.history.pushState(null, '', window.location.href);

    return () => {
      window.removeEventListener('beforeunload', beforeUnloadHandler);
      window.removeEventListener('popstate', popStateHandler);
    };
  }, [isDownloadActive]);

  // Focus trap for leave confirmation dialog
  useEffect(() => {
    if (!showLeaveConfirm) return;

    const focusTimer = setTimeout(() => {
      keepWaitingRef.current?.focus();
    }, 50);

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowLeaveConfirm(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const container = confirmDialogRef.current;
      if (!container) return;
      const focusable = container.querySelectorAll('button, a, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showLeaveConfirm]);

  const handleAttemptClose = () => {
    if (isActive) {
      setShowLeaveConfirm(true);
    } else {
      setPhase('idle');
      onClose();
    }
  };

  const handleLeaveAnyway = () => {
    abortRef.current = true;
    setShowLeaveConfirm(false);
    setPhase('idle');
    onClose();
  };

  const handleMerge = async () => {
    retryActionRef.current='merge';setPhase('merging');setError(null);setMergeResult(null);
    try{const response=await base44.functions.invoke('mergePdfs',{supplier_id:supplierId});if(abortRef.current)return;setMergeResult(response.data);setPhase('merge_complete');onComplete?.();}
    catch(e){if(!abortRef.current){setError(e.response?.data?.error||e.message);setPhase('error');}}
  };

  const shareMerged=async()=>{
    if(!mergeResult?.document)return;setPhase('merging');
    try{const r=await base44.functions.invoke('shareDocument',{document_id:mergeResult.document.id,action:'create',confirmed:true});if(!abortRef.current)setMergeResult(previous=>({...previous,customer_share:r.data.share,share_error:null}));}
    catch(e){if(!abortRef.current)setMergeResult(previous=>({...previous,share_error:e.message}));}
    finally{if(!abortRef.current)setPhase('merge_complete');}
  };
  const handleClose = () => {
    setPhase('idle');
    onClose();
  };

  const handleOpenRunHistory = () => {
    handleClose();
    navigate('/run-history');
  };

  const totals = result?.totals;
  const results = result?.results || [];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) handleAttemptClose(); }}
        >
          <motion.div ref={phaseDialog}
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="bg-background rounded-2xl shadow-2xl w-full max-w-lg p-6 sm:p-8 relative max-h-[90dvh] overflow-y-auto"
            role="dialog"
            aria-modal="true"
          >
            {(phase === 'confirm' || !isActive) && (
              <button onClick={handleAttemptClose} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors z-20" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            )}

            <AnimatePresence mode="wait">
              {/* Confirmation / warning screen */}
              {phase === 'confirm' && (
                <motion.div key="confirm" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-center py-2">
                  <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-primary/10 flex items-center justify-center">
                    <Download className="h-8 w-8 text-primary" />
                  </div>
                  <h3 className="text-xl font-bold mb-1">{retryFailed?'Retry failed collection items':mode==='incremental'?'Check new invoices':'Run workflow — full recheck'}</h3>
                  <p className="text-sm text-muted-foreground mb-5">{supplierName}</p>
                  <p className="text-sm text-muted-foreground mb-5">{retryFailed?'Retries failed attachments from the latest completed collection. Prior run history and saved originals remain unchanged.':mode==='incremental'?'Checks since the last successful collection with a 48-hour overlap. If no compatible checkpoint exists, performs a full check.':'Rechecks all messages matching the saved workflow. Existing duplicate protection remains active.'} An incomplete or failed check does not advance the successful checkpoint. This is a manual check, not background monitoring.</p>

                  <div role="alert" className="flex gap-3 p-4 mb-6 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-left">
                    <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Keep Flowstack open until the download finishes.</p>
                      <p className="text-xs text-amber-700 dark:text-amber-400 mt-1.5">Closing the app, refreshing the page, locking your phone, or leaving the browser for too long may interrupt the connection. Completed files are preserved. Run this workflow again to resume an interrupted collection.</p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Button className="gap-2" onClick={startDownload}>
                      <Download className="h-4 w-4" /> Collect & Save
                    </Button>
                    <Button variant="ghost" onClick={handleAttemptClose}>Cancel</Button>
                  </div>
                </motion.div>
              )}

              {/* Active download / merge progress */}
              {isActive && (
                <motion.div key="progress" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center py-4">
                  <div className="relative w-20 h-20 mx-auto mb-6">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                      className="absolute inset-0 rounded-full border-4 border-muted border-t-primary"
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                      {phase === 'merging' ? <Merge className="h-7 w-7 text-primary" /> : <Download className="h-7 w-7 text-primary" />}
                    </div>
                  </div>
                  <h3 className="text-lg font-semibold mb-1">
                    {phase === 'connecting' && 'Connecting to Gmail...'}
                    {phase === 'searching' && 'Searching for files...'}
                    {phase === 'merging' && 'Merging PDFs...'}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-6">
                    {phase === 'connecting' && 'Setting up your download'}
                    {phase === 'searching' && (result?.totals ? `${result.totals.emails_found} emails checked · ${result.totals.files_saved} originals saved · ${result.totals.drive_saved} Drive copies saved` : supplierName)}
                    {phase === 'merging' && 'Combining all PDFs into one file'}
                  </p>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-4 relative">
                    <motion.div
                      animate={{ left: ['-33%', '100%'] }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                      className="absolute h-full w-1/3 bg-primary rounded-full"
                    />
                  </div>

                  {isDownloadActive && (
                    <div role="status" aria-live="polite" className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 mb-4">
                      <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                        Please keep this screen open and your device unlocked until the download completes.
                      </p>
                      <p className="text-xs text-amber-600 dark:text-amber-500 mt-1.5 sm:hidden">
                        For best results, do not switch apps while the download is running.
                      </p>
                    </div>
                  )}

                  <Button variant="ghost" size="sm" onClick={handleAttemptClose} className="text-muted-foreground">
                    Cancel
                  </Button>
                </motion.div>
              )}

              {/* Download complete */}
              {phase === 'complete' && totals && (
                <motion.div key="complete" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center py-4">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', damping: 15, stiffness: 200, delay: 0.1 }}
                    className="w-16 h-16 mx-auto mb-5 rounded-full bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center"
                  >
                    <motion.svg viewBox="0 0 24 24" className="w-8 h-8 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <motion.path
                        d="M5 13 L10 18 L19 7"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 0.4, delay: 0.3 }}
                      />
                    </motion.svg>
                  </motion.div>
                  <h3 className="text-xl font-bold mb-1">{totals.errors ? 'Collection needs attention' : 'Collection Complete'}</h3>
                  <p className="text-sm text-muted-foreground mb-5">Originals are saved in FlowStack; Drive copies are verified separately below.</p>

                  <div className="grid grid-cols-3 gap-3 mb-6">
                    <div className="p-3 rounded-xl bg-muted/50">
                      <p className="text-2xl font-bold text-emerald-600">{totals.files_saved}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">New originals</p>
                    </div>
                    <div className="p-3 rounded-xl bg-muted/50">
                      <p className="text-2xl font-bold text-amber-600">{totals.duplicates_skipped}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Identical Skipped</p>
                    </div>
                    <div className="p-3 rounded-xl bg-muted/50">
                      <p className="text-2xl font-bold text-blue-600">{totals.emails_found}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Emails Found</p>
                    </div>
                  </div>

                  <p className="text-sm mb-4">{totals.drive_saved} new Drive copies · {totals.errors} errors</p>
                  {!!totals.errors&&<div role="alert" className="text-left text-sm border rounded-lg p-3 mb-4"><p className="font-semibold">Saved originals remain available. Run the workflow again to retry failed copies.</p>{totals.error_details?.map((e,i)=><p key={i} className="mt-2 break-words">{e.filename}: {e.reason}</p>)}</div>}
                  {totals.name_collision_saved > 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 -mt-3 mb-6">
                      {totals.name_collision_saved} same-name file{totals.name_collision_saved > 1 ? 's' : ''} saved with an [alt-…] suffix — same name, different content. Both files were kept.
                    </p>
                  )}

                  {results.length > 1 && (
                    <div className="space-y-1 mb-5 text-left">
                      {results.map((r, i) => (
                        <a key={i} href={r.drive_folder_link} target="_blank" rel="noopener noreferrer"
                          className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-muted/30 hover:bg-muted/60 transition-colors">
                          <span className="font-medium">{r.supplier_name}</span>
                          <span>{r.files_saved} saved · {r.errors} errors</span>
                        </a>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-col gap-2">
                    <div className="flex gap-2">
                      {results.length === 1 && results[0].drive_folder_link && (
                        <Button className="flex-1 gap-2" asChild>
                          <a href={results[0].drive_folder_link} target="_blank" rel="noopener noreferrer">
                            <FolderOpen className="h-4 w-4" /> Open Folder
                          </a>
                        </Button>
                      )}
                      {supplierId && supplierId !== 'all' && (
                        <Button variant="outline" className="flex-1 gap-2" onClick={handleMerge}>
                          <Merge className="h-4 w-4" /> Merge PDFs
                        </Button>
                      )}
                    </div>
                    <Button variant="outline" onClick={()=>{handleClose();navigate(supplierId==='all'?'/documents':'/documents?workflow='+supplierId);}}>View saved files</Button>
                  </div>
                </motion.div>
              )}

              {/* Merge complete */}
              {phase === 'merge_complete' && mergeResult && (
                <motion.div key="merge_complete" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center py-4">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', damping: 15, stiffness: 200, delay: 0.1 }}
                    className="w-16 h-16 mx-auto mb-5 rounded-full bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center"
                  >
                    <motion.svg viewBox="0 0 24 24" className="w-8 h-8 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <motion.path
                        d="M5 13 L10 18 L19 7"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 0.4, delay: 0.3 }}
                      />
                    </motion.svg>
                  </motion.div>
                  <h3 className="text-xl font-bold mb-1">Merge Complete</h3>
                  <p className="text-sm text-muted-foreground mb-2">{mergeResult.pdf_count} PDFs merged; all originals preserved</p>
                  <p className="text-sm font-medium text-primary mb-6">{mergeResult.merged_filename}</p>
                  {mergeResult.share_error&&<p role="alert" className="text-sm text-amber-700 mb-3">Merge saved. Customer link failed: {mergeResult.share_error}</p>}
                  <Button className="mb-3" asChild><a href={'/api/flow/documents/'+mergeResult.document.id}>Download merged PDF</a></Button>
                  {mergeResult.customer_share?.status==='active'?<div className="mb-3"><label className="block text-sm">Customer link<input readOnly value={mergeResult.customer_share.download_link||mergeResult.customer_share.view_link} onFocus={e=>e.target.select()} className="border rounded-lg p-2 w-full bg-background"/></label><Button variant="outline" onClick={async()=>{try{const r=await base44.functions.invoke('shareDocument',{document_id:mergeResult.document.id,action:'check'});setMergeResult(previous=>({...previous,customer_share:r.data.share}));if(r.data.share?.status!=='active')throw Error(r.data.share?.verification_reason||'Customer link is not active.');await navigator.clipboard.writeText(r.data.share.download_link||r.data.share.view_link);}catch(e){setMergeResult(previous=>({...previous,share_error:'Customer link was not copied: '+e.message}));}}}>Copy customer link</Button><p className="text-xs mt-2">Manage or revoke this link in Documents → Share PDF link. No automatic expiry.</p></div>:<div className="mb-3"><p className="text-xs mb-2">A customer link creates a separate read-only copy accessible to anyone with the link.</p><Button variant="outline" onClick={shareMerged}>Create customer download link</Button></div>}

                  <div className="flex flex-col gap-2">
                    <Button className="gap-2" asChild>
                      <a href={mergeResult.drive_folder_link} target="_blank" rel="noopener noreferrer">
                        <FolderOpen className="h-4 w-4" /> Open Folder
                      </a>
                    </Button>
                    <Button variant="outline" onClick={()=>{handleClose();navigate(supplierId==='all'?'/documents':'/documents?workflow='+supplierId);}}>View saved files</Button>
                  </div>
                </motion.div>
              )}

              {/* Generic error */}
              {phase === 'error' && (
                <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-4">
                  <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-red-100 dark:bg-red-950 flex items-center justify-center">
                    <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
                  </div>
                  <h3 className="text-xl font-bold mb-1">Something went wrong</h3>
                  <p className="text-sm text-muted-foreground mb-6">{error}</p>
                  <Button onClick={()=>retryActionRef.current==='merge'?handleMerge():startDownload()}>Retry / Resume</Button><Button variant="ghost" onClick={handleClose}>Close</Button>
                </motion.div>
              )}

              {/* Network error / connection lost */}
              {phase === 'network_error' && (
                <motion.div key="network_error" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center py-4">
                  <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-amber-100 dark:bg-amber-950 flex items-center justify-center">
                    <WifiOff className="h-8 w-8 text-amber-600 dark:text-amber-400" />
                  </div>
                  <h3 className="text-xl font-bold mb-1">Connection lost</h3>
                  <p className="text-sm text-muted-foreground mb-6 px-2">
                    Flowstack lost its connection while the download was running. The current batch may finish. Saved files are preserved; run this workflow again to resume the remaining collection.
                  </p>
                  <div className="flex flex-col gap-2">
                    <Button className="gap-2" onClick={handleOpenRunHistory}>
                      <History className="h-4 w-4" /> Open Run History
                    </Button>
                    <Button onClick={()=>retryActionRef.current==='merge'?handleMerge():startDownload()}>Retry / Resume</Button><Button variant="ghost" onClick={handleClose}>Close</Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Leave confirmation overlay */}
            <AnimatePresence>
              {showLeaveConfirm && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-30 bg-background rounded-2xl flex items-center justify-center p-6"
                  role="alertdialog"
                  aria-modal="true"
                  aria-labelledby="leave-title"
                  aria-describedby="leave-desc"
                >
                  <div ref={confirmDialogRef} className="text-center w-full">
                    <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-amber-100 dark:bg-amber-950 flex items-center justify-center">
                      <AlertTriangle className="h-7 w-7 text-amber-600 dark:text-amber-400" />
                    </div>
                    <h3 id="leave-title" className="text-lg font-bold mb-2">Download still in progress</h3>
                    <p id="leave-desc" className="text-sm text-muted-foreground mb-6">
                      Leaving now may cause Flowstack to lose its connection to the download. The current batch may finish. Run this workflow again to resume; completed files are preserved.
                    </p>
                    <div className="flex flex-col gap-2">
                      <Button ref={keepWaitingRef} onClick={() => setShowLeaveConfirm(false)}>Keep Waiting</Button>
                      <Button variant="destructive" onClick={handleLeaveAnyway}>Leave Anyway</Button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
