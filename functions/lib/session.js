const encoder = new TextEncoder();
export const SESSION_SECONDS = 24 * 60 * 60;

export function authConfigured(env) {
  return typeof env.SITE_PASSWORD === 'string' && env.SITE_PASSWORD.length >= 8 &&
    env.SITE_PASSWORD.length <= 256 && typeof env.SESSION_SECRET === 'string' && env.SESSION_SECRET.length >= 32;
}

function encode(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function decode(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('Invalid encoding');
  const padded = text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - text.length % 4) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}
async function keyFor(env) {
  return crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function passwordVersion(env, key) {
  return encode(await crypto.subtle.sign('HMAC', key, encoder.encode(`password-version:${env.SITE_PASSWORD}`)));
}

export async function passwordMatches(candidate, env) {
  if (!authConfigured(env) || typeof candidate !== 'string' || candidate.length > 256) return false;
  const key = await keyFor(env);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`password:${env.SITE_PASSWORD}`));
  // WebCrypto verifies the fixed-size MAC instead of comparing password strings.
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(`password:${candidate}`));
}

export async function createSession(env, hostname, now = Date.now()) {
  const key = await keyFor(env);
  const payload = encode(encoder.encode(JSON.stringify({
    exp: Math.floor(now / 1000) + SESSION_SECONDS,
    host: hostname,
    version: await passwordVersion(env, key),
  })));
  const signature = encode(await crypto.subtle.sign('HMAC', key, encoder.encode(`session:${payload}`)));
  return `${payload}.${signature}`;
}

export async function verifySession(token, env, hostname, now = Date.now()) {
  if (!authConfigured(env) || !token || token.length > 2048) return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [payload, signature] = parts;
    const key = await keyFor(env);
    if (!await crypto.subtle.verify('HMAC', key, decode(signature), encoder.encode(`session:${payload}`))) return false;
    const data = JSON.parse(new TextDecoder().decode(decode(payload)));
    const seconds = Math.floor(now / 1000);
    return Number.isSafeInteger(data.exp) && data.exp > seconds && data.exp <= seconds + SESSION_SECONDS &&
      data.host === hostname && data.version === await passwordVersion(env, key);
  } catch { return false; }
}

function cookieName(request) {
  return new URL(request.url).protocol === 'https:' ? '__Host-vhs_session' : 'vhs_session_local';
}
export function readSession(request) {
  const prefix = `${cookieName(request)}=`;
  const values = (request.headers.get('Cookie') || '').split(';').map(part => part.trim()).filter(part => part.startsWith(prefix));
  return values.length === 1 ? values[0].slice(prefix.length) : null;
}
export function sessionCookie(request, token, clear = false) {
  const secure = new URL(request.url).protocol === 'https:';
  return `${cookieName(request)}=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : SESSION_SECONDS}${secure ? '; Secure' : ''}`;
}
