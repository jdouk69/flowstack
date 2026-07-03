import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

function escapeDriveQuery(str) {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function base64UrlToUint8Array(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const FILE_TYPE_EXTENSIONS = {
  pdf: ['pdf'],
  images: ['jpg', 'jpeg', 'png', 'heic'],
  word: ['doc', 'docx'],
  excel: ['xls', 'xlsx'],
  zip: ['zip'],
};

function getAllowedExtensions(fileTypes) {
  const types = fileTypes && fileTypes.length > 0 ? fileTypes : ['pdf'];
  const exts = new Set();
  for (const t of types) {
    const extensions = FILE_TYPE_EXTENSIONS[t];
    if (extensions) extensions.forEach(e => exts.add(e));
  }
  return exts;
}

function getExtension(filename) {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

function extractAttachments(payload, allowedExtensions) {
  const attachments = [];
  function walk(parts) {
    if (!parts) return;
    for (const part of parts) {
      if (part.filename && part.body && part.body.attachmentId) {
        const ext = getExtension(part.filename);
        if (allowedExtensions.has(ext)) {
          attachments.push({
            filename: part.filename,
            attachmentId: part.body.attachmentId,
            size: part.body.size,
            mimeType: part.mimeType || 'application/octet-stream'
          });
        }
      }
      if (part.parts) walk(part.parts);
    }
  }
  if (payload) walk(payload.parts);
  return attachments;
}

async function findOrCreateFolder(driveAuth, folderName) {
  const query = `name='${escapeDriveQuery(folderName)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`, { headers: driveAuth });
  if (searchRes.ok) {
    const searchData = await searchRes.json();
    if (searchData.files && searchData.files.length > 0) return searchData.files[0];
  }
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { ...driveAuth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder' })
  });
  if (!createRes.ok) throw new Error('Failed to create Drive folder: ' + folderName);
  return await createRes.json();
}

async function listExistingFiles(driveAuth, folderId) {
  const names = new Set();
  let pageToken = null;
  do {
    let url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed=false`)}&fields=files(name,id),nextPageToken&pageSize=200`;
    if (pageToken) url += `&pageToken=${pageToken}`;
    const res = await fetch(url, { headers: driveAuth });
    if (!res.ok) break;
    const data = await res.json();
    (data.files || []).forEach(f => names.add(f.name));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return names;
}

async function searchGmail(gmailAuth, query) {
  const messageIds = new Set();
  let pageToken = null;
  let pageCount = 0;
  do {
    let url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=100`;
    if (pageToken) url += `&pageToken=${pageToken}`;
    const res = await fetch(url, { headers: gmailAuth });
    if (!res.ok) break;
    const data = await res.json();
    if (data.messages) data.messages.forEach(m => messageIds.add(m.id));
    pageToken = data.nextPageToken;
    pageCount++;
  } while (pageToken && pageCount < 3);
  return messageIds;
}

async function getMessage(gmailAuth, messageId) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`, { headers: gmailAuth });
  if (!res.ok) return null;
  return await res.json();
}

async function getAttachment(gmailAuth, messageId, attachmentId) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`, { headers: gmailAuth });
  if (!res.ok) return null;
  const data = await res.json();
  return data.data;
}

async function uploadFileToDrive(driveAuth, filename, folderId, fileBytes, mimeType) {
  const metadata = { name: filename, parents: [folderId] };
  const boundary = '-------314159265358979323846';
  const delimiter = `--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const body = new Blob([
    delimiter + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) + '\r\n',
    delimiter + `Content-Type: ${mimeType}\r\n\r\n`,
    fileBytes,
    closeDelimiter
  ], { type: `multipart/related; boundary=${boundary}` });

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { ...driveAuth, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  });
  if (!res.ok) throw new Error('Failed to upload: ' + filename);
  return await res.json();
}

async function processSupplier(supplier, gmailAuth, driveAuth) {
  const result = {
    supplier_name: supplier.name,
    emails_found: 0,
    pdfs_saved: 0,
    duplicates_skipped: 0,
    errors: 0,
    drive_folder_link: '',
    error_details: []
  };

  try {
    const searchType = supplier.search_type || 'sender_email';
    const queries = [];
    if (searchType === 'sender_email' && supplier.email) {
      queries.push(`from:${supplier.email} has:attachment`);
    } else if (searchType === 'company_name' && supplier.keyword) {
      queries.push(`from:${supplier.keyword} has:attachment`);
    } else if (searchType === 'gmail_search' && supplier.keyword) {
      queries.push(`${supplier.keyword} has:attachment`);
    }

    const allMessageIds = new Set();
    for (const q of queries) {
      const ids = await searchGmail(gmailAuth, q);
      ids.forEach(id => allMessageIds.add(id));
    }
    result.emails_found = allMessageIds.size;

    if (allMessageIds.size === 0) return result;

    const folder = await findOrCreateFolder(driveAuth, supplier.drive_folder_name);
    result.drive_folder_link = `https://drive.google.com/drive/folders/${folder.id}`;

    const existingFiles = await listExistingFiles(driveAuth, folder.id);
    const allowedExtensions = getAllowedExtensions(supplier.file_types);

    for (const messageId of allMessageIds) {
      try {
        const message = await getMessage(gmailAuth, messageId);
        if (!message) { result.errors++; continue; }

        const attachments = extractAttachments(message.payload, allowedExtensions);
        for (const att of attachments) {
          try {
            if (existingFiles.has(att.filename)) {
              result.duplicates_skipped++;
              continue;
            }
            const attachmentData = await getAttachment(gmailAuth, messageId, att.attachmentId);
            if (!attachmentData) { result.errors++; continue; }

            const fileBytes = base64UrlToUint8Array(attachmentData);
            await uploadFileToDrive(driveAuth, att.filename, folder.id, fileBytes, att.mimeType);
            existingFiles.add(att.filename);
            result.pdfs_saved++;
          } catch (attErr) {
            result.errors++;
            result.error_details.push(`${att.filename}: ${attErr.message}`);
          }
        }
      } catch (msgErr) {
        result.errors++;
        result.error_details.push(`msg ${messageId}: ${msgErr.message}`);
      }
    }
  } catch (err) {
    result.errors++;
    result.error_details.push(`Supplier error: ${err.message}`);
  }

  return result;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { supplier_id } = body;
    if (!supplier_id) return Response.json({ error: 'supplier_id is required' }, { status: 400 });

    let suppliers = [];
    if (supplier_id === 'all') {
      suppliers = await base44.entities.Supplier.list();
    } else {
      const s = await base44.entities.Supplier.get(supplier_id);
      suppliers = [s];
    }

    if (suppliers.length === 0) {
      return Response.json({ error: 'No suppliers found' }, { status: 404 });
    }

    const { accessToken: gmailToken } = await base44.asServiceRole.connectors.getConnection('gmail');
    const { accessToken: driveToken } = await base44.asServiceRole.connectors.getConnection('googledrive');
    const gmailAuth = { Authorization: `Bearer ${gmailToken}` };
    const driveAuth = { Authorization: `Bearer ${driveToken}` };

    const allResults = [];

    for (const supplier of suppliers) {
      const result = await processSupplier(supplier, gmailAuth, driveAuth);
      allResults.push(result);

      await base44.entities.RunHistory.create({
        run_date: new Date().toISOString(),
        supplier_id: supplier.id,
        supplier_name: supplier.name,
        emails_found: result.emails_found,
        pdfs_saved: result.pdfs_saved,
        duplicates_skipped: result.duplicates_skipped,
        errors: result.errors,
        drive_folder_link: result.drive_folder_link,
        status: result.errors > 0 ? 'partial' : 'completed',
        error_details: result.error_details.join('; ')
      });

      await base44.entities.Supplier.update(supplier.id, {
        last_run: new Date().toISOString(),
        status: result.errors > 0 ? 'error' : 'active'
      });
    }

    const totals = allResults.reduce((acc, r) => ({
      emails_found: acc.emails_found + r.emails_found,
      pdfs_saved: acc.pdfs_saved + r.pdfs_saved,
      duplicates_skipped: acc.duplicates_skipped + r.duplicates_skipped,
      errors: acc.errors + r.errors,
    }), { emails_found: 0, pdfs_saved: 0, duplicates_skipped: 0, errors: 0 });

    return Response.json({ results: allResults, totals });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});