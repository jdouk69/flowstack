import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import Skeleton from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import { X, Search, FileText, Image as ImageIcon, File, ExternalLink, Merge, AlertCircle, FolderOpen, Loader2, CheckCircle2, HardDrive, RefreshCw } from 'lucide-react';

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
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState([]);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [merging, setMerging] = useState(false);
  const [mergeResult, setMergeResult] = useState(null);

  const loadFiles = useCallback(async () => {
    if (!supplierId) return;
    setLoading(true);
    setError(null);
    setMergeResult(null);
    try {
      const res = await base44.functions.invoke('listWorkflowFiles', { supplier_id: supplierId });
      setFiles(res.data.files || []);
      setMeta({
        workflow_name: res.data.workflow_name,
        folder_name: res.data.folder_name,
        folder_link: res.data.folder_link,
        total_files: res.data.total_files,
        total_pdfs: res.data.total_pdfs,
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
        setError({ type: 'generic', message: errData?.error || errData?.message || e.message || 'Something went wrong' });
      }
    }
    setLoading(false);
  }, [supplierId]);

  useEffect(() => {
    if (open && supplierId) {
      setSearch('');
      setFilterType('all');
      setSortBy('name');
      setMergeResult(null);
      loadFiles();
    }
  }, [open, supplierId]);

  const handleMerge = async () => {
    setMerging(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('mergePdfs', { supplier_id: supplierId });
      setMergeResult(res.data);
      toast({ title: 'Merge complete', description: `${res.data.merged_filename} created with ${res.data.pdf_count} PDFs` });
      await loadFiles();
    } catch (e) {
      const msg = e.response?.data?.error || e.message || 'Merge failed';
      setError({ type: 'merge_failed', message: msg });
    }
    setMerging(false);
  };

  const handleClose = () => {
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

  const pdfCount = files.filter(f => f.is_pdf).length;
  const canMerge = pdfCount >= 2;

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
                    placeholder="Search files..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="w-full sm:w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FILE_TYPE_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SORT_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>Sort: {s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Merge bar */}
            {!loading && !error && canMerge && (
              <div className="px-5 pb-3 shrink-0">
                <Button className="w-full gap-2" onClick={handleMerge} disabled={merging}>
                  {merging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Merge className="h-4 w-4" />}
                  {merging ? 'Merging PDFs...' : 'Merge PDFs'}
                </Button>
              </div>
            )}

            {/* Merge success */}
            {mergeResult && (
              <div className="mx-5 mb-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 flex items-center gap-3 shrink-0">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">Merge complete</p>
                  <p className="text-xs text-emerald-700 dark:text-emerald-400 truncate">{mergeResult.merged_filename} ({mergeResult.pdf_count} PDFs)</p>
                </div>
                <Button size="sm" variant="outline" asChild className="shrink-0">
                  <a href={mergeResult.drive_folder_link} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3.5 w-3.5" /> Open
                  </a>
                </Button>
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
                    <div key={file.id} className="flex items-center gap-3 p-3 rounded-xl border bg-card hover:bg-accent/50 transition-colors">
                      <div className="shrink-0">{getFileIcon(file.mime_type, file.is_pdf)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{file.name}</p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-0.5">
                          <span>{formatSize(file.size)}</span>
                          <span className="hidden sm:inline">·</span>
                          <span>{formatDate(file.modified_date)}</span>
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" asChild className="shrink-0">
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