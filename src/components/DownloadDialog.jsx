import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { base44 } from '@/api/base44Client';
import { Loader2, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react';

export default function DownloadDialog({ open, onClose, suppliers, onComplete, defaultSupplierId }) {
  const [selectedSupplier, setSelectedSupplier] = useState('all');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setSelectedSupplier(defaultSupplierId || 'all');
      setResult(null);
      setError(null);
    }
  }, [open, defaultSupplierId]);

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await base44.functions.invoke('downloadPdfs', { supplier_id: selectedSupplier });
      setResult(res.data);
      if (onComplete) onComplete();
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Something went wrong');
    }
    setRunning(false);
  };

  const handleClose = () => {
    setResult(null);
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Download PDFs</DialogTitle>
        </DialogHeader>
        {!result && !error && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Select Supplier</Label>
              <Select value={selectedSupplier} onValueChange={setSelectedSupplier}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Suppliers</SelectItem>
                  {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {suppliers.length === 0 && (
              <p className="text-sm text-muted-foreground">No suppliers configured yet. Add one first.</p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleRun} disabled={running || suppliers.length === 0}>
                {running ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Searching Gmail...</> : 'Download PDFs'}
              </Button>
            </DialogFooter>
          </div>
        )}
        {result && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-5 w-5" />
              <span className="font-medium">Download Complete</span>
            </div>
            {result.results?.map((r, i) => (
              <div key={i} className="space-y-2 p-3 rounded-lg border">
                <p className="font-medium">{r.supplier_name}</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>Emails found: <span className="font-semibold">{r.emails_found}</span></div>
                  <div>PDFs saved: <span className="font-semibold text-green-600">{r.pdfs_saved}</span></div>
                  <div>Duplicates: <span className="font-semibold text-amber-600">{r.duplicates_skipped}</span></div>
                  <div>Errors: <span className="font-semibold text-red-600">{r.errors}</span></div>
                </div>
                {r.drive_folder_link && (
                  <a href={r.drive_folder_link} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline inline-flex items-center gap-1">
                    Open Drive folder <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            ))}
            <DialogFooter>
              <Button onClick={handleClose}>Done</Button>
            </DialogFooter>
          </div>
        )}
        {error && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-red-600">
              <AlertCircle className="h-5 w-5" />
              <span className="font-medium">Error</span>
            </div>
            <p className="text-sm text-muted-foreground">{error}</p>
            <DialogFooter>
              <Button onClick={handleClose}>Close</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}