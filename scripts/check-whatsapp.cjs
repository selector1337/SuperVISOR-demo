// Diagnóstico em sessão temporária: não conecta conta nem envia mensagens.
require('../src/env');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'supervisor-wa-check-'));
process.env.DEMO_DATA_DIR = tempRoot;
process.env.DEMO_CLIENT_ID = 'diagnostico';
const trial = require('../src/trial');
fs.mkdirSync(trial.clientDir('diagnostico'));
trial.save({ id: 'diagnostico', days: null, startedAt: new Date().toISOString(), expiresAt: null });
process.chdir(trial.clientDir('diagnostico'));
const whatsapp = require('../src/whatsapp');
let finished = false;
async function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  console.log(error ? `Falha: ${error}` : 'QR Code gerado com sucesso. Nenhuma conta foi conectada.');
  await whatsapp.shutdownWhatsApp();
  // Somente o diretório criado por mkdtemp nesta execução.
  process.chdir(os.tmpdir());
  try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); }
  catch (cleanupError) { console.error('Não foi possível remover o diretório temporário:', cleanupError.message); }
  process.exit(error ? 1 : 0);
}
const timeout = setTimeout(() => finish('Tempo esgotado (150 segundos) ao gerar QR Code.'), 150000);
console.log(`Node ${process.version}; whatsapp-web.js ${require('whatsapp-web.js/package.json').version}; Puppeteer ${require('puppeteer/package.json').version}`);
whatsapp.initWhatsApp({ emit(event, state) {
  if (event !== 'whatsapp:state' || finished) return;
  console.log(`Estado: ${state.status}`);
  if (state.qrCodeDataUrl) finish();
  else if (state.status === 'error') finish(state.error);
} });
process.once('SIGINT', () => finish('Diagnóstico interrompido.'));
process.once('SIGTERM', () => finish('Diagnóstico interrompido.'));
