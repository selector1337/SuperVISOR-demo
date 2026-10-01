const path = require('path');
module.exports = {
  apps: [{
    name: 'supervisor-demo',
    script: 'src/gateway.js',
    cwd: __dirname,
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    restart_delay: 5000,
    min_uptime: '30s',
    max_restarts: 10,
    kill_timeout: 25000,
    env: {
      NODE_ENV: 'production',
      PUPPETEER_CACHE_DIR: path.join(__dirname, '.cache', 'puppeteer')
    }
  }]
};
