import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Mail, Folder, LogOut, User, CheckCircle2 } from 'lucide-react';

export default function Settings() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const handleLogout = async () => {
    await base44.auth.logout();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage your account and connections</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Account</CardTitle></CardHeader>
        <CardContent>
          {user ? (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
                <User className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <p className="font-medium">{user.full_name || 'User'}</p>
                <p className="text-sm text-muted-foreground">{user.email}</p>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">Loading...</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Google Connections</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-lg border">
            <div className="flex items-center gap-3">
              <Mail className="h-5 w-5 text-primary" />
              <div>
                <p className="font-medium text-sm">Gmail</p>
                <p className="text-xs text-muted-foreground">Read-only access for searching PDFs</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 text-sm text-green-600">
              <CheckCircle2 className="h-4 w-4" /> Connected
            </span>
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg border">
            <div className="flex items-center gap-3">
              <Folder className="h-5 w-5 text-primary" />
              <div>
                <p className="font-medium text-sm">Google Drive</p>
                <p className="text-xs text-muted-foreground">Full access for saving and merging PDFs</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 text-sm text-green-600">
              <CheckCircle2 className="h-4 w-4" /> Connected
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <Button variant="destructive" onClick={handleLogout} className="gap-2 w-full sm:w-auto">
            <LogOut className="h-4 w-4" /> Logout
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}