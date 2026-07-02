import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import SupplierForm from '@/components/SupplierForm';
import DownloadDialog from '@/components/DownloadDialog';
import { Plus, Mail, Folder, Tag, Download, Merge, Pencil, Trash2, FileText, Loader2 } from 'lucide-react';

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editSupplier, setEditSupplier] = useState(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloadSupplierId, setDownloadSupplierId] = useState(null);
  const [mergeLoading, setMergeLoading] = useState(null);

  const load = async () => {
    try {
      setSuppliers(await base44.entities.Supplier.list());
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSave = async (form) => {
    if (editSupplier) {
      await base44.entities.Supplier.update(editSupplier.id, form);
    } else {
      await base44.entities.Supplier.create(form);
    }
    setFormOpen(false);
    setEditSupplier(null);
    load();
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this supplier?')) return;
    await base44.entities.Supplier.delete(id);
    load();
  };

  const openDownload = (supplierId) => {
    setDownloadSupplierId(supplierId);
    setDownloadOpen(true);
  };

  const handleMerge = async (supplier) => {
    setMergeLoading(supplier.id);
    try {
      const res = await base44.functions.invoke('mergePdfs', { supplier_id: supplier.id });
      alert(`Merged ${res.data.pdf_count} PDFs into "${res.data.merged_filename}"`);
    } catch (e) {
      alert(e.response?.data?.error || 'Merge failed');
    }
    setMergeLoading(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Suppliers</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your email suppliers and Drive folders</p>
        </div>
        <Button onClick={() => { setEditSupplier(null); setFormOpen(true); }} className="gap-2">
          <Plus className="h-4 w-4" /> Add Supplier
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : suppliers.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-40" />
            <p className="text-muted-foreground mb-4">No suppliers yet. Add one to get started.</p>
            <Button onClick={() => setFormOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" /> Add Your First Supplier
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {suppliers.map(s => (
            <Card key={s.id}>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <h3 className="font-semibold text-lg">{s.name}</h3>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => { setEditSupplier(s); setFormOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(s.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-1.5 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 shrink-0" /> {s.email}</div>
                  {s.keyword && <div className="flex items-center gap-2"><Tag className="h-3.5 w-3.5 shrink-0" /> {s.keyword}</div>}
                  <div className="flex items-center gap-2"><Folder className="h-3.5 w-3.5 shrink-0" /> {s.drive_folder_name}</div>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button size="sm" className="gap-2 flex-1" onClick={() => openDownload(s.id)}>
                    <Download className="h-3.5 w-3.5" /> Download
                  </Button>
                  <Button size="sm" variant="outline" className="gap-2 flex-1" onClick={() => handleMerge(s)} disabled={mergeLoading === s.id}>
                    {mergeLoading === s.id ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Merging...</> : <><Merge className="h-3.5 w-3.5" /> Merge</>}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <SupplierForm open={formOpen} onClose={() => { setFormOpen(false); setEditSupplier(null); }} onSubmit={handleSave} supplier={editSupplier} />
      <DownloadDialog open={downloadOpen} onClose={() => setDownloadOpen(false)} suppliers={suppliers} onComplete={load} defaultSupplierId={downloadSupplierId} />
    </div>
  );
}