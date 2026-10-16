import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8788';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Execute este teste somente no ambiente local.');
const sample = readFileSync('.local/sample.mp4');
const passwordLine = readFileSync('.dev.vars', 'utf8').split('\n').find(line => line.startsWith('SITE_PASSWORD='));
if (!passwordLine) throw new Error('Execute npm run setup:local primeiro.');
const passwordValue = passwordLine.slice('SITE_PASSWORD='.length).trim();
const localPassword = passwordValue.startsWith('"') ? JSON.parse(passwordValue) : passwordValue;
assert.equal((await fetch(base, { redirect: 'manual' })).status, 303);
for (const path of ['/api/videos', '/media/videos/trip/private.mp4']) {
  assert.equal((await fetch(base + path)).status, 401);
  assert.equal((await fetch(base + path, { method: 'HEAD', headers: { Range: 'bytes=0-99' } })).status, 401);
}
const login = await fetch(base + '/login', {
  method: 'POST', redirect: 'manual',
  headers: { Origin: new URL(base).origin, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ password: localPassword }),
});
assert.equal(login.status, 303);
assert.equal(login.headers.get('location'), '/');
const cookie = login.headers.get('set-cookie').split(';')[0];
const authenticatedFetch = (url, init = {}) => fetch(url, { ...init, headers: { ...init.headers, Cookie: cookie } });
async function signIn(page) {
  await page.goto(base);
  await page.getByLabel('Senha da família').fill(localPassword);
  await page.getByRole('button', { name: 'Entrar no acervo' }).click();
}
console.log('Autenticação HTTP real: página, API e mídia bloqueadas sem sessão; login por senha aprovado.');

const catalog = async () => {
  const response = await authenticatedFetch(base + '/api/videos');
  assert.equal(response.status, 200);
  return response.json();
};
const initial = await catalog();
assert.ok(initial.albums.length >= 2, 'Execute npm run seed:local primeiro');
const url = initial.albums[0].videos[0].url;
const full = await authenticatedFetch(base + url);
assert.equal(full.status, 200);
assert.deepEqual(Buffer.from(await full.arrayBuffer()), sample);
const partial = await authenticatedFetch(base + url, { headers: { Range: 'bytes=100-199' } });
assert.equal(partial.status, 206);
assert.equal(partial.headers.get('content-range'), `bytes 100-199/${sample.length}`);
assert.deepEqual(Buffer.from(await partial.arrayBuffer()), sample.subarray(100, 200));
const suffix = await authenticatedFetch(base + url, { headers: { Range: 'bytes=-50' } });
assert.equal(suffix.status, 206);
assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), sample.subarray(-50));
const head = await authenticatedFetch(base + url, { method: 'HEAD' });
assert.equal(head.status, 200);
assert.equal(Number(head.headers.get('content-length')), sample.length);
assert.equal((await head.arrayBuffer()).byteLength, 0);
assert.equal((await authenticatedFetch(base + url, { headers: { Range: `bytes=${sample.length}-` } })).status, 416);
assert.equal((await authenticatedFetch(base + '/media/videos/missing/no.mp4')).status, 404);
assert.equal((await authenticatedFetch(base + '/api/videos', { method: 'POST' })).status, 405);
assert.equal((await authenticatedFetch(base + url, { method: 'DELETE' })).status, 405);
console.log('HTTP real: catálogo, streaming, HEAD, Range, 404, 405 e 416 aprovados.');

const key = 'videos/2099-teste-automatico/temporario.mp4';
const wrangler = (...args) => execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args, '--local'], { stdio: 'pipe', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: '.local/wrangler.log' } });
try {
  wrangler('r2', 'object', 'put', `vhs-familia/${key}`, '--file', '.local/sample.mp4', '--content-type', 'video/mp4');
  assert.ok((await catalog()).albums.some(a => a.id === '2099-teste-automatico'));
} finally { wrangler('r2', 'object', 'delete', `vhs-familia/${key}`); }
assert.ok(!(await catalog()).albums.some(a => a.id === '2099-teste-automatico'));
console.log('R2 real local: upload e exclusão refletidos sem redeploy.');

const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
mkdirSync('.local', { recursive: true });
try {
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    const mediaRequests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (r.url().includes('/media/videos/')) mediaRequests.push(r.url()); });
    await signIn(page);
    await page.locator('.card').first().waitFor();
    assert.equal(await page.locator('.card').count(), initial.albums.length);
    assert.equal(mediaRequests.length, 0, 'A página inicial não deve baixar vídeos');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `.local/${name}.png`, fullPage: true });
    await page.locator('.card').first().focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('.card').nth(1).evaluate(n => n === document.activeElement), true);
    await page.locator('.card').first().click();
    await page.locator('.breadcrumb').waitFor();
    assert.equal(mediaRequests.length, 0, 'O álbum não deve baixar vídeos');
    await page.locator('.card').first().click();
    await page.locator('#player-panel').waitFor();
    await page.locator('video').evaluate(async video => { video.muted = true; await video.play(); });
    await page.waitForFunction(() => document.querySelector('video').currentTime > 0.2);
    await page.locator('video').evaluate(video => { video.currentTime = 10; });
    await page.waitForFunction(() => document.querySelector('video').currentTime >= 10 && !document.querySelector('video').seeking);
    assert.equal(await page.locator('#player-error').isHidden(), true);
    await page.locator('.breadcrumb a').first().click();
    await page.locator('.card').first().waitFor();
    assert.equal(await page.locator('video').getAttribute('src'), null);
    assert.deepEqual(errors, []);
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await page.getByLabel('Senha da família').waitFor();
    assert.equal(await page.evaluate(async () => (await fetch('/api/videos')).status), 401);
    await page.screenshot({ path: `.local/login-${name}.png`, fullPage: true });
    await page.close();
    console.log(`Navegador ${name}: navegação, teclado, reprodução H.264/AAC, seek e layout aprovados.`);
  }
  const page = await browser.newPage();
  await signIn(page);
  await page.route('**/api/videos', route => route.fulfill({ contentType: 'application/json', body: '{"albums":[]}' }));
  await page.goto(base);
  await page.getByText('Nossa coleção começa aqui.', { exact: false }).waitFor();
  assert.equal(await page.locator('.card').count(), 0);
  await page.unroute('**/api/videos');
  await page.route('**/api/videos', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.getByRole('button', { name: 'Atualizar catálogo' }).click();
  await page.locator('.status.error').waitFor();
  await page.unroute('**/api/videos');
  await page.getByRole('button', { name: 'Atualizar catálogo' }).click();
  await page.locator('.card').first().waitFor();
  await page.goto(base + '/#album/nao-existe');
  await page.getByText('Este álbum ou vídeo não está mais disponível.', { exact: false }).waitFor();
  await page.route('**/api/videos', route => route.fulfill({ contentType: 'text/html', body: '<h1>Entrar novamente</h1>' }));
  await page.getByRole('button', { name: 'Atualizar catálogo' }).click();
  await page.getByText('Sua sessão pode ter expirado.', { exact: false }).waitFor();
  await page.unroute('**/api/videos');
  await page.context().clearCookies();
  await page.route('**/api/videos', route => route.fulfill({ status: 401, body: 'Entre novamente' }));
  await page.getByRole('button', { name: 'Atualizar catálogo' }).click();
  await page.getByLabel('Senha da família').waitFor();
  console.log('Navegador: login, logout, catálogo vazio, erro, recuperação, link ausente e sessão expirada aprovados.');
  await page.close();
} finally { await browser.close(); }
