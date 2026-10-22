import { useState, useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Home, FileText, History, Settings as SettingsIcon, LogOut, Menu, X, ChevronDown } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import Logo from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/useTheme';

const navItems = [
  { path: '/', label: 'Dashboard', icon: Home },
  { path: '/attention', label: 'Needs attention', icon: FileText },
  { path: '/invoices', label: 'Invoices', icon: FileText },
  { path: '/reports', label: 'Reports', icon: FileText },
];

const advancedItems = [
  { path: '/rules', label: 'Workflows', icon: FileText },
  { path: '/analysis', label: 'Analysis', icon: FileText },
  { path: '/suppliers', label: 'Suppliers', icon: FileText },
  { path: '/audit', label: 'Audit Findings', icon: FileText },
  { path: '/purchases', label: 'Purchase history', icon: FileText },
  { path: '/reconciliation', label: 'Reconciliation', icon: FileText },
  { path: '/documents', label: 'Combine PDFs', icon: FileText },
  { path: '/shared-packages', label: 'Shared packages', icon: FileText },
  { path: '/run-history', label: 'History', icon: History },
  { path: '/settings', label: 'Settings', icon: SettingsIcon },
];

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState(null);
  const { isDark } = useTheme();
  const location = useLocation();
  const auditLayout = location.pathname === '/' || location.pathname.startsWith('/audit');

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    await base44.auth.logout();
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile header */}
      <header className={`${auditLayout ? 'audit-topbar' : 'lg:hidden'} fixed top-0 inset-x-0 z-40 h-14 border-b bg-background/80 backdrop-blur-lg flex items-center px-4`}>
        <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)} className="mr-2" aria-label="Open menu">
          <Menu className="h-5 w-5" />
        </Button>
        <Link to="/">
          <Logo size="sm" />
        </Link>
        {auditLayout && <nav className="audit-topnav" aria-label="Audit navigation">{[['/','Dashboard'],['/attention','Needs attention'],['/invoices','Invoices'],['/reports','Reports']].map(([to,label])=><Link key={to} to={to} aria-current={location.pathname===to?'page':undefined}>{label}</Link>)}</nav>}
      </header>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className={`${auditLayout ? '' : 'lg:hidden'} fixed inset-0 z-50 bg-black/40 backdrop-blur-sm`} onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed top-0 bottom-0 left-0 z-50 flex h-[100dvh] w-64 flex-col overflow-hidden bg-background border-r transition-transform duration-300 ${auditLayout ? '' : 'lg:translate-x-0'} ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="h-16 shrink-0 flex items-center justify-between px-5 border-b">
          <Link to="/">
            <Logo size="md" />
          </Link>
          <Button variant="ghost" size="icon" className={auditLayout ? '' : 'lg:hidden'} onClick={() => setSidebarOpen(false)} aria-label="Close menu">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pb-4 space-y-1 [scrollbar-gutter:stable]" style={{ WebkitOverflowScrolling: 'touch' }}>
          {navItems.map(item => {
            const Icon = item.icon;
            const active = location.pathname === item.path;
            return (
              <Link key={item.path} to={item.path}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}>
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
          <details className="mt-2 border-t pt-2">
            <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
              <span>More tools</span><ChevronDown className="h-4 w-4" />
            </summary>
            <div className="mt-1 space-y-1">
              {advancedItems.map(item => {
                const Icon = item.icon;
                const active = location.pathname === item.path || (item.path === '/audit' && location.pathname.startsWith('/audit'));
                return (
                  <Link key={item.path} to={item.path}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}>
                    <Icon className="h-4 w-4" />{item.label}
                  </Link>
                );
              })}
            </div>
          </details>
        </nav>

        <div className="shrink-0 border-t px-3 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)]">
          {user && (
            <div className="flex items-center gap-3 px-3 py-2 mb-1">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-xs font-semibold text-primary">
                  {(user.full_name || user.email || 'U').charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user.full_name || 'User'}</p>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
            </div>
          )}
          <Button variant="ghost" className="w-full justify-start gap-3 text-muted-foreground" onClick={handleLogout}>
            <LogOut className="h-4 w-4" />
            Log Out
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className={auditLayout ? "audit-main pt-14 min-h-screen" : "lg:ml-64 pt-14 lg:pt-0 min-h-screen"}>
        <details className={auditLayout ? "audit-connection-notice" : "m-4"}><summary>Automation and collection status</summary><div role="status" className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Automatic scheduled monitoring is currently off. From Dashboard, use <strong>Run invoice check now</strong> to process the active vendor workflows. To collect Gmail attachments, open <Link className="underline font-semibold" to="/rules">Workflows</Link>; use <Link className="underline font-semibold" to="/attention">Needs attention</Link> for files FlowStack could not read. <Link className="underline font-semibold" to="/google-setup-later">Google setup directions</Link> are available. Manual uploads and PDF tools are under <Link className="underline font-semibold" to="/documents">More tools → Documents</Link>.</div></details><Outlet />
      </main>
    </div>
  );
}
