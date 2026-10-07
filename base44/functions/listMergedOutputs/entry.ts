import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { resolveWorkflowFolder, FolderResolutionError } from '../../shared/resolveWorkflowFolder.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googledrive');
    const driveAuth = { Authorization: `Bearer ${accessToken}` };

    const suppliers = await base44.entities.Supplier.list('-created_date', 100);
    const outputs = [];

    for (const supplier of suppliers) {
      let folderId;
      try {
        const resolved = await resolveWorkflowFolder(driveAuth, base44, supplier, { allowCreate: false });
        folderId = resolved.folderId;
        if (resolved.bound) await base44.entities.Supplier.update(supplier.id, { drive_folder_id: folderId });
      } catch (err) {
        continue;
      }
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed=false and name contains '_merged_'`)}&fields=files(id,name,size,createdTime,webViewLink)&pageSize=50`,
        { headers: driveAuth }
      );
      if (!res.ok) continue;
      const data = await res.json();
      (data.files || []).forEach(f => outputs.push({
        id: f.id,
        name: f.name,
        size: parseInt(f.size || '0', 10),
        created_date: f.createdTime,
        web_view_link: f.webViewLink,
        supplier_id: supplier.id,
        supplier_name: supplier.name
      }));
    }

    outputs.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
    return Response.json({ outputs });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});