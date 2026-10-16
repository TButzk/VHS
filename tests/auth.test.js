import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequest } from '../functions/_middleware.js';
import { authConfigured, createSession, verifySession, passwordMatches, sessionCookie, readSession, SESSION_SECONDS } from '../functions/lib/session.js';

// Test-only credentials, never deployed or used as defaults.
const env = { SITE_PASSWORD: 'senha-apenas-de-teste', SESSION_SECRET: 'chave-apenas-de-teste-0123456789abcdef' };
const origin = 'https://vhs.tiarlesbutzk.com.br';
const cookieFor = token => `__Host-vhs_session=${token}`;
async function run(path, init = {}, bindings = env) {
  let called = false;
  const response = await onRequest({ request: new Request(origin + path, init), env: bindings,
    next: async () => { called = true; return new Response('private content', { headers: { 'Cache-Control': 'public, max-age=3600' } }); } });
  return { response, called };
}
function login(password, extra = {}) {
  return { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded', ...extra }, body: new URLSearchParams({ password }).toString() };
}

test('configuration fails closed without both sufficiently long secrets', () => {
  assert.equal(authConfigured(env), true);
  for (const bindings of [{}, { SITE_PASSWORD: 'short', SESSION_SECRET: env.SESSION_SECRET }, { SITE_PASSWORD: env.SITE_PASSWORD, SESSION_SECRET: 'short' }]) assert.equal(authConfigured(bindings), false);
});

test('password verification accepts exact input only', async () => {
  assert.equal(await passwordMatches(env.SITE_PASSWORD, env), true);
  for (const value of ['', 'incorrect', env.SITE_PASSWORD.toUpperCase(), env.SITE_PASSWORD + ' ', 'x'.repeat(257)]) assert.equal(await passwordMatches(value, env), false);
});

test('signed sessions expire, bind to host and reject tampering', async () => {
  const now = 1800000000000;
  const token = await createSession(env, 'vhs.tiarlesbutzk.com.br', now);
  assert.equal(await verifySession(token, env, 'vhs.tiarlesbutzk.com.br', now), true);
  assert.equal(await verifySession(token, env, 'vhs.tiarlesbutzk.com.br', now + SESSION_SECONDS * 1000), false);
  assert.equal(await verifySession(token, env, 'other.example', now), false);
  assert.equal(await verifySession(token, { ...env, SITE_PASSWORD: 'outra-senha-de-teste' }, 'vhs.tiarlesbutzk.com.br', now), false);
  assert.equal(await verifySession(token, { ...env, SESSION_SECRET: env.SESSION_SECRET + 'x' }, 'vhs.tiarlesbutzk.com.br', now), false);
  for (const value of [token.slice(0, 10) + 'z' + token.slice(11), token + '.extra', 'invalid', '..', 'x'.repeat(2049)]) assert.equal(await verifySession(value, env, 'vhs.tiarlesbutzk.com.br', now), false);
});

test('HTTPS session cookies use Host prefix, Secure, HttpOnly, SameSite and root path', () => {
  const request = new Request(origin);
  const cookie = sessionCookie(request, 'token');
  for (const value of ['__Host-vhs_session=token', 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=86400', 'Secure']) assert.ok(cookie.includes(value));
  assert.ok(!cookie.includes('Domain='));
  assert.ok(sessionCookie(request, '', true).includes('Max-Age=0'));
  assert.equal(readSession(new Request(origin, { headers: { Cookie: 'other=x; __Host-vhs_session=token' } })), 'token');
  assert.equal(readSession(new Request(origin, { headers: { Cookie: '__Host-vhs_session=one; __Host-vhs_session=two' } })), null);
});

test('local HTTP uses separate cookie, production HTTP is rejected', async () => {
  const request = new Request('http://localhost:8788/');
  assert.ok(sessionCookie(request, 'token').startsWith('vhs_session_local=token;'));
  assert.ok(!sessionCookie(request, 'token').includes('; Secure'));
  assert.equal((await onRequest({ request: new Request(origin.replace('https:', 'http:')), env })).status, 403);
});

for (const path of ['/', '/index.html', '/js/app.js', '/css/styles.css', '/_routes.json']) {
  test(`unauthenticated static route is protected: ${path}`, async () => {
    const { response, called } = await run(path);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/login');
    assert.equal(called, false);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  });
}

for (const path of ['/api/videos', '/media/videos/trip/private.mp4', '/media/posters/trip/private.jpg']) {
  test(`unauthenticated API/media and Range/HEAD are protected: ${path}`, async () => {
    for (const init of [{}, { method: 'HEAD' }, { headers: { Range: 'bytes=0-99' } }, { method: 'DELETE' }]) {
      const { response, called } = await run(path, init);
      assert.equal(response.status, 401);
      assert.equal(called, false);
    }
  });
}

test('login page is public, private data and secrets never appear in HTML', async () => {
  const { response, called } = await run('/login');
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.equal(called, false);
  assert.match(html, /type="password"/);
  assert.ok(!html.includes(env.SITE_PASSWORD));
  assert.ok(!html.includes(env.SESSION_SECRET));
  assert.match(response.headers.get('content-security-policy'), /form-action 'self'/);
  assert.equal(await (await run('/login', { method: 'HEAD' })).response.text(), '');
  for (const path of ['/favicon.svg', '/css/login.css']) assert.equal((await run(path)).called, true);
});

test('correct login sets session; wrong password sets no cookie and no reflected input', async () => {
  const { response } = await run('/login', login(env.SITE_PASSWORD));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/');
  const token = response.headers.get('set-cookie').split(';')[0].split('=')[1];
  assert.equal(await verifySession(token, env, new URL(origin).hostname), true);
  const rejected = (await run('/login', login('<script>bad</script>'))).response;
  assert.equal(rejected.status, 303);
  assert.equal(rejected.headers.has('set-cookie'), false);
  assert.equal(rejected.headers.get('location'), '/login?error=1');
  assert.match(await (await run('/login?error=1')).response.text(), /Senha incorreta/);
});

test('login rejects CSRF, invalid types, repeated password and oversized bodies', async () => {
  assert.equal((await run('/login', login(env.SITE_PASSWORD, { Origin: 'https://attacker.example' }))).response.status, 403);
  const noOrigin = login(env.SITE_PASSWORD); delete noOrigin.headers.Origin;
  assert.equal((await run('/login', noOrigin)).response.status, 403);
  assert.equal((await run('/login', login(env.SITE_PASSWORD, { 'Content-Type': 'application/json' }))).response.status, 400);
  const duplicate = login(env.SITE_PASSWORD); duplicate.body += '&password=extra';
  assert.equal((await run('/login', duplicate)).response.status, 400);
  const oversized = login('x'.repeat(5000));
  assert.equal((await run('/login', oversized)).response.status, 400);
  assert.equal((await run('/login', { method: 'DELETE' })).response.status, 405);
});

test('authenticated next responses retain required private headers', async () => {
  const token = await createSession(env, new URL(origin).hostname);
  const { response, called } = await run('/api/videos', { headers: { Cookie: cookieFor(token) } });
  assert.equal(called, true);
  assert.equal(await response.text(), 'private content');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal((await run('/login', { headers: { Cookie: cookieFor(token) } })).response.headers.get('location'), '/');
});

test('logout requires same-origin POST and clears session cookie', async () => {
  assert.equal((await run('/logout')).response.status, 405);
  assert.equal((await run('/logout', { method: 'POST', headers: { Origin: 'https://attacker.example' } })).response.status, 403);
  const { response } = await run('/logout', { method: 'POST', headers: { Origin: origin } });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/login');
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
});

test('missing secrets and every alternate Pages host fail closed even on static pages', async () => {
  assert.equal((await run('/', {}, {})).response.status, 503);
  for (const host of ['vhs-familia.pages.dev', 'preview.vhs-familia.pages.dev', 'other.example']) {
    for (const path of ['/', '/index.html', '/login', '/api/videos', '/media/videos/trip/video.mp4']) {
      const response = await onRequest({ request: new Request(`https://${host}${path}`), env });
      assert.equal(response.status, 404);
    }
  }
});

// The middleware tests are insufficient if deployment routing bypasses it.
test('deployment routes send every asset and endpoint through authentication', () => {
  const routes = JSON.parse(readFileSync(new URL('../public/_routes.json', import.meta.url), 'utf8'));
  assert.ok(routes.include.includes('/*'));
  assert.deepEqual(routes.exclude, []);
});
