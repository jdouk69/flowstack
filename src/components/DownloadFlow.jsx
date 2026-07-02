import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Check, X, Download, FolderOpen, AlertCircle, Merge } from 'lucide-react';

export default function DownloadFlow({ open, onClose, supplierId, suppliers = [], onComplete }) {
  const [phase, setPhase] = useState('idle');
  const [result, setResult] = useState(null);
  const [mergeResult, setMergeResult] = useState(null);
  const [error, setError] = useState(null);
  const [supplierName, setSupplierName] = useState('');
  const abortRef = useRef(false);

  useEffect(() => {
    if (open && supplierId) {
      abortRef.current = false;
      setPhase('connecting');
      setResult(null);
      setMergeResult(null);
      setError(null);

      const supplier = suppliers.find(s => s.id === supplierId);
      setSupplierName(supplier?.name || 'All Suppliers');

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
          setError(e.response?.data?.error || e.message || 'Something went wrong');
          setPhase('error');
        }
      })();
    }
  }, [open, supplierId]);

  const handleCancel = () => {
    abortRef.current = true;
    setPhase('idle');
    onClose();
  };

  const handleMerge = async () => {
    if (!supplierId || supplierId === 'all') return;
    setPhase('merging');
    setMergeResult(null);
    setError(null);
    try {
      const res = await base44.functions.invoke('mergePdfs', { supplier_id: supplierId });
      setMergeResult(res.data);
      setPhase('merge_complete');
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Merge failed');
      setPhase('error');
    }
  };

  const handleClose = () => {
    setPhase('idle');
    onClose();
  };

  const totals = result?.totals;
  const results = result?.results || [];
  const isActive = phase === 'connecting' || phase === 'searching' || phase === 'merging';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget && !isActive) handleClose(); }}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="bg-background rounded-2xl shadow-2xl w-full max-w-lg p-8 relative"
            role="dialog"
            aria-modal="true"
          >
            {!isActive && (
              <button onClick={handleClose} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            )}

            <AnimatePresence mode="wait">
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
                    {phase === 'searching' && 'Searching for PDFs...'}
                    {phase === 'merging' && 'Merging PDFs...'}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-6">
                    {phase === 'connecting' && 'Setting up your download'}
                    {phase === 'searching' && supplierName}
                    {phase === 'merging' && 'Combining all PDFs into one file'}
                  </p>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-6 relative">
                    <motion.div
                      animate={{ left: ['-33%', '100%'] }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                      className="absolute h-full w-1/3 bg-primary rounded-full"
                    />
                  </div>
                  <Button variant="ghost" size="sm" onClick={handleCancel} className="text-muted-foreground">
                    Cancel
                  </Button>
                </motion.div>
              )}

              {phase === 'complete' && totals && (
                <motion.div key="complete" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center py-4">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', damping: 15, stiffness: 200, delay: 0.1 }}
                    className="w-16 h-16 mx-auto mb-5 rounded-full bg-green-100 dark:bg-green-950 flex items-center justify-center"
                  >
                    <motion.svg viewBox="0 0 24 24" className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <motion.path
                        d="M5 13 L10 18 L19 7"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 0.4, delay: 0.3 }}
                      />
                    </motion.svg>
                  </motion.div>
                  <h3 className="text-xl font-bold mb-1">Download Complete</h3>
                  <p className="text-sm text-muted-foreground mb-5">Your PDFs have been saved to Google Drive</p>

                  <div className="grid grid-cols-3 gap-3 mb-6">
                    <div className="p-3 rounded-xl bg-muted/50">
                      <p className="text-2xl font-bold text-green-600">{totals.pdfs_saved}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">PDFs Saved</p>
                    </div>
                    <div className="p-3 rounded-xl bg-muted/50">
                      <p className="text-2xl font-bold text-amber-600">{totals.duplicates_skipped}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Duplicates</p>
                    </div>
                    <div className="p-3 rounded-xl bg-muted/50">
                      <p className="text-2xl font-bold text-blue-600">{totals.emails_found}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Emails Found</p>
                    </div>
                  </div>

                  {results.length > 1 && (
                    <div className="space-y-1 mb-5 text-left">
                      {results.map((r, i) => (
                        <a key={i} href={r.drive_folder_link} target="_blank" rel="noopener noreferrer"
                          className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-muted/30 hover:bg-muted/60 transition-colors">
                          <span className="font-medium">{r.supplier_name}</span>
                          <span className="text-green-600">{r.pdfs_saved} saved</span>
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

              {phase === 'merge_complete' && mergeResult && (
                <motion.div key="merge_complete" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center py-4">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', damping: 15, stiffness: 200, delay: 0.1 }}
                    className="w-16 h-16 mx-auto mb-5 rounded-full bg-green-100 dark:bg-green-950 flex items-center justify-center"
                  >
                    <motion.svg viewBox="0 0 24 24" className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
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
                  <p className="text-sm font-medium text-primary mb-6">{mergeResult.merged_filename}</p>
                  <div className="flex flex-col gap-2">
                    <Button className="gap-2" asChild>
                      <a href={mergeResult.drive_folder_link} target="_blank" rel="noopener noreferrer">
                        <FolderOpen className="h-4 w-4" /> Open Folder
                      </a>
                    </Button>
                    <Button variant="ghost" onClick={handleClose}>Return to Dashboard</Button>
                  </div>
                </motion.div>
              )}

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
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}