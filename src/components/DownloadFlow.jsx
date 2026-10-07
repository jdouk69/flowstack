import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { X, Download, FolderOpen, AlertCircle, Merge, AlertTriangle, WifiOff, History, Copy, Link2, ExternalLink, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

export default function DownloadFlow({ open, onClose, supplierId, suppliers = [], onComplete }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [phase, setPhase] = useState('idle');
  const [result, setResult] = useState(null);
  const [mergeResult, setMergeResult] = useState(null);
  const [error, setError] = useState(null);
  const [supplierName, setSupplierName] = useState('');
  const [linkState, setLinkState] = useState(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const abortRef = useRef(false);
  const confirmDialogRef = useRef(null);
  const keepWaitingRef = useRef(null);

  const isActive = phase === 'connecting' || phase === 'searching' || phase === 'merging';
  const isDownloadActive = phase === 'connecting' || phase === 'searching';

  // Initialize to confirmation screen when opened
  useEffect(() => {
    if (open && supplierId) {
      abortRef.current = false;
      setPhase('confirm');
      setResult(null);
      setMergeResult(null);
      setLinkState(null);
      setError(null);
      setShowLeaveConfirm(false);
      const supplier = suppliers.find(s => s.id === supplierId);
      setSupplierName(supplier?.name || 'All Suppliers');
    }
  }, [open, supplierId]);

  const startDownload = () => {
    setPhase('connecting');
    const timer = setTimeout(() => {
      if (!abortRef.current) setPhase('searching');
    }, 800);

    (async () => {
      try {
        const res = await base44.functions.invoke('downloadPdfs', { supplier_id: supplierId });
        clearTimeout(timer);
        if (abortRef.current) return;
        setResult(res.data);
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
    if (!supplierId || supplierId === 'all') return;
    setPhase('merging');
    setMergeResult(null);
    setError(null);
    try {
      const res = await base44.functions.invoke('mergePdfs', { supplier_id: supplierId, date_str: new Date().toLocaleDateString('en-CA') });
      setMergeResult(res.data);
      setPhase('merge_complete');
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Merge failed');
      setPhase('error');
    }
  };

  const createCustomerLink = async () => {
    if (!mergeResult?.merged_file_id) return;
    setLinkState({ status: 'working' });
    try {
      const res = await base44.functions.invoke('createCustomerLink', { file_id: mergeResult.merged_file_id, supplier_id: supplierId });
      setLinkState({ status: 'active', data: res.data });
      toast({ title: 'Customer link created' });
    } catch (e) {
      setLinkState({ status: 'failed', message: e.response?.data?.message || e.message || 'Could not create the customer link. The merge is safe — try again.' });
    }
  };

  const copyCustomerLink = async () => {
    if (!linkState?.data?.download_url) return;
    try {
      await navigator.clipboard.writeText(linkState.data.download_url);
      toast({ title: 'Link copied' });
    } catch (e) {
      toast({ title: 'Could not copy the link' });
    }
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
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="bg-background rounded-2xl shadow-2xl w-full max-w-lg p-8 relative overflow-hidden"
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
                  <h3 className="text-xl font-bold mb-1">Ready to download</h3>
                  <p className="text-sm text-muted-foreground mb-5">{supplierName}</p>

                  <div role="alert" className="flex gap-3 p-4 mb-6 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-left">
                    <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Keep InboxVault open until the download finishes.</p>
                      <p className="text-xs text-amber-700 dark:text-amber-400 mt-1.5">Closing the app, refreshing the page, locking your phone, or leaving the browser for too long may interrupt the connection. The backend may continue processing, but InboxVault may no longer be able to show the final result.</p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Button className="gap-2" onClick={startDownload}>
                      <Download className="h-4 w-4" /> Start Download
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
                    {phase === 'searching' && supplierName}
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
                  <h3 className="text-xl font-bold mb-1">Download Complete</h3>
                  <p className="text-sm text-muted-foreground mb-5">Your files have been saved to Google Drive</p>

                  <div className="grid grid-cols-3 gap-3 mb-6">
                    <div className="p-3 rounded-xl bg-muted/50">
                      <p className="text-2xl font-bold text-emerald-600">{totals.pdfs_saved}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Files Saved</p>
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
                          <span className="text-emerald-600">{r.pdfs_saved} saved</span>
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
                    <Button variant="ghost" onClick={handleClose}>Return to Dashboard</Button>
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
                  <p className="text-sm text-muted-foreground mb-2">{mergeResult.pdf_count} PDFs merged into one file</p>
                  <p className="text-sm font-medium text-primary mb-2">{mergeResult.merged_filename}</p>
                  {linkState?.status === 'failed' && (
                    <div className="mb-4 w-full p-3 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-left">
                      <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Merge succeeded, but the customer link failed.</p>
                      <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">{linkState.message}</p>
                    </div>
                  )}
                  {linkState?.status === 'active' && (
                    <p className="text-xs text-emerald-700 dark:text-emerald-400 mb-4 w-full">
                      Anyone with this link can view and download a separate copy. It never expires automatically — revoke it in Documents.
                    </p>
                  )}
                  <div className="flex flex-col gap-2">
                    {linkState?.status === 'active' ? (
                      <div className="flex gap-2">
                        <Button className="flex-1 gap-2" onClick={copyCustomerLink}>
                          <Copy className="h-4 w-4" /> Copy customer link
                        </Button>
                        <Button variant="outline" className="flex-1 gap-2" asChild>
                          <a href={linkState.data.share_url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4" /> Open copy
                          </a>
                        </Button>
                      </div>
                    ) : (
                      <Button className="gap-2" onClick={createCustomerLink} disabled={linkState?.status === 'working' || !mergeResult.merged_file_id}>
                        {linkState?.status === 'working' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                        {linkState?.status === 'working' ? 'Creating link...' : 'Create customer link'}
                      </Button>
                    )}
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1 gap-2" asChild>
                        <a href={`https://drive.google.com/uc?export=download&id=${mergeResult.merged_file_id}`} target="_blank" rel="noopener noreferrer">
                          <Download className="h-4 w-4" /> Download PDF
                        </a>
                      </Button>
                      <Button variant="outline" className="flex-1 gap-2" asChild>
                        <a href={mergeResult.drive_folder_link} target="_blank" rel="noopener noreferrer">
                          <FolderOpen className="h-4 w-4" /> Open Folder
                        </a>
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Large downloads: Google may show a confirmation page before the file starts.</p>
                    <Button variant="ghost" onClick={handleClose}>Return to Dashboard</Button>
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
                  <Button variant="ghost" onClick={handleClose}>Close</Button>
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
                    InboxVault lost its connection while the download was running. Your files may still be processing in the background. Check the Google Drive folder and Run History after a few moments.
                  </p>
                  <div className="flex flex-col gap-2">
                    <Button className="gap-2" onClick={handleOpenRunHistory}>
                      <History className="h-4 w-4" /> Open Run History
                    </Button>
                    <Button variant="ghost" onClick={handleClose}>Close</Button>
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
                      Leaving now may cause InboxVault to lose its connection to the download. The files may continue saving to Google Drive, but the app may not be able to show the final status.
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