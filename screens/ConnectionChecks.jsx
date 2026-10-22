import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, CircleHelp, Loader2, XCircle } from 'lucide-react';
import { request } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const checks = [
  { id: 'gmail', kind: 'gmail', title: 'Gmail access', detail: 'Confirm FlowStack can read the connected Gmail account.' },
  ...['Tournas', 'Akron', 'Ergobeton'].flatMap((supplier) => [
    { id: `drive:${supplier}`, kind: 'drive', supplier, title: `${supplier} supplier Drive folder`, detail: 'Open the existing saved folder reference in read-only mode.' },
    { id: `sheet:${supplier}`, kind: 'spreadsheet', supplier, title: `${supplier} master spreadsheet`, detail: 'Read the existing spreadsheet title and tab list.' },
  ]),
];

const statusStyle = {
  'Pass': 'border-green-200 bg-green-50 text-green-800',
  'Needs attention': 'border-amber-200 bg-amber-50 text-amber-900',
  'Not tested': 'border-slate-200 bg-slate-50 text-slate-600',
};

function StatusIcon({ status }) {
  if (status === 'Pass') return <CheckCircle2 className="h-4 w-4" aria-hidden="true" />;
  if (status === 'Needs attention') return <XCircle className="h-4 w-4" aria-hidden="true" />;
  return <CircleHelp className="h-4 w-4" aria-hidden="true" />;
}

export default function ConnectionChecks() {
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(null);

  const runCheck = async (check) => {
    if (running) return;
    setRunning(check.id);
    try {
      const result = await request('/google/check', {
        method: 'POST',
        body: JSON.stringify({ kind: check.kind, supplier: check.supplier }),
      });
      setResults((current) => ({ ...current, [check.id]: result }));
    } catch (error) {
      setResults((current) => ({
        ...current,
        [check.id]: { status: 'Needs attention', message: error.message || 'The check could not be completed.', checked_at: new Date().toISOString() },
      }));
    } finally {
      setRunning(null);
    }
  };

  return (
    <main className="audit-page">
      <div className="audit-page-heading">
        <div>
          <div className="mb-2"><Link to="/settings" className="inline-flex items-center gap-2 text-sm text-primary"><ArrowLeft className="h-4 w-4" />Settings</Link></div>
          <h1>Connection Checks</h1>
          <p>Run one check at a time. Each check only reads the selected Google connection or saved file.</p>
        </div>
      </div>
      <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        These checks do not create or move Drive files, change spreadsheet rows or emails, process invoices, or change workflow schedules. Results are shown for this page session only.
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {checks.map((check) => {
          const result = results[check.id];
          const status = result?.status || 'Not tested';
          const date = result?.checked_at ? new Date(result.checked_at) : null;
          return (
            <Card key={check.id}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{check.title}</CardTitle>
                <p className="text-sm text-muted-foreground">{check.detail}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium ${statusStyle[status] || statusStyle['Needs attention']}`}>
                  {running === check.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <StatusIcon status={status} />}
                  {running === check.id ? 'Checking…' : status}
                </div>
                <p className="min-h-10 text-sm" aria-live="polite">{running === check.id ? 'Reading the selected connection…' : result?.message || 'This check has not been run.'}</p>
                <p className="text-xs text-muted-foreground">{date ? `Checked ${date.toLocaleString()}` : 'Time: —'}</p>
                <Button variant="outline" disabled={Boolean(running)} onClick={() => runCheck(check)}>
                  {running === check.id ? 'Checking…' : 'Run this check'}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </main>
  );
}
