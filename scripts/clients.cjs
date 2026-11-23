require('../src/env');
const fs = require('fs');
const crypto = require('crypto');
const trial = require('../src/trial');

async function main() {
  const args = process.argv.slice(2);
  const [action, id, name, email] = process.argv.slice(2);
  if (action === 'set-duration') {
    const info = trial.setDuration(id, trial.parseDuration(args.slice(2)));
    console.log(`Prazo atualizado: ${info.id} • ${trial.durationDays(info) === null ? 'sem expiração' : trial.durationDays(info) + ' dias'} • término: ${info.expiresAt || 'sem data'}`);
    return;
  }
  if (action === 'list') {
    if (!fs.existsSync(trial.registry)) return console.log('Nenhuma demo criada.');
    for (const entry of fs.readdirSync(trial.registry)) {
      const client = trial.read(entry);
      console.log(`${client.id}\t${client.name}\t${trial.expired(client) ? 'encerrada' : client.startedAt ? 'ativa' : 'aguardando login'}\t${trial.durationDays(client) === null ? 'sem expiração' : trial.durationDays(client) + ' dias'}\t${client.expiresAt || '-'}`);
    }
    return;
  }
  if (action === 'revoke') {
    const client = trial.read(id);
    client.revokedAt = new Date().toISOString();
    trial.save(client);
    return console.log('Acesso revogado. O processo será encerrado em até 1 segundo.');
  }
  if (action !== 'create' || !name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) {
    throw new Error('Uso: npm run client -- create identificador "Empresa" email@empresa.com [--days 21 | --unlimited] | set-duration identificador --days 21 | set-duration identificador --unlimited | list | revoke identificador');
  }
  const days = trial.parseDuration(args.slice(4), true);
  const dir = trial.clientDir(id);
  fs.mkdirSync(trial.registry, { recursive: true, mode: 0o700 });
  fs.mkdirSync(dir, { mode: 0o700 }); // Falha se o ID já existe; nunca renova uma demo existente.
  const token = crypto.randomBytes(32).toString('hex');
  const password = crypto.randomBytes(15).toString('base64url');
  process.chdir(dir);
  delete process.env.MONGODB_URI; // Demos sempre usam armazenamento local isolado.
  const store = require('../src/store');
  await store.createUser({ name, email, password });
  trial.save({ id, name, email, days, tokenHash: crypto.createHash('sha256').update(token).digest('hex'), sessionSecret: crypto.randomBytes(32).toString('hex'), createdAt: new Date().toISOString(), startedAt: null, expiresAt: null, revokedAt: null });
  const origin = process.env.DEMO_PUBLIC_URL || 'https://demo.supervisor.umsoftware.com.br';
  console.log(`Convite: ${origin}/convite/${token}\nE-mail: ${email}\nSenha inicial: ${password}\nPrazo: ${days === null ? 'sem expiração (até revogação manual)' : days + ' dias a partir do primeiro login válido'}.\nGuarde o convite: o token não é armazenado em texto aberto.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
