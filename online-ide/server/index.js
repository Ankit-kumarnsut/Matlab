const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

function runCommand(command, args, input, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

app.post('/api/run', async (req, res) => {
  const { language, code, stdin } = req.body || {};
  if (!language || typeof code !== 'string') {
    return res.status(400).json({ error: 'language and code are required' });
  }

  const id = uuidv4();
  const tmpDir = path.join(__dirname, '..', 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  try {
    if (language === 'javascript') {
      const file = path.join(tmpDir, `${id}.mjs`);
      fs.writeFileSync(file, code, 'utf8');
      const result = await runCommand('node', ['--no-warnings', file], stdin || '', 5000);
      fs.rmSync(file, { force: true });
      return res.json(result);
    }

    if (language === 'python') {
      const file = path.join(tmpDir, `${id}.py`);
      fs.writeFileSync(file, code, 'utf8');
      const result = await runCommand('python3', [file], stdin || '', 7000);
      fs.rmSync(file, { force: true });
      return res.json(result);
    }

    if (language === 'cpp') {
      const src = path.join(tmpDir, `${id}.cpp`);
      const out = path.join(tmpDir, `${id}.out`);
      fs.writeFileSync(src, code, 'utf8');
      const compile = await runCommand('bash', ['-lc', `g++ -std=c++17 -O2 -pipe -s "${src}" -o "${out}" 2>&1`], '', 10000);
      if (compile.code !== 0 || compile.stderr) {
        // g++ with bash wrapper puts errors in stdout due to 2>&1
        const msg = (compile.stdout || compile.stderr || '').trim();
        fs.rmSync(src, { force: true });
        fs.rmSync(out, { force: true });
        return res.json({ code: compile.code, stdout: '', stderr: msg, timedOut: compile.timedOut });
      }
      const run = await runCommand(out, [], stdin || '', 5000);
      fs.rmSync(src, { force: true });
      fs.rmSync(out, { force: true });
      return res.json(run);
    }

    return res.status(400).json({ error: 'Unsupported language' });
  } catch (err) {
    return res.status(500).json({ error: String(err && err.message || err) });
  }
});

app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path && req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});