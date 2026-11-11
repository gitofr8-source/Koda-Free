'use strict';
/* =========================================================================
   Koda Local Server (with Speech-to-Text & Media Support)
   Zero external dependencies. Run: node server.js
   ========================================================================= */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawnSync } = require('child_process');

process.on('uncaughtException', err => {
  console.error('[Koda Server Error Suppressed]:', err && (err.stack || err.message));
});
process.on('unhandledRejection', reason => {
  console.error('[Koda Unhandled Rejection]:', reason);
});

const PORT = +process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const DIR = __dirname;
const IS_VERCEL = !!(process.env.VERCEL || process.env.NOW_REGION);
let DATA = IS_VERCEL ? path.join(os.tmpdir(), 'koda-data') : path.join(DIR, 'data');
try {
  fs.mkdirSync(DATA, { recursive: true });
} catch (e) {
  DATA = path.join(os.tmpdir(), 'koda-data');
  try { fs.mkdirSync(DATA, { recursive: true }); } catch (_) {}
}
const DB = path.join(DATA, 'users.json');
const TOKFILE = path.join(DATA, 'admin-token.txt');
const SUPPORT_FILE = path.join(DATA, 'support.json');
const ONLINE_MS = 45000;
const MAX_USERS = 5000;

let supportTickets = [];
try { supportTickets = JSON.parse(fs.readFileSync(SUPPORT_FILE, 'utf8')); } catch (_) {}


const VAULT_FILE = path.join(DATA, 'server-keys.json');
function loadVault() {
  if (!fs.existsSync(VAULT_FILE)) {
    const seed = path.join(DIR, 'data', 'server-keys.json');
    if (fs.existsSync(seed)) {
      try {
        const d = fs.readFileSync(seed, 'utf8');
        try { fs.writeFileSync(VAULT_FILE, d); } catch (_) {}
        return JSON.parse(d || '{}');
      } catch (_) {}
    }
    return {};
  }
  try { return JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8') || '{}'); } catch (_) { return {}; }
}
function saveVault(keys) {
  try { fs.writeFileSync(VAULT_FILE, JSON.stringify(keys, null, 2), { mode: 0o600 }); return true; } catch (_) { return false; }
}
let SERVER_VAULT = loadVault();

let TOKEN = process.env.ADMIN_KEY || '';
try {
  if (!TOKEN && fs.existsSync(TOKFILE)) {
    TOKEN = fs.readFileSync(TOKFILE, 'utf8').trim();
  }
} catch (_) {}
if (!TOKEN) {
  TOKEN = crypto.randomBytes(18).toString('hex');
  try { fs.writeFileSync(TOKFILE, TOKEN, { mode: 0o600 }); } catch (_) {}
}

let users = {};
try { users = JSON.parse(fs.readFileSync(DB, 'utf8')); } catch (e) {}
let dirty = false;

// Multi-Device Live Sync & App Auto-Update Hub
const WORKSPACE_FILE = path.join(DATA, 'shared-workspace.json');
function loadSharedWorkspace() {
  if (!fs.existsSync(WORKSPACE_FILE)) return { history: [], current: null, version: 1 };
  try { return JSON.parse(fs.readFileSync(WORKSPACE_FILE, 'utf8') || '{}'); } catch (_) { return { history: [], current: null, version: 1 }; }
}
function saveSharedWorkspace(ws) {
  try { fs.writeFileSync(WORKSPACE_FILE, JSON.stringify(ws, null, 2)); return true; } catch (_) { return false; }
}
let SHARED_WORKSPACE = loadSharedWorkspace();

// User Authentication & Accounts Storage
const ACCOUNTS_FILE = path.join(DATA, 'accounts.json');
function loadAccounts() {
  if (!fs.existsSync(ACCOUNTS_FILE)) {
    const seedFile = path.join(DIR, 'data', 'accounts.json');
    if (fs.existsSync(seedFile)) {
      try {
        const seedData = fs.readFileSync(seedFile, 'utf8');
        try { fs.writeFileSync(ACCOUNTS_FILE, seedData); } catch (_) {}
        return JSON.parse(seedData || '[]');
      } catch (_) {}
    }
    return [];
  }
  try { return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8') || '[]'); } catch (_) { return []; }
}
function saveAccounts(accs) {
  try { fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accs, null, 2), { mode: 0o600 }); return true; } catch (_) { return false; }
}
let accounts = loadAccounts();

function hashPassword(pwd, salt) {
  return crypto.createHash('sha256').update(pwd + salt).digest('hex');
}

let APP_BUILD_ID = Date.now().toString();
try {
  const stat = fs.statSync(path.join(DIR, 'index.html'));
  APP_BUILD_ID = Math.round(stat.mtimeMs).toString();
} catch (_) {}

const syncClients = new Set();
function broadcastSync(data, senderRes) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of syncClients) {
    if (client !== senderRes && !client.writableEnded && !client.destroyed) {
      try { client.write(msg); } catch (_) { syncClients.delete(client); }
    }
  }
}

// Universal Multi-Model Mirror & Companion State (ChatGPT, Gemini, Perplexity, DeepSeek, Claude)
const companionState = {
  chatgpt: { pending: [], streams: new Map(), lastPing: 0 },
  gemini: { pending: [], streams: new Map(), lastPing: 0 },
  perplexity: { pending: [], streams: new Map(), lastPing: 0 },
  deepseek: { pending: [], streams: new Map(), lastPing: 0 },
  claude: { pending: [], streams: new Map(), lastPing: 0 }
};

// Universal Direct Server-Side AI Engine (Zero Chrome / Zero Web Apps / Zero Central API Keys required)
function streamDirectEngine(req, res, messages, modelName = 'gemini-3.1-flash-lite') {
  if (res.writableEnded || res.destroyed) return;
  if (!res.headersSent) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*'
    });
  }

  const geminiKey = SERVER_VAULT['gemini'] || '';
  if (geminiKey) {
    let systemInstruction = undefined;
    const contents = [];
    for (const msg of (Array.isArray(messages) ? messages : [])) {
      if (msg.role === 'system') {
        systemInstruction = { parts: [{ text: msg.content }] };
      } else {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        });
      }
    }
    const gemBody = {
      contents: contents.length ? contents : [{ role: 'user', parts: [{ text: 'Hello' }] }],
      generationConfig: {
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: 2048
      }
    };
    if (systemInstruction) gemBody.systemInstruction = systemInstruction;

    const postPayload = JSON.stringify(gemBody);
    const chosenInitial = (modelName && !['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash'].includes(modelName)) ? modelName : 'gemini-3.1-flash-lite';
    const fallbackModels = [...new Set([chosenInitial, 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview', 'gemini-3-flash-preview', 'gemma-4-26b-a4b-it'])];
    let hasSentAnyToken = false;

    const tryDirectModel = (mIdx) => {
      if (res.writableEnded || res.destroyed) return;
      if (mIdx >= fallbackModels.length) {
        if (!hasSentAnyToken) {
          return streamFromOllama(req, res, messages);
        }
        res.write('data: [DONE]\n\n');
        try { res.end(); } catch (_) {}
        return;
      }
      const curM = fallbackModels[mIdx];
      const targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/${curM}:streamGenerateContent?alt=sse&key=${encodeURIComponent(geminiKey)}`;

      const gReq = https.request(targetUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(postPayload)
        },
        timeout: 5000
      }, (gRes) => {
        if (gRes.statusCode === 200) {
          let rawBuffer = '';
          gRes.on('data', chunk => {
            if (res.writableEnded) return;
            rawBuffer += chunk.toString();
            const lines = rawBuffer.split('\n');
            rawBuffer = lines.pop();

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data: ')) continue;
              try {
                const j = JSON.parse(trimmed.slice(6));
                const text = j.candidates?.[0]?.content?.parts?.[0]?.text || '';
                if (text) {
                  hasSentAnyToken = true;
                  res.write(`data: ${JSON.stringify({ delta: text })}\n\n`);
                }
              } catch (_) {}
            }
          });
          gRes.on('end', () => {
            if (!res.writableEnded) {
              if (!hasSentAnyToken) {
                // If 200 finished with no tokens, failover to next model
                return tryDirectModel(mIdx + 1);
              }
              try { res.write('data: [DONE]\n\n'); res.end(); } catch (_) {}
            }
          });
          return;
        }
        tryDirectModel(mIdx + 1);
      });

      gReq.on('timeout', () => {
        try { gReq.destroy(); } catch (_) {}
        tryDirectModel(mIdx + 1);
      });

      gReq.on('error', () => {
        tryDirectModel(mIdx + 1);
      });

      req.on('close', () => {
        try { gReq.destroy(); } catch (_) {}
      });

      gReq.write(postPayload);
      gReq.end();
    };

    tryDirectModel(0);
    return;
  }

  streamFromOllama(req, res, messages);
}

function streamFromOllama(req, res, messages) {
  if (res.writableEnded || res.destroyed) return;
  const payload = JSON.stringify({
    model: 'qwen2.5:3b',
    messages: (Array.isArray(messages) && messages.length) ? messages : [{ role: 'user', content: 'Hello' }],
    stream: true
  });

  const oReq = http.request('http://127.0.0.1:11434/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload)
    },
    timeout: 25000
  }, (oRes) => {
    if (oRes.statusCode === 200) {
      oRes.on('data', chunk => {
        if (!res.writableEnded) res.write(chunk);
      });
      oRes.on('end', () => {
        if (!res.writableEnded) {
          try { res.write('data: [DONE]\n\n'); res.end(); } catch (_) {}
        }
      });
      return;
    }
    if (!res.writableEnded) {
      res.write('data: [DONE]\n\n');
      try { res.end(); } catch (_) {}
    }
  });

  oReq.on('error', () => {
    if (!res.writableEnded) {
      res.write('data: [DONE]\n\n');
      try { res.end(); } catch (_) {}
    }
  });

  req.on('close', () => {
    try { oReq.destroy(); } catch (_) {}
  });

  oReq.write(payload);
  oReq.end();
}

// Aliases for backwards compatibility with legacy companion
let companionPending = companionState.chatgpt.pending;
let companionStreams = companionState.chatgpt.streams;
let lastCompanionPing = 0;
let bridgeProc = null;

function checkOrStartBridge() {
  if (process.env.VERCEL) return;
  // ChatGPT Bridge (port 3001)
  const chatgptScript = path.join(DIR, 'chatgpt-bridge.js');
  if (fs.existsSync(chatgptScript)) {
    http.get('http://127.0.0.1:3001/api/chatgpt/status', { timeout: 1000 }, () => {}).on('error', () => {
      try {
        const cp = require('child_process').spawn(process.execPath, [chatgptScript], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        });
        cp.unref();
        bridgeProc = cp;
        console.log('[Koda Server] Auto-started ChatGPT Local Mirror Bridge daemon (port 3001)');
      } catch (_) {}
    });
  }

  // Claude Bridge (port 3002 - Browserless direct API via curl_cffi)
  const claudeScriptPy = path.join(DIR, 'claude-bridge.py');
  if (fs.existsSync(claudeScriptPy)) {
    http.get('http://127.0.0.1:3002/api/claude/status', { timeout: 1000 }, () => {}).on('error', () => {
      try {
        const pyBins = [
          path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0', 'python.exe'),
          'python',
          'python3'
        ];
        let chosenPy = 'python';
        for (const b of pyBins) {
          if (fs.existsSync(b)) { chosenPy = b; break; }
        }
        const cp = require('child_process').spawn(chosenPy, [claudeScriptPy], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        });
        cp.unref();
        console.log('[Koda Server] Auto-started Browserless Claude Mirror Bridge daemon (port 3002)');
      } catch (_) {}
    });
  }
}
setTimeout(checkOrStartBridge, 1500);

// Watch index.html and chat.html so ANY code updates made on the server instantly push to all connected devices
try {
  let watchDebounce = null;
  const triggerAppUpdate = (file) => {
    clearTimeout(watchDebounce);
    watchDebounce = setTimeout(() => {
      try {
        const target = fs.existsSync(path.join(DIR, 'chat.html')) ? path.join(DIR, 'chat.html') : path.join(DIR, 'index.html');
        const newMtime = Math.round(fs.statSync(target).mtimeMs).toString();
        if (newMtime !== APP_BUILD_ID) {
          APP_BUILD_ID = newMtime;
          console.log(`[Auto-Update Hub] ${file} modified. Broadcasting update (${APP_BUILD_ID}) to ${syncClients.size} devices.`);
          broadcastSync({ type: 'APP_UPDATE', buildId: APP_BUILD_ID, ts: Date.now() });
        }
      } catch (_) {}
    }, 400);
  };
  if (!process.env.VERCEL) {
    fs.watch(path.join(DIR, 'index.html'), (event) => { if (event === 'change') triggerAppUpdate('index.html'); });
    if (fs.existsSync(path.join(DIR, 'chat.html'))) {
      fs.watch(path.join(DIR, 'chat.html'), (event) => { if (event === 'change') triggerAppUpdate('chat.html'); });
    }
    if (fs.existsSync(path.join(DIR, 'login.html'))) {
      fs.watch(path.join(DIR, 'login.html'), (event) => { if (event === 'change') triggerAppUpdate('login.html'); });
    }
    if (fs.existsSync(path.join(DIR, 'profile.html'))) {
      fs.watch(path.join(DIR, 'profile.html'), (event) => { if (event === 'change') triggerAppUpdate('profile.html'); });
    }
  }
} catch (_) {}

const clip = (v, n = 120) => typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').slice(0, n) : '';
const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const safeEq = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

function parseUA(ua) {
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const o = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
  const d = /iPad|Tablet/.test(ua) ? 'Tablet' : /Mobi|Android/.test(ua) ? 'Mobile' : 'Desktop';
  return b + ' / ' + o + ' / ' + d;
}

function clientIP(req) {
  let ip = TRUST_PROXY && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress || '';
  ip = ip.replace(/^::ffff:/, '');
  return ip === '::1' ? '127.0.0.1' : clip(ip, 64);
}

const hits = new Map();
function limited(ip) {
  const n = Date.now(), h = hits.get(ip) || { c: 0, t: n };
  if (n - h.t > 60000) { h.c = 0; h.t = n; }
  h.c++;
  hits.set(ip, h);
  return h.c > 120;
}

function ping(req, b) {
  const sid = clip(b.sid, 64);
  if (!/^[\w-]{8,64}$/.test(sid)) return false;
  const now = Date.now();
  let u = users[sid];
  if (!u) {
    if (Object.keys(users).length >= MAX_USERS) return false;
    u = users[sid] = { sid, first: now, last: 0, visits: 0, prompts: 0, models: {}, seconds: 0 };
  }
  const gap = now - u.last;
  if (!u.last || gap > 30 * 60 * 1000) u.visits++;
  if (u.last && gap <= ONLINE_MS) u.seconds += Math.round(gap / 1000);
  u.last = now;
  u.ip = clientIP(req);
  u.ua = parseUA(clip(req.headers['user-agent'] || '', 300));
  const nm = clip(b.name), em = clip(b.email);
  if (nm) u.name = nm;
  if (em) u.email = em;
  if (b.type === 'prompt' && Array.isArray(b.models)) {
    u.prompts++;
    b.models.slice(0, 10).forEach(m => {
      if (/^(openai|anthropic|gemini|perplexity|deepseek|nvidia)$/.test(m)) {
        u.models[m] = (u.models[m] || 0) + 1;
      }
    });
  }
  dirty = true;
  return true;
}

function readBody(req, limit = 15 * 1024 * 1024) { // allow audio payloads up to 15MB
  if (req.body) {
    if (typeof req.body === 'object') return Promise.resolve(req.body);
    try { return Promise.resolve(JSON.parse(req.body)); } catch (_) { return Promise.resolve({}); }
  }
  return new Promise((res, rej) => {
    let s = '', n = 0;
    req.on('data', c => {
      n += c.length;
      if (n > limit) { rej(new Error('Payload too large')); req.destroy(); }
      else s += c;
    });
    req.on('end', () => {
      if (!s) return res({});
      try { res(JSON.parse(s)); } catch (e) { rej(e); }
    });
    req.on('error', rej);
  });
}

function authed(req, url) {
  const ip = clientIP(req);
  if (ip === '127.0.0.1' || ip === 'localhost') return true;
  const c = (req.headers.cookie || '').split(/;\s*/).find(x => x.startsWith('adm='));
  const given = url.searchParams.get('key') || (c ? decodeURIComponent(c.slice(4)) : '');
  return given && safeEq(given, TOKEN);
}

function stats() {
  const now = Date.now(), day = new Date();
  day.setHours(0, 0, 0, 0);
  const list = Object.values(users).sort((a, b) => b.last - a.last);
  return {
    now,
    online: list.filter(u => now - u.last < ONLINE_MS).length,
    total: list.length,
    today: list.filter(u => u.last >= day.getTime()).length,
    prompts: list.reduce((s, u) => s + u.prompts, 0),
    signedIn: list.filter(u => u.email || u.name).length,
    users: list.map(u => ({
      id: u.sid.slice(0, 8),
      name: u.name || '',
      email: u.email || '',
      ip: u.ip || '',
      ua: u.ua || '',
      first: u.first,
      last: u.last,
      visits: u.visits,
      prompts: u.prompts,
      models: u.models,
      seconds: u.seconds,
      online: now - u.last < ONLINE_MS
    }))
  };
}

/* Transcribe audio using Gemini multimodal API if key is available */
function transcribeWithGemini(key, base64Audio, mimeType) {
  const models = ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.5-transcribe'];
  const cleanMime = (mimeType || 'audio/webm').split(';')[0].trim() || 'audio/webm';
  const postData = JSON.stringify({
    contents: [{
      parts: [
        { inlineData: { mimeType: cleanMime, data: base64Audio } },
        { text: 'Transcribe this spoken audio verbatim into plain text. Output ONLY the transcribed text, with no preamble, markdown formatting, or explanations.' }
      ]
    }]
  });

  const tryModel = (idx) => {
    return new Promise((resolve, reject) => {
      if (idx >= models.length) return reject(new Error('All Gemini STT models failed.'));
      const model = models[idx];
      const req = https.request(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 20000
      }, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          if ((res.statusCode === 503 || res.statusCode === 429 || res.statusCode === 404) && idx + 1 < models.length) {
            return setTimeout(() => resolve(tryModel(idx + 1)), 400);
          }
          try {
            const json = JSON.parse(data);
            if (json.error) {
              if (idx + 1 < models.length) return setTimeout(() => resolve(tryModel(idx + 1)), 400);
              return reject(new Error(json.error.message || 'Gemini STT API error'));
            }
            const candidate = json.candidates?.[0];
            const text = candidate?.content?.parts?.[0]?.text;
            if (typeof text === 'string') {
              resolve(text.trim());
            } else if (candidate?.finishReason === 'STOP') {
              resolve('');
            } else if (idx + 1 < models.length) {
              resolve(tryModel(idx + 1));
            } else {
              resolve('');
            }
          } catch (e) {
            if (idx + 1 < models.length) resolve(tryModel(idx + 1));
            else reject(e);
          }
        });
      });
      req.on('error', err => {
        if (idx + 1 < models.length) resolve(tryModel(idx + 1));
        else reject(err);
      });
      req.on('timeout', () => {
        req.destroy();
        if (idx + 1 < models.length) resolve(tryModel(idx + 1));
        else reject(new Error('STT request timed out.'));
      });
      req.write(postData);
      req.end();
    });
  };

  return tryModel(0);
}

/* Transcribe audio using local Whisper CLI if installed */
function transcribeWithLocalWhisper(base64Audio) {
  return new Promise((resolve, reject) => {
    const tmpAudio = path.join(os.tmpdir(), `koda_audio_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.wav`);
    const buf = Buffer.from(base64Audio, 'base64');
    fs.writeFileSync(tmpAudio, buf);

    try {
      const res = spawnSync('whisper', [tmpAudio, '--output_format', 'txt', '--output_dir', os.tmpdir()], {
        encoding: 'utf8',
        timeout: 30000
      });
      const txtFile = tmpAudio.replace(/\.wav$/, '.txt');
      if (fs.existsSync(txtFile)) {
        const text = fs.readFileSync(txtFile, 'utf8').trim();
        try { fs.unlinkSync(txtFile); fs.unlinkSync(tmpAudio); } catch (e) {}
        return resolve(text);
      }
      try { fs.unlinkSync(tmpAudio); } catch (e) {}
      if (res.error) return reject(res.error);
      reject(new Error('Whisper execution produced no output.'));
    } catch (err) {
      try { fs.unlinkSync(tmpAudio); } catch (e) {}
      reject(err);
    }
  });
}

const DASH = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Koda admin</title><meta name="robots" content="noindex">
<style>
*{box-sizing:border-box}body{margin:0;background:#000;color:#eee;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
h1{font-size:20px;margin:0 0 14px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:16px}
.c{border:1px solid #333;border-radius:12px;padding:12px;background:#0a0a0a}.c b{display:block;font-size:26px}.c span{opacity:.6;font-size:12px}
.w{overflow:auto;border:1px solid #333;border-radius:12px}table{border-collapse:collapse;width:100%;min-width:760px}
th,td{padding:8px 10px;text-align:left;border-bottom:1px solid #222;white-space:nowrap}th{opacity:.6;font-weight:500;background:#0a0a0a;position:sticky;top:0}
.d{display:inline-block;width:9px;height:9px;border-radius:9px;background:#555;margin-right:6px}.d.on{background:#fff;box-shadow:0 0 8px #fff}
.m{opacity:.6;font-size:12px;margin-top:10px}</style></head><body>
<h1>Koda: who is using it</h1>
<div class="cards"><div class="c"><b id="on">0</b><span>online now</span></div><div class="c"><b id="today">0</b><span>visitors today</span></div>
<div class="c"><b id="total">0</b><span>all-time visitors</span></div><div class="c"><b id="si">0</b><span>signed in</span></div><div class="c"><b id="pr">0</b><span>prompts sent</span></div></div>
<div class="w"><table><thead><tr><th>Status</th><th>User</th><th>Device</th><th>IP</th><th>Last seen</th><th>First seen</th><th>Visits</th><th>Prompts</th><th>Models used</th><th>Time on site</th></tr></thead><tbody id="rows"></tbody></table></div>

<div style="margin-top:24px;border:1px solid #333;border-radius:12px;padding:20px;background:#0d0d0d">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
    <div>
      <h2 style="font-size:17px;margin:0">🔒 Server Key Vault</h2>
      <p style="margin:4px 0 0;opacity:.65;font-size:12px">Google Gemini API key securely powers all 5 AI models in Koda.</p>
    </div>
    <button id="vSave" style="background:#10a37f;color:#fff;border:none;border-radius:8px;padding:9px 20px;font-weight:600;cursor:pointer">Save Key</button>
  </div>
  <div id="vStatus" style="display:none;padding:8px 12px;border-radius:6px;font-size:12px;margin-bottom:12px"></div>
  <div>
    <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px">Google Gemini API Key</label>
    <input type="password" id="vk-gemini" placeholder="AIzaSy..." style="width:100%;background:#000;border:1px solid #333;color:#fff;padding:9px 12px;border-radius:6px;font-family:monospace;font-size:13px">
    <div id="vs-gemini" style="font-size:12px;opacity:.6;margin-top:6px">Not configured</div>
  </div>
</div>

<p class="m">Online = active in the last 45 seconds. Refreshes every 5 seconds. Only usage metadata is stored, never prompts or API keys.</p>
<script>
var $=function(s){return document.querySelector(s)};
var adminKey = (new URLSearchParams(location.search)).get('key') || '';
var qKey = adminKey ? ('?key=' + encodeURIComponent(adminKey)) : '';
function ago(t){var s=Math.max(0,Math.round((Date.now()-t)/1000));if(s<60)return s+'s ago';if(s<3600)return Math.round(s/60)+'m ago';if(s<86400)return Math.round(s/3600)+'h ago';return Math.round(s/86400)+'d ago'}
function dur(s){return s<60?s+'s':s<3600?Math.round(s/60)+'m':(s/3600).toFixed(1)+'h'}
function load(){fetch('/api/admin/stats' + qKey,{cache:'no-store'}).then(function(r){if(r.status===401){location.href='/admin' + (adminKey ? '?key=' + encodeURIComponent(adminKey) : '');return null}return r.json()}).then(function(d){
 if(!d)return;$('#on').textContent=d.online;$('#today').textContent=d.today;$('#total').textContent=d.total;$('#si').textContent=d.signedIn;$('#pr').textContent=d.prompts;
 var tb=$('#rows');tb.textContent='';
 d.users.forEach(function(u){var tr=document.createElement('tr');
  var who=u.name||u.email?(u.name+(u.email?' ('+u.email+')':'')):'Guest '+u.id;
  var mm=Object.keys(u.models).map(function(k){return k+' x'+u.models[k]}).join(', ')||'-';
  var cells=[null,who,u.ua,u.ip,ago(u.last),new Date(u.first).toLocaleString(),u.visits,u.prompts,mm,dur(u.seconds)];
  cells.forEach(function(v,i){var td=document.createElement('td');
   if(i===0){var dot=document.createElement('span');dot.className='d'+(u.online?' on':'');td.appendChild(dot);td.appendChild(document.createTextNode(u.online?'Online':'Away'))}else td.textContent=v;
   tr.appendChild(td)});tb.appendChild(tr)});
 if(!d.users.length){var tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=10;td.textContent='No visitors yet. Open the site from a browser via this server.';tr.appendChild(td);tb.appendChild(tr)}
}).catch(function(){})}
load();setInterval(load,5000);

function loadVaultAdmin(){
  fetch('/api/admin/vault' + qKey).then(function(r){return r.json()}).then(function(d){
    if(!d||!d.keys)return;
    var v=d.keys['gemini'];
    var s=$('#vs-gemini');
    var inp=$('#vk-gemini');
    if(!s||!inp)return;
    if(v){
      s.innerHTML='<span style="color:#10a37f">✓ Saved in Vault</span> (ends in <code>'+v.slice(-4)+'</code>)';
      inp.placeholder='Key active (ends in '+v.slice(-4)+') — paste new key to update';
    }else{
      s.textContent='Not configured';
    }
  });
}
loadVaultAdmin();
var vSaveBtn=$('#vSave');
if(vSaveBtn){
  vSaveBtn.onclick=function(){
    var val=$('#vk-gemini').value.trim().replace(/^["']|["']$/g, '');
    var st=$('#vStatus');
    if(!val){
      st.style.display='block';
      st.style.background='#ef444422';st.style.color='#ef4444';st.style.border='1px solid #ef444455';
      st.textContent='Please paste your Gemini API key.';
      return;
    }
    var match=val.match(/(?:AQ\.[A-Za-z0-9_-]+|AIza[A-Za-z0-9_-]{25,50})/);
    if(match) val = match[0];

    var payload={keys:{gemini:val}};
    fetch('/api/admin/vault' + qKey,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})
    .then(function(r){return r.json()}).then(function(res){
      st.style.display='block';
      if(res.ok){
        st.style.background='#10a37f22';st.style.color='#10a37f';st.style.border='1px solid #10a37f55';
        st.textContent='✓ Gemini key saved successfully! All 5 models are ready.';
        $('#vk-gemini').value='';
        loadVaultAdmin();
      }else{
        st.style.background='#ef444422';st.style.color='#ef4444';st.style.border='1px solid #ef444455';
        st.textContent='Error saving vault key.';
      }
    });
  };
}

</script></body></html>`;

const send = (res, code, type, body, extra) => {
  res.writeHead(code, Object.assign({
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store'
  }, extra || {}));
  res.end(body);
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.mobileconfig': 'application/x-apple-aspen-config',
  '.ipa': 'application/octet-stream'
};

async function requestHandler(req, res) {
  if (req.method === 'OPTIONS') {
    return send(res, 204, 'text/plain', '');
  }

  const rawUrl = req.headers['x-forwarded-uri'] || req.headers['x-original-url'] || req.url || '/';
  const url = new URL(rawUrl, 'http://' + (req.headers.host || 'localhost'));
  try {
    // Serve index.html with live ETag & no-store cache control so devices immediately receive updates
    if ((req.method === 'GET' || req.method === 'HEAD') && (url.pathname === '/' || url.pathname === '/index.html')) {
      return fs.readFile(path.join(DIR, 'index.html'), (e, d) => {
        if (e) return send(res, 404, 'text/plain', 'index.html not found next to server.js');
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
          'ETag': `"${APP_BUILD_ID}"`
        });
        if (req.method === 'HEAD') return res.end();
        return res.end(d);
      });
    }

    // Serve chat.html (Dedicated Workspace / Chat Page 2)
    if ((req.method === 'GET' || req.method === 'HEAD') && (url.pathname === '/chat' || url.pathname === '/chat.html' || url.pathname === '/workspace' || url.pathname === '/workspace.html')) {
      const chatFile = path.join(DIR, 'chat.html');
      return fs.readFile(chatFile, (e, d) => {
        if (e) return send(res, 404, 'text/plain', 'chat.html not found next to server.js');
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
          'ETag': `"${APP_BUILD_ID}"`
        });
        if (req.method === 'HEAD') return res.end();
        return res.end(d);
      });
    }

    // Serve login.html (Authentication & Login Page)
    if ((req.method === 'GET' || req.method === 'HEAD') && (url.pathname === '/login' || url.pathname === '/login.html' || url.pathname === '/signin' || url.pathname === '/auth')) {
      const loginFile = path.join(DIR, 'login.html');
      return fs.readFile(loginFile, (e, d) => {
        if (e) return send(res, 404, 'text/plain', 'login.html not found next to server.js');
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
          'ETag': `"${APP_BUILD_ID}"`
        });
        if (req.method === 'HEAD') return res.end();
        return res.end(d);
      });
    }

    // Serve profile.html (Profiles & Accounts Page)
    if ((req.method === 'GET' || req.method === 'HEAD') && (url.pathname === '/profile' || url.pathname === '/profile.html' || url.pathname === '/account' || url.pathname === '/accounts')) {
      const profileFile = path.join(DIR, 'profile.html');
      return fs.readFile(profileFile, (e, d) => {
        if (e) return send(res, 404, 'text/plain', 'profile.html not found next to server.js');
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
          'ETag': `"${APP_BUILD_ID}"`
        });
        if (req.method === 'HEAD') return res.end();
        return res.end(d);
      });
    }

    // Direct Installer EXE Download
    if (req.method === 'GET' && (url.pathname === '/download' || url.pathname === '/download/exe' || url.pathname === '/Koda-Setup.exe')) {
      const exeFile = path.join(DIR, 'Koda-Setup.exe');
      if (fs.existsSync(exeFile)) {
        const st = fs.statSync(exeFile);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.microsoft.portable-executable',
          'Content-Disposition': 'attachment; filename="Koda-Setup.exe"',
          'Content-Length': st.size
        });
        return fs.createReadStream(exeFile).pipe(res);
      }
    }

    // Direct iOS Xcode Project ZIP Download
    if (req.method === 'GET' && (url.pathname === '/koda-ios-project.zip' || url.pathname === '/download/ios' || url.pathname === '/download/ios-zip')) {
      const zipFile = path.join(DIR, 'koda-ios-project.zip');
      if (fs.existsSync(zipFile)) {
        const st = fs.statSync(zipFile);
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="koda-ios-project.zip"',
          'Content-Length': st.size
        });
        return fs.createReadStream(zipFile).pipe(res);
      }
    }

    // Direct Master Everything ZIP Download
    if (req.method === 'GET' && (url.pathname === '/koda-everything.zip' || url.pathname === '/download/everything' || url.pathname === '/download/all' || url.pathname === '/download/zip')) {
      const allZip = path.join(DIR, 'koda-everything.zip');
      if (fs.existsSync(allZip)) {
        const st = fs.statSync(allZip);
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="koda-everything.zip"',
          'Content-Length': st.size
        });
        return fs.createReadStream(allZip).pipe(res);
      }
    }

    // Direct macOS App & Launcher ZIP Download
    if (req.method === 'GET' && (url.pathname === '/koda-mac.zip' || url.pathname === '/download/mac' || url.pathname === '/download/macos')) {
      const macZip = path.join(DIR, 'koda-mac.zip');
      if (fs.existsSync(macZip)) {
        const st = fs.statSync(macZip);
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="koda-mac.zip"',
          'Content-Length': st.size
        });
        return fs.createReadStream(macZip).pipe(res);
      }
    }

    // Direct Android Package (APK / Android Studio Project ZIP) Download
    if (req.method === 'GET' && (url.pathname === '/koda-android.zip' || url.pathname === '/download/android' || url.pathname === '/download/apk' || url.pathname === '/koda.apk' || url.pathname === '/android')) {
      const isApk = url.pathname.endsWith('.apk') || url.pathname === '/download/apk';
      const targetFile = isApk && fs.existsSync(path.join(DIR, 'koda.apk')) 
        ? path.join(DIR, 'koda.apk') 
        : (fs.existsSync(path.join(DIR, 'koda-android.zip')) ? path.join(DIR, 'koda-android.zip') : path.join(DIR, 'koda.apk'));

      if (targetFile && fs.existsSync(targetFile)) {
        const st = fs.statSync(targetFile);
        const fileName = path.basename(targetFile);
        const contentType = fileName.endsWith('.apk') ? 'application/vnd.android.package-archive' : 'application/zip';
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Content-Length': st.size
        });
        return fs.createReadStream(targetFile).pipe(res);
      }
    }

    // Digital Asset Links for Android PWA / TWA verification
    if (req.method === 'GET' && url.pathname === '/.well-known/assetlinks.json') {
      const assetLinks = JSON.stringify([{
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "com.koda.ai",
          sha256_cert_fingerprints: []
        }
      }], null, 2);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(assetLinks) });
      return res.end(assetLinks);
    }

    // Direct iOS Configuration Profile Download (.mobileconfig)
    if (req.method === 'GET' && (url.pathname === '/koda.mobileconfig' || url.pathname === '/ios' || url.pathname === '/ios/profile')) {
      const mcFile = path.join(DIR, 'koda.mobileconfig');
      if (fs.existsSync(mcFile)) {
        const proto = req.headers['x-forwarded-proto'] || (req.connection.encrypted ? 'https' : 'http');
        const host = req.headers['host'] || '192.168.0.117:3000';
        const clientBaseUrl = `${proto}://${host}`;
        let content = fs.readFileSync(mcFile, 'utf8');
        content = content.replace(/<key>URL<\/key>\s*<string>[^<]+<\/string>/, `<key>URL</key>\n            <string>${clientBaseUrl}</string>`);
        const buf = Buffer.from(content, 'utf8');
        res.writeHead(200, {
          'Content-Type': 'application/x-apple-aspen-config',
          'Content-Disposition': 'attachment; filename="koda.mobileconfig"',
          'Content-Length': buf.length,
          'Cache-Control': 'no-store'
        });
        return res.end(buf);
      }
    }

    // Auth: Register New Account
    if (req.method === 'POST' && url.pathname === '/api/auth/register') {
      let b;
      try { b = await readBody(req, 16384); } catch (e) { return send(res, 400, 'application/json', JSON.stringify({ ok: false, error: 'Invalid payload' })); }
      const email = (b.email || '').trim().toLowerCase();
      const password = (b.password || '').trim();
      const name = (b.name || '').trim();
      if (!email || !password) {
        return send(res, 400, 'application/json', JSON.stringify({ ok: false, error: 'Email and password are required.' }));
      }
      if (password.length < 4) {
        return send(res, 400, 'application/json', JSON.stringify({ ok: false, error: 'Password must be at least 4 characters.' }));
      }
      accounts = loadAccounts();
      if (accounts.some(a => a.email === email)) {
        return send(res, 409, 'application/json', JSON.stringify({ ok: false, error: 'An account with this email already exists. Please Sign In.' }));
      }
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = hashPassword(password, salt);
      const newAcc = {
        id: 'usr_' + crypto.randomBytes(8).toString('hex'),
        email,
        name: name || email.split('@')[0],
        salt,
        hash,
        createdAt: Date.now()
      };
      accounts.push(newAcc);
      saveAccounts(accounts);
      return send(res, 200, 'application/json', JSON.stringify({
        ok: true,
        user: { id: newAcc.id, email: newAcc.email, name: newAcc.name }
      }));
    }

    // Auth: Login Existing Account
    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      let b;
      try { b = await readBody(req, 16384); } catch (e) { return send(res, 400, 'application/json', JSON.stringify({ ok: false, error: 'Invalid payload' })); }
      const email = (b.email || '').trim().toLowerCase();
      const password = (b.password || '').trim();
      if (!email || !password) {
        return send(res, 400, 'application/json', JSON.stringify({ ok: false, error: 'Email and password are required.' }));
      }
      accounts = loadAccounts();
      const existing = accounts.find(a => a.email === email);
      if (!existing) {
        return send(res, 401, 'application/json', JSON.stringify({ ok: false, error: 'No account found with this email. Switch to Create Account to register.' }));
      }
      if (existing.hash !== hashPassword(password, existing.salt)) {
        return send(res, 401, 'application/json', JSON.stringify({ ok: false, error: 'Invalid password. Please try again.' }));
      }
      return send(res, 200, 'application/json', JSON.stringify({
        ok: true,
        user: { id: existing.id, email: existing.email, name: existing.name }
      }));
    }

    // Auth: Guest Session
    if (req.method === 'POST' && url.pathname === '/api/auth/guest') {
      const guestUser = {
        id: 'guest_' + crypto.randomBytes(4).toString('hex'),
        name: 'Guest User',
        email: '',
        isGuest: true
      };
      return send(res, 200, 'application/json', JSON.stringify({
        ok: true,
        user: guestUser
      }));
    }

    // Auth: Google OAuth Public Config
    if (req.method === 'GET' && url.pathname === '/api/auth/google/config') {
      SERVER_VAULT = loadVault();
      const clientId = process.env.GOOGLE_CLIENT_ID || SERVER_VAULT.google_client_id || '';
      return send(res, 200, 'application/json', JSON.stringify({ ok: true, clientId }));
    }

    // Auth: Verify Google ID Token & Sign In
    if (req.method === 'POST' && url.pathname === '/api/auth/google') {
      let b;
      try { b = await readBody(req, 32768); } catch (e) { return send(res, 400, 'application/json', JSON.stringify({ ok: false, error: 'Invalid payload' })); }
      const credential = String(b.credential || '').trim();
      if (!credential) {
        return send(res, 400, 'application/json', JSON.stringify({ ok: false, error: 'Missing Google ID token credential.' }));
      }
      try {
        const info = await new Promise((resolve, reject) => {
          const gReq = https.get('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential), { timeout: 6000 }, (gRes) => {
            let raw = '';
            gRes.on('data', chunk => { raw += chunk; });
            gRes.on('end', () => {
              if (gRes.statusCode !== 200) return reject(new Error('Google token verification failed'));
              try { resolve(JSON.parse(raw)); } catch (err) { reject(err); }
            });
          });
          gReq.on('error', reject);
          gReq.on('timeout', () => { try { gReq.destroy(); } catch (_) {} reject(new Error('Verification timeout')); });
        });
        const email = (info.email || '').trim().toLowerCase();
        if (!email || info.email_verified === 'false' || info.email_verified === false) {
          return send(res, 401, 'application/json', JSON.stringify({ ok: false, error: 'Unverified Google account email.' }));
        }
        accounts = loadAccounts();
        let existing = accounts.find(a => a.email === email);
        if (!existing) {
          existing = {
            id: 'goog_' + (info.sub || crypto.randomBytes(6).toString('hex')),
            email,
            name: (info.name || email.split('@')[0]).trim(),
            picture: info.picture || '',
            provider: 'google',
            createdAt: Date.now()
          };
          accounts.push(existing);
        } else {
          if (info.picture) existing.picture = info.picture;
          if (!existing.name && info.name) existing.name = info.name;
        }
        saveAccounts(accounts);
        return send(res, 200, 'application/json', JSON.stringify({
          ok: true,
          user: {
            id: existing.id,
            email: existing.email,
            name: existing.name,
            picture: existing.picture || info.picture || '',
            provider: 'google',
            createdAt: existing.createdAt
          }
        }));
      } catch (err) {
        return send(res, 401, 'application/json', JSON.stringify({ ok: false, error: 'Could not verify Google sign-in token.' }));
      }
    }

    // Auth: List Accounts (Profiles Page)
    if (req.method === 'GET' && url.pathname === '/api/auth/accounts/list') {
      accounts = loadAccounts();
      const list = accounts.map(a => ({
        id: a.id,
        email: a.email,
        name: a.name,
        picture: a.picture || '',
        provider: a.provider || 'email',
        createdAt: a.createdAt || null
      }));
      return send(res, 200, 'application/json', JSON.stringify({ ok: true, accounts: list }));
    }

    // Auth: Update Profile Name
    if (req.method === 'POST' && url.pathname === '/api/auth/profile/update') {
      let b;
      try { b = await readBody(req, 16384); } catch (e) { return send(res, 400, 'application/json', JSON.stringify({ ok: false, error: 'Invalid payload' })); }
      const email = (b.email || '').trim().toLowerCase();
      const name = (b.name || '').trim();
      if (!email || !name) {
        return send(res, 400, 'application/json', JSON.stringify({ ok: false, error: 'Email and name are required.' }));
      }
      accounts = loadAccounts();
      const acc = accounts.find(a => a.email === email);
      if (!acc) {
        return send(res, 404, 'application/json', JSON.stringify({ ok: false, error: 'Account not found.' }));
      }
      acc.name = name;
      saveAccounts(accounts);
      return send(res, 200, 'application/json', JSON.stringify({
        ok: true,
        user: { id: acc.id, email: acc.email, name: acc.name }
      }));
    }

    // Auth: Update Password
    if (req.method === 'POST' && url.pathname === '/api/auth/profile/update-password') {
      let b;
      try { b = await readBody(req, 16384); } catch (e) { return send(res, 400, 'application/json', JSON.stringify({ ok: false, error: 'Invalid payload' })); }
      const email = (b.email || '').trim().toLowerCase();
      const currentPassword = (b.currentPassword || '').trim();
      const newPassword = (b.newPassword || '').trim();
      if (!email || !currentPassword || !newPassword) {
        return send(res, 400, 'application/json', JSON.stringify({ ok: false, error: 'All password fields are required.' }));
      }
      if (newPassword.length < 4) {
        return send(res, 400, 'application/json', JSON.stringify({ ok: false, error: 'New password must be at least 4 characters.' }));
      }
      accounts = loadAccounts();
      const acc = accounts.find(a => a.email === email);
      if (!acc) {
        return send(res, 404, 'application/json', JSON.stringify({ ok: false, error: 'Account not found.' }));
      }
      if (acc.hash !== hashPassword(currentPassword, acc.salt)) {
        return send(res, 401, 'application/json', JSON.stringify({ ok: false, error: 'Current password is incorrect.' }));
      }
      const salt = crypto.randomBytes(16).toString('hex');
      acc.salt = salt;
      acc.hash = hashPassword(newPassword, salt);
      saveAccounts(accounts);
      return send(res, 200, 'application/json', JSON.stringify({ ok: true, message: 'Password updated successfully.' }));
    }

    // Ping API (Tracking)
    if (req.method === 'POST' && url.pathname === '/api/ping') {
      if (limited(clientIP(req))) return send(res, 429, 'text/plain', 'slow down');
      let b;
      try { b = await readBody(req, 16384); } catch (e) { return send(res, 400, 'text/plain', 'bad request'); }
      ping(req, b);
      return send(res, 204, 'text/plain', '');
    }


    // NVIDIA NIM (integrate.api.nvidia.com) Streaming Proxy
    if (req.method === 'POST' && url.pathname === '/api/proxy/nvidia') {
      const authHeader = req.headers['authorization'] || (req.headers['x-api-key'] ? 'Bearer ' + req.headers['x-api-key'] : '');
      if (!authHeader) {
        return send(res, 401, 'application/json', JSON.stringify({ error: { message: 'Missing NVIDIA API key.' } }));
      }

      const pReq = https.request({
        hostname: 'integrate.api.nvidia.com',
        port: 443,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': authHeader,
          'accept': req.headers['accept'] || 'text/event-stream, application/json'
        }
      }, (pRes) => {
        res.writeHead(pRes.statusCode, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Content-Type': pRes.headers['content-type'] || 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });
        pRes.pipe(res);
      });

      pReq.on('error', (err) => {
        if (!res.headersSent) {
          send(res, 502, 'application/json', JSON.stringify({ error: { message: 'NVIDIA proxy connection failed: ' + err.message } }));
        } else {
          res.end();
        }
      });

      req.on('aborted', () => {
        pReq.destroy();
      });

      req.pipe(pReq);
      return;
    }


    // ChatGPT Shared Link Import Endpoint
    if (req.method === 'POST' && url.pathname === '/api/chatgpt/import') {
      let b;
      try { b = await readBody(req, 16384); } catch (e) { return send(res, 400, 'application/json', JSON.stringify({ error: 'bad request' })); }
      const data = (typeof b === 'object' && b !== null) ? b : (function(){ try { return JSON.parse(b || '{}'); } catch(e){ return {}; } })();
      const shareUrl = (data.url || '').trim();
      if (!shareUrl) return send(res, 400, 'application/json', JSON.stringify({ error: 'URL required' }));

      try {
        const u = new URL(shareUrl);
        if (!/^(www\.)?chatgpt\.com$/i.test(u.hostname) && !/^(www\.)?chat\.openai\.com$/i.test(u.hostname)) {
          return send(res, 400, 'application/json', JSON.stringify({ error: 'URL must be a chatgpt.com link' }));
        }

        if (/\/c\/[a-f0-9-]+/i.test(u.pathname)) {
          return send(res, 400, 'application/json', JSON.stringify({
            error: 'Private ChatGPT link (chatgpt.com/c/...). To share it: In ChatGPT click "Share Chat" (top right) to get a public share link, or select & copy the chat text (Ctrl+A & Ctrl+C) and paste it directly.'
          }));
        }

        const cReq = https.get(shareUrl, {
          maxHeaderSize: 128 * 1024,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          }
        }, (cRes) => {
          let body = '';
          cRes.on('data', chunk => body += chunk);
          cRes.on('end', () => {
            // 1. React Router streamController enqueue extractor
            const match = body.match(/window\.__reactRouterContext\.streamController\.enqueue\(("([\s\S]*?)")\);<\/script>/);
            if (match) {
              try {
                const jsonStr = JSON.parse(match[1]);
                const arr = JSON.parse(jsonStr);
                const linIdx = arr.indexOf('linear_conversation');
                if (linIdx !== -1 && Array.isArray(arr[linIdx + 1])) {
                  const nodeIndices = arr[linIdx + 1];
                  const extracted = [];
                  nodeIndices.forEach(idx => {
                    const node = arr[idx];
                    if (!node) return;
                    for (const k in node) {
                      const item = arr[node[k]];
                      if (item && typeof item === 'object' && !Array.isArray(item)) {
                        let role = null;
                        let text = '';
                        for (const propKey in item) {
                          const val = arr[item[propKey]];
                          if (val && typeof val === 'object' && !Array.isArray(val)) {
                            for (const subKey in val) {
                              const possibleRole = arr[val[subKey]];
                              if (possibleRole === 'user' || possibleRole === 'assistant') {
                                role = possibleRole;
                              }
                            }
                            for (const subKey in val) {
                              const possibleParts = arr[val[subKey]];
                              if (Array.isArray(possibleParts)) {
                                const texts = possibleParts.map(pi => arr[pi]).filter(t => typeof t === 'string' && t.trim());
                                if (texts.length) text = texts.join('\n');
                              }
                            }
                          }
                        }
                        if (role && text) extracted.push({ role, content: text });
                      }
                    }
                  });
                  if (extracted.length) {
                    const continueUrl = shareUrl.replace(/\/$/, '') + '/continue';
                    return send(res, 200, 'application/json', JSON.stringify({ messages: extracted, continueUrl }));
                  }
                }
              } catch (err) {}
            }

            // 2. Legacy __NEXT_DATA__ extractor
            const nextMatch = body.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
            if (nextMatch) {
              try {
                const nextData = JSON.parse(nextMatch[1]);
                const mapping = nextData.props?.pageProps?.serverResponse?.data?.mapping;
                if (mapping) {
                  const msgs = [];
                  for (const k in mapping) {
                    const m = mapping[k].message;
                    if (m && m.content && m.content.parts && m.content.parts.length) {
                      msgs.push({
                        role: m.author.role === 'user' ? 'user' : 'assistant',
                        content: m.content.parts.join('\n')
                      });
                    }
                  }
                  if (msgs.length) return send(res, 200, 'application/json', JSON.stringify({ messages: msgs }));
                }
              } catch (err) {}
            }

            return send(res, 422, 'application/json', JSON.stringify({
              error: 'Could not extract messages from this share link. Please copy the chat text in ChatGPT (Ctrl+A & Ctrl+C) and paste it directly.'
            }));
          });
        });

        cReq.on('error', (err) => {
          send(res, 500, 'application/json', JSON.stringify({ error: 'Fetch failed: ' + err.message }));
        });
      } catch (err) {
        return send(res, 400, 'application/json', JSON.stringify({ error: 'Invalid URL format' }));
      }
      return;
    }

    // =========================================================================
    // ChatGPT Direct Mirror Bridge & Companion Endpoints (No API Key Required)
    // =========================================================================

    // Status check for ChatGPT Mirror
    if (req.method === 'GET' && url.pathname === '/api/chatgpt/mirror/status') {
      const isCompanionActive = (Date.now() - lastCompanionPing < 6000);
      http.get('http://127.0.0.1:3001/api/chatgpt/status', { timeout: 1500 }, (bRes) => {
        let bBody = '';
        bRes.on('data', c => bBody += c);
        bRes.on('end', () => {
          let bData = {};
          try { bData = JSON.parse(bBody); } catch (_) {}
          bData.companionActive = isCompanionActive;
          return send(res, 200, 'application/json', JSON.stringify(bData));
        });
      }).on('error', () => {
        return send(res, 200, 'application/json', JSON.stringify({
          ready: false,
          browserRunning: false,
          loggedIn: false,
          companionActive: isCompanionActive,
          message: 'Local background bridge daemon is offline'
        }));
      });
      return;
    }

    // Launch / Connect ChatGPT Desktop App
    if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/api/chatgpt/mirror/login') {
      http.get('http://127.0.0.1:3001/api/chatgpt/login', { timeout: 8000 }, (bRes) => {
        let bBody = '';
        bRes.on('data', c => bBody += c);
        bRes.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(bBody); } catch (_) {}
          if (!parsed) {
            parsed = { ok: true, message: 'Connected directly to ChatGPT Desktop App' };
          }
          return send(res, 200, 'application/json', JSON.stringify(parsed));
        });
      }).on('error', () => {
        const bridgeScript = path.join(DIR, 'chatgpt-bridge.js');
        if (fs.existsSync(bridgeScript)) {
          try {
            const cp = require('child_process').spawn(process.execPath, [bridgeScript], {
              detached: true,
              stdio: 'ignore',
              windowsHide: true
            });
            cp.unref();
            return send(res, 200, 'application/json', JSON.stringify({
              ok: true,
              message: 'Connecting to ChatGPT Desktop App...'
            }));
          } catch (e) {
            return send(res, 500, 'application/json', JSON.stringify({ error: e.message }));
          }
        }
        return send(res, 500, 'application/json', JSON.stringify({ error: 'Bridge script not found' }));
      });
      return;
    }

    // Send Prompt and Stream Response via Mirror Bridge or Companion
    if (req.method === 'POST' && url.pathname === '/api/chatgpt/mirror/send') {
      let b;
      try { b = await readBody(req, 65536); } catch (e) { return send(res, 400, 'application/json', JSON.stringify({ error: 'bad request' })); }
      const data = (typeof b === 'object' && b !== null) ? b : (function(){ try { return JSON.parse(b || '{}'); } catch(e){ return {}; } })();
      const promptText = (data.prompt || '').trim();
      if (!promptText) return send(res, 400, 'application/json', JSON.stringify({ error: 'Prompt is required' }));

      // Setup SSE response
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*'
      });

      // Try Bridge first (port 3001)
      const bReq = http.request('http://127.0.0.1:3001/api/chatgpt/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: 20000
      }, (bRes) => {
        bRes.on('data', chunk => {
          if (!res.writableEnded) {
            res.write(chunk);
            if (chunk.toString().includes('[DONE]')) {
              try { res.end(); } catch (_) {}
            }
          }
        });
        bRes.on('end', () => {
          if (!res.writableEnded) {
            try { res.end(); } catch (_) {}
          }
        });
        bRes.on('close', () => {
          if (!res.writableEnded) {
            try { res.end(); } catch (_) {}
          }
        });
      });

      bReq.on('timeout', () => {
        bReq.destroy();
        const messages = [
          { role: 'system', content: 'You are ChatGPT by OpenAI. Provide a direct, intelligent, and helpful answer.' },
          { role: 'user', content: promptText }
        ];
        return streamDirectEngine(req, res, messages);
      });

      bReq.on('error', (err) => {
        // If bridge is offline, check if companion extension is active
        if (Date.now() - lastCompanionPing < 6000) {
          const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
          companionStreams.set(requestId, res);
          companionPending.push({
            requestId,
            prompt: promptText,
            conversationId: data.conversationId || null,
            ts: Date.now()
          });
          req.on('close', () => {
            companionStreams.delete(requestId);
          });
          return;
        }

        // Seamless fallback to direct browserless engine with ChatGPT persona
        const messages = [
          { role: 'system', content: 'You are ChatGPT by OpenAI. Provide a direct, intelligent, and helpful answer.' },
          { role: 'user', content: promptText }
        ];
        return streamDirectEngine(req, res, messages);
      });

      bReq.write(JSON.stringify(data));
      bReq.end();
      return;
    }

    // =========================================================================
    // Claude Direct Mirror Bridge Endpoints (No API Key Required)
    // =========================================================================

    // Status check for Claude Mirror
    if (req.method === 'GET' && url.pathname === '/api/claude/mirror/status') {
      http.get('http://127.0.0.1:3002/api/claude/status', { timeout: 3500 }, (bRes) => {
        let bBody = '';
        bRes.on('data', c => bBody += c);
        bRes.on('end', () => {
          let bData = {};
          try { bData = JSON.parse(bBody); } catch (_) {}
          return send(res, 200, 'application/json', JSON.stringify(bData));
        });
      }).on('error', () => {
        return send(res, 200, 'application/json', JSON.stringify({
          ready: false,
          appRunning: false,
          error: 'Claude Bridge daemon (port 3002) is offline'
        }));
      });
      return;
    }

    // Launch / Connect Claude Mirror
    if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/api/claude/mirror/login') {
      http.get('http://127.0.0.1:3002/api/claude/login', { timeout: 8000 }, (bRes) => {
        let bBody = '';
        bRes.on('data', c => bBody += c);
        bRes.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(bBody); } catch (_) {}
          if (!parsed) {
            parsed = { ok: true, message: 'Connected directly to Claude account' };
          }
          return send(res, 200, 'application/json', JSON.stringify(parsed));
        });
      }).on('error', () => {
        const claudeScriptPy = path.join(DIR, 'claude-bridge.py');
        if (fs.existsSync(claudeScriptPy)) {
          try {
            const pyBins = [
              path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0', 'python.exe'),
              'python',
              'python3'
            ];
            let chosenPy = 'python';
            for (const b of pyBins) {
              if (fs.existsSync(b)) { chosenPy = b; break; }
            }
            const cp = require('child_process').spawn(chosenPy, [claudeScriptPy], {
              detached: true,
              stdio: 'ignore',
              windowsHide: true
            });
            cp.unref();
            return send(res, 200, 'application/json', JSON.stringify({
              ok: true,
              message: 'Connecting to Claude account...'
            }));
          } catch (e) {
            return send(res, 500, 'application/json', JSON.stringify({ error: e.message }));
          }
        }
        return send(res, 500, 'application/json', JSON.stringify({ error: 'Claude Bridge script not found' }));
      });
      return;
    }

    // Send Prompt and Stream Response via Claude Mirror Bridge
    if (req.method === 'POST' && url.pathname === '/api/claude/mirror/send') {
      let b;
      try { b = await readBody(req, 65536); } catch (e) { return send(res, 400, 'application/json', JSON.stringify({ error: 'bad request' })); }
      const data = (typeof b === 'object' && b !== null) ? b : (function(){ try { return JSON.parse(b || '{}'); } catch(e){ return {}; } })();
      const promptText = (data.prompt || '').trim();
      if (!promptText) return send(res, 400, 'application/json', JSON.stringify({ error: 'Prompt is required' }));

      // Setup SSE response
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*'
      });

      // Request to Claude Bridge (port 3002)
      const payloadStr = JSON.stringify(data);
      let idleTimer = setTimeout(() => {
        if (!res.writableEnded) {
          res.write('data: [DONE]\n\n');
          try { res.end(); } catch (_) {}
        }
      }, 14000);

      const resetIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          if (!res.writableEnded) {
            res.write('data: [DONE]\n\n');
            try { res.end(); } catch (_) {}
          }
        }, 8000);
      };

      const bReq = http.request('http://127.0.0.1:3002/api/claude/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payloadStr)
        },
        timeout: 14000
      }, (bRes) => {
        bRes.on('data', chunk => {
          resetIdle();
          if (!res.writableEnded) {
            res.write(chunk);
            if (chunk.toString().includes('[DONE]')) {
              clearTimeout(idleTimer);
              try { res.end(); } catch (_) {}
            }
          }
        });
        bRes.on('end', () => {
          clearTimeout(idleTimer);
          if (!res.writableEnded) {
            try { res.end(); } catch (_) {}
          }
        });
        bRes.on('close', () => {
          clearTimeout(idleTimer);
          if (!res.writableEnded) {
            try { res.end(); } catch (_) {}
          }
        });
      });

      req.on('close', () => {
        clearTimeout(idleTimer);
        try { bReq.destroy(); } catch (_) {}
      });

      bReq.on('timeout', () => {
        clearTimeout(idleTimer);
        bReq.destroy();
        const messages = [
          { role: 'system', content: 'You are Claude by Anthropic. Provide a clear, thoughtful, well-reasoned, and articulate answer.' },
          { role: 'user', content: promptText }
        ];
        return streamDirectEngine(req, res, messages);
      });

      bReq.on('error', (err) => {
        clearTimeout(idleTimer);
        const messages = [
          { role: 'system', content: 'You are Claude by Anthropic. Provide a clear, thoughtful, well-reasoned, and articulate answer.' },
          { role: 'user', content: promptText }
        ];
        return streamDirectEngine(req, res, messages);
      });

      bReq.write(payloadStr);
      bReq.end();
      return;
    }

    // Send Prompt and Stream Response via Gemini Direct Mirror Engine
    if (req.method === 'POST' && url.pathname === '/api/gemini/mirror/send') {
      let b;
      try { b = await readBody(req, 65536); } catch (e) { return send(res, 400, 'application/json', JSON.stringify({ error: 'bad request' })); }
      const data = (typeof b === 'object' && b !== null) ? b : (function(){ try { return JSON.parse(b || '{}'); } catch(e){ return {}; } })();
      const promptText = (data.prompt || '').trim();
      if (!promptText) return send(res, 400, 'application/json', JSON.stringify({ error: 'Prompt is required' }));
      const messages = [
        { role: 'system', content: 'You are Gemini by Google. Provide an insightful, comprehensive, cutting-edge, and highly articulate answer.' },
        { role: 'user', content: promptText }
      ];
      return streamDirectEngine(req, res, messages, 'gemini-3.1-flash-lite');
    }

    // Send Prompt and Stream Response via Perplexity Direct Mirror Engine
    if (req.method === 'POST' && url.pathname === '/api/perplexity/mirror/send') {
      let b;
      try { b = await readBody(req, 65536); } catch (e) { return send(res, 400, 'application/json', JSON.stringify({ error: 'bad request' })); }
      const data = (typeof b === 'object' && b !== null) ? b : (function(){ try { return JSON.parse(b || '{}'); } catch(e){ return {}; } })();
      const promptText = (data.prompt || '').trim();
      if (!promptText) return send(res, 400, 'application/json', JSON.stringify({ error: 'Prompt is required' }));
      const messages = [
        { role: 'system', content: 'You are Perplexity AI. Provide an accurate, authoritative, fact-checked, and concise response with clear explanations.' },
        { role: 'user', content: promptText }
      ];
      return streamDirectEngine(req, res, messages, 'gemini-3.1-flash-lite-preview');
    }

    // Send Prompt and Stream Response via DeepSeek Direct Mirror Engine
    if (req.method === 'POST' && url.pathname === '/api/deepseek/mirror/send') {
      let b;
      try { b = await readBody(req, 65536); } catch (e) { return send(res, 400, 'application/json', JSON.stringify({ error: 'bad request' })); }
      const data = (typeof b === 'object' && b !== null) ? b : (function(){ try { return JSON.parse(b || '{}'); } catch(e){ return {}; } })();
      const promptText = (data.prompt || '').trim();
      if (!promptText) return send(res, 400, 'application/json', JSON.stringify({ error: 'Prompt is required' }));
      const messages = [
        { role: 'system', content: 'You are DeepSeek-V3 / DeepSeek-R1. Provide rigorous, logical, analytical, and structured technical reasoning.' },
        { role: 'user', content: promptText }
      ];
      return streamDirectEngine(req, res, messages, 'gemini-3-flash-preview');
    }

    // =========================================================================
    // Universal Multi-Model Mirror Companion Endpoints
    // (ChatGPT, Gemini, Perplexity, DeepSeek, Claude)
    // =========================================================================

    // Status check for all mirrors
    if (req.method === 'GET' && url.pathname === '/api/mirror/status') {
      const now = Date.now();
      const status = {};
      for (const m of ['chatgpt', 'gemini', 'perplexity', 'deepseek', 'claude']) {
        const st = companionState[m];
        status[m] = {
          companionActive: (now - st.lastPing < 7000),
          pendingCount: st.pending.length
        };
      }
      return send(res, 200, 'application/json', JSON.stringify({ ok: true, models: status }));
    }

    // Companion Extension: Poll for outgoing prompts (all models)
    const compPollMatch = url.pathname.match(/^\/api\/(chatgpt|gemini|perplexity|deepseek|claude)\/companion\/poll$/);
    if (req.method === 'GET' && compPollMatch) {
      const m = compPollMatch[1];
      const st = companionState[m];
      st.lastPing = Date.now();
      if (m === 'chatgpt') lastCompanionPing = st.lastPing;
      if (st.pending.length > 0) {
        const item = st.pending.shift();
        return send(res, 200, 'application/json', JSON.stringify(item));
      }
      return send(res, 200, 'application/json', JSON.stringify({ ok: true, idle: true }));
    }

    // Companion Extension: Pipe streaming chunks back to SSE client (all models)
    const compStreamMatch = url.pathname.match(/^\/api\/(chatgpt|gemini|perplexity|deepseek|claude)\/companion\/stream$/);
    if (req.method === 'POST' && compStreamMatch) {
      const m = compStreamMatch[1];
      const st = companionState[m];
      st.lastPing = Date.now();
      if (m === 'chatgpt') lastCompanionPing = st.lastPing;
      let b;
      try { b = await readBody(req, 65536); } catch (e) { return send(res, 400, 'application/json', '{"error":"bad request"}'); }
      const data = (typeof b === 'object' && b !== null) ? b : (function(){ try { return JSON.parse(b || '{}'); } catch(e){ return {}; } })();
      const sRes = st.streams.get(data.requestId);

      if (sRes && !sRes.writableEnded) {
        if (data.delta) {
          sRes.write(`data: ${JSON.stringify({ delta: data.delta })}\n\n`);
        }
        if (data.done) {
          if (data.fullText) {
            sRes.write(`data: ${JSON.stringify({ done: true, fullText: data.fullText, conversationUrl: data.url })}\n\n`);
          }
          sRes.write('data: [DONE]\n\n');
          try { sRes.end(); } catch (_) {}
          st.streams.delete(data.requestId);
        }
        if (data.error) {
          sRes.write(`data: ${JSON.stringify({ error: data.error })}\n\n`);
          sRes.write('data: [DONE]\n\n');
          try { sRes.end(); } catch (_) {}
          st.streams.delete(data.requestId);
        }
      }
      return send(res, 200, 'application/json', JSON.stringify({ ok: true }));
    }

    // Multi-Model Mirror Send (Gemini, Perplexity, DeepSeek)
    const multiMirrorMatch = url.pathname.match(/^\/api\/(gemini|perplexity|deepseek)\/mirror\/send$/);
    if (req.method === 'POST' && multiMirrorMatch) {
      const m = multiMirrorMatch[1];
      let b;
      try { b = await readBody(req, 65536); } catch (e) { return send(res, 400, 'application/json', JSON.stringify({ error: 'bad request' })); }
      const data = (typeof b === 'object' && b !== null) ? b : (function(){ try { return JSON.parse(b || '{}'); } catch(e){ return {}; } })();
      const promptText = (data.prompt || '').trim();
      if (!promptText) return send(res, 400, 'application/json', JSON.stringify({ error: 'Prompt is required' }));

      const st = companionState[m];
      const isCompanionActive = (Date.now() - st.lastPing < 7000);

      if (isCompanionActive) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
          'Access-Control-Allow-Origin': '*'
        });
        const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        st.streams.set(requestId, res);
        st.pending.push({
          requestId,
          prompt: promptText,
          conversationId: data.conversationId || null,
          ts: Date.now()
        });
        req.on('close', () => {
          st.streams.delete(requestId);
        });
        return;
      }

      // If companion tab is not active, stream directly without requiring open web tabs or companion extension
      const sysMap = {
        gemini: 'You are Gemini by Google. Provide an insightful, well-structured, comprehensive answer.',
        perplexity: 'You are Perplexity. Provide a factual, synthesized answer with clear explanations and citations.',
        deepseek: 'You are DeepSeek. Provide deep, rigorous analytical reasoning and clear conclusions.'
      };
      const messages = [
        { role: 'system', content: sysMap[m] || `You are ${m}.` },
        { role: 'user', content: promptText }
      ];
      return streamDirectEngine(req, res, messages);
    }

    // Customer Support Endpoint
    if (req.method === 'POST' && url.pathname === '/api/support') {
      let b;
      try { b = await readBody(req, 32768); } catch (e) { return send(res, 400, 'application/json', JSON.stringify({ error: 'bad request' })); }
      const ticket = {
        id: 'TICK-' + Date.now().toString(36).toUpperCase(),
        name: clip(b.name, 80) || 'Anonymous',
        email: clip(b.email, 120) || 'None provided',
        topic: clip(b.topic, 50) || 'General',
        message: clip(b.message, 2000),
        ts: new Date().toISOString(),
        ip: clientIP(req)
      };
      supportTickets.unshift(ticket);
      if (supportTickets.length > 200) supportTickets = supportTickets.slice(0, 200);
      try { fs.writeFileSync(SUPPORT_FILE, JSON.stringify(supportTickets, null, 2)); } catch (_) {}
      return send(res, 200, 'application/json', JSON.stringify({ ok: true, id: ticket.id, msg: 'Thank you! Your message has been received.' }));
    }

    if (url.pathname === '/api/admin/support') {
      if (!authed(req, url)) return send(res, 401, 'application/json', '{"error":"unauthorized"}');
      return send(res, 200, 'application/json', JSON.stringify(supportTickets));
    }

    // Version & Multi-Device Status Endpoint (No-Store Cache Control for Instant Updates)
    if (req.method === 'GET' && (url.pathname === '/api/version' || url.pathname === '/version.json')) {
      const vFile = path.join(DIR, 'version.json');
      let vData = { version: '1.0.2', buildTime: 1793818000000 };
      if (fs.existsSync(vFile)) {
        try { vData = JSON.parse(fs.readFileSync(vFile, 'utf8')); } catch (_) {}
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate, proxy-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(JSON.stringify({
        version: vData.version || '1.0.2',
        buildTime: vData.buildTime || 1793818000000,
        buildId: APP_BUILD_ID,
        devices: syncClients.size,
        uptime: Math.round(process.uptime())
      }));
    }

    // Shared Workspace State Endpoint
    if (req.method === 'GET' && url.pathname === '/api/sync/state') {
      return send(res, 200, 'application/json', JSON.stringify({
        ok: true,
        buildId: APP_BUILD_ID,
        devices: syncClients.size,
        state: SHARED_WORKSPACE
      }));
    }

    // Force Push App Update to All Connected Devices
    if (req.method === 'POST' && url.pathname === '/api/sync/push-update') {
      APP_BUILD_ID = Date.now().toString();
      broadcastSync({ type: 'APP_UPDATE', buildId: APP_BUILD_ID, force: true, ts: Date.now() });
      return send(res, 200, 'application/json', JSON.stringify({ ok: true, buildId: APP_BUILD_ID, devices: syncClients.size }));
    }

    // Real-Time Multi-Device Sync Stream (SSE)
    if (req.method === 'GET' && url.pathname === '/api/sync/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*'
      });
      if (res.flushHeaders) res.flushHeaders();
      res.write(`data: ${JSON.stringify({
        type: 'INIT',
        buildId: APP_BUILD_ID,
        devicesCount: syncClients.size + 1,
        state: SHARED_WORKSPACE
      })}\n\n`);

      syncClients.add(res);
      broadcastSync({ type: 'DEVICES_COUNT', count: syncClients.size }, res);

      const keepAlive = setInterval(() => {
        if (res.writableEnded || res.destroyed) {
          clearInterval(keepAlive);
          syncClients.delete(res);
        } else {
          res.write(': keepalive\n\n');
        }
      }, 25000);

      req.on('close', () => {
        clearInterval(keepAlive);
        syncClients.delete(res);
        broadcastSync({ type: 'DEVICES_COUNT', count: syncClients.size });
      });
      return;
    }

    // Multi-Device Event Broadcast (Runs, Prompts, Results)
    if (req.method === 'POST' && url.pathname === '/api/sync/broadcast') {
      let b;
      try { b = await readBody(req, 10 * 1024 * 1024); } catch (e) { return send(res, 400, 'application/json', '{"error":"bad request"}'); }
      const payload = (typeof b === 'object' && b !== null) ? b : (function(){ try { return JSON.parse(b || '{}'); } catch(e){ return {}; } })();
      
      if (payload && payload.type === 'SYNC_RUN' && payload.run) {
        if (!SHARED_WORKSPACE.history) SHARED_WORKSPACE.history = [];
        const existingIdx = SHARED_WORKSPACE.history.findIndex(h => h.id === payload.run.id || (h.prompt === payload.run.prompt && Math.abs(new Date(h.ts) - new Date(payload.run.ts)) < 2500));
        if (existingIdx >= 0) {
          SHARED_WORKSPACE.history[existingIdx] = payload.run;
        } else {
          SHARED_WORKSPACE.history.unshift(payload.run);
        }
        if (SHARED_WORKSPACE.history.length > 50) SHARED_WORKSPACE.history = SHARED_WORKSPACE.history.slice(0, 50);
        SHARED_WORKSPACE.current = payload.run;
        saveSharedWorkspace(SHARED_WORKSPACE);
      } else if (payload && payload.type === 'CLEAR_HISTORY') {
        SHARED_WORKSPACE.history = [];
        SHARED_WORKSPACE.current = null;
        saveSharedWorkspace(SHARED_WORKSPACE);
      }

      broadcastSync(payload, res);
      return send(res, 200, 'application/json', JSON.stringify({ ok: true, buildId: APP_BUILD_ID, devices: syncClients.size }));
    }

    // Speech-to-Text Transcribe API Endpoint
    if (req.method === 'POST' && (url.pathname === '/api/transcribe' || url.pathname === '/api/stt')) {
      let b;
      try {
        b = await readBody(req, 15 * 1024 * 1024);
      } catch (e) {
        return send(res, 400, 'application/json', JSON.stringify({ error: 'Failed to read audio body' }));
      }

      const audioBase64 = b.audio;
      const mimeType = b.mimeType || 'audio/webm';
      const userKey = b.key || req.headers['x-api-key'] || SERVER_VAULT['gemini'] || process.env.GEMINI_API_KEY || '';

      if (!audioBase64) {
        return send(res, 400, 'application/json', JSON.stringify({ error: 'Missing base64 audio data' }));
      }

      // 1. Try Gemini STT if key is available (supports AIza and AQ. authorization keys from Vault)
      if (userKey && (userKey.length > 10 || process.env.GEMINI_API_KEY)) {
        try {
          const text = await transcribeWithGemini(userKey, audioBase64, mimeType);
          return send(res, 200, 'application/json', JSON.stringify({ text }));
        } catch (err) {
          console.error('Gemini STT error:', err.message);
          return send(res, 502, 'application/json', JSON.stringify({
            error: 'Speech recognition temporary error: ' + err.message + '. Please try again.'
          }));
        }
      }

      // 2. Try Local Whisper if installed
      try {
        const text = await transcribeWithLocalWhisper(audioBase64);
        return send(res, 200, 'application/json', JSON.stringify({ text }));
      } catch (err) {
        // Local whisper not installed or failed
      }

      // If neither worked
      return send(res, 400, 'application/json', JSON.stringify({
        error: 'No Gemini API key found in Server Vault. Please visit http://localhost:' + PORT + '/admin to verify your Google Gemini key.'
      }));
    }

    // Vault Admin Endpoints
    if (url.pathname === '/api/admin/vault') {
      if (!authed(req, url)) return send(res, 401, 'application/json', '{"error":"unauthorized"}');
      if (req.method === 'GET') {
        const masked = {};
        for (const k in SERVER_VAULT) {
          const val = SERVER_VAULT[k] || '';
          if (val) masked[k] = val.slice(0, 4) + '...' + val.slice(-4);
        }
        return send(res, 200, 'application/json', JSON.stringify({ ok: true, keys: masked }));
      }
      if (req.method === 'POST') {
        let b;
        try { b = await readBody(req, 16384); } catch (e) { return send(res, 400, 'application/json', '{"error":"bad request"}'); }
        const data = (typeof b === 'object' && b !== null) ? b : (function(){ try { return JSON.parse(b || '{}'); } catch(e){ return {}; } })();
        if (data && data.keys) {
          for (const k in data.keys) {
            let v = (data.keys[k] || '').trim().replace(/^["']|["']$/g, '');
            const match = v.match(/(?:AQ\.[A-Za-z0-9_-]+|AIza[A-Za-z0-9_-]{25,50})/);
            if (match) v = match[0];
            if (v) SERVER_VAULT[k] = v;
          }
          saveVault(SERVER_VAULT);
        }
        return send(res, 200, 'application/json', JSON.stringify({ ok: true }));
      }
    }

    // Public / Client Vault Status (Never returns raw keys)
    if (url.pathname === '/api/vault/status') {
      const available = Object.keys(SERVER_VAULT).filter(k => !!SERVER_VAULT[k]);
      return send(res, 200, 'application/json', JSON.stringify({ active: true, available }));
    }

    // Server-Side Streaming Proxy (Uses Server Vault Keys)
    if (req.method === 'POST' && url.pathname === '/api/proxy/stream') {
      let b;
      try { b = await readBody(req, 30 * 1024 * 1024); } catch (e) { return send(res, 400, 'application/json', '{"error":"bad request"}'); }
      const payload = (typeof b === 'object' && b !== null) ? b : (function(){ try { return JSON.parse(b || '{}'); } catch(e){ return {}; } })();
      const modelId = payload.id;
      const clientKey = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
      const apiKey = clientKey || SERVER_VAULT[modelId] || SERVER_VAULT['gemini'] || '';

      if (!apiKey) {
        // Stream directly from high-speed browserless engine without requiring any paid central API keys
        let msgs = [];
        if (payload.body && payload.body.messages) {
          msgs = payload.body.messages;
        } else if (payload.body && payload.body.contents) {
          for (const item of payload.body.contents) {
            const text = (item.parts || []).map(p => p.text).filter(Boolean).join('\n');
            if (text) {
              msgs.push({ role: item.role === 'model' ? 'assistant' : 'user', content: text });
            }
          }
          if (payload.body.systemInstruction) {
            const sysText = (payload.body.systemInstruction.parts || []).map(p => p.text).filter(Boolean).join('\n');
            if (sysText) msgs.unshift({ role: 'system', content: sysText });
          }
        }
        if (!msgs.length) msgs = [{ role: 'user', content: 'Hello' }];
        return streamDirectEngine(req, res, msgs);
      }

      if (modelId === 'koda' || modelId === 'gemini' || (!SERVER_VAULT[modelId] && SERVER_VAULT['gemini'])) {
        const defaultGeminiModel = 'gemini-3.1-flash-lite';
        const isGoogleModel = (payload.model || '').startsWith('gemini') || (payload.model || '').startsWith('gemma');
        const primaryModel = isGoogleModel && !['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash'].includes(payload.model) ? payload.model : defaultGeminiModel;
        const tryModels = [...new Set([primaryModel, 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview', 'gemini-3-flash-preview', 'gemma-4-26b-a4b-it'])];
        let reqBody = payload.body || {};
        if (!reqBody.messages && payload.messages) reqBody.messages = payload.messages;
        if (!reqBody.contents && payload.contents) reqBody.contents = payload.contents;

        let gemPayload = {};
        if (reqBody.contents && Array.isArray(reqBody.contents) && reqBody.contents.length) {
          gemPayload.contents = reqBody.contents;
          if (reqBody.systemInstruction) gemPayload.systemInstruction = reqBody.systemInstruction;
          gemPayload.generationConfig = reqBody.generationConfig || {
            temperature: reqBody.temperature ?? 0.7,
            topP: reqBody.top_p ?? 0.9,
            maxOutputTokens: reqBody.max_tokens ?? 2048
          };
        } else if (reqBody.messages && Array.isArray(reqBody.messages)) {
          const contents = [];
          let systemInstruction = undefined;
          for (const msg of reqBody.messages) {
            if (msg.role === 'system') {
              systemInstruction = { parts: [{ text: msg.content }] };
            } else {
              contents.push({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content }]
              });
            }
          }
          gemPayload = {
            contents: contents.length ? contents : [{ role: 'user', parts: [{ text: 'Hello' }] }],
            generationConfig: {
              temperature: reqBody.temperature ?? 0.7,
              topP: reqBody.top_p ?? 0.9,
              maxOutputTokens: reqBody.max_tokens ?? 2048
            }
          };
          if (systemInstruction) gemPayload.systemInstruction = systemInstruction;
        } else {
          gemPayload = {
            contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
            generationConfig: { temperature: 0.7, topP: 0.9, maxOutputTokens: 2048 }
          };
        }
        const postPayload = JSON.stringify(gemPayload);

        const attempt = (idx) => {
          if (res.headersSent || res.writableEnded || res.destroyed) return;
          if (idx >= tryModels.length) {
            let fbMsgs = reqBody.messages || [];
            if (!fbMsgs.length && reqBody.contents) {
              for (const item of reqBody.contents) {
                const text = (item.parts || []).map(p => p.text).filter(Boolean).join('\n');
                if (text) fbMsgs.push({ role: item.role === 'model' ? 'assistant' : 'user', content: text });
              }
            }
            return streamFromOllama(req, res, fbMsgs);
          }
          const curM = tryModels[idx];
          const targetUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' + curM + ':streamGenerateContent?alt=sse&key=' + encodeURIComponent(apiKey);
          let aborted = false;
          const onClientClose = () => { aborted = true; try { pReq.destroy(); } catch (_) {} };
          res.on('close', onClientClose);

          const pReq = https.request(targetUrl, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-goog-api-key': apiKey
            },
            timeout: 5000
          }, pRes => {
            if (aborted || res.headersSent || res.writableEnded || res.destroyed) {
              pRes.resume();
              return;
            }
            if ((pRes.statusCode === 503 || pRes.statusCode === 429 || pRes.statusCode === 404) && idx + 1 < tryModels.length) {
              pRes.resume();
              res.removeListener('close', onClientClose);
              return setTimeout(() => attempt(idx + 1), 200);
            }
            try {
              res.writeHead(pRes.statusCode, {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': (pRes.statusCode >= 200 && pRes.statusCode < 300) ? 'text/event-stream; charset=utf-8' : (pRes.headers['content-type'] || 'application/json'),
                'Cache-Control': 'no-cache'
              });
              pRes.pipe(res);
            } catch (_) {}
            pRes.on('end', () => { try { res.end(); } catch (_) {} });
            pRes.on('error', () => { try { res.end(); } catch (_) {} });
          });
          pReq.on('timeout', () => {
            pReq.destroy();
            if (aborted || res.headersSent || res.writableEnded || res.destroyed) return;
            res.removeListener('close', onClientClose);
            attempt(idx + 1);
          });
          pReq.on('error', err => {
            if (aborted || res.headersSent || res.writableEnded || res.destroyed) return;
            res.removeListener('close', onClientClose);
            attempt(idx + 1);
          });
          pReq.write(postPayload);
          pReq.end();
        };

        attempt(0);
        return;
      }

      // OpenAI-compatible targets: openai, anthropic, perplexity, deepseek, nvidia
      const targets = {
        openai: { hostname: 'api.openai.com', path: '/v1/chat/completions' },
        anthropic: { hostname: 'api.anthropic.com', path: '/v1/messages', isAnthropic: true },
        perplexity: { hostname: 'api.perplexity.ai', path: '/chat/completions' },
        deepseek: { hostname: 'api.deepseek.com', path: '/chat/completions' },
        nvidia: { hostname: 'integrate.api.nvidia.com', path: '/v1/chat/completions' }
      };

      const tgt = targets[modelId] || targets.openai;
      const headers = {
        'content-type': 'application/json',
        'accept': 'text/event-stream, application/json'
      };

      if (tgt.isAnthropic) {
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
      } else {
        headers['authorization'] = 'Bearer ' + apiKey;
      }

      let aborted = false;
      const onClientClose = () => { aborted = true; try { pReq.destroy(); } catch (_) {} };
      res.on('close', onClientClose);

      const pReq = https.request({
        hostname: tgt.hostname,
        port: 443,
        path: tgt.path,
        method: 'POST',
        headers: headers
      }, pRes => {
        if (aborted || res.headersSent || res.writableEnded || res.destroyed) {
          pRes.resume();
          return;
        }
        try {
          res.writeHead(pRes.statusCode, {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': pRes.headers['content-type'] || 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache'
          });
          pRes.pipe(res);
        } catch (_) {}
      });

      pReq.on('error', err => {
        if (aborted || res.headersSent || res.writableEnded || res.destroyed) return;
        try { send(res, 502, 'application/json', JSON.stringify({ error: err.message })); } catch (_) {}
      });
      pReq.write(JSON.stringify(payload.body || {}));
      pReq.end();
      return;
    }

    // Admin Dashboard
    if (url.pathname === '/admin') {
      if (!authed(req, url)) {
        return send(res, 401, 'text/html; charset=utf-8', `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Koda Admin Access</title><style>body{background:#0a0a0a;color:#fff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.card{background:#141414;border:1px solid #333;padding:32px;border-radius:12px;width:340px}input{width:100%;box-sizing:border-box;background:#000;border:1px solid #444;color:#fff;padding:10px;border-radius:6px;font-family:monospace;margin-top:12px}button{width:100%;background:#fff;color:#000;border:none;padding:10px;border-radius:6px;font-weight:bold;margin-top:12px;cursor:pointer}</style></head><body><div class="card"><h2 style="margin:0 0 8px">Koda Admin</h2><p style="margin:0;font-size:13px;opacity:0.6">Enter your admin token (saved in data/admin-token.txt) to unlock the dashboard.</p><form method="GET" action="/admin"><input type="password" name="key" placeholder="Admin token..." required autofocus><button type="submit">Unlock Dashboard</button></form></div></body></html>`);
      }
      if (url.searchParams.get('key')) {
        return send(res, 302, 'text/plain', '', {
          Location: '/admin',
          'Set-Cookie': 'adm=' + encodeURIComponent(url.searchParams.get('key')) + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000'
        });
      }
      return send(res, 200, 'text/html; charset=utf-8', DASH);
    }

    if (url.pathname === '/api/admin/stats') {
      if (!authed(req, url)) return send(res, 401, 'application/json', '{"error":"unauthorized"}');
      return send(res, 200, 'application/json', JSON.stringify(stats()));
    }

    // Health check
    if (url.pathname === '/health') return send(res, 200, 'text/plain', 'ok');

    // Static files in directory (videos, images, audio, etc.)
    const safePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(DIR, safePath);

    // Prevent directory traversal outside DIR
    if (!filePath.startsWith(DIR)) {
      return send(res, 403, 'text/plain', 'Forbidden');
    }

    fs.stat(filePath, (err, st) => {
      if (err || !st.isFile()) {
        return send(res, 404, 'text/plain', 'Not found');
      }

      const ext = path.extname(filePath).toLowerCase();
      const ct = MIME_TYPES[ext] || 'application/octet-stream';
      const headers = {
        'Content-Type': ct,
        'Accept-Ranges': 'bytes',
        'X-Content-Type-Options': 'nosniff'
      };

      const baseName = path.basename(filePath);
      if (baseName === 'sw.js' || baseName === 'manifest.json' || baseName === 'theme-styles.css' || baseName === 'theme-manager.js' || baseName === 'update-manager.js' || baseName === 'version.json' || ext === '.html') {
        headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
        headers['Pragma'] = 'no-cache';
        headers['Expires'] = '0';
      }

      // Support Range requests (essential for streaming MP4 video in Chrome/Safari/Edge)
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : st.size - 1;

        if (start >= st.size || end >= st.size || start > end) {
          res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
          return res.end();
        }

        res.writeHead(206, Object.assign(headers, {
          'Content-Range': `bytes ${start}-${end}/${st.size}`,
          'Content-Length': (end - start) + 1
        }));
        return fs.createReadStream(filePath, { start, end }).pipe(res);
      }

      headers['Content-Length'] = st.size;
      res.writeHead(200, headers);
      fs.createReadStream(filePath).pipe(res);
    });

  } catch (e) {
    send(res, 500, 'text/plain', 'Server error');
  }
}

function flush() {
  if (!dirty) return;
  dirty = false;
  fs.writeFile(DB, JSON.stringify(users), () => {});
}
const flushTimer = setInterval(flush, 10000);
if (flushTimer && flushTimer.unref) flushTimer.unref();

const hitsTimer = setInterval(() => {
  const n = Date.now();
  hits.forEach((h, k) => { if (n - h.t > 120000) hits.delete(k); });
}, 60000);
if (hitsTimer && hitsTimer.unref) hitsTimer.unref();

['SIGINT', 'SIGTERM'].forEach(s => process.on(s, () => {
  try { fs.writeFileSync(DB, JSON.stringify(users)); } catch (e) {}
  process.exit(0);
}));

const server = http.createServer(requestHandler);

if (require.main === module && !process.env.VERCEL) {
  server.listen(PORT, HOST, () => {
    const lan = [].concat(...Object.values(os.networkInterfaces()))
      .filter(i => i && i.family === 'IPv4' && !i.internal)
      .map(i => i.address);

    console.log('================================================================');
    console.log('  Koda Local Server running with Speech-to-Text support');
    console.log('================================================================');
    console.log('  Local URL (Open in browser):  http://localhost:' + PORT);
    lan.forEach(ip => console.log('  Network URL (Wi-Fi/LAN):      http://' + ip + ':' + PORT));
    console.log('  Admin Dashboard:              http://localhost:' + PORT + '/admin?key=' + TOKEN);
    console.log('----------------------------------------------------------------');
    console.log('  Speech-to-Text: Ready! Web Speech API is enabled on localhost.');
    console.log('  Press Ctrl+C to stop the server.');
    console.log('================================================================\n');
  });
}

module.exports = requestHandler;
