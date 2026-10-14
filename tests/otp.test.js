// Runs the serverless OTP handlers directly (no network): node tests/otp.test.js
const fs = require('fs'), os = require('os'), path = require('path');
const mock = path.join(os.tmpdir(), 'nl-otp-' + Date.now() + '.log');
process.env.OTP_MOCK_FILE = mock; process.env.OTP_SECRET = 'test-secret';
const send = require('../api/send-otp.js'), verify = require('../api/verify-otp.js');
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : (fail++, console.log('FAIL', n, x || '')); };
function call(h, method, body) {
  return new Promise(r => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { r({ status: this.statusCode, body: JSON.parse(b) }); } };
    h({ method, body }, res);
  });
}
(async () => {
  ok('GET rejected', (await call(send, 'GET')).status === 405);
  ok('non-gmail rejected', (await call(send, 'POST', { email: 'a@yahoo.com' })).status === 422);
  const s = await call(send, 'POST', { email: 'Pael.Test@gmail.com', name: 'Pael' });
  ok('send ok', s.status === 200 && s.body.ok && s.body.token, JSON.stringify(s));
  ok('token payload holds only email + expiry', Object.keys(JSON.parse(Buffer.from(s.body.token.split('.')[0], 'base64url').toString())).sort().join() === 'e,x');
  const code = JSON.parse(fs.readFileSync(mock, 'utf8').trim().split('\n').pop()).text.match(/code is (\d{6})/)[1];
  const email = 'pael.test@gmail.com';
  ok('wrong code', (await call(verify, 'POST', { email, code: code === '000000' ? '111111' : '000000', token: s.body.token })).status === 401);
  ok('other email', (await call(verify, 'POST', { email: 'x.y.z.abc@gmail.com', code, token: s.body.token })).status === 400);
  ok('tampered token', (await call(verify, 'POST', { email, code, token: s.body.token.slice(0, -2) + 'AA' })).status === 401);
  const good = await call(verify, 'POST', { email, code, token: s.body.token });
  ok('right code', good.status === 200 && good.body.ok && good.body.email === email, JSON.stringify(good));
  // expired
  const real = Date.now; Date.now = () => real() + 301000;
  ok('expired', (await call(verify, 'POST', { email, code, token: s.body.token })).status === 410);
  Date.now = real;
  console.log(pass + ' passed, ' + fail + ' failed'); fs.unlinkSync(mock); process.exit(fail ? 1 : 0);
})();
