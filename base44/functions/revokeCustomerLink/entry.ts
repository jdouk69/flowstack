import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { getDriveAuth, removeAnyonePermissions } from '../../shared/linkSharing.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    if (!body.link_id) return Response.json({ error: 'link_id is required' }, { status: 400 });

    const driveAuth = await getDriveAuth(base44);
    const record = await base44.entities.CustomerLink.get(body.link_id);
    if (!record) return Response.json({ error: 'NOT_FOUND', message: 'Link record not found.' }, { status: 404 });

    const history = Array.isArray(record.history) ? [...record.history] : [];
    let removed = 0;

    if (record.copy_id) {
      try {
        removed = await removeAnyonePermissions(driveAuth, record.copy_id);
      } catch (e) {
        await base44.entities.CustomerLink.update(record.id, {
          status: 'incomplete',
          history: [...history, { event: 'revoke_failed', date: new Date().toISOString(), detail: e.message }]
        });
        return Response.json({ error: 'REVOKE_FAILED', message: e.message }, { status: 502 });
      }
    }

    await base44.entities.CustomerLink.update(record.id, {
      status: 'revoked',
      history: [...history, { event: 'link_revoked', date: new Date().toISOString(), detail: `${removed} public permission(s) removed and verified` }]
    });

    return Response.json({
      status: 'revoked',
      verified: true,
      removed,
      note: 'Copies already downloaded by a customer cannot be recalled. Original PDFs and the supplier folder are untouched.'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});