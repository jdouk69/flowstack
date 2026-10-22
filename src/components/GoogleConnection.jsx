import { useResultReveal } from '@/hooks/useResultReveal';
import { useEffect, useRef, useState } from 'react';
import { request } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';

const authorizationMessages = {
  cancelled: 'Google authorization was cancelled.',
  invalid_client: 'Google rejected the client ID or client secret. Use Replace client credentials and paste the values copied directly from Google Cloud.',
  unauthorized_client: 'Google rejected this OAuth client type. Check that this is a Web application.',
  invalid_grant: 'Google rejected the authorization code. Start a fresh connection; check the exact redirect address if it repeats.',
  token_exchange_failed: 'Google authorization failed. Try a fresh connection.',
  gmail_access_failed: 'Google authorization reached the Gmail access check, but Gmail rejected or could not complete that check. Confirm Gmail API is enabled in your Google Cloud project.',
  connection_save_failed: 'Google access succeeded, but FlowStack could not save the connection. Please report this app error.',
  wrong_account: 'Choose jimdoukakis@gmail.com.',
  missing_permissions: 'Grant all requested Gmail, Drive, and spreadsheet permissions.',
  invalid_state: 'This connection attempt expired or was already used. Try Connect again.',
  failed: 'Google authorization could not be completed. Check the client credentials and redirect address.',
};

export default function GoogleConnection() {
  const reveal = useResultReveal();
  const feedback = useRef(null);
  const [changing, setChanging] = useState(false);
  const [status, setStatus] = useState(null);
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState('info');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const refresh = () => request('/google/status').then(setStatus);

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    const result = new URLSearchParams(window.location.search).get('google');
    if (result) {
      const nextMessage = result === 'connected'
        ? 'Google authorization saved. Run the connection test below.'
        : authorizationMessages[result] || 'Check your Google connection.';
      window.requestAnimationFrame(() => {
        setMessage(nextMessage);
        setMessageTone(result === 'connected' ? 'info' : 'error');
      });
      window.history.replaceState(null, '', '/settings');
    }
  }, []);

  useEffect(() => {
    if (message || error) reveal(feedback);
  }, [message, error, reveal]);

  const act = async (action) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    setMessageTone('info');
    try {
      const result = await request(`/google/${action}`, {
        method: 'POST',
        body: JSON.stringify(action === 'configure'
          ? { client_id: clientId.trim(), client_secret: secret.trim() }
          : {}),
      });
      if (action === 'configure') {
        setClientId('');
        setSecret('');
        setChanging(false);
        setMessage('Credentials saved securely. Now connect your Google account.');
        setMessageTone('success');
      } else if (action === 'start') {
        window.location.assign(result.url);
        return;
      } else {
        setMessage(result.message || 'Done.');
        setMessageTone('info');
      }
      await refresh();
    } catch (e) {
      setError(e.message);
      setMessageTone('error');
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const feedbackContent = (
    <div ref={feedback} tabIndex={-1} aria-live="polite" className="space-y-1">
      {error && <p role="alert" className="text-sm break-words text-red-700">{error}</p>}
      {message && (
        <p
          role="status"
          className={`text-sm break-words ${
            messageTone === 'success'
              ? 'text-green-700 dark:text-green-400'
              : messageTone === 'error'
                ? 'text-red-700 dark:text-red-400'
                : 'text-muted-foreground'
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm">
        Connect your personal Google account: <strong>jimdoukakis@gmail.com</strong>. ChatGPT sign-in continues to protect this app.
      </p>
      <p className="text-sm text-muted-foreground">
                Permissions: read Gmail and Drive, save original attachments to supplier folders, and update the configured audit spreadsheet.
      </p>
      {!status?.connected && feedbackContent}
      {!status && !error && <p>Checking connection…</p>}
      {status && (
        <>
          <p className="text-sm font-medium">
            {status.connected
              ? `Google account connected: ${status.email}`
              : status.configured
                ? 'Credentials saved — Google authorization needed'
                : 'Google setup needed'}
          </p>
          {(!status.configured || changing) && (
            <form
              onSubmit={(e) => { e.preventDefault(); act('configure'); }}
              className="space-y-3"
            >
              <label className="block text-sm">
                Google OAuth client ID
                <input autoComplete="off" required disabled={busy} className="mt-1 w-full rounded-lg border p-2 bg-background" value={clientId} onChange={(e) => setClientId(e.target.value)} />
              </label>
              <label className="block text-sm">
                Google OAuth client secret
                <input type="password" autoComplete="off" required disabled={busy} className="mt-1 w-full rounded-lg border p-2 bg-background" value={secret} onChange={(e) => setSecret(e.target.value)} />
              </label>
              <p className="text-xs text-muted-foreground">
                Paste credentials here privately. They are encrypted on the server and never displayed after saving. Do not put them in a screenshot.
              </p>
              <Button disabled={busy} type="submit">Save Google credentials</Button>
            </form>
          )}
          {status.connected && !status.spreadsheet_authorized && (
            <p role="status" className="text-sm text-amber-700">
              One-time setup: reconnect Google and grant the spreadsheet permission so FlowStack can update your existing Tournas master audit.
            </p>
          )}
          {status.configured && !status.connected && (
            <Button variant="outline" disabled={busy} onClick={() => setChanging((v) => !v)}>
              Replace client credentials
            </Button>
          )}
          {status.configured && status.connected ? (
            <div className="flex flex-wrap items-start gap-3">
              <Button disabled={busy} onClick={() => act('start')}>
                {status.spreadsheet_authorized ? 'Reconnect Google' : 'Authorize spreadsheet access'}
              </Button>
              <div className="min-w-0 max-w-full space-y-2">
                <Button asChild variant="outline"><Link to="/connection-checks">Open Connection Checks</Link></Button>
                {feedbackContent}
              </div>
              <Button disabled={busy} variant="outline" onClick={() => act('disconnect')}>
                Disconnect Google
              </Button>
            </div>
          ) : status.configured ? (
            <Button disabled={busy} onClick={() => act('start')}>Connect Google</Button>
          ) : null}
        </>
      )}
    </div>
  );
}
