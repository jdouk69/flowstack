import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import StatCard from '@/components/StatCard';
import DownloadDialog from '@/components/DownloadDialog';
import { Users, FileText, Clock, Download, TrendingUp, ExternalLink } from 'lucide-react';

export default function Dashboard() {
  const [suppliers, setSuppliers] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [downloadOpen, setDownloadOpen] = useState(false);

  const loadData = async () => {
    try {
      const [supps, hist] = await Promise.all([
        base44.entities.Supplier.list(),
        base44.entities.RunHistory.list('-run_date', 10)
      ]);
      setSuppliers(supps);
      setHistory(hist);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const totalPdfs = history.reduce((sum, r) => sum + (r.pdfs_saved || 0), 0);
  const lastRun = history[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">Organize PDF attachments from your Gmail</p>
        </div>
        <Button onClick={() => setDownloadOpen(true)} className="gap-2">
          <Download className="h-4 w-4" /> Download PDFs
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users} label="Suppliers" value={suppliers.length} />
        <StatCard icon={FileText} label="PDFs Saved" value={totalPdfs} />
        <StatCard icon={Clock} label="Total Runs" value={history.length} />
        <StatCard icon={TrendingUp} label="Last Run" value={lastRun ? new Date(lastRun.run_date).toLocaleDateString() : '—'} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : history.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p>No runs yet. Click "Download PDFs" to get started.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {history.slice(0, 5).map(run => (
                <div key={run.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <p className="font-medium text-sm">{run.supplier_name}</p>
                    <p className="text-xs text-muted-foreground">{new Date(run.run_date).toLocaleString()}</p>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-green-600">{run.pdfs_saved} saved</span>
                    {run.duplicates_skipped > 0 && <span className="text-amber-600">{run.duplicates_skipped} dupes</span>}
                    {run.drive_folder_link && (
                      <a href={run.drive_folder_link} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <DownloadDialog open={downloadOpen} onClose={() => setDownloadOpen(false)} suppliers={suppliers} onComplete={loadData} />
    </div>
  );
}