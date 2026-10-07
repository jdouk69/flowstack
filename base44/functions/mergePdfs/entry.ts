import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { PDFDocument } from 'npm:pdf-lib@1.17.1';
import { resolveWorkflowFolder, FolderResolutionError } from '../../shared/resolveWorkflowFolder.ts';

async function listPdfsInFolder(driveAuth, folderId) {
  const pdfs = [];
  let pageToken = null;
  do {
    let url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed=false and mimeType='application/pdf'`)}&fields=files(id,name),nextPageToken&pageSize=200&orderBy=name`;
    if (pageToken) url += `&pageToken=${pageToken}`;
    const res = await fetch(url, { headers: driveAuth });
    if (!res.ok) throw new Error(`Failed to list PDFs in the Drive folder (HTTP ${res.status}).`);
    const data = await res.json();
    (data.files || []).forEach(f => pdfs.push(f));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return pdfs;
}

async function downloadFile(driveAuth, fileId) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: driveAuth });
  if (!res.ok) throw new Error('Failed to download file');
  return new Uint8Array(await res.arrayBuffer());
}

async function uploadFileToDrive(driveAuth, filename, folderId, data) {
  const metadata = { name: filename, parents: [folderId] };
  const boundary = '-------314159265358979323846';
  const delimiter = `--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const body = new Blob([
    delimiter + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) + '\r\n',
    delimiter + 'Content-Type: application/pdf\r\n\r\n',
    data,
    closeDelimiter
  ], { type: `multipart/related; boundary=${boundary}` });

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { ...driveAuth, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  });
  if (!res.ok) throw new Error('Failed to upload merged file');
  return await res.json();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json();
    const { supplier_id } = body;
    if (!supplier_id) return Response.json({ error: 'supplier_id is required' }, { status: 400 });

    const supplier = await base44.entities.Supplier.get(supplier_id);

    const { accessToken: driveToken } = await base44.asServiceRole.connectors.getConnection('googledrive');
    const driveAuth = { Authorization: `Bearer ${driveToken}` };

    let folderId;
    try {
      const resolved = await resolveWorkflowFolder(driveAuth, base44, supplier, { allowCreate: false });
      folderId = resolved.folderId;
      if (resolved.bound) await base44.entities.Supplier.update(supplier.id, { drive_folder_id: folderId });
    } catch (err) {
      const status = err instanceof FolderResolutionError
        ? (err.code === 'FOLDER_NOT_FOUND' ? 404 : 409)
        : 500;
      return Response.json({ error: err.code || 'FOLDER_ERROR', message: err.message, ...(err.details || {}) }, { status });
    }

    // Selection mode: merge exactly the chosen PDFs (never silently truncate).
    const fileIds = Array.isArray(body.file_ids) ? body.file_ids.filter(Boolean) : [];
    let toMerge = [];
    let selectionMode = false;

    if (fileIds.length > 0) {
      selectionMode = true;
      const valid = [];
      for (let i = 0; i < fileIds.length; i += 6) {
        const chunk = fileIds.slice(i, i + 6);
        const checks = await Promise.allSettled(chunk.map(id =>
          fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType,parents,trashed`, { headers: driveAuth, signal: AbortSignal.timeout(10000) })
            .then(r => r.ok ? r.json() : null)
        ));
        checks.forEach(c => {
          const f = c.status === 'fulfilled' ? c.value : null;
          if (f && !f.trashed && (f.parents || []).includes(folderId) && f.mimeType === 'application/pdf') valid.push(f);
        });
      }
      if (valid.length !== fileIds.length) {
        return Response.json({
          error: 'SELECTION_INVALID',
          message: `${fileIds.length - valid.length} of the selected files were missing, trashed, or not PDFs in this folder. Merge aborted — nothing was changed.`,
          found: valid.length,
          requested: fileIds.length
        }, { status: 400 });
      }
      if (valid.length < 2) {
        return Response.json({ error: 'Select at least 2 PDFs to merge' }, { status: 400 });
      }
      toMerge = valid;
    } else {
      const pdfs = await listPdfsInFolder(driveAuth, folderId);
      if (pdfs.length === 0) {
        return Response.json({ error: 'No PDFs found in folder' }, { status: 404 });
      }
      toMerge = pdfs.filter(p => !p.name.includes('_merged_'));
      if (toMerge.length === 0) {
        return Response.json({ error: 'No PDFs to merge' }, { status: 404 });
      }
    }

    const mergedPdf = await PDFDocument.create();
    let mergedCount = 0;
    const skipped = [];
    for (const pdf of toMerge) {
      try {
        const pdfBytes = await downloadFile(driveAuth, pdf.id);
        const doc = await PDFDocument.load(pdfBytes);
        const pages = await mergedPdf.copyPages(doc, doc.getPageIndices());
        pages.forEach(p => mergedPdf.addPage(p));
        mergedCount++;
      } catch (e) {
        skipped.push(pdf.name);
      }
    }

    if (mergedCount === 0) {
      return Response.json({ error: 'Failed to merge any PDFs' }, { status: 500 });
    }

    const mergedBytes = await mergedPdf.save();
    const dateStr = typeof body.date_str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date_str)
      ? body.date_str
      : new Date().toISOString().slice(0, 10);
    const mergedFilename = `${supplier.name}_merged_${dateStr}.pdf`;

    // Idempotent save: update an existing merged file with the same name instead of creating a duplicate.
    let uploadedId = null;
    const existingQ = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed=false and name='${mergedFilename.replace(/'/g, "\\'")}'`)}&fields=files(id)&pageSize=1`,
      { headers: driveAuth }
    );
    const existing = (await existingQ.json()).files || [];
    if (existing.length > 0) {
      const upRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existing[0].id}?uploadType=media`, {
        method: 'PATCH',
        headers: { ...driveAuth, 'Content-Type': 'application/pdf' },
        body: mergedBytes
      });
      if (!upRes.ok) throw new Error('Failed to update the existing merged file');
      uploadedId = existing[0].id;
    } else {
      const up = await uploadFileToDrive(driveAuth, mergedFilename, folderId, mergedBytes);
      uploadedId = up.id;
    }

    // Verify the saved file on Drive before reporting success.
    const verRes = await fetch(`https://www.googleapis.com/drive/v3/files/${uploadedId}?fields=id,size,md5Checksum`, { headers: driveAuth });
    const ver = await verRes.json();
    const verified = parseInt(ver.size || '0', 10) === mergedBytes.length;

    return Response.json({
      success: true,
      merged_filename: mergedFilename,
      merged_file_id: uploadedId,
      merged_size: mergedBytes.length,
      verified,
      pdf_count: mergedCount,
      selection_mode: selectionMode,
      requested_count: toMerge.length,
      skipped,
      drive_folder_link: `https://drive.google.com/drive/folders/${folderId}`
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});