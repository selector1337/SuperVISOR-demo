const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const registry = fs.mkdtempSync(path.join(os.tmpdir(), 'supervisor-demo-test-'));
process.env.DEMO_DATA_DIR = registry;
process.env.DEMO_COOKIE_SECURE = 'false';
process.env.DEMO_TEST_MODE = 'true';
const trial = require('../src/trial');
const { createGateway } = require('../src/gateway');
let gateway;
after(async () => {
  if (gateway) await gateway.close();
  fs.rmSync(registry, { recursive: true, force: true });
});

test('prazo é exatamente 7 dias e expira no limite, sem renovar por login', () => {
  const dir = trial.clientDir('clock');
  fs.mkdirSync(dir);
  trial.save({ id: 'clock', startedAt: null, expiresAt: null });
  const info = trial.start('clock');
  assert.equal(Date.parse(info.expiresAt) - Date.parse(info.startedAt), 7 * 86400000);
  assert.equal(trial.expired(info, Date.parse(info.expiresAt) - 1), false);
  assert.equal(trial.expired(info, Date.parse(info.expiresAt)), true);
  assert.deepEqual(trial.start('clock'), info);
  info.expiresAt = new Date(Date.now() - 1).toISOString();
  trial.save(info);
  assert.throws(() => trial.start('clock'), /terminou/);
  assert.throws(() => trial.clientDir('../escape'), /inválido/);
});

test('gateway real: convites, login, isolamento, sockets, expiração e revogação', async t => {
  t.after(async () => { if (gateway) { await gateway.close(); gateway = null; } });
  const create = id => {
    const output = execFileSync(process.execPath, [path.join(__dirname, '../scripts/clients.cjs'), 'create', id, `Cliente ${id}`, `${id}@example.com`], { encoding: 'utf8', env: process.env });
    return { token: output.match(/convite\/([a-f0-9]{64})/)[1], password: output.match(/Senha inicial: (\S+)/)[1], email: `${id}@example.com`, cookies: new Map() };
  };
  const a = create('empresa-a');
  const b = create('empresa-b');
  gateway = createGateway();
  await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${gateway.server.address().port}`;
  const request = async (client, url, body) => {
    const response = await fetch(base + url, {
      redirect: 'manual',
      method: body ? 'POST' : 'GET',
      headers: { Cookie: [...client.cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    for (const cookie of response.headers.getSetCookie()) {
      const first = cookie.split(';')[0];
      const pos = first.indexOf('=');
      client.cookies.set(first.slice(0, pos), first.slice(pos + 1));
      assert.match(cookie, /HttpOnly/i);
    }
    return { status: response.status, body: await response.text() };
  };
  assert.equal((await request(a, '/')).status, 401);
  assert.equal((await request(a, '/convite/' + 'f'.repeat(64))).status, 404);
  assert.equal((await request(a, '/convite/' + a.token)).status, 303);
  assert.equal((await request(b, '/convite/' + b.token)).status, 303);
  assert.equal((await request(a, '/api/setup', { name: 'intruso' })).status, 403);
  assert.equal((await request(a, '/api/login', { email: a.email, password: 'errada' })).status, 401);
  assert.equal(trial.read('empresa-a').startedAt, null);
  assert.equal((await request(a, '/api/contacts')).status, 401);
  // Socket.IO permite o transporte inicial, mas exige sessão para entrar no namespace.
  const unauth = await request(a, '/socket.io/?EIO=4&transport=polling');
  const sid = JSON.parse(unauth.body.slice(1)).sid;
  await fetch(`${base}/socket.io/?EIO=4&transport=polling&sid=${sid}`, { method: 'POST', headers: { Cookie: `supervisor-demo=${a.token}`, 'Content-Type': 'text/plain' }, body: '40' });
  const denied = await request(a, `/socket.io/?EIO=4&transport=polling&sid=${sid}`);
  assert.match(denied.body, /Login necessário/);
  assert.equal((await request(a, '/api/login', { email: a.email, password: a.password })).status, 200);
  assert.equal((await request(b, '/api/login', { email: a.email, password: a.password })).status, 401);
  assert.equal((await request(b, '/api/login', { email: b.email, password: b.password })).status, 200);
  const started = trial.read('empresa-a').startedAt;
  await request(a, '/api/login', { email: a.email, password: a.password });
  assert.equal(trial.read('empresa-a').startedAt, started);
  assert.equal((await request(a, '/api/contacts', { name: 'Contato exclusivo A', phone: '5511999999999' })).status, 201);
  assert.equal(JSON.parse((await request(b, '/api/contacts')).body).contacts.length, 0);
  assert.equal((await request(a, '/api/admin/integrations')).status, 404);
  assert.equal((await request(a, '/api/integrations/gum/events', {})).status, 404);
  const app = await request(a, '/app.js');
  assert.doesNotMatch(app.body, /gUMperformance|integrationsTab|Integrações/);
  const authSocket = await request(a, '/socket.io/?EIO=4&transport=polling');
  const authSid = JSON.parse(authSocket.body.slice(1)).sid;
  await fetch(`${base}/socket.io/?EIO=4&transport=polling&sid=${authSid}`, { method: 'POST', headers: { Cookie: [...a.cookies].map(([k,v]) => `${k}=${v}`).join('; '), 'Content-Type': 'text/plain' }, body: '40' });
  assert.match((await request(a, `/socket.io/?EIO=4&transport=polling&sid=${authSid}`)).body, /whatsapp:state/);
  if (process.env.DEMO_UI_TEST === 'true') {
    let browser;
    try { browser = await require('puppeteer').launch({ executablePath: process.env.DEMO_BROWSER_PATH, headless: true }); }
    catch (error) { console.error('Falha na validação visual:', error); throw error; }
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewport({ width: 1440, height: 1000 });
      await page.goto(base + '/convite/' + a.token, { waitUntil: 'networkidle0' });
      await page.type('[name="email"]', a.email);
      await page.type('[name="password"]', a.password);
      await page.click('#authForm button[type="submit"]');
      await page.waitForSelector('.app-shell');
      await page.waitForFunction(() => document.querySelector('#demoBanner')?.textContent.includes('restantes'));
      assert.doesNotMatch(await page.$eval('.nav', el => el.textContent), /Integrações/);
      await page.waitForFunction(() => socket.io.engine.transport.name === 'websocket');
      fs.mkdirSync(path.join(__dirname, '../qa'), { recursive: true });
      await page.screenshot({ path: path.join(__dirname, '../qa/dashboard-desktop.png'), fullPage: true });
      await page.setViewport({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(__dirname, '../qa/dashboard-mobile.png'), fullPage: true });
      assert.deepEqual(errors, []);
      await page.click('#accountButton');
      await page.click('#logoutButton');
      await page.waitForSelector('#authForm');
      assert.equal(await page.evaluate(() => socket.connected), false);
    } finally { await browser.close(); }
  }
  const ended = trial.read('empresa-a');
  ended.expiresAt = new Date(Date.now() - 1).toISOString();
  trial.save(ended);
  assert.equal((await request(a, '/api/contacts')).status, 403);
  assert.equal((await request(a, '/api/login', { email: a.email, password: a.password })).status, 403);
  assert.equal((await request(a, '/')).status, 403);
  assert.equal((await request(a, '/convite/' + a.token)).status, 403);
  assert.equal((await request(b, '/api/contacts')).status, 200);
  const revoked = trial.read('empresa-b');
  revoked.revokedAt = new Date().toISOString();
  trial.save(revoked);
  assert.equal((await request(b, '/api/contacts')).status, 403);
  await new Promise(resolve => setTimeout(resolve, 1800));
  assert.equal(gateway.workers.size, 0);
});

test('expiração bloqueia scheduler e envios diretos antes de consultar WhatsApp', async () => {
  process.env.DEMO_CLIENT_ID = 'clock';
  const store = require('../src/store');
  const previous = store.listSchedules;
  store.listSchedules = async () => { throw new Error('Não deve consultar agendamentos após expiração'); };
  try { await require('../src/scheduler').runDueSchedules(); } finally { store.listSchedules = previous; }
  const whatsapp = require('../src/whatsapp');
  await assert.rejects(whatsapp.sendMessage('fake', 'não enviar'), /encerrada/);
  await assert.rejects(whatsapp.sendMessageWithMedia('fake', { message: 'não enviar' }), /encerrada/);
  await assert.rejects(whatsapp.sendMessageToTargets({ groupIds: ['fake'] }, 'não enviar'), /encerrada/);
});
