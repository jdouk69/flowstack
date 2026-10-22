import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Loader2, FileStack } from 'lucide-react';
import AutomationDashboard from '@/components/AutomationDashboard';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function RunCheck() {
  const [suppliers, setSuppliers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    base44.entities.Supplier.list('', 500).then((items) => {
      if (active) setSuppliers(items.filter((item) => !['disabled', 'paused'].includes(item.status)));
    }).catch((e) => {
      if (active) setError(e.message || 'Could not load saved supplier workspaces.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return (
    <main className="audit-page">
      <div className="audit-page-heading">
        <div>
          <div className="mb-2"><Link to="/" className="inline-flex items-center gap-2 text-sm text-primary"><ArrowLeft className="h-4 w-4" />Dashboard</Link></div>
          <h1>Choose a workspace</h1>
          <p>Run one supplier workflow at a time. The check collects and reviews files for the selected workspace only.</p>
        </div>
      </div>
      <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        Each run is limited to one supplier’s saved Gmail workflow, Drive folder, and master spreadsheet. Other supplier workspaces are left out until you select them separately.
      </div>
      <div className="mb-5 flex flex-col gap-2 rounded-lg border bg-background p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold">Need to combine PDFs?</h2><p className="text-sm text-muted-foreground">Combine saved originals into a downloadable PDF, including multi-step batches.</p></div><Button asChild variant="outline"><Link to="/documents"><FileStack className="mr-2 h-4 w-4"/>Open Combine PDFs</Link></Button></div>
      {loading && <p className="inline-flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>Loading saved workspaces…</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!loading && !error && !suppliers.length && <Card><CardContent className="p-5 text-sm">No active supplier workspaces are available. Add or enable a workflow in <Link className="text-primary underline" to="/rules">Workflows</Link>.</CardContent></Card>}
      {!!suppliers.length && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {suppliers.map((supplier) => {
          const isSelected = selected?.id === supplier.id;
          return <Card key={supplier.id} className={isSelected ? 'border-primary ring-1 ring-primary/20' : ''}>
            <CardContent className="flex h-full flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3"><h2 className="font-semibold">{supplier.name || 'Unnamed workspace'}</h2>{isSelected && <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" aria-label="Selected"/>}</div>
              <p className="flex-1 text-sm text-muted-foreground">Select this workspace to check only its invoices and configured master.</p>
              <Button variant={isSelected ? 'default' : 'outline'} onClick={() => setSelected(supplier)} aria-pressed={isSelected}>{isSelected ? 'Selected workspace' : 'Select workspace'}</Button>
            </CardContent>
          </Card>;
        })}
      </div>}
      {selected && <section className="mt-6" aria-label={`${selected.name} invoice check`}>
        <div className="mb-3 rounded-lg border bg-background p-3 text-sm"><strong>Selected workspace:</strong> {selected.name} · This run will not include other workspaces.</div>
        <AutomationDashboard key={selected.id} supplierId={selected.id} supplierName={selected.name}/>
      </section>}
    </main>
  );
}
