'use strict';
const crypto = require('crypto');
const L = require('./_lib');

module.exports = async function (req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return L.json(res, 405, { ok: false, error: 'method-not-allowed' }); }
  const body = L.readBody(req);
  if (!body) return L.json(res, 400, { ok: false, error: 'bad-request' });

  const email = String(body.email || '').trim().toLowerCase();
  const name = String(body.name || '').trim().slice(0, 60);
  if (!L.GMAIL_RE.test(email)) return L.json(res, 422, { ok: false, error: 'invalid-email' });

  const cfg = L.config();
  if (!cfg.secret) return L.json(res, 503, { ok: false, error: 'not-configured' });

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const exp = Math.floor(Date.now() / 1000) + L.OTP_TTL;
  // Stateless: the code itself is never stored. The browser keeps this signed token and sends it back with the code.
  const token = L.b64u(JSON.stringify({ e: email, x: exp })) + '.' + L.sign(cfg.secret, email, exp, code);

  const mins = Math.round(L.OTP_TTL / 60);
  const hello = name ? 'Hi ' + L.escapeHtml(name) + ',' : 'Hi,';
  const html =
    '<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;color:#111">' +
    '<h2 style="margin:0 0 8px">Northlight Studio</h2><p>' + hello + '</p>' +
    '<p>Your sign-in code is:</p>' +
    '<p style="font-size:34px;letter-spacing:8px;font-weight:700;background:#f3f4f8;padding:14px;text-align:center;border-radius:10px">' + code + '</p>' +
    '<p style="color:#555">It expires in ' + mins + ' minutes. If you did not ask for it, you can ignore this email.</p></div>';
  const text = (name ? 'Hi ' + name + ',\n\n' : '') + 'Your Northlight Studio sign-in code is ' + code + '. It expires in ' + mins + ' minutes.';

  const sent = await L.sendMail(email, code + ' is your Northlight sign-in code', html, text);
  if (!sent.ok) {
    const map = { 'not-configured': 503, brevo: 502, network: 502 };
    return L.json(res, map[sent.reason] || 502, { ok: false, error: sent.reason === 'not-configured' ? 'not-configured' : 'send-failed' });
  }
  return L.json(res, 200, { ok: true, token, expiresIn: L.OTP_TTL, cooldown: L.OTP_COOLDOWN, masked: L.mask(email) });
};
