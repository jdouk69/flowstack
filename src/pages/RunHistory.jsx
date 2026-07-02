import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { History as HistoryIcon, ExternalLink } from 'lucide-react';

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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Run History</h1>
        <p className="text-muted-foreground text-sm mt-1">Log of all PDF download runs</p>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : history.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <HistoryIcon className="h-12 w-12 mx-auto mb-3 opacity-40" />
            <p className="text-muted-foreground">No runs yet.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50">
                  <tr>
                    <th className="text-left p-3 font-medium">Date</th>
                    <th className="text-left p-3 font-medium">Supplier</th>
                    <th className="text-center p-3 font-medium">Emails</th>
                    <th className="text-center p-3 font-medium">PDFs Saved</th>
                    <th className="text-center p-3 font-medium">Duplicates</th>
                    <th className="text-center p-3 font-medium">Errors</th>
                    <th className="text-center p-3 font-medium">Folder</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(run => (
                    <tr key={run.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="p-3 whitespace-nowrap">{new Date(run.run_date).toLocaleString()}</td>
                      <td className="p-3 font-medium">{run.supplier_name}</td>
                      <td className="p-3 text-center">{run.emails_found}</td>
                      <td className="p-3 text-center text-green-600 font-medium">{run.pdfs_saved}</td>
                      <td className="p-3 text-center text-amber-600">{run.duplicates_skipped}</td>
                      <td className="p-3 text-center text-red-600">{run.errors}</td>
                      <td className="p-3 text-center">
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
            <div className="sm:hidden divide-y">
              {history.map(run => (
                <div key={run.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{run.supplier_name}</span>
                    <span className="text-xs text-muted-foreground">{new Date(run.run_date).toLocaleDateString()}</span>
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