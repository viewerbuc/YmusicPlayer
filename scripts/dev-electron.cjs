const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

const root = path.resolve(__dirname, '..');
const host = '127.0.0.1';
const preferredPort = Number(process.env.VITE_PORT || 5173);

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForPort(port, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await canConnect(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for Vite on ${host}:${port}`);
}

async function findFreePort(startPort) {
  for (let port = startPort; port < startPort + 100; port += 1) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port found from ${startPort} to ${startPort + 99}`);
}

function run(command, args, env) {
  return spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
}

(async () => {
  const port = await findFreePort(preferredPort);
  const url = `http://${host}:${port}`;
  console.log(`[dev] Vite dev server: ${url}`);

  const sharedEnv = {
    VITE_DEV_SERVER_URL: url,
    VITE_PORT: String(port)
  };

  const vite = run('npx', ['vite', '--host', host, '--port', String(port), '--strictPort'], sharedEnv);
  let electron = null;
  let shuttingDown = false;

  const shutdown = (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (electron && !electron.killed) electron.kill();
    if (!vite.killed) vite.kill();
    process.exit(code);
  };

  vite.on('exit', (code) => {
    if (!shuttingDown) shutdown(code || 0);
  });

  await waitForPort(port);
  electron = run('npx', ['electron', '.'], sharedEnv);
  electron.on('exit', (code) => shutdown(code || 0));

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
