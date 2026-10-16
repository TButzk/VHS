import { errorResponse, privateHeaders, allowedHost } from './lib/http.js';
import { authConfigured, passwordMatches, createSession, verifySession, readSession, sessionCookie } from './lib/session.js';
import { loginPage } from './lib/login.js';

function headers(extra = {}) {
  return privateHeaders({
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...extra,
  });
}
function redirect(location, cookie) {
  return new Response(null, { status: 303, headers: headers({ Location: location, ...(cookie ? { 'Set-Cookie': cookie } : {}) }) });
}
async function boundedForm(request) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/x-www-form-urlencoded') return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new URLSearchParams(new TextDecoder().decode(body));
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  // Protect static files too; Pages previews and aliases fail closed on every route.
  if (!allowedHost(request, env)) return errorResponse(404, 'Não encontrado.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) return errorResponse(403, 'Use HTTPS para acessar o acervo.');
  if (!authConfigured(env)) return errorResponse(503, 'O acervo ainda não está configurado. Peça ao proprietário para configurar a senha.');

  if (url.pathname === '/login') {
    if (request.method === 'POST') {
      if (request.headers.get('Origin') !== url.origin) return errorResponse(403, 'Origem não permitida.');
      const form = await boundedForm(request);
      if (!form || form.getAll('password').length !== 1) return errorResponse(400, 'Formulário inválido.');
      if (!await passwordMatches(form.get('password'), env)) return redirect('/login?error=1');
      const token = await createSession(env, url.hostname);
      return redirect('/', sessionCookie(request, token));
    }
    if (!['GET', 'HEAD'].includes(request.method)) return errorResponse(405, 'Método não permitido.', { Allow: 'GET, HEAD, POST' });
    if (await verifySession(readSession(request), env, url.hostname)) return redirect('/');
    return new Response(request.method === 'HEAD' ? null : loginPage(url.searchParams.get('error') === '1'), {
      headers: headers({ 'Content-Type': 'text/html; charset=utf-8' }),
    });
  }
  if (url.pathname === '/logout') {
    if (request.method !== 'POST') return errorResponse(405, 'Método não permitido.', { Allow: 'POST' });
    if (request.headers.get('Origin') !== url.origin) return errorResponse(403, 'Origem não permitida.');
    return redirect('/login', sessionCookie(request, '', true));
  }
  const publicAsset = ['/css/login.css', '/favicon.svg'].includes(url.pathname);
  if (!publicAsset && !await verifySession(readSession(request), env, url.hostname)) {
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/') || !['GET', 'HEAD'].includes(request.method)) {
      return errorResponse(401, 'Entre com a senha da família para acessar o acervo.');
    }
    return redirect('/login');
  }
  if (!['GET', 'HEAD'].includes(request.method)) return errorResponse(405, 'Método não permitido.', { Allow: 'GET, HEAD' });
  const response = await context.next();
  const secured = new Response(response.body, response);
  for (const [name, value] of headers()) secured.headers.set(name, value);
  return secured;
}
