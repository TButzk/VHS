import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'pages', 'dev', 'public', '--ip', '127.0.0.1', '--port', '8788'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || `${root}/.local/config`,
    WRANGLER_SEND_METRICS: 'false',
    WRANGLER_LOG_PATH: `${root}/.local/wrangler.log`,
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 0; });
