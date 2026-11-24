const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const tmpDb = path.join(os.tmpdir(), 'pg-test-' + Date.now() + '.json');
process.env.DB_FILE = tmpDb;
process.env.PORT = '3471';

const server = require('../src/server');
let baseUrl;

test.before(async () => {
  await new Promise(res => {
    server.listen(0, '127.0.0.1', () => {
      baseUrl = 'http://127.0.0.1:' + server.address().port;
      res();
    });
  });
});

test.after(async () => {
  await new Promise(r => server.close(r));
  try { fs.unlinkSync(tmpDb); } catch(e) {}
});

test('1. Health check returns 200 OK and service metadata', async () => {
  const res = await fetch(baseUrl + '/health');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.service, 'PrivateGate');
});

test('2. Team Keys API returns initial keys and supports creating new team key', async () => {
  const getRes = await fetch(baseUrl + '/api/keys');
  assert.equal(getRes.status, 200);
  const keys = await getRes.json();
  assert.ok(keys.keys.length >= 3);

  const postRes = await fetch(baseUrl + '/api/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Data Science Team', monthlyBudget: 500000, role: 'member' })
  });
  assert.equal(postRes.status, 200);
  const created = await postRes.json();
  assert.equal(created.key.name, 'Data Science Team');
});

test('3. OpenAI-compatible /v1/chat/completions validates team API key', async () => {
  const badAuth = await fetch(baseUrl + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer bad-key' },
    body: JSON.stringify({ model: 'qwen2.5-coder:14b', messages: [{ role: 'user', content: 'hello' }] })
  });
  assert.equal(badAuth.status, 401);

  const goodAuth = await fetch(baseUrl + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer pg-live-jaime-2026' },
    body: JSON.stringify({ model: 'qwen2.5-coder:14b', messages: [{ role: 'user', content: 'hello' }] })
  });
  assert.equal(goodAuth.status, 200);
  const data = await goodAuth.json();
  assert.ok(data.choices[0].message.content.includes('PrivateGate verified response'));
});

test('4. Data Loss Prevention (PII Scrubber) blocks sensitive Social Security Numbers', async () => {
  const piiAttempt = await fetch(baseUrl + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer pg-live-jaime-2026' },
    body: JSON.stringify({ model: 'qwen2.5-coder:14b', messages: [{ role: 'user', content: 'My SSN is 123-45-6789 please analyze' }] })
  });
  assert.equal(piiAttempt.status, 400);
  const err = await piiAttempt.json();
  assert.equal(err.error.type, 'dlp_violation');
});

test('5. Audit Log accurately logs all allowed and blocked team requests', async () => {
  const res = await fetch(baseUrl + '/api/audit');
  assert.equal(res.status, 200);
  const audit = await res.json();
  assert.ok(audit.logs.length >= 2);
  assert.ok(audit.logs.some(l => l.status === 'blocked_pii'));
  assert.ok(audit.logs.some(l => l.status === 'allowed'));
});
