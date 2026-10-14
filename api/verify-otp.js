'use strict';
const crypto = require('crypto');
const L = require('./_lib');

function safeEq(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = async function (req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return L.json(res, 405, { ok: false, error: 'method-not-allowed' }); }
  const body = L.readBody(req);
  if (!body) return L.json(res, 400, { ok: false, error: 'bad-request' });

  const email = String(body.email || '').trim().toLowerCase();
  const code = String(body.code || '').replace(/\s+/g, '');
  const token = String(body.token || '');
  if (!/^\d{6}$/.test(code) || !token) return L.json(res, 422, { ok: false, error: 'invalid-code' });

  const cfg = L.config();
  if (!cfg.secret) return L.json(res, 503, { ok: false, error: 'not-configured' });

  const parts = token.split('.');
  let payload = null;
  try { payload = JSON.parse(Buffer.from(parts[0] || '', 'base64url').toString('utf8')); } catch (e) {}
  if (parts.length !== 2 || !payload || payload.e !== email) return L.json(res, 400, { ok: false, error: 'no-code' });
  if (Math.floor(Date.now() / 1000) > payload.x) return L.json(res, 410, { ok: false, error: 'expired' });

  await new Promise(r => setTimeout(r, 400));   // small delay slows down guessing
  if (!safeEq(parts[1], L.sign(cfg.secret, email, payload.x, code))) return L.json(res, 401, { ok: false, error: 'wrong-code' });
  return L.json(res, 200, { ok: true, email });
};
