// Koda Claude Bridge forwarder to browserless Python bridge (ZERO Google Chrome)
const { spawn } = require('child_process');
const path = require('path');

const pyScript = path.join(__dirname, 'claude-bridge.py');
const p = spawn('python', [pyScript], { stdio: 'inherit' });
p.on('exit', code => process.exit(code || 0));
