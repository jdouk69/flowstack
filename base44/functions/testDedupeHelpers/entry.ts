// Code-level tests for the content-based dedupe and source-date helpers.
// Pure logic only: no Gmail, no Drive, no entity access.
import { computeMd5, parsePdfCreationDate, buildCollisionName, decideAttachment, buildSourceDateMetadata } from '../../shared/contentDedupe.ts';

Deno.serve(async () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  const results: Array<{ test: string; passed: boolean; [k: string]: unknown }> = [];
  const check = (test: string, cond: boolean, extra?: Record<string, unknown>) =>
    results.push({ test, passed: !!cond, ...(extra || {}) });

  // --- MD5 correctness (known vectors) ---
  check('md5 empty string', computeMd5(enc('')) === 'd41d8cd98f00b204e9800998ecf8427e');
  check('md5 abc', computeMd5(enc('abc')) === '900150983cd24fb0d6963f7d28e17f72');
  check('md5 quick brown fox', computeMd5(enc('The quick brown fox jumps over the lazy dog')) === '9e107d9d372bb6826bd81d3542a419d6');
  check('md5 alphabet', computeMd5(enc('abcdefghijklmnopqrstuvwxyz')) === 'c3fcd3d76192e4007dfb496cca67e13b');

  // --- PDF creation date parsing ---
  const pdf = (d: string) => enc(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\n2 0 obj\n<< /CreationDate (${d}) >>\nendobj\ntrailer\n<<>>\n%%EOF`);
  check('pdf date with +02\'00 offset', parsePdfCreationDate(pdf("D:20260115093000+02'00")) === '2026-01-15T09:30:00+02:00');
  check('pdf date with Z', parsePdfCreationDate(pdf('D:20191231235959Z')) === '2019-12-31T23:59:59Z');
  check('pdf date without timezone', parsePdfCreationDate(pdf('D:20260115093000')) === '2026-01-15T09:30:00');
  check('pdf date missing entirely', parsePdfCreationDate(enc('%PDF-1.4\nno date object here\n%%EOF')) === '');
  check('pdf date invalid (non-numeric)', parsePdfCreationDate(pdf('D:20ab')) === '');
  check('pdf date invalid (month 13)', parsePdfCreationDate(pdf('D:20261315093000Z')) === '');
  check('non-pdf content yields empty', parsePdfCreationDate(enc('hello world, not a pdf')) === '');

  // --- Duplicate decisions ---
  const existing = [
    { name: 'invoice.pdf', md5: 'aaa' },
    { name: 'other.pdf', md5: 'bbb' }
  ];
  check('identical content, different name -> skip', decideAttachment('renamed.pdf', 'aaa', existing).action === 'skip_identical');
  check('identical content, same name -> skip', decideAttachment('invoice.pdf', 'aaa', existing).action === 'skip_identical');

  const coll = decideAttachment('invoice.pdf', 'ccc', existing);
  check('same name, different content -> save_collision', coll.action === 'save_collision');
  check('collision name keeps stem and extension', coll.finalName.startsWith('invoice [alt-') && coll.finalName.endsWith('.pdf'), { got: coll.finalName });
  check('collision suffix is stable/deterministic', coll.finalName === decideAttachment('invoice.pdf', 'ccc', existing).finalName);
  check('collision suffix derives from md5', coll.finalName === buildCollisionName('invoice.pdf', 'ccc'));

  const existingAfterSave = [...existing, { name: coll.finalName, md5: 'ccc' }];
  check('repeat of collision-saved content -> skip (in-run dedupe)', decideAttachment('invoice.pdf', 'ccc', existingAfterSave).action === 'skip_identical');

  const save = decideAttachment('brand-new.pdf', 'ddd', existing);
  check('different content, different name -> save unchanged', save.action === 'save' && save.finalName === 'brand-new.pdf');

  const unverified = decideAttachment('invoice.pdf', 'aaa', [{ name: 'invoice.pdf', md5: null }]);
  check('same name, checksum unavailable -> save with suffix (never assume duplicate)', unverified.action === 'save_collision');

  const noExt = decideAttachment('README', 'eee', [{ name: 'README', md5: 'fff' }]);
  check('collision without extension handled', noExt.action === 'save_collision' && noExt.finalName.startsWith('README [alt-'));

  // --- Source date metadata ---
  const emailIso = new Date(1767225600000).toISOString();
  const m1 = buildSourceDateMetadata({ isPdf: true, fileBytes: pdf("D:20260115093000+02'00"), internalDateMs: '1767225600000' });
  check('description carries both labels', m1.description.includes('Email received:') && m1.description.includes('PDF metadata creation date:'), { got: m1.description });
  check('appProperties carry both dates', m1.appProperties.source_email_received === emailIso && m1.appProperties.source_pdf_creation === '2026-01-15T09:30:00+02:00');
  check('drive timestamps from tz-complete pdf date', m1.createdTime === '2026-01-15T09:30:00+02:00' && m1.modifiedTime === m1.createdTime);

  const m2 = buildSourceDateMetadata({ isPdf: true, fileBytes: pdf('D:20260115093000'), internalDateMs: '1767225600000' });
  check('no-tz pdf date recorded but NOT used as drive timestamp', m2.appProperties.source_pdf_creation === '2026-01-15T09:30:00' && m2.createdTime === emailIso, { got: m2 });

  const m3 = buildSourceDateMetadata({ isPdf: true, fileBytes: enc('%PDF-1.4 no date'), internalDateMs: '1767225600000' });
  check('missing pdf date -> email received drives timestamp, no pdf label', m3.createdTime === emailIso && !m3.description.includes('PDF metadata'));

  const m4 = buildSourceDateMetadata({ isPdf: false, fileBytes: enc('x'), internalDateMs: null });
  check('no dates at all -> no timestamps, no labels', m4.createdTime === null && m4.description === '' && Object.keys(m4.appProperties).length === 0);

  const failed = results.filter(r => !r.passed);
  return Response.json({
    passed: failed.length === 0,
    total: results.length,
    failed_count: failed.length,
    failures: failed,
    results
  });
});