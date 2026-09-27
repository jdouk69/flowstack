import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { resolveWorkflowFolder, FolderResolutionError } from '../../shared/resolveWorkflowFolder.ts';
import { computeMd5, decideAttachment, buildSourceDateMetadata } from '../../shared/contentDedupe.ts';

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
  images: ['jpg', 'jpeg', 'png', 'heic', 'gif', 'webp', 'tif', 'tiff'],
  word: ['doc', 'docx'],
  excel: ['xls', 'xlsx'],
  powerpoint: ['ppt', 'pptx'],
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


// Existing files with checksums, across ALL pages of the Drive listing.
// A listing failure is an error (fatal) — never assume there are no duplicates.
async function listExistingFiles(driveAuth, folderId) {
  const files = [];
  let pageToken = null;
  do {
    let url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed=false`)}&fields=files(name,md5Checksum),nextPageToken&pageSize=200`;
    if (pageToken) url += `&pageToken=${pageToken}`;
    const res = await fetch(url, { headers: driveAuth });
    if (!res.ok) throw new FolderResolutionError('FOLDER_LISTING_FAILED', `Could not list the destination folder's existing files (HTTP ${res.status}). The workflow was stopped to avoid creating duplicate files.`);
    const data = await res.json();
    (data.files || []).forEach(f => files.push({ name: f.name, md5: f.md5Checksum || null }));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return files;
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

async function uploadFileToDrive(driveAuth, metadata, fileBytes, mimeType) {
  const boundary = '-------314159265358979323846';
  const delimiter = `--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const body = new Blob([
    delimiter + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) + '\r\n',
    delimiter + `Content-Type: ${mimeType}\r\n\r\n`,
    fileBytes,
    closeDelimiter
  ], { type: `multipart/related; boundary=${boundary}` });

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,md5Checksum', {
    method: 'POST',
    headers: { ...driveAuth, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  });
  if (!res.ok) throw new Error('Failed to upload: ' + metadata.name);
  return await res.json();
}

async function processSupplier(supplier, gmailAuth, driveAuth, base44) {
  const result = {
    supplier_name: supplier.name,
    emails_found: 0,
    pdfs_saved: 0,
    identical_content_skipped: 0,
    name_collision_saved: 0,
    // Back-compat alias for older UI: filename-based skip -> identical-content skip
    duplicates_skipped: 0,
    errors: 0,
    drive_folder_link: '',
    error_details: [],
    fatal: false
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

    const { folderId, bound } = await resolveWorkflowFolder(driveAuth, base44, supplier, { allowCreate: true });
    if (bound) await base44.entities.Supplier.update(supplier.id, { drive_folder_id: folderId });
    result.drive_folder_link = `https://drive.google.com/drive/folders/${folderId}`;

    const existingFiles = await listExistingFiles(driveAuth, folderId);
    const allowedExtensions = getAllowedExtensions(supplier.file_types);

    for (const messageId of allMessageIds) {
      try {
        const message = await getMessage(gmailAuth, messageId);
        if (!message) { result.errors++; continue; }
        const internalDateMs = message.internalDate || null;

        const attachments = extractAttachments(message.payload, allowedExtensions);
        for (const att of attachments) {
          try {
            // Fetch bytes first: content-based dedupe requires the checksum
            const attachmentData = await getAttachment(gmailAuth, messageId, att.attachmentId);
            if (!attachmentData) { result.errors++; continue; }

            const fileBytes = base64UrlToUint8Array(attachmentData);
            const md5 = computeMd5(fileBytes);
            const decision = decideAttachment(att.filename, md5, existingFiles);

            if (decision.action === 'skip_identical') {
              result.identical_content_skipped++;
              continue;
            }

            const dateMeta = buildSourceDateMetadata({
              isPdf: getExtension(att.filename) === 'pdf',
              fileBytes,
              internalDateMs
            });

            const metadata = {
              name: decision.finalName,
              parents: [folderId]
            };
            if (dateMeta.description) metadata.description = dateMeta.description;
            if (Object.keys(dateMeta.appProperties).length > 0) metadata.appProperties = dateMeta.appProperties;
            if (dateMeta.createdTime) {
              metadata.createdTime = dateMeta.createdTime;
              metadata.modifiedTime = dateMeta.modifiedTime;
            }

            await uploadFileToDrive(driveAuth, metadata, fileBytes, att.mimeType);
            existingFiles.push({ name: decision.finalName, md5 });
            result.pdfs_saved++;
            if (decision.action === 'save_collision') result.name_collision_saved++;
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
    result.fatal = err instanceof FolderResolutionError;
    result.error_details.push(`Supplier error: ${err.message}`);
  }

  result.duplicates_skipped = result.identical_content_skipped;
  return result;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

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
      let result;
      try {
        result = await processSupplier(supplier, gmailAuth, driveAuth, base44);
      } catch (fatalErr) {
        result = {
          supplier_name: supplier.name,
          emails_found: 0,
          pdfs_saved: 0,
          identical_content_skipped: 0,
          name_collision_saved: 0,
          duplicates_skipped: 0,
          errors: 1,
          drive_folder_link: '',
          error_details: [fatalErr.message],
          fatal: true
        };
      }
      allResults.push(result);

      await base44.entities.RunHistory.create({
        run_date: new Date().toISOString(),
        supplier_id: supplier.id,
        supplier_name: supplier.name,
        emails_found: result.emails_found,
        pdfs_saved: result.pdfs_saved,
        duplicates_skipped: result.duplicates_skipped,
        identical_content_skipped: result.identical_content_skipped,
        name_collision_saved: result.name_collision_saved,
        errors: result.errors,
        drive_folder_link: result.drive_folder_link,
        status: result.fatal ? 'failed' : (result.errors > 0 ? 'partial' : 'completed'),
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
      identical_content_skipped: acc.identical_content_skipped + r.identical_content_skipped,
      name_collision_saved: acc.name_collision_saved + r.name_collision_saved,
      errors: acc.errors + r.errors,
    }), { emails_found: 0, pdfs_saved: 0, duplicates_skipped: 0, identical_content_skipped: 0, name_collision_saved: 0, errors: 0 });

    return Response.json({ results: allResults, totals });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});