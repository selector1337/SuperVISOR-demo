const fs = require('fs');
const path = require('path');
const DAYS = 7;
const registry = path.resolve(process.env.DEMO_DATA_DIR || path.join(__dirname, '..', 'instances'));

function clientDir(id) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id || '')) throw new Error('Identificador de cliente inválido.');
  return path.join(registry, id);
}
function read(id = process.env.DEMO_CLIENT_ID) {
  return JSON.parse(fs.readFileSync(path.join(clientDir(id), 'trial.json'), 'utf8'));
}
function save(trial) {
  const file = path.join(clientDir(trial.id), 'trial.json');
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(trial, null, 2), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}
function expired(trial, now = Date.now()) {
  return Boolean(trial.revokedAt || (trial.expiresAt && now >= Date.parse(trial.expiresAt)));
}
function active(trial = read()) {
  return Boolean(trial.startedAt && !expired(trial));
}
function start(id = process.env.DEMO_CLIENT_ID) {
  const trial = read(id);
  if (expired(trial)) throw Object.assign(new Error('Seu período de demonstração terminou.'), { status: 403 });
  if (!trial.startedAt) {
    trial.startedAt = new Date().toISOString();
    trial.expiresAt = new Date(Date.parse(trial.startedAt) + DAYS * 86400000).toISOString();
    save(trial);
  }
  return trial;
}
function publicTrial(trial = read()) {
  return { id: trial.id, name: trial.name, days: DAYS, startedAt: trial.startedAt, expiresAt: trial.expiresAt, expired: expired(trial) };
}
function requireActive() {
  if (!active()) throw Object.assign(new Error('Demonstração inativa ou encerrada.'), { status: 403 });
}
module.exports = { registry, clientDir, read, save, expired, active, start, publicTrial, requireActive };
