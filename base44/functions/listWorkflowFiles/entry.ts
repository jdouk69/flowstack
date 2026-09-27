import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveWorkflowFolder, FolderResolutionError } from '../../shared/resolveWorkflowFolder.ts';

async function listFilesInFolder(driveAuth, folderId) {
  const files = [];
  let pageToken = null;
  const fields = 'files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink,appProperties),nextPageToken';
  do {
    let url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed=false`)}&fields=${encodeURIComponent(fields)}&pageSize=200&orderBy=name`;
    if (pageToken) url += `&pageToken=${pageToken}`;
    const res = await fetch(url, { headers: driveAuth });
    if (!res.ok) throw new Error('Failed to list Drive files');
    const data = await res.json();
    (data.files || []).forEach(f => files.push(f));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return files;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json();
    const { supplier_id } = body;
    if (!supplier_id) return Response.json({ error: 'supplier_id is required' }, { status: 400 });

    // User-scoped entity access — only the owner can read their workflow
    const supplier = await base44.entities.Supplier.get(supplier_id);

    const { accessToken: driveToken } = await base44.asServiceRole.connectors.getConnection('googledrive');
    const driveAuth = { Authorization: `Bearer ${driveToken}` };

    const folderName = supplier.drive_folder_name;
    let folderId;
    try {
      const resolved = await resolveWorkflowFolder(driveAuth, base44, supplier, { allowCreate: false });
      folderId = resolved.folderId;
      if (resolved.bound) await base44.entities.Supplier.update(supplier_id, { drive_folder_id: folderId });
    } catch (err) {
      const status = err instanceof FolderResolutionError
        ? (err.code === 'FOLDER_NOT_FOUND' ? 404 : 409)
        : 500;
      return Response.json({
        error: err.code || 'FOLDER_ERROR',
        message: err.message,
        ...(err.details || {})
      }, { status });
    }

    const files = await listFilesInFolder(driveAuth, folderId);

    const formatted = files.map(f => ({
      id: f.id,
      name: f.name,
      mime_type: f.mimeType || 'application/octet-stream',
      size: parseInt(f.size || '0', 10),
      created_date: f.createdTime || null,
      modified_date: f.modifiedTime || null,
      web_view_link: f.webViewLink,
      source_dates: {
        email_received: f.appProperties?.source_email_received || null,
        pdf_creation_date: f.appProperties?.source_pdf_creation || null
      },
      is_pdf: f.mimeType === 'application/pdf'
    }));

    const pdfCount = formatted.filter(f => f.is_pdf).length;

    return Response.json({
      workflow_name: supplier.name,
      folder_id: folderId,
      folder_name: folderName,
      folder_link: `https://drive.google.com/drive/folders/${folderId}`,
      files: formatted,
      total_files: formatted.length,
      total_pdfs: pdfCount
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});