const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const DIR = __dirname;
const LOG_FILE = path.join(DIR, 'data', 'service-247.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch (_) {}
  console.log(msg);
}

log('Koda 24/7 Watchdog initialized.');

let serverProcess = null;
let tunnelProcess = null;
let shuttingDown = false;

function startServer() {
  if (shuttingDown) return;
  log('Starting server.js...');
  serverProcess = spawn(process.execPath, [path.join(DIR, 'server.js')], {
    cwd: DIR,
    stdio: 'inherit',
    env: process.env
  });

  serverProcess.on('exit', (code, sig) => {
    if (shuttingDown) return;
    log(`Server exited with code ${code} / signal ${sig}. Auto-restarting in 2 seconds...`);
    setTimeout(startServer, 2000);
  });
}

function startTunnel() {
  if (shuttingDown) return;
  const cfExe = 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe';
  if (!fs.existsSync(cfExe)) return;

  log('Starting Cloudflare public tunnel...');
  tunnelProcess = spawn(cfExe, ['tunnel', '--url', 'http://localhost:3000'], {
    cwd: DIR
  });

  tunnelProcess.stderr.on('data', (data) => {
    const text = data.toString();
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (match) {
      const publicUrl = match[0];
      log(`PUBLIC TUNNEL LIVE: ${publicUrl}`);
      try {
        fs.writeFileSync(path.join(DIR, 'data', 'public-tunnel-url.txt'), publicUrl, 'utf8');
      } catch (_) {}
    }
  });

  tunnelProcess.on('exit', (code, sig) => {
    if (shuttingDown) return;
    log(`Tunnel exited with code ${code}. Auto-restarting in 3 seconds...`);
    setTimeout(startTunnel, 3000);
  });
}

startServer();
// Wait 2s for local server to be ready before starting tunnel
setTimeout(startTunnel, 2000);

['SIGINT', 'SIGTERM'].forEach(sig => {
  process.on(sig, () => {
    shuttingDown = true;
    log('Stopping 24/7 service...');
    try { if (serverProcess) serverProcess.kill(); } catch (_) {}
    try { if (tunnelProcess) tunnelProcess.kill(); } catch (_) {}
    process.exit(0);
  });
});
