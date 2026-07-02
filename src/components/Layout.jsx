import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, History, Settings as SettingsIcon, LogOut, Menu, X, FileText } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/suppliers', label: 'Suppliers', icon: Users },
  { path: '/run-history', label: 'Run History', icon: History },
  { path: '/settings', label: 'Settings', icon: SettingsIcon },
];

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  const handleLogout = async () => {
    await base44.auth.logout();
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-background border-b h-14 flex items-center px-4">
        <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)}>
          <Menu className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2 ml-2">
          <FileText className="h-5 w-5 text-primary" />
          <span className="font-semibold">PDF Organizer</span>
        </div>
      </div>

      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/50" onClick={() => setSidebarOpen(false)} />
      )}
      <aside className={`fixed top-0 left-0 z-50 h-full w-64 bg-background border-r transition-transform lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="h-14 flex items-center justify-between px-4 border-b">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <FileText className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold">PDF Organizer</span>
          </div>
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <nav className="p-3 space-y-1">
          {navItems.map(item => {
            const Icon = item.icon;
            const active = location.pathname === item.path;
            return (
              <Link key={item.path} to={item.path} onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="absolute bottom-0 left-0 right-0 p-3 border-t">
          <Button variant="ghost" className="w-full justify-start gap-3 text-muted-foreground" onClick={handleLogout}>
            <LogOut className="h-4 w-4" />
            Logout
          </Button>
        </div>
      </aside>

      <main className="lg:ml-64 pt-14 lg:pt-0 min-h-screen">
        <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}