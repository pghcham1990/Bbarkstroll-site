const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { requireRole } = require('../lib/auth');
const Anthropic = require('@anthropic-ai/sdk');

const INVOICES_DIR = '/var/www/barkstroll.com/invoices';
const VENMO_QR_URL = 'https://barkstroll.com/venmo-qr.png';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// HTML template (CSS + structure) extracted from the reference invoice
const INVOICE_CSS = `
  :root {
    --green: #3a5c3a; --green-light: #4e7a4e; --green-pale: #eef4ee;
    --cream: #faf8f4; --warm-white: #ffffff; --border: #e2ddd5;
    --text-dark: #1e2b1e; --text-mid: #4a5a4a; --text-light: #8a9e8a; --accent: #c8a84b;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', sans-serif; background: var(--cream); color: var(--text-dark); min-height: 100vh; display: flex; justify-content: center; align-items: flex-start; padding: 40px 20px; }
  .invoice { background: var(--warm-white); width: 780px; border-radius: 6px; overflow: hidden; box-shadow: 0 4px 40px rgba(58,92,58,0.10); border: 1px solid var(--border); }
  .header { background: var(--green); color: white; padding: 44px 52px 38px; position: relative; overflow: hidden; }
  .header::before { content: '🐾'; position: absolute; right: 52px; top: 50%; transform: translateY(-50%); font-size: 120px; opacity: 0.06; pointer-events: none; }
  .header-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
  .brand { display: flex; align-items: center; gap: 14px; }
  .logo-circle { width: 52px; height: 52px; background: rgba(255,255,255,0.12); border: 2px solid rgba(255,255,255,0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px; flex-shrink: 0; }
  .brand-text h1 { font-family: 'Playfair Display', serif; font-size: 26px; font-weight: 700; color: white; letter-spacing: -0.3px; }
  .brand-text p { font-size: 11.5px; color: rgba(255,255,255,0.55); letter-spacing: 1.2px; text-transform: uppercase; margin-top: 3px; }
  .invoice-meta { text-align: right; }
  .invoice-label { font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: rgba(255,255,255,0.45); margin-bottom: 4px; }
  .invoice-number { font-family: 'Playfair Display', serif; font-size: 26px; font-weight: 600; color: var(--accent); }
  .invoice-date { font-size: 12px; color: rgba(255,255,255,0.5); margin-top: 4px; }
  .header-bottom { display: flex; justify-content: space-between; align-items: flex-end; }
  .contact-info p { font-size: 12.5px; color: rgba(255,255,255,0.6); line-height: 1.8; }
  .status-badge { background: var(--accent); color: #1a1a1a; font-size: 10.5px; font-weight: 600; letter-spacing: 1.2px; text-transform: uppercase; padding: 6px 16px; border-radius: 20px; }
  .body { padding: 48px 52px; }
  .billing-row { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-bottom: 44px; padding-bottom: 40px; border-bottom: 1px solid var(--border); }
  .billing-section h3 { font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: var(--text-light); margin-bottom: 12px; }
  .client-name { font-family: 'Playfair Display', serif; font-size: 20px; font-weight: 600; color: var(--text-dark); margin-bottom: 4px; }
  .billing-section p { font-size: 13.5px; color: var(--text-mid); line-height: 1.7; }
  .pet-tag { display: inline-flex; align-items: center; gap: 5px; background: var(--green-pale); border: 1px solid #c8dcc8; color: var(--green); font-size: 11.5px; font-weight: 500; padding: 4px 12px; border-radius: 20px; margin-top: 10px; }
  .services-label { font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: var(--text-light); margin-bottom: 14px; }
  .services-table { width: 100%; border-collapse: collapse; margin-bottom: 32px; }
  .services-table thead tr { background: var(--green-pale); }
  .services-table thead th { font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--green); font-weight: 500; padding: 11px 16px; text-align: left; }
  .services-table thead th:last-child { text-align: right; }
  .services-table tbody tr { border-bottom: 1px solid #f2ede6; }
  .services-table tbody tr:last-child { border-bottom: none; }
  .services-table tbody td { padding: 18px 16px; vertical-align: top; }
  .overnight-badge { display: inline-block; background: var(--green); color: white; font-size: 9px; letter-spacing: 1px; text-transform: uppercase; padding: 2px 8px; border-radius: 3px; margin-bottom: 5px; }
  .service-name { font-size: 14px; font-weight: 500; color: var(--text-dark); margin-bottom: 3px; }
  .service-detail { font-size: 12px; color: var(--text-light); line-height: 1.6; }
  .service-price { font-size: 14px; font-weight: 500; color: var(--text-dark); text-align: right; white-space: nowrap; }
  .totals { margin-left: auto; width: 280px; }
  .totals-row { display: flex; justify-content: space-between; align-items: center; padding: 9px 0; font-size: 13.5px; color: var(--text-mid); border-bottom: 1px solid var(--border); }
  .totals-row:last-child { border-bottom: none; }
  .totals-total { background: var(--green); color: white; padding: 16px 20px; border-radius: 5px; margin-top: 12px; display: flex; justify-content: space-between; align-items: center; }
  .totals-total span:first-child { font-size: 10.5px; letter-spacing: 1.5px; text-transform: uppercase; color: rgba(255,255,255,0.65); }
  .totals-total span:last-child { font-family: 'Playfair Display', serif; font-size: 24px; font-weight: 700; color: var(--accent); }
  .notes { margin-top: 44px; padding-top: 36px; border-top: 1px solid var(--border); display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
  .notes h3 { font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: var(--text-light); margin-bottom: 12px; }
  .notes p { font-size: 13px; color: var(--text-mid); line-height: 1.7; }
  .payment-box { background: var(--green-pale); border: 1px solid #c8dcc8; border-radius: 5px; padding: 20px; }
  .payment-box h3 { font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: var(--green); margin-bottom: 14px; }
  .payment-inner { display: flex; gap: 16px; align-items: flex-start; }
  .payment-details { flex: 1; }
  .venmo-handle { font-weight: 700; color: var(--text-dark); font-size: 15px; margin-bottom: 4px; }
  .venmo-sub { font-size: 11.5px; color: var(--text-light); margin-bottom: 10px; }
  .payment-note { font-size: 11.5px; color: var(--green); font-style: italic; line-height: 1.5; border-top: 1px solid #c8dcc8; padding-top: 10px; margin-top: 2px; }
  .footer { background: var(--green-pale); border-top: 1px solid #c8dcc8; padding: 22px 52px; display: flex; justify-content: space-between; align-items: center; }
  .footer p { font-size: 11.5px; color: var(--text-light); }
  .footer .thank-you { font-family: 'Playfair Display', serif; font-size: 13.5px; color: var(--green); font-style: italic; }
  @media print { body { background: white; padding: 0; } .invoice { box-shadow: none; width: 100%; border: none; } }
`;

function getSystemPrompt(docType) {
  const typeLabel = docType === 'proposal' ? 'Proposal' : 'Invoice';
  return `You are a document generator for Bark & Stroll, a professional pet care company in Bridgeville, PA owned by Scott Rocca. You generate the HTML body content for ${typeLabel.toLowerCase()}s.

Given a plain English description of services, you must output ONLY a valid JSON object (no markdown, no explanation) with these fields:

{
  "doc_label": "${typeLabel}",
  "status_badge": "Payment Due Before Service",
  "service_period_title": "Friday, March 21 — Sunday, March 23, 2026",
  "service_period_detail": "Weekend Care Package<br>5 scheduled visits + 2 overnight stays",
  "services": [
    {
      "is_overnight": false,
      "name": "Afternoon Visit",
      "detail": "Walk, feeding & post-meal bathroom break",
      "date_time": "Sat Mar 22<br>1:00 PM – 2:00 PM",
      "price": "$30.00"
    }
  ],
  "subtotal": "$349.99",
  "tax": "$0.00",
  "total": "$349.99",
  "care_notes": "Description of care provided, mentioning pet by name and any relevant details."
}

Rules:
- For overnight services, set is_overnight to true and format date_time as "Fri Mar 21, 7:00 PM<br>→ Sat Mar 22, 6:00 AM"
- For proposals, change status_badge to "Proposed Services" and make care_notes describe what is being proposed
- Calculate subtotal and total correctly from individual service prices
- If the user provides a total, distribute prices across services to match that total exactly
- Use professional service descriptions (e.g. "Full overnight care, feeding, routine & crate management")
- Format all prices as $XX.XX
- Use proper date formatting with day of week abbreviations
- Be smart about interpreting plain English — "friday 7pm to saturday 6am" means an overnight stay
- Keep responses concise and professional`;
}

// Generate or refine document via Anthropic
router.post('/documents/generate', requireRole('admin'), async (req, res) => {
  try {
    const { customer_id, doc_type, prompt, conversation } = req.body;
    if (!customer_id || !prompt) {
      return res.status(400).json({ error: 'customer_id and prompt required' });
    }

    // Get customer + dogs
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    const dogs = db.prepare('SELECT * FROM dogs WHERE customer_id = ? ORDER BY name').all(customer_id);

    const type = doc_type || 'invoice';
    const clientInfo = `Client: ${customer.first_name} ${customer.last_name}\nAddress: ${customer.address || 'Bridgeville, PA'}\nPets: ${dogs.map(d => d.name + (d.breed ? ' (' + d.breed + ')' : '')).join(', ') || 'N/A'}`;

    // Build messages for conversation continuity
    const messages = [];
    if (conversation && conversation.length) {
      for (const msg of conversation) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
    messages.push({
      role: 'user',
      content: `${clientInfo}\n\n${prompt}`
    });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: getSystemPrompt(type),
      messages
    });

    try {
      require('/opt/shared/llm-usage').createUsageLog('/opt/shared/llm-usage.db').record({
        app: 'barkstroll', model: 'claude-sonnet-4-20250514', kind: 'bs_document', source: 'anthropic',
        input_tokens: response.usage && response.usage.input_tokens,
        output_tokens: response.usage && response.usage.output_tokens,
      });
    } catch (e) { /* usage logging must never break the feature */ }

    const aiText = response.content[0].text;
    let docData;
    try {
      // Extract JSON from response (handle possible markdown wrapping)
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');
      docData = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      return res.status(500).json({ error: 'AI returned invalid JSON', raw: aiText });
    }

    // Build the full HTML document
    const petTags = dogs.map(d =>
      `<div class="pet-tag">🐶 ${escHtml(d.name)}${d.breed ? ' &nbsp;·&nbsp; ' + escHtml(d.breed) : ''}</div>`
    ).join('\n        ');

    // Generate document number
    const now = new Date();
    const docNum = `#BBS-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    // Build services rows.
    // SECURITY: every docData.* field comes from an LLM JSON response. A prompt
    // injection in the human-readable input can plant <script> / event-handler
    // payloads in these strings, which then execute when the rendered HTML is
    // viewed at /invoices/*.html. Escape everything that flows from the model.
    const serviceRows = docData.services.map(s => `
        <tr>
          <td>
            ${s.is_overnight ? '<div class="overnight-badge">Overnight</div>' : ''}
            <div class="service-name">${escHtml(s.name)}</div>
            <div class="service-detail">${escHtml(s.detail)}</div>
          </td>
          <td><div class="service-detail">${escHtmlBr(s.date_time)}</div></td>
          <td class="service-price">${escHtml(s.price)}</td>
        </tr>`).join('');

    // Payment section for invoices (not proposals)
    const paymentSection = type === 'invoice' ? `
      <div class="payment-box">
        <h3>Payment Instructions</h3>
        <div class="payment-details" style="padding:0">
          <div class="venmo-handle">@Scott-Rocca</div>
          <div class="venmo-sub">Venmo · Search by username</div>
          <div class="payment-note">Please include "${docNum}" in your payment note for easy matching.</div>
        </div>
      </div>` : `
      <div>
        <h3>${type === 'proposal' ? 'Next Steps' : 'Payment'}</h3>
        <p>If you'd like to proceed with these services, just let us know and we'll get everything scheduled. Payment is due before service begins.</p>
      </div>`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bark & Stroll, ${escHtml(docData.doc_label || (type === 'proposal' ? 'Proposal' : 'Invoice'))}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
<style>${INVOICE_CSS}</style>
</head>
<body>
<div class="invoice">
  <div class="header">
    <div class="header-top">
      <div class="brand">
        <div class="logo-circle">🐾</div>
        <div class="brand-text">
          <h1>Bark & Stroll</h1>
          <p>Professional Pet Care · Bridgeville, PA</p>
        </div>
      </div>
      <div class="invoice-meta">
        <div class="invoice-label">${escHtml(docData.doc_label || (type === 'proposal' ? 'Proposal' : 'Invoice'))}</div>
        <div class="invoice-number">${docNum}</div>
        <div class="invoice-date">Issued: ${dateStr}</div>
      </div>
    </div>
    <div class="header-bottom">
      <div class="contact-info">
        <p>Scott Rocca &nbsp;·&nbsp; Bark & Stroll LLC</p>
        <p>(412) 992-1480 &nbsp;·&nbsp; barkstroll.com</p>
        <p>Bridgeville, PA</p>
      </div>
      <div class="status-badge">${escHtml(docData.status_badge || 'Payment Due Before Service')}</div>
    </div>
  </div>

  <div class="body">
    <div class="billing-row">
      <div class="billing-section">
        <h3>Billed To</h3>
        <div class="client-name">${escHtml(customer.first_name)} ${escHtml(customer.last_name)}</div>
        <p>${escHtml(customer.address || 'Bridgeville, PA')}</p>
        ${petTags}
      </div>
      <div class="billing-section">
        <h3>Service Period</h3>
        <p><strong>${escHtml(docData.service_period_title)}</strong></p>
        <p style="margin-top:6px;">${escHtmlBr(docData.service_period_detail)}</p>
      </div>
    </div>

    <div class="services-label">Services ${type === 'proposal' ? 'Proposed' : 'Rendered'}</div>
    <table class="services-table">
      <thead>
        <tr>
          <th style="width:55%">Service</th>
          <th>Date & Time</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>${serviceRows}
      </tbody>
    </table>

    <div class="totals">
      <div class="totals-row"><span>Subtotal</span><span>${escHtml(docData.subtotal)}</span></div>
      <div class="totals-row"><span>Tax</span><span>${escHtml(docData.tax || '$0.00')}</span></div>
      <div class="totals-total">
        <span>Total ${type === 'proposal' ? 'Estimated' : 'Due'}</span>
        <span>${escHtml(docData.total)}</span>
      </div>
    </div>

    <div class="notes">
      <div>
        <h3>Care Notes</h3>
        <p>${escHtml(docData.care_notes)}</p>
      </div>
      ${paymentSection}
    </div>
  </div>

  <div class="footer">
    <p class="thank-you">Thank you for trusting Bark & Stroll 🐾</p>
    <p>barkstroll.com &nbsp;·&nbsp; (412) 992-1480</p>
  </div>
</div>
</body>
</html>`;

    // Update conversation for continuity
    const updatedConversation = [...(conversation || [])];
    updatedConversation.push({ role: 'user', content: prompt });
    updatedConversation.push({ role: 'assistant', content: aiText });

    res.json({
      html,
      doc_data: docData,
      doc_number: docNum,
      conversation: updatedConversation
    });
  } catch (err) {
    console.error('Document generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Save document (generate PDF + persist)
router.post('/documents/save', requireRole('admin'), async (req, res) => {
  try {
    const { customer_id, doc_type, html_content, conversation, doc_number, visits_json } = req.body;
    if (!customer_id || !html_content) {
      return res.status(400).json({ error: 'customer_id and html_content required' });
    }

    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    const dogs = db.prepare('SELECT * FROM dogs WHERE customer_id = ? ORDER BY name').all(customer_id);

    const type = doc_type || 'invoice';

    // Build filename: BBS OwnerName_DogName_YYYY-MM-DD
    const ownerName = `${customer.first_name} ${customer.last_name}`.replace(/[^a-zA-Z0-9 ]/g, '').trim();
    const dogName = dogs.map(d => d.name).join('-') || 'NoDog';
    const now = new Date();
    const dateStamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const fileId = crypto.randomBytes(6).toString('hex');
    const filename = `BBS ${ownerName}_${dogName}_${dateStamp}_${fileId}`;
    const safeFilename = filename.replace(/[^a-zA-Z0-9 _\-]/g, '');

    const htmlPath = path.join(INVOICES_DIR, safeFilename + '.html');
    const pdfPath = path.join(INVOICES_DIR, safeFilename + '.pdf');

    const pdfHtml = html_content;

    // Generate PDF with puppeteer-core
    const puppeteer = require('puppeteer-core');
    const browser = await puppeteer.launch({
      executablePath: '/snap/bin/chromium',
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      headless: 'new'
    });
    try {
      const page = await browser.newPage();
      await page.setContent(pdfHtml, { waitUntil: 'networkidle0' });
      await page.pdf({ path: pdfPath, format: 'Letter', printBackground: true });
    } finally {
      await browser.close();
    }

    // Save web-friendly HTML (with https QR URL)
    fs.writeFileSync(htmlPath, html_content, 'utf8');

    // Save to database
    const result = db.prepare(`
      INSERT INTO documents (customer_id, type, doc_number, file_id, filename, html_content, conversation, status, visits_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'saved', ?)
    `).run(
      customer_id,
      type,
      doc_number || '',
      fileId,
      safeFilename,
      html_content,
      JSON.stringify(conversation || []),
      visits_json ? JSON.stringify(typeof visits_json === 'string' ? JSON.parse(visits_json) : visits_json) : null
    );

    res.json({
      ok: true,
      id: result.lastInsertRowid,
      file_id: fileId,
      filename: safeFilename,
      pdf_url: `/invoices/${safeFilename}.pdf`,
      html_url: `/invoices/${safeFilename}.html`
    });
  } catch (err) {
    console.error('Document save error:', err);
    res.status(500).json({ error: err.message });
  }
});

// List documents for a customer
router.get('/documents/:customerId', requireRole('admin'), (req, res) => {
  const docs = db.prepare(`
    SELECT id, type, doc_number, file_id, filename, status, created_at, updated_at
    FROM documents WHERE customer_id = ? ORDER BY created_at DESC
  `).all(req.params.customerId);
  res.json(docs);
});

// Get single document
router.get('/documents/detail/:id', requireRole('admin'), (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.json(doc);
});

// Delete a document
router.delete('/documents/:id', requireRole('admin'), (req, res) => {
  try {
    const doc = db.prepare('SELECT id, filename FROM documents WHERE id = ?').get(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });

    const fs = require('fs');
    const path = require('path');
    const invoiceDir = '/var/www/barkstroll.com/invoices';
    const pdfPath = path.join(invoiceDir, doc.filename + '.pdf');
    const htmlPath = path.join(invoiceDir, doc.filename + '.html');

    if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
    if (fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath);

    db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Document delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Like escHtml, but honors line breaks: escape everything for XSS safety, then
// restore the <br> tags the AI is instructed to emit (service_period_detail,
// date_time) plus any real newlines. Only <br> survives; <script> etc. stay
// escaped. Function declaration so it hoists above the render fn that uses it.
function escHtmlBr(s) {
  return escHtml(s).replace(/&lt;br\s*\/?&gt;/gi, '<br>').replace(/\r\n|\r|\n/g, '<br>');
}

function escRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = router;
