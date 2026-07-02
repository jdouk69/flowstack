import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function SupplierForm({ open, onClose, onSubmit, supplier }) {
  const [form, setForm] = useState({ name: '', email: '', keyword: '', drive_folder_name: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (supplier) {
      setForm({
        name: supplier.name || '',
        email: supplier.email || '',
        keyword: supplier.keyword || '',
        drive_folder_name: supplier.drive_folder_name || ''
      });
    } else {
      setForm({ name: '', email: '', keyword: '', drive_folder_name: '' });
    }
  }, [supplier, open]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    await onSubmit(form);
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{supplier ? 'Edit Supplier' : 'Add Supplier'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Supplier Name</Label>
            <Input id="name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="e.g. Acme Corp" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email Address</Label>
            <Input id="email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required placeholder="billing@acme.com" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="keyword">Keyword (optional)</Label>
            <Input id="keyword" value={form.keyword} onChange={e => setForm({ ...form, keyword: e.target.value })} placeholder="e.g. Acme" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="folder">Drive Folder Name</Label>
            <Input id="folder" value={form.drive_folder_name} onChange={e => setForm({ ...form, drive_folder_name: e.target.value })} required placeholder="e.g. Acme Invoices" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? 'Saving...' : 'Save'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}