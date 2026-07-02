import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Mail, Folder, LogOut, CheckCircle2, Shield } from 'lucide-react';

export default function Settings() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const handleLogout = async () => {
    await base44.auth.logout();
  };

  return (
    <div className="p-6 sm:p-8 lg:p-12 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage your account and connected services</p>
      </div>

      <div className="space-y-6">
        {/* Account */}
        <Card>
          <CardHeader><CardTitle className="text-base">Account</CardTitle></CardHeader>
          <CardContent>
            {user ? (
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-lg font-semibold text-primary">
                    {(user.full_name || user.email || 'U').charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <p className="font-medium">{user.full_name || 'User'}</p>
                  <p className="text-sm text-muted-foreground">{user.email}</p>
                </div>
              </div>
            ) : (
              <div className="h-12 bg-muted rounded-lg animate-pulse" />
            )}
          </CardContent>
        </Card>

        {/* Connections */}
        <Card>
          <CardHeader><CardTitle className="text-base">Google Connections</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-4 rounded-xl border">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-red-50 dark:bg-red-950/30 flex items-center justify-center">
                  <Mail className="h-5 w-5 text-red-600" />
                </div>
                <div>
                  <p className="font-medium text-sm">Gmail</p>
                  <p className="text-xs text-muted-foreground">Read-only access for searching PDFs</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 text-sm text-green-600 font-medium">
                <CheckCircle2 className="h-4 w-4" /> Connected
              </span>
            </div>
            <div className="flex items-center justify-between p-4 rounded-xl border">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-yellow-50 dark:bg-yellow-950/30 flex items-center justify-center">
                  <Folder className="h-5 w-5 text-yellow-600" />
                </div>
                <div>
                  <p className="font-medium text-sm">Google Drive</p>
                  <p className="text-xs text-muted-foreground">Full access for saving and merging PDFs</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 text-sm text-green-600 font-medium">
                <CheckCircle2 className="h-4 w-4" /> Connected
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Privacy */}
        <Card>
          <CardHeader><CardTitle className="text-base">Privacy & Security</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-start gap-3 p-4 rounded-xl bg-muted/30">
              <Shield className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">Your data stays yours</p>
                <p className="text-xs text-muted-foreground mt-1">
                  This app only accesses Gmail to search for PDF attachments and Google Drive to save files. No email content is stored.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Logout */}
        <Card>
          <CardContent className="p-4">
            <Button variant="destructive" onClick={handleLogout} className="gap-2 w-full sm:w-auto">
              <LogOut className="h-4 w-4" /> Log Out
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}