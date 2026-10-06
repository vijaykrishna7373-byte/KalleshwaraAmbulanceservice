const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const HTML_FILE = path.join(ROOT_DIR, 'index.html');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const LEAD_NOTIFICATION_EMAIL = process.env.LEAD_NOTIFICATION_EMAIL || 'prashanthlingarajappa15@gmail.com';
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || '';
const RESEND_FROM_NAME = process.env.RESEND_FROM_NAME || 'Kalleshwara Ambulance';
const IS_VERCEL = process.env.VERCEL === '1';

app.disable('x-powered-by');
app.use(express.json({ limit: '25kb' }));
app.use(express.urlencoded({ extended: true, limit: '25kb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return next();
});
if (!IS_VERCEL) {
  app.use('/images', express.static(path.join(ROOT_DIR, 'images'), { maxAge: '7d', fallthrough: false }));
}

function normalizeString(value, maxLength = 2000) {
  if (value === undefined || value === null) {
    return '';
  }

  const text = String(value).replace(/\u0000/g, '').trim();
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function escapeHtml(value) {
  return normalizeString(value, 5000)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isValidEmail(email) {
  if (!email) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
  if (!phone) return false;
  const trimmed = normalizeString(phone, 32);
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 && /^[+0-9()\-\s]+$/.test(trimmed);
}

function dateKey(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('');
}

function leadIdFor(date = new Date()) {
  return `KA-${dateKey(date)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function formatSubmittedAt(date = new Date()) {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Asia/Kolkata'
  }).format(date);
}

function toStringMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined || raw === null) continue;
    if (Array.isArray(raw)) {
      out[key] = raw.map((item) => normalizeString(item, 500)).filter(Boolean).join(', ');
    } else {
      out[key] = normalizeString(raw, 500);
    }
  }
  return out;
}

function buildLeadPayload(body, request) {
  const sourcePage = normalizeString(body.sourcePage || request.get('referer') || request.get('origin'), 1000);
  const sourceUrl = normalizeString(body.sourceUrl || request.get('referer') || '', 1000);
  const name = normalizeString(body.name, 120);
  const phone = normalizeString(body.phone, 40);
  const email = normalizeString(body.email, 160);
  const service = normalizeString(body.service, 120);
  const subject = normalizeString(body.subject, 160);
  const message = normalizeString(body.message, 4000);
  const pickup = normalizeString(body.pickup, 160);
  const destination = normalizeString(body.destination, 160);
  const companyName = normalizeString(body.companyName, 160);
  const location = normalizeString(body.location, 160);
  const preferredDate = normalizeString(body.date, 40);
  const preferredTime = normalizeString(body.time, 40);

  const errors = [];
  if (!name) errors.push('name is required');
  if (!phone) errors.push('phone is required');
  if (!pickup) errors.push('pickup is required');
  if (!destination) errors.push('destination is required');
  if (!service) errors.push('service is required');
  if (!isValidPhone(phone)) errors.push('phone format is invalid');
  if (!isValidEmail(email)) errors.push('email format is invalid');

  const knownKeys = new Set([
    'name',
    'phone',
    'email',
    'service',
    'subject',
    'message',
    'companyName',
    'location',
    'pickup',
    'destination',
    'date',
    'time',
    'sourcePage',
    'sourceUrl'
  ]);

  const additionalFields = toStringMap(body);
  for (const key of knownKeys) {
    delete additionalFields[key];
  }

  return {
    errors,
    lead: {
      leadId: leadIdFor(),
      name,
      phone,
      email,
      service,
      subject,
      message,
      companyName,
      location,
      pickup,
      destination,
      preferredDate,
      preferredTime,
      sourcePage,
      sourceUrl,
      additionalFields,
      submittedAt: new Date().toISOString(),
      submittedAtDisplay: formatSubmittedAt(),
      emailStatus: 'pending'
    }
  };
}

function buildEmailParts(lead) {
  const customerLines = [];
  if (lead.name) customerLines.push(`Name: ${lead.name}`);
  if (lead.phone) customerLines.push(`Phone: ${lead.phone}`);
  if (lead.email) customerLines.push(`Email: ${lead.email}`);

  const enquiryLines = [];
  if (lead.service) enquiryLines.push(`Service: ${lead.service}`);
  if (lead.subject) enquiryLines.push(`Subject: ${lead.subject}`);
  if (lead.pickup) enquiryLines.push(`Pickup location: ${lead.pickup}`);
  if (lead.destination) enquiryLines.push(`Destination: ${lead.destination}`);
  if (lead.preferredDate) enquiryLines.push(`Preferred date: ${lead.preferredDate}`);
  if (lead.preferredTime) enquiryLines.push(`Preferred time: ${lead.preferredTime}`);
  if (lead.message) enquiryLines.push(`Message: ${lead.message}`);

  const additionalLines = [];
  if (lead.companyName) additionalLines.push(`Company name: ${lead.companyName}`);
  if (lead.location) additionalLines.push(`Location: ${lead.location}`);
  for (const [key, value] of Object.entries(lead.additionalFields || {})) {
    if (value) additionalLines.push(`${key}: ${value}`);
  }

  const textLines = ['NEW WEBSITE LEAD', ''];
  if (customerLines.length) {
    textLines.push('Customer Details');
    textLines.push(...customerLines);
    textLines.push('');
  }
  if (enquiryLines.length) {
    textLines.push('Enquiry Details');
    textLines.push(...enquiryLines);
    textLines.push('');
  }
  if (additionalLines.length) {
    textLines.push('Additional Details');
    textLines.push(...additionalLines);
    textLines.push('');
  }
  if (lead.sourcePage) {
    textLines.push(`Source: ${lead.sourcePage}`);
  }
  if (lead.sourceUrl && lead.sourceUrl !== lead.sourcePage) {
    textLines.push(`Source URL: ${lead.sourceUrl}`);
  }
  textLines.push(`Submitted: ${lead.submittedAtDisplay}`);

  const htmlSections = [];
  if (customerLines.length) {
    htmlSections.push(`
      <h2 style="margin:24px 0 10px;font-size:18px;">Customer Details</h2>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
        ${customerLines.map((line) => `<tr><td style="padding:6px 0;color:#1f2937;font-size:14px;">${escapeHtml(line)}</td></tr>`).join('')}
      </table>
    `);
  }
  if (enquiryLines.length) {
    htmlSections.push(`
      <h2 style="margin:24px 0 10px;font-size:18px;">Enquiry Details</h2>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
        ${enquiryLines.map((line) => `<tr><td style="padding:6px 0;color:#1f2937;font-size:14px;">${escapeHtml(line)}</td></tr>`).join('')}
      </table>
    `);
  }
  if (additionalLines.length) {
    htmlSections.push(`
      <h2 style="margin:24px 0 10px;font-size:18px;">Additional Details</h2>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
        ${additionalLines.map((line) => `<tr><td style="padding:6px 0;color:#1f2937;font-size:14px;">${escapeHtml(line)}</td></tr>`).join('')}
      </table>
    `);
  }

  if (lead.sourcePage || lead.sourceUrl) {
    htmlSections.push(`
      <h2 style="margin:24px 0 10px;font-size:18px;">Source</h2>
      <p style="margin:0 0 8px;color:#1f2937;font-size:14px;">${escapeHtml(lead.sourcePage || lead.sourceUrl)}</p>
      ${lead.sourceUrl && lead.sourceUrl !== lead.sourcePage ? `<p style="margin:0 0 8px;color:#1f2937;font-size:14px;">Source URL: ${escapeHtml(lead.sourceUrl)}</p>` : ''}
    `);
  }

  htmlSections.push(`
    <h2 style="margin:24px 0 10px;font-size:18px;">Submitted</h2>
    <p style="margin:0;color:#1f2937;font-size:14px;">${escapeHtml(lead.submittedAtDisplay)}</p>
  `);

  return {
    subject: `New Website Lead - ${lead.name || 'Website Enquiry'}`,
    text: textLines.join('\n'),
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#111827;background:#f8fafc;padding:24px;">
        <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;padding:24px;">
          <p style="margin:0 0 10px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#0f766e;font-weight:700;">New Website Lead</p>
          <h1 style="margin:0 0 18px;font-size:24px;color:#0f172a;">${escapeHtml(lead.name || 'Website Enquiry')}</h1>
          ${htmlSections.join('')}
        </div>
      </div>
    `
  };
}

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(LEADS_FILE);
  } catch {
    await fs.writeFile(LEADS_FILE, '[]', 'utf8');
  }
}

async function readLeads() {
  await ensureDataFile();
  const raw = await fs.readFile(LEADS_FILE, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeLeads(leads) {
  await ensureDataFile();
  await fs.writeFile(LEADS_FILE, JSON.stringify(leads, null, 2), 'utf8');
}

async function saveLead(lead) {
  const leads = await readLeads();
  leads.push(lead);
  await writeLeads(leads);
}

async function updateLead(leadId, updater) {
  const leads = await readLeads();
  const index = leads.findIndex((item) => item.leadId === leadId);
  if (index === -1) {
    return null;
  }

  leads[index] = { ...leads[index], ...updater(leads[index]) };
  await writeLeads(leads);
  return leads[index];
}

async function sendLeadEmail(lead) {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL || !LEAD_NOTIFICATION_EMAIL) {
    throw new Error('Resend is not configured with RESEND_API_KEY, RESEND_FROM_EMAIL, or LEAD_NOTIFICATION_EMAIL.');
  }

  const email = buildEmailParts(lead);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`,
      to: [LEAD_NOTIFICATION_EMAIL],
      subject: email.subject,
      text: email.text,
      html: email.html
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Resend returned ${response.status}: ${errorText}`);
  }
}

app.get('/', (_req, res) => {
  res.sendFile(HTML_FILE);
});

app.get('/robots.txt', (_req, res) => res.sendFile(path.join(ROOT_DIR, 'robots.txt')));
app.get('/sitemap.xml', (_req, res) => res.sendFile(path.join(ROOT_DIR, 'sitemap.xml')));

app.post('/api/leads', async (req, res) => {
  const { errors, lead } = buildLeadPayload(req.body || {}, req);

  if (errors.length) {
    return res.status(400).json({
      success: false,
      message: 'Please check the submitted details and try again.',
      errors
    });
  }

  // Vercel function filesystems are ephemeral/read-only. Treat email delivery as
  // the production handoff until a durable database is configured.
  if (IS_VERCEL) {
    try {
      await sendLeadEmail(lead);
      return res.status(201).json({ success: true, leadId: lead.leadId, emailStatus: 'sent' });
    } catch (error) {
      console.error('Lead notification failed:', { leadId: lead.leadId, message: normalizeString(error.message, 200) });
      return res.status(503).json({
        success: false,
        message: 'We could not send your enquiry right now. Please call +91 90662 83566 or try again shortly.'
      });
    }
  }

  try {
    await saveLead(lead);
  } catch (error) {
    console.error('Lead storage failed:', { leadId: lead.leadId, message: normalizeString(error.message, 200) });
    return res.status(500).json({ success: false, message: 'We could not save your enquiry right now. Please call +91 90662 83566.' });
  }

  try {
    await sendLeadEmail(lead);
    await updateLead(lead.leadId, () => ({
      emailStatus: 'sent',
      emailSentAt: new Date().toISOString()
    }));

    return res.status(201).json({
      success: true,
      leadId: lead.leadId,
      emailStatus: 'sent'
    });
  } catch (error) {
    console.error('Lead email failed:', { leadId: lead.leadId, message: normalizeString(error.message, 200) });
    try {
      await updateLead(lead.leadId, () => ({
        emailStatus: 'failed',
        emailErrorAt: new Date().toISOString()
      }));
    } catch (storageError) {
      console.error('Lead email status could not be saved:', { leadId: lead.leadId, message: normalizeString(storageError.message, 200) });
    }

    return res.status(202).json({
      success: true,
      leadId: lead.leadId,
      emailStatus: 'failed',
      message: 'Your enquiry was saved, but its email notification could not be sent right now.'
    });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

function start() {
  return app.listen(PORT, () => {
    console.log(`Kalleshwara Ambulance server running on port ${PORT}`);
  });
}

if (require.main === module) {
  start();
}

module.exports = app;
module.exports.start = start;
