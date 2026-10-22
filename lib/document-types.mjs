// Names and MIME types are server-owned; browser-supplied MIME is not trusted.
const types = {
  pdf: ['pdf', 'application/pdf'],
  jpg: ['images', 'image/jpeg'], jpeg: ['images', 'image/jpeg'],
  png: ['images', 'image/png'], heic: ['images', 'image/heic'],
  gif: ['images', 'image/gif'], webp: ['images', 'image/webp'],
  tif: ['images', 'image/tiff'], tiff: ['images', 'image/tiff'],
  doc: ['word', 'application/msword'],
  docx: ['word', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xls: ['excel', 'application/vnd.ms-excel'],
  xlsx: ['excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ppt: ['powerpoint', 'application/vnd.ms-powerpoint'],
  pptx: ['powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  zip: ['zip', 'application/zip'],
};
export const acceptedDocumentExtensions = Object.keys(types).map(ext => '.' + ext).join(',');
export function documentType(filename) {
  if (typeof filename !== 'string') return null;
  const extension = filename.split('.').pop().toLowerCase();
  const info = types[extension];
  return info ? { extension, file_type: info[0], mime_type: info[1] } : null;
}
export function isPdfDocument(document) {
  return document.mime_type ? document.mime_type === 'application/pdf' : documentType(document.name)?.file_type === 'pdf';
}
export function alternateDocumentName(name, hash) {
  const dot = name.lastIndexOf('.');
  return `${name.slice(0,dot)} [alt-${hash.slice(0,8)}]${name.slice(dot)}`;
}
