// Provider-independent, read-only preview logic used by the personal Google OAuth adapter.
const extensions = {
  pdf: ['pdf'], images: ['jpg', 'jpeg', 'png', 'heic', 'gif', 'webp', 'tif', 'tiff'],
  word: ['doc', 'docx'], excel: ['xls', 'xlsx'], powerpoint: ['ppt', 'pptx'], zip: ['zip'],
};

export function previewCriteria(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid search criteria');
  const searchType = input.search_type || 'sender_email';
  const text = searchType === 'sender_email' ? input.email : input.keyword;
  if (typeof text !== 'string' || !text.trim() || text.length > 2000 || /[\r\n\0]/.test(text)) {
    throw new Error('Enter valid search criteria');
  }
  const value = text.trim();
  let query;
  if (searchType === 'sender_email') {
    if (!/^[^\s<>"():]+@[^\s<>"():]+\.[^\s<>"():]+$/.test(value)) throw new Error('Enter a valid sender email');
    query = `from:${value} has:attachment`;
  } else if (searchType === 'company_name') {
    // Preserve the original sender-name search while keeping multiword names one term.
    query = `from:"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" has:attachment`;
  } else if (searchType === 'gmail_search') {
    query = `(${value}) has:attachment`;
  } else throw new Error('Unsupported search type');
  const fileTypes = input.file_types?.length ? input.file_types : ['pdf'];
  if (!Array.isArray(fileTypes) || fileTypes.length > 6 || fileTypes.some(t => !Object.hasOwn(extensions, t))) {
    throw new Error('Unsupported file types');
  }
  return { query, allowedExtensions: new Set(fileTypes.flatMap(t => extensions[t])) };
}

export function countPreviewAttachments(payload, allowedExtensions) {
  let count = 0;
  function walk(part) {
    if (!part) return;
    if (typeof part.filename === 'string') {
      const dot = part.filename.lastIndexOf('.');
      if (dot >= 0 && allowedExtensions.has(part.filename.slice(dot + 1).toLowerCase())) count++;
    }
    for (const child of part.parts || []) walk(child);
  }
  walk(payload);
  return count;
}

/**
 * Adapter contract (not a generic browser-callable proxy):
 * search({query, maxResults, pageToken}) -> {messages: [{id}], nextPageToken?}
 * read(messageId) -> Gmail full message with payload MIME tree.
 * An eligible server-owned adapter must validate provider success and throw on
 * failed reads. This core never reads credentials, downloads, or writes files.
 */
export async function previewCollection(input, provider) {
  const { query, allowedExtensions } = previewCriteria(input);
  const ids = new Set();
  const seenTokens = new Set();
  let nextPageToken;
  for (let page = 0; page < 3; page++) {
    const result = await provider.search({ query, maxResults: 100, pageToken: nextPageToken });
    if (!result || !Array.isArray(result.messages)) throw new Error('Invalid Gmail search response');
    for (const message of result.messages.slice(0, 100)) {
      if (typeof message.id !== 'string' || !message.id) throw new Error('Invalid Gmail message identifier');
      ids.add(message.id);
    }
    nextPageToken = result.nextPageToken;
    if (!nextPageToken) break;
    if (typeof nextPageToken !== 'string' || seenTokens.has(nextPageToken)) throw new Error('Invalid Gmail pagination');
    seenTokens.add(nextPageToken);
  }
  const sampleIds = [...ids].slice(0, 50);
  let observedFiles = 0;
  const sampleEmails = [];
  for (const id of sampleIds) {
    const message = await provider.read(id);
    if (!message?.payload) throw new Error('Could not read a Gmail preview message');
    observedFiles += countPreviewAttachments(message.payload, allowedExtensions);
    if (sampleEmails.length < 5) {
      const header = name => message.payload.headers?.find(h => h.name?.toLowerCase() === name)?.value || '';
      sampleEmails.push({ subject: header('subject') || '(no subject)', from: header('from'), date: header('date') });
    }
  }
  const estimated = ids.size > sampleIds.length;
  const files = estimated ? Math.round(observedFiles / sampleIds.length * ids.size) : observedFiles;
  return {
    emails_found: ids.size, files_found: files, sample_emails: sampleEmails,
    estimated_time_seconds: Math.round(files * 1.5),
    files_found_is_estimate: estimated, search_truncated: Boolean(nextPageToken),
    emails_found_is_lower_bound: Boolean(nextPageToken),
    emails_sampled: sampleIds.length, files_observed: observedFiles,
  };
}
