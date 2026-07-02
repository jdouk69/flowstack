import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import Skeleton from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import DownloadFlow from '@/components/DownloadFlow';
import { Download, FileText, History, ArrowRight, Clock, Plus } from 'lucide-react';

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 18) return 'Good Afternoon';
  return 'Good Evening';
}

export default function Welcome() {
  const [user, setUser] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const navigate = useNavigate();

  const loadData = async () => {
    const [u, s, h] = await Promise.all([
      base44.auth.me().catch(() => null),
      base44.entities.Supplier.list().catch(() => []),
      base44.entities.RunHistory.list('-run_date', 5).catch(() => []),
    ]);
    setUser(u);
    setSuppliers(s);
    setHistory(h);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const firstName = user?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'there';

  return (
    <div className="p-6 sm:p-8 lg:p-12 max-w-5xl mx-auto">
      {/* Greeting */}
      <div className="mb-10 animate-slide-up">
        <p className="text-muted-foreground text-sm font-medium">
          {getGreeting()}, {firstName} 👋
        </p>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mt-2 text-balance">
          Welcome to InboxVault
        </h1>
        <p className="text-base text-muted-foreground mt-3">
          Your documents. Automatically organized.
        </p>
      </div>

      {/* Primary action */}
      <div className="mb-12 animate-slide-up" style={{ animationDelay: '0.1s' }}>
        <Button
          size="lg"
          className="h-14 px-8 text-base gap-3 shadow-lg shadow-primary/25"
          onClick={() => suppliers.length > 0 ? setDownloadOpen(true) : navigate('/rules/new')}
        >
          <Download className="h-5 w-5" />
          Start Download
        </Button>
        <p className="text-sm text-muted-foreground mt-3 max-w-md">
          Search Gmail. Find attachments. Organize everything automatically.
        </p>
      </div>

      {/* Recent Downloads & Recent Rules */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Recent Downloads */}
        <Card className="animate-slide-up" style={{ animationDelay: '0.2s' }}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">Recent Downloads</h2>
              <button onClick={() => navigate('/run-history')} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                View all <ArrowRight className="h-3 w-3" />
              </button>
            </div>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : history.length === 0 ? (
              <EmptyState
                icon={History}
                title="No downloads yet"
                description="Your download history will appear here."
                compact
              />
            ) : (
              <div className="space-y-2">
                {history.slice(0, 4).map(run => (
                  <div key={run.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{run.supplier_name}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(run.run_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-emerald-600">{run.pdfs_saved}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Rules */}
        <Card className="animate-slide-up" style={{ animationDelay: '0.3s' }}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">Recent Rules</h2>
              <button onClick={() => navigate('/rules')} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                View all <ArrowRight className="h-3 w-3" />
              </button>
            </div>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : suppliers.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="No rules yet"
                description="Create a rule to automate PDF downloads."
                action={<Button size="sm" onClick={() => navigate('/rules/new')} className="gap-2"><Plus className="h-4 w-4" /> Create Rule</Button>}
                compact
              />
            ) : (
              <div className="space-y-2">
                {suppliers.slice(0, 4).map(s => (
                  <div key={s.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer" onClick={() => navigate('/rules')}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{s.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{s.drive_folder_name}</p>
                    </div>
                    {s.last_run ? (
                      <span className="text-xs text-muted-foreground">
                        {new Date(s.last_run).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                    ) : (
                      <span className="text-xs text-primary">New</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <DownloadFlow
        open={downloadOpen}
        onClose={() => setDownloadOpen(false)}
        supplierId="all"
        suppliers={suppliers}
        onComplete={loadData}
      />
    </div>
  );
}