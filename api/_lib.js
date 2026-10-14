/* Northlight — shared helpers for the Vercel serverless OTP endpoints.
   Files starting with "_" are not exposed as routes by Vercel.
   Secrets come ONLY from Vercel Environment Variables:
     BREVO_API_KEY      Brevo API key (starts with xkeysib-…)
     OTP_SENDER_EMAIL   a sender verified in Brevo (e.g. camasurapael@gmail.com)
     OTP_SENDER_NAME    optional, default "Northlight Studio"
     OTP_SECRET         optional long random string used to sign codes (falls back to the API key)
*/
'use strict';
const crypto = require('crypto');
const fs = require('fs');

const OTP_TTL = 300;      // seconds a code stays valid
const OTP_COOLDOWN = 30;  // seconds before the browser may ask for another code
const GMAIL_RE = /^[a-z0-9.]{6,30}@(gmail|googlemail)\.com$/i;

function config() {
  return {
    apiKey: process.env.BREVO_API_KEY || '',
    senderEmail: process.env.OTP_SENDER_EMAIL || '',
    senderName: process.env.OTP_SENDER_NAME || 'Northlight Studio',
    secret: process.env.OTP_SECRET || process.env.BREVO_API_KEY || (process.env.OTP_MOCK_FILE ? 'mock-secret' : '')
  };
}

function b64u(buf) { return Buffer.from(buf).toString('base64url'); }
function sign(secret, email, exp, code) {
  return crypto.createHmac('sha256', secret).update(email + '|' + exp + '|' + code).digest('base64url');
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  return b && typeof b === 'object' ? b : null;
}

function mask(email) {
  const [local, domain] = email.split('@');
  const keep = Math.max(1, Math.min(2, local.length - 1));
  return local.slice(0, keep) + '*'.repeat(Math.max(2, local.length - keep)) + '@' + domain;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Sends one transactional email through Brevo. OTP_MOCK_FILE (tests only) writes to a file instead. */
async function sendMail(to, subject, html, text) {
  const cfg = config();
  if (process.env.OTP_MOCK_FILE) {
    fs.appendFileSync(process.env.OTP_MOCK_FILE, JSON.stringify({ to, subject, text }) + '\n');
    return { ok: true };
  }
  if (!cfg.apiKey || !cfg.senderEmail) return { ok: false, reason: 'not-configured' };
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': cfg.apiKey },
      body: JSON.stringify({
        sender: { name: cfg.senderName, email: cfg.senderEmail },
        to: [{ email: to }], subject, htmlContent: html, textContent: text
      })
    });
    if (r.ok) return { ok: true };
    const data = await r.json().catch(() => ({}));
    console.error('Brevo send failed', r.status, JSON.stringify(data));
    return { ok: false, reason: 'brevo', detail: data.message || ('HTTP ' + r.status) };
  } catch (e) {
    console.error('Brevo unreachable', e);
    return { ok: false, reason: 'network' };
  }
}

module.exports = { OTP_TTL, OTP_COOLDOWN, GMAIL_RE, config, b64u, sign, json, readBody, mask, escapeHtml, sendMail };
