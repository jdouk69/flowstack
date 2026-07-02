import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Skeleton from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import DownloadFlow from '@/components/DownloadFlow';
import { Plus, Play, Pencil, Trash2, Folder, Clock } from 'lucide-react';

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
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloadSupplierId, setDownloadSupplierId] = useState(null);
  const navigate = useNavigate();

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

  const openDownload = (id) => {
    setDownloadSupplierId(id);
    setDownloadOpen(true);
  };

  return (
    <div className="p-6 sm:p-8 lg:p-12 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Workflows</h1>
          <p className="text-muted-foreground text-sm mt-1">Automated recipes for organizing your documents</p>
        </div>
        <Button onClick={() => navigate('/rules/new')} className="gap-2">
          <Plus className="h-4 w-4" /> Create Workflow
        </Button>
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i}><CardContent className="p-5"><Skeleton className="h-32 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : suppliers.length === 0 ? (
        <Card>
          <CardContent className="py-16">
            <EmptyState
              icon={Plus}
              title="No workflows yet"
              description="Create your first download workflow to automatically save PDF attachments from Gmail to Google Drive."
              action={<Button onClick={() => navigate('/rules/new')} className="gap-2"><Plus className="h-4 w-4" /> Create Your First Workflow</Button>}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {suppliers.map(s => {
            const searchValue = s.search_type === 'sender_email' ? s.email : s.keyword;
            const status = statusConfig[s.status] || statusConfig.new;
            return (
              <Card key={s.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold truncate">{s.name}</h3>
                      <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full mt-1 ${status.className}`}>
                        {status.label}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1.5 text-sm mb-4">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span className="text-xs font-medium w-20 shrink-0">Search</span>
                      <span className="truncate">{searchTypeLabels[s.search_type] || 'Sender Email'}: {searchValue || '—'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Folder className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{s.drive_folder_name}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="h-3.5 w-3.5 shrink-0" />
                      <span>{s.last_run ? new Date(s.last_run).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never run'}</span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button size="sm" className="gap-2 flex-1" onClick={() => openDownload(s.id)}>
                      <Play className="h-3.5 w-3.5" /> Run Now
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => navigate(`/rules/${s.id}/edit`)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleDelete(s.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
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
        suppliers={suppliers}
        onComplete={load}
      />
    </div>
  );
}