import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { PDFDocument } from 'npm:pdf-lib@1.17.1';

function escapeDriveQuery(str) {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findFolder(driveAuth, folderName) {
  const query = `name='${escapeDriveQuery(folderName)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`, { headers: driveAuth });
  if (!res.ok) return null;
  const data = await res.json();
  return (data.files && data.files.length > 0) ? data.files[0] : null;
}

async function listPdfsInFolder(driveAuth, folderId) {
  const pdfs = [];
  let pageToken = null;
  do {
    let url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed=false and mimeType='application/pdf'`)}&fields=files(id,name),nextPageToken&pageSize=200&orderBy=name`;
    if (pageToken) url += `&pageToken=${pageToken}`;
    const res = await fetch(url, { headers: driveAuth });
    if (!res.ok) break;
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
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { supplier_id } = body;
    if (!supplier_id) return Response.json({ error: 'supplier_id is required' }, { status: 400 });

    const supplier = await base44.entities.Supplier.get(supplier_id);

    const { accessToken: driveToken } = await base44.asServiceRole.connectors.getConnection('googledrive');
    const driveAuth = { Authorization: `Bearer ${driveToken}` };

    const folder = await findFolder(driveAuth, supplier.drive_folder_name);
    if (!folder) {
      return Response.json({ error: 'Folder not found. Run a download first.' }, { status: 404 });
    }

    const pdfs = await listPdfsInFolder(driveAuth, folder.id);
    if (pdfs.length === 0) {
      return Response.json({ error: 'No PDFs found in folder' }, { status: 404 });
    }

    const toMerge = pdfs.filter(p => !p.name.includes('_merged_'));
    if (toMerge.length === 0) {
      return Response.json({ error: 'No PDFs to merge' }, { status: 404 });
    }

    const mergedPdf = await PDFDocument.create();
    let mergedCount = 0;
    for (const pdf of toMerge) {
      try {
        const pdfBytes = await downloadFile(driveAuth, pdf.id);
        const doc = await PDFDocument.load(pdfBytes);
        const pages = await mergedPdf.copyPages(doc, doc.getPageIndices());
        pages.forEach(p => mergedPdf.addPage(p));
        mergedCount++;
      } catch (e) {
        // skip problematic PDF
      }
    }

    if (mergedCount === 0) {
      return Response.json({ error: 'Failed to merge any PDFs' }, { status: 500 });
    }

    const mergedBytes = await mergedPdf.save();
    const dateStr = new Date().toISOString().slice(0, 10);
    const mergedFilename = `${supplier.name}_merged_${dateStr}.pdf`;

    await uploadFileToDrive(driveAuth, mergedFilename, folder.id, mergedBytes);

    return Response.json({
      success: true,
      merged_filename: mergedFilename,
      pdf_count: mergedCount,
      drive_folder_link: `https://drive.google.com/drive/folders/${folder.id}`
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});