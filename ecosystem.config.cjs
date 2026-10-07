const repoRoot = __dirname;

module.exports = {
  apps: [
    {
      name: 'tradeos-staging-api',
      cwd: repoRoot,
      script: './bin/start-api.sh',
      interpreter: '/bin/bash',
      uid: 'lightworld',
      gid: 'lightworld',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      max_memory_restart: '450M',
    },
    {
      name: 'tradeos-staging-web',
      cwd: repoRoot,
      script: './bin/start-web.sh',
      interpreter: '/bin/bash',
      uid: 'lightworld',
      gid: 'lightworld',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      max_memory_restart: '500M',
    },
  ],
};
