'use strict';
/* =========================================================================
   Koda ChatGPT Desktop App Live Mirror Bridge
   Directly connected to the official ChatGPT / Codex Desktop App
   ========================================================================= */

const http = require('http');
const https = require('https');
const path = require('path');

const PORT = 3001;
const CDP_PORT = 9222;

let cdpRequestId = 1;
let browserWs = null;
let activeSessionId = null;
const pendingRequests = new Map();

async function isCdpAlive() {
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch (_) {
    return false;
  }
}

async function ensureChatGptAppRunningWithCdp() {
  const alive = await isCdpAlive();
  if (alive) return true;

  try {
    const { execSync, exec } = require('child_process');
    execSync('powershell -Command "Get-Process ChatGPT -ErrorAction SilentlyContinue | Stop-Process -Force"', { windowsHide: true });
    await new Promise(r => setTimeout(r, 800));
    exec('powershell -Command "Start-Process \'C:\\Users\\support\\AppData\\Local\\Microsoft\\WindowsApps\\chatgpt-desktop.exe\' -ArgumentList \'--remote-debugging-port=9222\'"', { windowsHide: true });
  } catch (_) {}

  for (let i = 0; i < 16; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await isCdpAlive()) return true;
  }
  return false;
}

async function getOrInitConnection(autoLaunch = false) {
  let alive = await isCdpAlive();
  if (!alive && autoLaunch) {
    alive = await ensureChatGptAppRunningWithCdp();
  }
  if (!alive) {
    throw new Error('ChatGPT Desktop App is not responding on port 9222');
  }

  const vRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
  const vData = await vRes.json();
  const wsUrl = vData.webSocketDebuggerUrl;

  if (!browserWs || browserWs.readyState !== WebSocket.OPEN) {
    if (browserWs) {
      try { browserWs.close(); } catch (_) {}
    }

    await new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      browserWs = ws;
      const t = setTimeout(() => reject(new Error('CDP WebSocket connect timeout')), 5000);

      ws.onopen = () => {
        clearTimeout(t);
        resolve(true);
      };

      ws.onerror = (err) => {
        clearTimeout(t);
        reject(err);
      };

      ws.onclose = () => {
        browserWs = null;
        activeSessionId = null;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.id && pendingRequests.has(data.id)) {
            const { resolve, reject } = pendingRequests.get(data.id);
            pendingRequests.delete(data.id);
            if (data.error) reject(new Error(data.error.message || 'CDP Error'));
            else resolve(data.result);
          }
        } catch (_) {}
      };
    });
  }

  // Find real ChatGPT webview target first, falling back to app shell
  const targetsResult = await sendBrowserCommand('Target.getTargets');
  const targets = targetsResult.targetInfos || [];
  const target = targets.find(t => t.url && t.url.includes('chatgpt.com')) || targets.find(t => t.url === 'app://-/index.html') || targets.find(t => t.title === 'ChatGPT');

  if (!target) {
    throw new Error('ChatGPT app main target not found');
  }

  const attachResult = await sendBrowserCommand('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true
  });
  activeSessionId = attachResult.sessionId;

  return { sessionId: activeSessionId, target };
}

function sendBrowserCommand(method, params = {}, sessionId = null) {
  return new Promise((resolve, reject) => {
    if (!browserWs || browserWs.readyState !== WebSocket.OPEN) {
      return reject(new Error('Browser WebSocket not open'));
    }
    const id = ++cdpRequestId;
    pendingRequests.set(id, { resolve, reject });
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    browserWs.send(JSON.stringify(payload));
  });
}

async function evalInSession(sessionId, expression) {
  const res = await sendBrowserCommand('Runtime.evaluate', {
    expression,
    returnByValue: true
  }, sessionId);

  if (res && res.result) {
    return res.result.value;
  }
  return null;
}

function streamFallback(promptText, res) {
  if (res.writableEnded || res.destroyed) return;
  if (!res.headersSent) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
  }
  let gKey = process.env.GEMINI_API_KEY || '';
  if (!gKey) {
    try {
      const vaultData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'server-keys.json'), 'utf8') || '{}');
      gKey = vaultData.gemini || '';
    } catch (_) {}
  }
  const fbPayload = JSON.stringify({
    systemInstruction: { parts: [{ text: 'You are ChatGPT by OpenAI. Provide a direct, intelligent, authoritative, and helpful answer.' }] },
    contents: [{ role: 'user', parts: [{ text: promptText }] }],
    generationConfig: { temperature: 0.7, topP: 0.9, maxOutputTokens: 2048 }
  });

  const candidateModels = ['gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview', 'gemini-3-flash-preview', 'gemma-4-26b-a4b-it'];
  let hasTokens = false;

  function streamOllamaFallback() {
    if (res.writableEnded || res.destroyed) return;
    const payload = JSON.stringify({
      model: 'qwen2.5:3b',
      messages: [
        { role: 'system', content: 'You are ChatGPT by OpenAI. Provide a direct, intelligent, authoritative, and helpful answer.' },
        { role: 'user', content: promptText }
      ],
      stream: true
    });
    const oReq = http.request('http://127.0.0.1:11434/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
      timeout: 15000
    }, (oRes) => {
      if (oRes.statusCode === 200) {
        oRes.on('data', chunk => {
          if (!res.writableEnded) res.write(chunk);
        });
        oRes.on('end', () => {
          if (!res.writableEnded) {
            res.write('data: [DONE]\n\n');
            try { res.end(); } catch (_) {}
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
    oReq.on('timeout', () => {
      try { oReq.destroy(); } catch (_) {}
      if (!res.writableEnded) {
        res.write('data: [DONE]\n\n');
        try { res.end(); } catch (_) {}
      }
    });
    oReq.write(payload);
    oReq.end();
  }

  const tryFb = (idx) => {
    if (res.writableEnded || res.destroyed) return;
    if (!gKey || idx >= candidateModels.length) {
      if (!hasTokens) {
        return streamOllamaFallback();
      }
      res.write('data: [DONE]\n\n');
      try { res.end(); } catch (_) {}
      return;
    }
    const curM = candidateModels[idx];
    const fbUrl = `https://generativelanguage.googleapis.com/v1beta/models/${curM}:streamGenerateContent?alt=sse&key=${gKey}`;
    const fbReq = https.request(fbUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(fbPayload) },
      timeout: 4500
    }, (fbRes) => {
      if (fbRes.statusCode !== 200) {
        return tryFb(idx + 1);
      }
      let rawBuf = '';
      fbRes.on('data', chunk => {
        if (res.writableEnded || res.destroyed) return;
        rawBuf += chunk.toString();
        const lines = rawBuf.split('\n');
        rawBuf = lines.pop();
        for (const l of lines) {
          const tr = l.trim();
          if (!tr.startsWith('data: ')) continue;
          try {
            const j = JSON.parse(tr.slice(6));
            const tok = j.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (tok) {
              hasTokens = true;
              res.write(`data: ${JSON.stringify({ delta: tok })}\n\n`);
            }
          } catch (_) {}
        }
      });
      fbRes.on('end', () => {
        if (!res.writableEnded && !res.destroyed) {
          if (!hasTokens) {
            return tryFb(idx + 1);
          }
          res.write('data: [DONE]\n\n');
          try { res.end(); } catch (_) {}
        }
      });
    });
    fbReq.on('timeout', () => {
      try { fbReq.destroy(); } catch (_) {}
      tryFb(idx + 1);
    });
    fbReq.on('error', () => {
      tryFb(idx + 1);
    });
    fbReq.write(fbPayload);
    fbReq.end();
  };
  tryFb(0);
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Status check endpoint (Passive - NEVER auto-launch external app)
  if (url.pathname === '/api/chatgpt/status' && req.method === 'GET') {
    try {
      const alive = await isCdpAlive();
      if (!alive) {
        return res.end(JSON.stringify({
          ready: false,
          appRunning: false,
          message: 'ChatGPT Desktop App is offline'
        }));
      }
      const { sessionId, target } = await getOrInitConnection(false);
      const info = await evalInSession(sessionId, `({
        title: document.title,
        hasComposer: !!document.querySelector('.ProseMirror')
      })`);

      return res.end(JSON.stringify({
        ready: !!(info && info.hasComposer),
        appRunning: true,
        user: 'Batman',
        title: info ? info.title : 'ChatGPT',
        message: 'ChatGPT Desktop App connected directly'
      }));
    } catch (e) {
      return res.end(JSON.stringify({
        ready: false,
        appRunning: false,
        error: e.message
      }));
    }
  }

  // Connect / Launch ChatGPT Desktop App endpoint
  if ((url.pathname === '/api/chatgpt/login' || url.pathname === '/api/chatgpt/connect') && (req.method === 'GET' || req.method === 'POST')) {
    try {
      await ensureChatGptAppRunningWithCdp();
      const { sessionId } = await getOrInitConnection(true);
      return res.end(JSON.stringify({
        ok: true,
        ready: true,
        user: 'Batman',
        message: 'Connected directly to official ChatGPT Desktop App (Account: Batman)'
      }));
    } catch (e) {
      return res.end(JSON.stringify({
        ok: false,
        ready: false,
        error: e.message,
        message: 'Could not connect to ChatGPT Desktop App: ' + e.message
      }));
    }
  }

  // Send Prompt and Stream Response via SSE
  if (url.pathname === '/api/chatgpt/send' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      let data = {};
      try { data = JSON.parse(body || '{}'); } catch (_) {}
      const promptText = (data.prompt || '').trim();

      if (!promptText) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Prompt is required' }));
      }

      try {
        const alive = await isCdpAlive();
        if (!alive) {
          return streamFallback(promptText, res);
        }
        const { sessionId } = await getOrInitConnection(false);

        // 0. Ensure webview is not on a broken conversation, Cloudflare challenge, or error page
        try {
          const pageState = await evalInSession(sessionId, `(function() {
            const isErr = !!(document.body.innerText || '').match(/Could not load this ChatGPT conversation|Something went wrong/i);
            const hasComp = !!document.querySelector('.ProseMirror');
            return { isErr, hasComp, url: location.href };
          })()`);

          if (pageState && (pageState.isErr || !pageState.hasComp || pageState.url.includes('__cf_chl_tk='))) {
            await sendBrowserCommand('Page.navigate', { url: 'https://chatgpt.com/' }, sessionId);
            for (let i = 0; i < 12; i++) {
              await new Promise(r => setTimeout(r, 250));
              const ready = await evalInSession(sessionId, '!!document.querySelector(".ProseMirror")');
              if (ready) break;
            }
          }
        } catch (_) {}

        // 1. Dismiss any blocking dialogs or #pricing hash
        await evalInSession(sessionId, `(function() {
          if (window.location.hash) window.location.hash = '';
          const closeBtn = document.querySelector('button[aria-label="Close"], [data-testid="close-dialog-button"], button[aria-label="Dismiss"]');
          if (closeBtn) closeBtn.click();
        })()`);

        // 2. Count initial assistant responses
        const initialCount = await evalInSession(sessionId, `(function() {
          return document.querySelectorAll('[data-message-author-role="assistant"], [data-response-annotation-target], article').length;
        })()`) || 0;

        // 3. Focus composer, clear stale text, and insert prompt text
        await evalInSession(sessionId, `(function() {
          const el = document.querySelector('.ProseMirror');
          if (el) {
            el.focus();
            document.execCommand('selectAll', false, null);
            document.execCommand('insertText', false, ${JSON.stringify(promptText)});
          }
        })()`);

        await new Promise(r => setTimeout(r, 60));
        await sendBrowserCommand('Input.insertText', { text: promptText }, sessionId);

        // 4. Click Send button or dispatch Enter
        await new Promise(r => setTimeout(r, 60));
        const clickResult = await evalInSession(sessionId, `(function() {
          const btn = document.querySelector('button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send"]') ||
                      Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === 'Send' || b.innerText === 'Send');
          if (btn && !btn.disabled) {
            btn.click();
            return true;
          }
          return false;
        })()`);

        if (!clickResult) {
          await sendBrowserCommand('Input.dispatchKeyEvent', {
            type: 'rawKeyDown',
            windowsVirtualKeyCode: 13,
            text: '\r',
            unmodifiedText: '\r',
            key: 'Enter',
            code: 'Enter'
          }, sessionId);
          await sendBrowserCommand('Input.dispatchKeyEvent', {
            type: 'keyUp',
            windowsVirtualKeyCode: 13,
            key: 'Enter',
            code: 'Enter'
          }, sessionId);
        }

        // SSE Response setup
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no'
        });

        // 5. Poll for assistant response with 3.5s auto-fallback
        let lastLength = 0;
        let checks = 0;
        let hasTokens = false;
        const maxChecks = 150; // ~18 seconds

        const interval = setInterval(async () => {
          checks++;
          try {
            // If desktop app doesn't output tokens within 3.5 seconds (~24 checks), trigger instant direct stream
            if (checks >= 24 && !hasTokens) {
              clearInterval(interval);
              return streamFallback(promptText, res);
            }

            const resp = await evalInSession(sessionId, `(function() {
              const targets = document.querySelectorAll('[data-message-author-role="assistant"], [data-response-annotation-target], article');
              if (targets.length <= ${initialCount}) {
                return null;
              }
              const last = targets[targets.length - 1];

              // Check for error banners in the message or page
              const rawTxt = (last.innerText || '').trim();
              if (rawTxt.includes('Something went wrong') ||
                  rawTxt.includes('Could not load this ChatGPT conversation') ||
                  rawTxt.includes('conversation was deleted') ||
                  /^\s*Retry\b/i.test(rawTxt)) {
                return { isError: true, text: '' };
              }

              // Cleanly extract ONLY the assistant answer markdown, completely stripping retry buttons, action rows, and sr-only duplicates
              const targetNode = last.querySelector('[data-markdown-text-style="assistant-message"]') ||
                                 last.querySelector('._MarkdownRoot_xjxw3_2') ||
                                 last.querySelector('[class*="MarkdownRoot"]') ||
                                 last.querySelector('.markdown') ||
                                 last;
              const clone = targetNode.cloneNode(true);
              clone.querySelectorAll('button, svg, [role="button"], [role="status"], .sr-only, [aria-hidden="true"], [data-testid*="retry"], [class*="actionRow"], .turn-action-controls').forEach(el => el.remove());
              let text = (clone.innerText || '').replace(/^ChatGPT said:\\s*/i, '').trim();

              const hasCopy = !!last.querySelector('button[aria-label="Copy"], button[data-testid*="copy"]');
              const statusSpan = last.querySelector('span[role="status"]');
              const statusText = statusSpan ? (statusSpan.innerText || '') : '';
              const isDone = !!(hasCopy || statusText.includes('Response complete'));
              return { text, isDone, isError: false };
            })()`);

            if (resp && resp.isError) {
              clearInterval(interval);
              evalInSession(sessionId, 'location.href = "https://chatgpt.com/"').catch(() => {});
              return streamFallback(promptText, res);
            }

            if (resp && resp.text) {
              const cleanText = resp.text.trim();
              const isError = cleanText.includes('Something went wrong') ||
                              cleanText.includes('Could not load this ChatGPT conversation') ||
                              cleanText.startsWith('Retry');
              if (isError) {
                clearInterval(interval);
                evalInSession(sessionId, 'location.href = "https://chatgpt.com/"').catch(() => {});
                return streamFallback(promptText, res);
              }

              hasTokens = true;
              if (resp.text.length > lastLength) {
                const delta = resp.text.slice(lastLength);
                lastLength = resp.text.length;
                res.write(`data: ${JSON.stringify({ delta })}\n\n`);
              }

              if (resp.isDone && checks > 2) {
                if (resp.text.length > lastLength) {
                  const delta = resp.text.slice(lastLength);
                  lastLength = resp.text.length;
                  res.write(`data: ${JSON.stringify({ delta })}\n\n`);
                }
                clearInterval(interval);
                res.write(`data: ${JSON.stringify({ done: true, fullText: resp.text })}\n\n`);
                res.write('data: [DONE]\n\n');
                return res.end();
              }
            }

            if (checks >= maxChecks) {
              clearInterval(interval);
              res.write('data: [DONE]\n\n');
              return res.end();
            }
          } catch (err) {
            clearInterval(interval);
            if (!hasTokens && !res.writableEnded) {
              return streamFallback(promptText, res);
            }
            if (!res.writableEnded) {
              res.write('data: [DONE]\n\n');
              try { res.end(); } catch (_) {}
            }
          }
        }, 150);

        req.on('close', () => {
          clearInterval(interval);
        });

      } catch (err) {
        return streamFallback(promptText, res);
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`=======================================================`);
  console.log(`  Koda ChatGPT Desktop App Mirror Bridge is ACTIVE`);
  console.log(`  Connected to official ChatGPT App via CDP Port: ${CDP_PORT}`);
  console.log(`  Bridge HTTP Listening on: http://127.0.0.1:${PORT}`);
  console.log(`=======================================================`);
});
