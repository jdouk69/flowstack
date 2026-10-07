import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { getDriveAuth, getDriveFile, ensureAnyoneReader } from '../../shared/linkSharing.ts';

function downloadUrlFor(copyId) {
  return `https://drive.google.com/uc?export=download&id=${copyId}`;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const driveAuth = await getDriveAuth(base44);

    // Resolve or create the link record.
    let record = null;
    if (body.link_id) {
      record = await base44.entities.CustomerLink.get(body.link_id);
      if (!record) return Response.json({ error: 'NOT_FOUND', message: 'Link record not found.' }, { status: 404 });
    } else if (body.file_id) {
      // Idempotency: reuse an existing non-revoked link for this source owned by this user (retries never duplicate copies).
      const existing = await base44.entities.CustomerLink.filter({ source_file_id: body.file_id }, '-created_date', 5);
      const mine = (existing || []).find(l => l.created_by_id === user.id && l.status !== 'revoked');
      if (mine) record = mine;
    } else {
      return Response.json({ error: 'file_id or link_id is required' }, { status: 400 });
    }

    const history = Array.isArray(record?.history) ? [...record.history] : [];
    const addHistory = (event, detail = '') => history.push({ event, date: new Date().toISOString(), detail });

    if (!record) {
      const source = await getDriveFile(driveAuth, body.file_id, 'id,name,size,md5Checksum,mimeType,trashed');
      if (!source || source.trashed) {
        return Response.json({ error: 'SOURCE_NOT_FOUND', message: 'The source PDF was not found in Drive.' }, { status: 404 });
      }
      if (source.mimeType !== 'application/pdf') {
        return Response.json({ error: 'NOT_A_PDF', message: 'Customer links are only available for PDF files.' }, { status: 400 });
      }
      const baseName = source.name.replace(/\.pdf$/i, '');
      record = await base44.entities.CustomerLink.create({
        supplier_id: body.supplier_id || '',
        supplier_name: body.supplier_name || '',
        source_file_id: source.id,
        source_name: source.name,
        source_size: parseInt(source.size || '0', 10),
        status: 'pending',
        copy_id: '',
        copy_name: `${baseName} (Customer Copy).pdf`,
        share_url: '',
        download_url: '',
        verified: false,
        history: [{ event: 'link_created', date: new Date().toISOString(), detail: source.name }]
      });
    }

    // Step 1: dedicated customer copy in Drive (server-side copy, never routed through the user's device).
    // The copy id is persisted BEFORE anything else so retries reuse it.
    let copyId = record.copy_id;
    let copy = copyId ? await getDriveFile(driveAuth, copyId) : null;
    if (!copy || copy.trashed) {
      const copyRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${record.source_file_id}/copy?fields=id,name,md5Checksum`,
        {
          method: 'POST',
          headers: { ...driveAuth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: record.copy_name || `${record.source_name.replace(/\.pdf$/i, '')} (Customer Copy).pdf` })
        }
      );
      if (!copyRes.ok) {
        await base44.entities.CustomerLink.update(record.id, {
          status: 'incomplete',
          history: [...history, { event: 'copy_failed', date: new Date().toISOString(), detail: `HTTP ${copyRes.status}` }]
        });
        return Response.json({
          error: 'COPY_FAILED',
          message: `Google Drive could not create the customer copy (HTTP ${copyRes.status}). The merge is safe — retry the link from Documents.`
        }, { status: 502 });
      }
      copy = await copyRes.json();
      copyId = copy.id;
      await base44.entities.CustomerLink.update(record.id, { copy_id: copyId, copy_name: copy.name, status: 'pending' });
      addHistory('copy_created', copyId);
    }

    // Step 2: anyone-with-the-link Viewer permission on the COPY only (originals and folders stay private).
    try {
      await ensureAnyoneReader(driveAuth, copyId);
    } catch (e) {
      await base44.entities.CustomerLink.update(record.id, {
        status: 'incomplete',
        history: [...history, { event: 'share_failed', date: new Date().toISOString(), detail: e.message }]
      });
      return Response.json({
        error: 'SHARE_FAILED',
        message: `${e.message} The customer copy exists — retry from Documents.`,
        copy_id: copyId
      }, { status: 502 });
    }

    // Step 3: verify the copy against the source before reporting success.
    const sourceMeta = await getDriveFile(driveAuth, record.source_file_id, 'id,size,md5Checksum');
    const copyMeta = await getDriveFile(driveAuth, copyId, 'id,name,size,md5Checksum,webViewLink');
    const sourceSize = parseInt(sourceMeta?.size || '0', 10) || record.source_size;
    const copySize = parseInt(copyMeta?.size || '0', 10);
    const verified = !!(sourceSize && copySize && sourceSize === copySize);
    if (!verified) addHistory('verify_failed', `source ${sourceSize} bytes / copy ${copySize} bytes`);

    const shareUrl = copyMeta?.webViewLink || `https://drive.google.com/file/d/${copyId}/view`;
    const downloadUrl = downloadUrlFor(copyId);

    await base44.entities.CustomerLink.update(record.id, {
      copy_id: copyId,
      copy_name: copyMeta?.name || record.copy_name,
      copy_size: copySize,
      share_url: shareUrl,
      download_url: downloadUrl,
      status: 'active',
      verified,
      history: [...history, { event: 'link_active', date: new Date().toISOString() }]
    });

    return Response.json({
      link_id: record.id,
      copy_id: copyId,
      copy_name: copyMeta?.name || record.copy_name,
      source_name: record.source_name,
      share_url: shareUrl,
      download_url: downloadUrl,
      verified,
      reused: !!body.link_id
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});