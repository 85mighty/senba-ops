// PM2 설정 — 등록: pm2 start ecosystem.config.cjs && pm2 save  (pm2 save 필수!)
// 다른 PM2 프로세스는 절대 건드리지 않는다. pm2 restart all 금지.
module.exports = {
  apps: [
    {
      name: 'kr-jp-arbitrage',
      script: 'src/index.js',
      cwd: '/root/kr-jp-arbitrage',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '600M',
      env: { NODE_ENV: 'production' },
      out_file: 'logs/pm2-out.log',
      error_file: 'logs/pm2-err.log',
      time: true,
    },
  ],
};
