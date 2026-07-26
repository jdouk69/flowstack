import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

function escapeDriveQuery(str) {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findFoldersByName(driveAuth, folderName) {
  const query = `name='${escapeDriveQuery(folderName)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`, { headers: driveAuth });
  if (!res.ok) throw new Error('Failed to search Google Drive folders');
  const data = await res.json();
  return data.files || [];
}

async function listFilesInFolder(driveAuth, folderId) {
  const files = [];
  let pageToken = null;
  const fields = 'files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink),nextPageToken';
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
    let folderId = supplier.drive_folder_id;

    // Resolve folder: prefer stored ID, fall back to name lookup
    if (!folderId) {
      const folders = await findFoldersByName(driveAuth, folderName);
      if (folders.length === 0) {
        return Response.json({
          error: 'FOLDER_NOT_FOUND',
          message: `No Google Drive folder named "${folderName}" was found. Run a download first to create it.`,
          folder_name: folderName
        }, { status: 404 });
      }
      if (folders.length > 1) {
        return Response.json({
          error: 'AMBIGUOUS_FOLDER',
          message: `Multiple Google Drive folders named "${folderName}" were found. Rename one in Drive or update your workflow destination.`,
          folder_name: folderName,
          matching_count: folders.length
        }, { status: 409 });
      }
      folderId = folders[0].id;
      // Persist resolved ID for future lookups
      await base44.entities.Supplier.update(supplier_id, { drive_folder_id: folderId });
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