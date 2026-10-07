import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import Skeleton from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import { Link2, Copy, ExternalLink, ShieldOff, RefreshCw, FileText, Trash2, HardDrive, Info, CheckCircle2 } from 'lucide-react';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'merged', label: 'Merged PDFs' },
  { value: 'links', label: 'Customer links' },
];

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const STATUS_STYLES = {
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  incomplete: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  revoked: 'bg-muted text-muted-foreground',
};

export default function Documents() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [merged, setMerged] = useState([]);
  const [links, setLinks] = useState([]);
  const [filter, setFilter] = useState('all');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mergedRes, linksRes] = await Promise.all([
        base44.functions.invoke('listMergedOutputs', {}),
        base44.entities.CustomerLink.list('-created_date', 100),
      ]);
      setMerged(mergedRes.data.outputs || []);
      setLinks(linksRes || []);
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Could not load documents.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const activeLinkBySource = {};
  links.filter(l => l.status === 'active' && l.copy_id).forEach(l => {
    if (!activeLinkBySource[l.source_file_id]) activeLinkBySource[l.source_file_id] = l;
  });

  const copyLink = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: 'Link copied' });
    } catch (e) {
      toast({ title: 'Could not copy the link' });
    }
  };

  const createLinkFor = async (file) => {
    setBusyId(file.id);
    try {
      await base44.functions.invoke('createCustomerLink', {
        file_id: file.id,
        supplier_id: file.supplier_id,
        supplier_name: file.supplier_name,
      });
      toast({ title: 'Customer link created' });
      await load();
    } catch (e) {
      toast({ title: 'Link failed', description: e.response?.data?.message || e.message || 'Try again — nothing was lost.' });
    }
    setBusyId(null);
  };

  const retryLink = async (link) => {
    setBusyId(link.id);
    try {
      await base44.functions.invoke('createCustomerLink', { link_id: link.id });
      toast({ title: 'Link ready' });
      await load();
    } catch (e) {
      toast({ title: 'Retry failed', description: e.response?.data?.message || e.message || 'Try again — nothing was lost.' });
    }
    setBusyId(null);
  };

  const revokeLink = async (link) => {
    setBusyId(link.id);
    try {
      const res = await base44.functions.invoke('revokeCustomerLink', { link_id: link.id });
      toast({ title: 'Link revoked', description: res.data?.note || 'Anonymous access removed and verified.' });
      await load();
    } catch (e) {
      toast({ title: 'Revoke failed', description: e.response?.data?.message || e.message || 'Try again.' });
    }
    setBusyId(null);
  };

  const deleteLink = async (link) => {
    setBusyId(link.id);
    try {
      await base44.entities.CustomerLink.delete(link.id);
      await load();
    } catch (e) {
      toast({ title: 'Could not delete the record' });
    }
    setBusyId(null);
  };

  const showMerged = filter === 'all' || filter === 'merged';
  const showLinks = filter === 'all' || filter === 'links';

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Documents</h1>
        <p className="text-sm text-muted-foreground mt-1">Merged PDFs saved to Drive and the customer links you've shared.</p>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {FILTERS.map(f => (
          <Button key={f.value} size="sm" variant={filter === f.value ? 'default' : 'outline'} onClick={() => setFilter(f.value)}>
            {f.label}
            {f.value === 'merged' && merged.length > 0 && <span className="ml-1 opacity-70">({merged.length})</span>}
            {f.value === 'links' && links.length > 0 && <span className="ml-1 opacity-70">({links.length})</span>}
          </Button>
        ))}
      </div>

      <div role="note" className="flex gap-3 p-3 mb-6 rounded-xl bg-muted/50 border">
        <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground">
          Customer links do not expire automatically — revoke them manually when you're done.
          Copies a customer has already downloaded cannot be recalled, and separately granted permissions may remain.
          Links are only applied to a dedicated customer copy; your originals and supplier folders stay private.
        </p>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
        </div>
      ) : error ? (
        <div className="py-12">
          <EmptyState icon={HardDrive} title="Something went wrong" description={error}
            action={<Button variant="outline" size="sm" onClick={load} className="gap-2"><RefreshCw className="h-3.5 w-3.5" /> Try Again</Button>} />
        </div>
      ) : (showMerged && merged.length === 0 && showLinks && links.length === 0) ? (
        <div className="py-12">
          <EmptyState
            icon={FileText}
            title="No documents yet"
            description="Merge PDFs from a workflow folder and the results will appear here, along with any customer links you create."
          />
        </div>
      ) : (
        <div className="space-y-8">
          {showMerged && merged.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Merged PDFs</h2>
              <div className="space-y-2">
                {merged.map(file => {
                  const link = activeLinkBySource[file.id];
                  return (
                    <div key={file.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-xl border bg-card">
                      <FileText className="h-5 w-5 text-red-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{file.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {file.supplier_name} · {formatSize(file.size)} · {formatDate(file.created_date)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 shrink-0">
                        {link ? (
                          <>
                            <Button size="sm" className="gap-2" onClick={() => copyLink(link.download_url)}>
                              <Copy className="h-3.5 w-3.5" /> Copy customer link
                            </Button>
                            <Button size="sm" variant="outline" className="gap-2" asChild>
                              <a href={link.share_url} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-3.5 w-3.5" /> Manage sharing
                              </a>
                            </Button>
                            <Button size="sm" variant="ghost" className="gap-2 text-destructive hover:text-destructive" disabled={busyId === link.id} onClick={() => revokeLink(link)}>
                              <ShieldOff className="h-3.5 w-3.5" /> Revoke
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" className="gap-2" disabled={busyId === file.id} onClick={() => createLinkFor(file)}>
                            {busyId === file.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                            Create customer link
                          </Button>
                        )}
                        <Button size="sm" variant="outline" className="gap-2" asChild>
                          <a href={file.web_view_link} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-3.5 w-3.5" /> Open
                          </a>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {showLinks && links.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Customer links</h2>
              <div className="space-y-2">
                {links.map(link => (
                  <div key={link.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-xl border bg-card">
                    <Link2 className="h-5 w-5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{link.copy_name || link.source_name}</p>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${STATUS_STYLES[link.status] || STATUS_STYLES.revoked}`}>
                          {link.status}
                        </span>
                        {link.status === 'active' && link.verified && (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" aria-label="Copy verified against source" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {link.supplier_name ? `${link.supplier_name} · ` : ''}source: {link.source_name} · created {formatDate(link.created_date)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                      {link.status === 'active' && (
                        <>
                          <Button size="sm" className="gap-2" onClick={() => copyLink(link.download_url)}>
                            <Copy className="h-3.5 w-3.5" /> Copy customer link
                          </Button>
                          <Button size="sm" variant="outline" className="gap-2" asChild>
                            <a href={link.share_url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-3.5 w-3.5" /> Open customer copy
                            </a>
                          </Button>
                          <Button size="sm" variant="ghost" className="gap-2 text-destructive hover:text-destructive" disabled={busyId === link.id} onClick={() => revokeLink(link)}>
                            <ShieldOff className="h-3.5 w-3.5" /> Revoke
                          </Button>
                        </>
                      )}
                      {(link.status === 'pending' || link.status === 'incomplete') && (
                        <>
                          <Button size="sm" className="gap-2" disabled={busyId === link.id} onClick={() => retryLink(link)}>
                            <RefreshCw className="h-3.5 w-3.5" /> Retry
                          </Button>
                          <Button size="sm" variant="ghost" className="gap-2 text-muted-foreground" disabled={busyId === link.id} onClick={() => deleteLink(link)}>
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                          </Button>
                        </>
                      )}
                      {link.status === 'revoked' && (
                        <Button size="sm" variant="ghost" className="gap-2 text-muted-foreground" disabled={busyId === link.id} onClick={() => deleteLink(link)}>
                          <Trash2 className="h-3.5 w-3.5" /> Delete record
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}