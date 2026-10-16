import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = fileURLToPath(new URL('../.local/sample.mp4', import.meta.url));
mkdirSync(new URL('../.local', import.meta.url), { recursive: true });
// All objects are synthetic, and --local is always explicit. Never writes to R2 remotely.
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '12', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', fixture], { stdio: 'inherit' });
for (const key of ['videos/2026-viagem-de-teste/primeiras-memorias.mp4', 'videos/2026-viagem-de-teste/um-novo-dia.mp4', 'videos/2025-encontro-de-teste/em-familia.mp4']) {
  execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'r2', 'object', 'put', `vhs-familia/${key}`, '--file', fixture, '--content-type', 'video/mp4', '--local'], { cwd: root, stdio: 'inherit' });
}
console.log('Três vídeos sintéticos adicionados somente ao R2 local.');
