// Shared Drive helpers for customer-copy sharing. Used by createCustomerLink and revokeCustomerLink.

export async function getDriveAuth(base44) {
  const { accessToken } = await base44.asServiceRole.connectors.getConnection('googledrive');
  return { Authorization: `Bearer ${accessToken}` };
}

export async function getDriveFile(driveAuth, fileId, fields = 'id,name,size,md5Checksum,mimeType,webViewLink,trashed') {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=${encodeURIComponent(fields)}`,
    { headers: driveAuth }
  );
  if (!res.ok) return null;
  return res.json();
}

export async function listPermissions(driveAuth, fileId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?fields=permissions(id,type,role)&pageSize=100`,
    { headers: driveAuth }
  );
  if (!res.ok) throw new Error(`Failed to read file permissions (HTTP ${res.status}).`);
  const data = await res.json();
  return data.permissions || [];
}

// Idempotent: ensures exactly one anyone-with-link reader permission on the file.
export async function ensureAnyoneReader(driveAuth, fileId) {
  const perms = await listPermissions(driveAuth, fileId);
  const existing = perms.find(p => p.type === 'anyone');
  if (existing && existing.role === 'reader') return existing;
  if (existing) {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions/${existing.id}`, {
      method: 'PATCH',
      headers: { ...driveAuth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader' })
    });
    if (!res.ok) throw new Error(`Failed to update the sharing permission (HTTP ${res.status}).`);
  } else {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
      method: 'POST',
      headers: { ...driveAuth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' })
    });
    if (!res.ok) throw new Error(`Failed to set the sharing permission (HTTP ${res.status}).`);
  }
  const verify = (await listPermissions(driveAuth, fileId)).find(p => p.type === 'anyone' && p.role === 'reader');
  if (!verify) throw new Error('Sharing permission could not be verified after it was set.');
  return verify;
}

// Removes every anyone-with-link permission and verifies none remain.
export async function removeAnyonePermissions(driveAuth, fileId) {
  const perms = await listPermissions(driveAuth, fileId);
  const anyones = perms.filter(p => p.type === 'anyone');
  for (const p of anyones) {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions/${p.id}`, {
      method: 'DELETE',
      headers: driveAuth
    });
    if (!res.ok) throw new Error(`Failed to remove the sharing permission (HTTP ${res.status}).`);
  }
  const after = await listPermissions(driveAuth, fileId);
  if (after.some(p => p.type === 'anyone')) {
    throw new Error('Revocation could not be verified — a public permission is still present.');
  }
  return anyones.length;
}