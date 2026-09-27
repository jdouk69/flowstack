// Shared Drive destination-folder resolution used by downloadPdfs, listWorkflowFiles and mergePdfs.
// Rules:
// 1. A failed Drive search is never treated as "folder does not exist" — it raises an explicit error,
//    and no folder is ever created or selected as a result of an API error.
// 2. A saved drive_folder_id is verified before use. If it is missing, trashed or inaccessible we
//    fail with a clear error — we never silently switch to another folder.
// 3. Workflows without a saved ID use their Run History folder ID when it identifies exactly one valid
//    destination. Ambiguous evidence raises an error listing the candidate folders.

export class FolderResolutionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function extractFolderIdFromLink(link) {
  if (!link) return null;
  const match = link.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

export async function findFoldersByName(driveAuth, folderName) {
  const escaped = folderName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const query = `name='${escaped}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,createdTime)&pageSize=50`, { headers: driveAuth });
  if (!res.ok) {
    throw new FolderResolutionError('FOLDER_SEARCH_FAILED', `Google Drive folder search failed (HTTP ${res.status}). No folder was created or selected.`, { folder_name: folderName });
  }
  const data = await res.json();
  return data.files || [];
}

async function getFolderMeta(driveAuth, folderId) {
  let res;
  try {
    res = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,mimeType,trashed&supportsAllDrives=true`, { headers: driveAuth });
  } catch (e) {
    return null;
  }
  if (!res.ok) return null;
  const meta = await res.json();
  if (!meta || meta.mimeType !== 'application/vnd.google-apps.folder' || meta.trashed) return null;
  return meta;
}

// Returns { folderId, bound } — bound=true means the caller should persist folderId to the
// workflow record (drive_folder_id) so later runs resolve by ID instead of by name.
export async function resolveWorkflowFolder(driveAuth, base44, supplier, { allowCreate = false } = {}) {
  const folderName = supplier.drive_folder_name;

  // 1. Saved ID: verify it exists and is an accessible, non-trashed folder.
  if (supplier.drive_folder_id) {
    const meta = await getFolderMeta(driveAuth, supplier.drive_folder_id);
    if (!meta) {
      throw new FolderResolutionError('FOLDER_ID_INACCESSIBLE',
        `The saved destination folder (ID ${supplier.drive_folder_id}) is missing, trashed or not accessible. Fix or clear this workflow's destination before running it — no other folder was used.`,
        { folder_id: supplier.drive_folder_id, folder_name: folderName });
    }
    return { folderId: meta.id, bound: false };
  }

  // 2. No saved ID: use Run History evidence. Only folders that still exist and are accessible
  // count as candidates; among them, a folder still named as this workflow's configured
  // destination identifies the valid destination. Anything ambiguous stops and reports the
  // candidate folders instead of guessing.
  const runs = await base44.entities.RunHistory.filter({ supplier_id: supplier.id });
  const historyIds = [...new Set(runs.map(r => extractFolderIdFromLink(r.drive_folder_link)).filter(Boolean))];

  if (historyIds.length > 0) {
    const valid = [];
    for (const id of historyIds) {
      const meta = await getFolderMeta(driveAuth, id);
      if (meta) valid.push(meta);
    }
    if (valid.length === 0) {
      throw new FolderResolutionError('FOLDER_ID_INACCESSIBLE',
        `The Drive folders used by past runs (${historyIds.join(', ')}) are missing, trashed or not accessible.`,
        { candidates: historyIds, folder_name: folderName });
    }
    const nameMatches = valid.filter(c => c.name === folderName);
    if (nameMatches.length === 1) {
      return { folderId: nameMatches[0].id, bound: true };
    }
    if (nameMatches.length > 1) {
      throw new FolderResolutionError('AMBIGUOUS_FOLDER',
        `Past runs of this workflow used multiple Drive folders named "${folderName}". Candidate folders: ${nameMatches.map(c => c.id).join(', ')}. Please reconcile them before continuing.`,
        { candidates: nameMatches.map(c => c.id), folder_name: folderName });
    }
    if (valid.length === 1) {
      // A single accessible folder from this workflow's own history, renamed in Drive — still its destination.
      return { folderId: valid[0].id, bound: true };
    }
    throw new FolderResolutionError('AMBIGUOUS_FOLDER',
      `Past runs of this workflow used multiple Drive folders. Candidate folders: ${valid.map(c => `${c.id} (named "${c.name}")`).join(', ')}. Please reconcile them before continuing.`,
      { candidates: valid.map(c => c.id), folder_name: folderName });
  }

  // 3. No saved ID and no history: name search. An API failure here is an explicit error.
  const folders = await findFoldersByName(driveAuth, folderName);
  if (folders.length > 1) {
    throw new FolderResolutionError('AMBIGUOUS_FOLDER',
      `Multiple Google Drive folders named "${folderName}" exist. Candidate folders: ${folders.map(f => f.id).join(', ')}. Rename one in Drive or update this workflow's destination.`,
      { candidates: folders.map(f => f.id), folder_name: folderName });
  }
  if (folders.length === 1) {
    return { folderId: folders[0].id, bound: true };
  }
  if (!allowCreate) {
    throw new FolderResolutionError('FOLDER_NOT_FOUND',
      `No Google Drive folder named "${folderName}" was found. Run a download first to create it.`,
      { folder_name: folderName });
  }

  // 4. First run ever: create the folder at Drive root and bind it.
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { ...driveAuth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder' })
  });
  if (!createRes.ok) {
    throw new FolderResolutionError('FOLDER_CREATE_FAILED',
      `Failed to create Drive folder "${folderName}" (HTTP ${createRes.status}).`,
      { folder_name: folderName });
  }
  const created = await createRes.json();
  return { folderId: created.id, bound: true };
}