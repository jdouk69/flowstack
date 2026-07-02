import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

function getHeader(headers, name) {
  const header = headers?.find(h => h.name.toLowerCase() === name.toLowerCase());
  return header ? header.value : '';
}

function countPdfAttachments(payload) {
  let count = 0;
  function walk(parts) {
    if (!parts) return;
    for (const part of parts) {
      if (part.filename && part.mimeType === 'application/pdf') count++;
      if (part.parts) walk(part.parts);
    }
  }
  if (payload) walk(payload.parts);
  return count;
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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { search_type, email, keyword } = body;

    const searchType = search_type || 'sender_email';
    let query = '';
    if (searchType === 'sender_email' && email) {
      query = `from:${email} has:attachment filename:pdf`;
    } else if (searchType === 'company_name' && keyword) {
      query = `from:${keyword} has:attachment filename:pdf`;
    } else if (searchType === 'gmail_search' && keyword) {
      query = `${keyword} has:attachment filename:pdf`;
    }

    if (!query) return Response.json({ error: 'No valid search criteria' }, { status: 400 });

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('gmail');
    const gmailAuth = { Authorization: `Bearer ${accessToken}` };

    const messageIds = await searchGmail(gmailAuth, query);
    const totalEmails = messageIds.size;

    if (totalEmails === 0) {
      return Response.json({
        emails_found: 0,
        pdfs_found: 0,
        sample_emails: [],
        estimated_time_seconds: 0
      });
    }

    const sampleSize = Math.min(50, totalEmails);
    const idsToFetch = Array.from(messageIds).slice(0, sampleSize);
    let totalPdfs = 0;
    const sampleEmails = [];

    for (let i = 0; i < idsToFetch.length; i++) {
      const message = await getMessage(gmailAuth, idsToFetch[i]);
      if (message) {
        totalPdfs += countPdfAttachments(message.payload);
        if (sampleEmails.length < 5) {
          sampleEmails.push({
            subject: getHeader(message.payload.headers, 'Subject') || '(no subject)',
            from: getHeader(message.payload.headers, 'From'),
            date: getHeader(message.payload.headers, 'Date'),
          });
        }
      }
    }

    const estimatedPdfs = totalEmails > sampleSize
      ? Math.round((totalPdfs / sampleSize) * totalEmails)
      : totalPdfs;

    const estimatedTimeSeconds = Math.round(estimatedPdfs * 1.5);

    return Response.json({
      emails_found: totalEmails,
      pdfs_found: estimatedPdfs,
      sample_emails: sampleEmails,
      estimated_time_seconds: estimatedTimeSeconds
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});