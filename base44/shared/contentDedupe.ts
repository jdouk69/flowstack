// Shared helpers for content-based duplicate detection and source-date capture.
// Used by downloadPdfs and testDedupeHelpers.

// --- MD5 (matches Google Drive's md5Checksum for binary files) ---

const MD5_K = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
  0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
  0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
  0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
  0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
  0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
  0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
  0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
  0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391
];

const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
];

export function computeMd5(bytes: Uint8Array): string {
  const len = bytes.length;
  const bitLen = len * 8;
  const paddedLen = ((len + 72) >> 6) << 6; // ceil((len + 9) / 64) * 64
  const buf = new Uint8Array(paddedLen);
  buf.set(bytes);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(paddedLen - 8, bitLen % 4294967296, true);
  dv.setUint32(paddedLen - 4, Math.floor(bitLen / 4294967296), true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

  for (let off = 0; off < paddedLen; off += 64) {
    const m = new Array(16);
    for (let i = 0; i < 16; i++) m[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
      else { F = C ^ (B | ~D); g = (7 * i) & 15; }
      const x = (F + A + MD5_K[i] + m[g]) >>> 0;
      const tmp = D;
      D = C;
      C = B;
      B = (B + ((x << MD5_S[i]) | (x >>> (32 - MD5_S[i])))) >>> 0;
      A = tmp;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, a0, true);
  odv.setUint32(4, b0, true);
  odv.setUint32(8, c0, true);
  odv.setUint32(12, d0, true);
  let hex = '';
  for (const b of out) hex += b.toString(16).padStart(2, '0');
  return hex;
}

// --- PDF embedded creation date (labeled "PDF metadata creation date") ---

const PDF_DATE_RE = /\/CreationDate\s*\(\s*D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(Z|Z\+\d+|[-+]\d{2}'?\d{2}|[-+]\d{2})?\s*\)/;

function latin1(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return s;
}

/**
 * Returns the PDF's embedded /CreationDate as an ISO-like string, or '' when
 * absent, unparsable, or out of range. The timezone offset is preserved when
 * present ('Z' or '+HH:MM'); dates without a timezone are returned WITHOUT an
 * offset so callers never guess a zone.
 */
export function parsePdfCreationDate(bytes: Uint8Array): string {
  const match = PDF_DATE_RE.exec(latin1(bytes));
  if (!match) return '';
  const y = match[1];
  const mo = match[2] ?? '01';
  const da = match[3] ?? '01';
  const hh = match[4];
  const mi = match[5] ?? '00';
  const ss = match[6] ?? '00';
  const month = parseInt(mo, 10), day = parseInt(da, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  if (hh && (parseInt(hh, 10) > 23 || parseInt(mi, 10) > 59 || parseInt(ss, 10) > 59)) return '';
  let out = `${y}-${mo}-${da}`;
  if (hh) out += `T${hh}:${mi}:${ss}`;
  const tz = match[7];
  if (tz && tz.startsWith('Z')) out += 'Z';
  else if (tz) out += `${tz.slice(0, 3)}:${tz.length > 3 ? tz.slice(3).replace("'", '') : '00'}`;
  return out;
}

// --- Content-based duplicate decisions ---

export interface ExistingFile {
  name: string | null;
  md5: string | null;
}

/** Stable, self-describing suffix for a same-name/different-content save. */
export function buildCollisionName(filename: string, md5: string): string {
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  return `${stem} [alt-${(md5 || '').slice(0, 8)}]${ext}`;
}

/**
 * Decides what to do with an attachment given its computed MD5 and the
 * destination folder's existing files (name + md5Checksum, all pages).
 * - identical checksum anywhere in the folder -> skip (even under another name)
 * - same name but different (or unverifiable) content -> save with a stable
 *   [alt-xxxxxxxx] suffix; never overwrite, never silently drop either file
 * - otherwise -> save under the original filename
 */
export function decideAttachment(filename: string, md5: string, existing: ExistingFile[]): { action: 'skip_identical' | 'save' | 'save_collision'; finalName: string } {
  if (md5) {
    for (const e of existing) {
      if (e.md5 && e.md5 === md5) return { action: 'skip_identical', finalName: filename };
    }
  }
  const sameName = existing.find(e => e.name === filename);
  if (!sameName) return { action: 'save', finalName: filename };
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  const hash = (md5 || '').slice(0, 8);
  let candidate = `${stem} [alt-${hash}]${ext}`;
  let n = 2;
  while (existing.some(e => e.name === candidate)) {
    candidate = `${stem} [alt-${hash}-${n}]${ext}`;
    n++;
  }
  return { action: 'save_collision', finalName: candidate };
}

// --- Source-date metadata for uploads ---

export function hasTimezone(dateStr: string): boolean {
  return /(Z|[+-]\d{2}:\d{2})$/.test(dateStr);
}

/**
 * Builds the labeled source-date metadata for a newly uploaded file.
 * - "Email received": Gmail's internalDate (server receipt time).
 * - "PDF metadata creation date": the PDF's embedded /CreationDate, when present
 *   and parseable. Not assumed to prove when the document was actually made.
 * Stored in Drive appProperties (app-retrievable) and in the Drive description
 * (visible in Drive).
 *
 * Drive timestamp rule: createdTime is set ONLY when the PDF's embedded creation
 * date is parseable AND carries a timezone. An email receipt date is never used —
 * it is not the attachment's creation or modification date. When no usable PDF
 * date exists, no Drive timestamps are set and Drive assigns its normal upload
 * timestamps. modifiedTime is never set: the file provides no separate, reliable
 * modification date. "PDF metadata creation date" stays clearly labeled as PDF
 * metadata, not a verified real-world creation date.
 */
export function buildSourceDateMetadata({ isPdf, fileBytes, internalDateMs }: { isPdf: boolean; fileBytes: Uint8Array; internalDateMs: string | null }): {
  appProperties: Record<string, string>;
  description: string;
  createdTime: string | null;
  modifiedTime: string | null;
} {
  const appProperties: Record<string, string> = {};
  const parts: string[] = [];
  const emailIso = internalDateMs ? new Date(Number(internalDateMs)).toISOString() : '';
  if (emailIso) {
    appProperties.source_email_received = emailIso;
    parts.push(`Email received: ${emailIso}`);
  }
  const pdfDate = isPdf ? parsePdfCreationDate(fileBytes) : '';
  if (pdfDate) {
    appProperties.source_pdf_creation = pdfDate;
    parts.push(`PDF metadata creation date: ${pdfDate}`);
  }
  const createdTime = pdfDate && hasTimezone(pdfDate) ? pdfDate : null;
  return { appProperties, description: parts.join(' | '), createdTime, modifiedTime: null };
}