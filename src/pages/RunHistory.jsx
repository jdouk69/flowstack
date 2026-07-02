import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import Skeleton from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import { History as HistoryIcon, ExternalLink, CheckCircle, AlertCircle } from 'lucide-react';

export default function RunHistory() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    base44.entities.RunHistory.list('-run_date', 100)
      .then(setHistory)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 sm:p-8 lg:p-12 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Run History</h1>
        <p className="text-muted-foreground text-sm mt-1">A log of all your PDF download runs</p>
      </div>

      {loading ? (
        <Card>
          <CardContent className="p-0">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="p-4 border-b last:border-0">
                <Skeleton className="h-12 w-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : history.length === 0 ? (
        <Card>
          <CardContent className="py-16">
            <EmptyState
              icon={HistoryIcon}
              title="No download history yet"
              description="When you download PDFs, each run will be logged here with stats and links to your Google Drive folders."
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30">
                  <tr>
                    <th className="text-left p-4 font-medium text-muted-foreground">Date</th>
                    <th className="text-left p-4 font-medium text-muted-foreground">Supplier</th>
                    <th className="text-center p-4 font-medium text-muted-foreground">Emails</th>
                    <th className="text-center p-4 font-medium text-muted-foreground">Saved</th>
                    <th className="text-center p-4 font-medium text-muted-foreground">Duplicates</th>
                    <th className="text-center p-4 font-medium text-muted-foreground">Errors</th>
                    <th className="text-center p-4 font-medium text-muted-foreground">Folder</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(run => (
                    <tr key={run.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="p-4 whitespace-nowrap text-muted-foreground">
                        {new Date(run.run_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        <span className="text-xs block">{new Date(run.run_date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
                      </td>
                      <td className="p-4 font-medium">{run.supplier_name}</td>
                      <td className="p-4 text-center">{run.emails_found}</td>
                      <td className="p-4 text-center">
                        <span className="inline-flex items-center gap-1 text-green-600 font-medium">
                          {run.pdfs_saved > 0 && <CheckCircle className="h-3.5 w-3.5" />}
                          {run.pdfs_saved}
                        </span>
                      </td>
                      <td className="p-4 text-center text-amber-600">{run.duplicates_skipped}</td>
                      <td className="p-4 text-center">
                        {run.errors > 0 ? <span className="text-red-600 inline-flex items-center gap-1"><AlertCircle className="h-3.5 w-3.5" />{run.errors}</span> : '—'}
                      </td>
                      <td className="p-4 text-center">
                        {run.drive_folder_link && (
                          <a href={run.drive_folder_link} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                            Open <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden divide-y">
              {history.map(run => (
                <div key={run.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{run.supplier_name}</span>
                    <span className="text-xs text-muted-foreground">{new Date(run.run_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center text-xs">
                    <div><div className="text-muted-foreground">Emails</div><div className="font-semibold">{run.emails_found}</div></div>
                    <div><div className="text-muted-foreground">Saved</div><div className="font-semibold text-green-600">{run.pdfs_saved}</div></div>
                    <div><div className="text-muted-foreground">Dupes</div><div className="font-semibold text-amber-600">{run.duplicates_skipped}</div></div>
                    <div><div className="text-muted-foreground">Errors</div><div className="font-semibold text-red-600">{run.errors}</div></div>
                  </div>
                  {run.drive_folder_link && (
                    <a href={run.drive_folder_link} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                      Open Drive folder <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}