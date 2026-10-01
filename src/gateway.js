require('./env');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fork } = require('child_process');
const trial = require('./trial');

function createGateway({ workerPath = path.join(__dirname, 'server.js') } = {}) {
  const workers = new Map();
  const loginAttempts = new Map();
  let stopping = false;
  const secure = process.env.DEMO_COOKIE_SECURE !== 'false';
  const cookieName = secure ? '__Host-supervisor-demo' : 'supervisor-demo';
  const digest = value => crypto.createHash('sha256').update(value).digest('hex');
  function findClient(token) {
    if (!/^[a-f0-9]{64}$/.test(token || '') || !fs.existsSync(trial.registry)) return null;
    const hash = digest(token);
    for (const id of fs.readdirSync(trial.registry)) {
      if (!fs.existsSync(path.join(trial.registry, id, 'trial.json'))) continue;
      const client = trial.read(id);
      if (client.tokenHash === hash) return client;
    }
    return null;
  }
  function cookieClient(req) {
    const token = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    return findClient(token);
  }
  function page(res, status, text) {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    res.end(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>SuperVISOR Demo</title><body style="font-family:system-ui;background:#101827;color:#eef2ff;max-width:640px;margin:12vh auto;padding:24px"><h1>SuperVISOR Demo</h1><p>${text}</p></body></html>`);
  }
  function errorResponse(req, res, status, message) {
    if (req.url.startsWith('/api/') || req.url.startsWith('/socket.io/')) {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ error: message, code: status === 403 ? 'DEMO_EXPIRED' : 'INVITE_REQUIRED' }));
    }
    page(res, status, message);
  }
  function stopWorker(worker) {
    if (worker.stopping) return;
    worker.stopping = true;
    worker.child.kill('SIGTERM');
    worker.killTimer = setTimeout(() => worker.child.kill('SIGKILL'), 20000);
    worker.killTimer.unref();
  }
  function ensureWorker(client) {
    if (stopping) return Promise.reject(new Error('Servidor encerrando.'));
    const existing = workers.get(client.id);
    if (existing) return existing.stopping ? Promise.reject(new Error('Ambiente encerrando.')) : existing.ready;
    if (workers.size >= Number(process.env.DEMO_MAX_WORKERS || 10)) return Promise.reject(new Error('Capacidade de demos atingida. Tente novamente mais tarde.'));
    const env = { ...process.env, PORT: '0', DEMO_CLIENT_ID: client.id, SESSION_SECRET: client.sessionSecret, DEMO_DATA_DIR: trial.registry };
    delete env.MONGODB_URI;
    delete env.MONGODB_DB;
    const child = fork(workerPath, [], { cwd: trial.clientDir(client.id), env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    const worker = { child, stopping: false };
    workers.set(client.id, worker);
    worker.ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { stopWorker(worker); reject(new Error('Tempo esgotado ao iniciar demo.')); }, 20000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', () => {
        clearTimeout(timeout);
        clearTimeout(worker.killTimer);
        workers.delete(client.id);
        reject(new Error('Ambiente indisponível.'));
      });
      child.on('message', message => {
        if (message.type === 'ready') { clearTimeout(timeout); resolve(message.port); }
      });
    });
    return worker.ready;
  }
  const server = http.createServer(async (req, res) => {
    try {
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Cache-Control', 'no-store');
      if (req.url === '/health') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ ok: !stopping }));
      }
      const invite = req.url.match(/^\/convite\/([a-f0-9]{64})$/);
      if (invite && req.method === 'GET') {
        const client = findClient(invite[1]);
        if (!client) return page(res, 404, 'Convite inválido. Solicite um novo link à UM Software.');
        if (trial.expired(client)) return page(res, 403, 'Seu período de demonstração terminou. Entre em contato com a UM Software para contratar o SuperVISOR.');
        res.writeHead(303, { Location: '/', 'Set-Cookie': `${cookieName}=${invite[1]}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure ? '; Secure' : ''}` });
        return res.end();
      }
      const client = cookieClient(req);
      if (!client) return errorResponse(req, res, 401, 'Teste o SuperVISOR por 7 dias. Acesse usando o convite enviado pela UM Software e suas credenciais.');
      if (trial.expired(client)) return errorResponse(req, res, 403, 'Seu período de demonstração terminou. Entre em contato com a UM Software para contratar o SuperVISOR.');
      if (req.url.split('?')[0] === '/api/login' && req.method === 'POST') {
        const key = `${client.id}:${req.headers['x-real-ip'] || req.socket.remoteAddress}`;
        const now = Date.now();
        const entry = loginAttempts.get(key);
        const attempt = entry && entry.until > now ? entry : { count: 0, until: now + 600000 };
        loginAttempts.set(key, attempt);
        if (++attempt.count > 20) return errorResponse(req, res, 429, 'Muitas tentativas de login. Aguarde 10 minutos.');
      }
      const port = await ensureWorker(client);
      if (trial.expired(trial.read(client.id))) return errorResponse(req, res, 403, 'Demonstração encerrada.');
      const upstream = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers: req.headers }, response => {
        res.writeHead(response.statusCode, { ...response.headers, 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' });
        response.pipe(res);
      });
      upstream.on('error', () => { if (!res.headersSent) errorResponse(req, res, 503, 'Ambiente indisponível. Tente novamente.'); else res.destroy(); });
      req.on('aborted', () => upstream.destroy());
      res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
      req.pipe(upstream);
    } catch (error) {
      console.error(error.message);
      if (!res.headersSent) errorResponse(req, res, 503, 'Não foi possível abrir sua demo. Tente novamente.');
    }
  });
  server.on('upgrade', async (req, socket, head) => {
    try {
      const client = cookieClient(req);
      if (!client || trial.expired(client) || !req.url.startsWith('/socket.io/')) throw new Error('Acesso inválido.');
      const port = await ensureWorker(client);
      const upstream = http.request({ host: '127.0.0.1', port, path: req.url, headers: req.headers });
      upstream.on('upgrade', (response, remote, remoteHead) => {
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([key, value]) => `${key}: ${value}\r\n`).join('')}\r\n`);
        if (remoteHead.length) socket.write(remoteHead);
        if (head.length) remote.write(head);
        socket.on('error', () => remote.destroy());
        remote.on('error', () => socket.destroy());
        socket.on('close', () => remote.destroy());
        remote.on('close', () => socket.destroy());
        socket.pipe(remote).pipe(socket);
      });
      upstream.on('response', response => { response.resume(); socket.destroy(); });
      upstream.on('error', () => socket.destroy());
      upstream.end();
    } catch { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); }
  });
  const sweep = setInterval(() => {
    for (const [id, worker] of workers) {
      try { if (trial.expired(trial.read(id))) stopWorker(worker); } catch { stopWorker(worker); }
    }
    for (const [key, value] of loginAttempts) if (value.until <= Date.now()) loginAttempts.delete(key);
  }, 1000);
  sweep.unref();
  async function close() {
    stopping = true;
    clearInterval(sweep);
    server.close();
    await Promise.all([...workers.values()].map(worker => new Promise(resolve => {
      worker.child.once('exit', resolve);
      stopWorker(worker);
    })));
    server.closeAllConnections();
  }
  return { server, close, workers };
}
if (require.main === module) {
  const gateway = createGateway();
  gateway.server.listen(Number(process.env.PORT || 3100), '127.0.0.1', () => console.log('SuperVISOR Demo: gateway iniciado.'));
  let closing = false;
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => {
    if (closing) return;
    closing = true;
    await gateway.close();
    process.exit(0);
  });
}
module.exports = { createGateway };
