/* Northlight — verifies a Firebase ID token on the server (Google sign-in users only).
   Reads Firebase; it changes nothing in your Firebase project.
   Optional env: FIREBASE_PROJECT_ID (defaults to northlight-cc676). */
'use strict';
const crypto = require('crypto');

const CERT_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
let certs = null, certsUntil = 0;

const projectId = () => process.env.FIREBASE_PROJECT_ID || 'northlight-cc676';

async function getCerts() {
  if (certs && Date.now() < certsUntil) return certs;
  const r = await fetch(CERT_URL);
  if (!r.ok) throw new Error('cert fetch ' + r.status);
  const m = /max-age=(\d+)/.exec((r.headers && r.headers.get && r.headers.get('cache-control')) || '');
  certs = await r.json();
  certsUntil = Date.now() + (m ? Math.min(+m[1], 21600) : 3600) * 1000;
  return certs;
}

/** Returns { email, uid } for a valid, unexpired token with a verified email; otherwise null. */
async function verifyIdToken(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (header.alg !== 'RS256' || !header.kid) return null;
    const pem = (await getCerts())[header.kid];
    if (!pem) return null;
    const ok = crypto.createVerify('RSA-SHA256').update(parts[0] + '.' + parts[1])
      .verify(crypto.createPublicKey(pem), Buffer.from(parts[2], 'base64url'));
    if (!ok) return null;
    const now = Math.floor(Date.now() / 1000), pid = projectId();
    if (p.aud !== pid || p.iss !== 'https://securetoken.google.com/' + pid) return null;
    if (!p.sub || typeof p.exp !== 'number' || p.exp < now || (p.iat && p.iat > now + 60)) return null;
    if (!p.email || p.email_verified !== true) return null;
    return { email: String(p.email).trim().toLowerCase(), uid: p.sub };
  } catch (e) { return null; }
}

module.exports = { verifyIdToken };
