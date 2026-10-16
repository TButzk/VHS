export function privateHeaders(extra = {}) {
  return new Headers({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    ...extra,
  });
}

export function errorResponse(status, message, extra = {}) {
  return new Response(message, { status, headers: privateHeaders({ 'Content-Type': 'text/plain; charset=utf-8', ...extra }) });
}

// Restrict every deployment to the canonical host or local development.
export function allowedHost(request, env) {
  const url = new URL(request.url);
  return url.hostname === (env.SITE_HOSTNAME || 'vhs.tiarlesbutzk.com.br') ||
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

export function guard(request, env) {
  if (!allowedHost(request, env)) return errorResponse(404, 'Não encontrado.');
  if (!['GET', 'HEAD'].includes(request.method)) {
    return errorResponse(405, 'Método não permitido.', { Allow: 'GET, HEAD' });
  }
  if (!env.MEDIA) return errorResponse(503, 'Armazenamento indisponível.');
}

export function validKey(key) {
  if (!key || key.length > 1024 || /[\\\x00-\x1f\x7f]/.test(key)) return false;
  const parts = key.split('/');
  if (parts.length !== 3 || parts.some(p => !p || p === '.' || p === '..')) return false;
  return (parts[0] === 'videos' && /\.mp4$/i.test(parts[2])) ||
    (parts[0] === 'posters' && /\.(jpg|jpeg|png|webp)$/i.test(parts[2]));
}

export function mediaUrl(key) {
  return '/media/' + key.split('/').map(encodeURIComponent).join('/');
}
