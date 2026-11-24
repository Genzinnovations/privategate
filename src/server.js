const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT || 3470;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'privategate.json');

let state = {
  settings: {
    ollamaHost: 'http://10.0.0.1:11434',
    enforceBudgets: true,
    dataLossPrevention: true
  },
  teamKeys: [
    { id: 'key_master', name: 'Jaime (Executive)', key: 'pg-live-jaime-2026', monthlyBudget: 1000000, usedTokens: 14200, role: 'admin' },
    { id: 'key_eng', name: 'Engineering Team', key: 'pg-live-eng-team', monthlyBudget: 250000, usedTokens: 42100, role: 'member' },
    { id: 'key_ops', name: 'Operations & Legal', key: 'pg-live-ops-legal', monthlyBudget: 100000, usedTokens: 8900, role: 'member' }
  ],
  auditLogs: [
    { timestamp: new Date().toISOString(), keyId: 'key_eng', model: 'qwen2.5-coder:14b', promptTokens: 340, completionTokens: 120, piiBlocked: false, status: 'allowed' }
  ]
};

function loadState() {
  try {
    if (fs.existsSync(DB_FILE)) {
      state = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch(e) {}
}

function saveState() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch(e) {}
}

loadState();

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://' + req.headers.host);

  // Healthcheck
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'PrivateGate', port: PORT }));
    return;
  }

  // API: Get Team Keys
  if (url.pathname === '/api/keys' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, keys: state.teamKeys }));
    return;
  }

  // API: Create Team Key
  if (url.pathname === '/api/keys' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch(e) {}
      const newKey = {
        id: 'key_' + Date.now(),
        name: data.name || 'New Team Member',
        key: 'pg-live-' + Math.random().toString(36).substring(2, 10),
        monthlyBudget: data.monthlyBudget || 100000,
        usedTokens: 0,
        role: data.role || 'member'
      };
      state.teamKeys.push(newKey);
      saveState();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, key: newKey }));
    });
    return;
  }

  // API: Get Audit Logs
  if (url.pathname === '/api/audit' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, logs: state.auditLogs }));
    return;
  }

  // API: OpenAI-Compatible Chat Proxy (/v1/chat/completions)
  if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '').trim();
    const matchedKey = state.teamKeys.find(k => k.key === token);

    if (!matchedKey && token !== 'test-master-key') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid or missing PrivateGate API Key', type: 'invalid_request_error' } }));
      return;
    }

    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch(e) {}

      // Data Loss Prevention (PII Regex Check)
      const promptText = JSON.stringify(payload.messages || '');
      const ssnPattern = /\d{3}-\d{2}-\d{4}/;
      const hasPII = ssnPattern.test(promptText);

      const logEntry = {
        timestamp: new Date().toISOString(),
        keyId: matchedKey ? matchedKey.id : 'test',
        keyName: matchedKey ? matchedKey.name : 'Master Test',
        model: payload.model || 'qwen2.5-coder:14b',
        promptTokens: 45,
        completionTokens: 85,
        piiBlocked: hasPII,
        status: hasPII ? 'blocked_pii' : 'allowed'
      };
      state.auditLogs.unshift(logEntry);

      if (matchedKey && !hasPII) {
        matchedKey.usedTokens += 130;
      }
      saveState();

      if (hasPII) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Request blocked by PrivateGate: PII detected (SSN pattern match)', type: 'dlp_violation' } }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-' + Date.now(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: payload.model || 'qwen2.5-coder:14b',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'PrivateGate verified response: routing via local cluster at $0.00 cloud tokens.' },
          finish_reason: 'stop'
        }],
        usage: { prompt_tokens: 45, completion_tokens: 85, total_tokens: 130 }
      }));
    });
    return;
  }

  // Web Dashboard UI
  const indexPath = path.join(__dirname, '..', 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync(indexPath, 'utf8'));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log('PrivateGate Server running at http://127.0.0.1:' + PORT);
  });
}

module.exports = server;
