import { guard, privateHeaders, errorResponse, validKey } from '../lib/http.js';

export function parseRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) return null;
  if (first === null) {
    if (last === 0) return null;
    const length = Math.min(last, size);
    return { offset: size - length, length };
  }
  if (first >= size || (last !== null && last < first)) return null;
  return { offset: first, length: Math.min(last ?? size - 1, size - 1) - first + 1 };
}

function contentType(key) {
  if (/\.mp4$/i.test(key)) return 'video/mp4';
  if (/\.png$/i.test(key)) return 'image/png';
  if (/\.webp$/i.test(key)) return 'image/webp';
  return 'image/jpeg';
}

export async function onRequest({ request, env }) {
  const rejected = guard(request, env);
  if (rejected) return rejected;
  let key;
  try { key = decodeURIComponent(new URL(request.url).pathname.slice('/media/'.length)); }
  catch { return errorResponse(404, 'Arquivo não encontrado.'); }
  if (!validKey(key)) return errorResponse(404, 'Arquivo não encontrado.');
  try {
    const object = await env.MEDIA.head(key);
    if (!object) return errorResponse(404, 'Arquivo não encontrado.');
    const headers = privateHeaders({
      'Content-Type': contentType(key),
      'Content-Length': String(object.size),
      'Accept-Ranges': 'bytes',
      'ETag': object.httpEtag,
      'Last-Modified': new Date(object.uploaded).toUTCString(),
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    });
    const noneMatch = request.headers.get('If-None-Match');
    if (noneMatch && (noneMatch === '*' || noneMatch.split(',').some(tag => tag.trim().replace(/^W\//, '') === object.httpEtag))) {
      headers.delete('Content-Length');
      return new Response(null, { status: 304, headers });
    }
    let range;
    const rangeHeader = request.headers.get('Range');
    const ifRange = request.headers.get('If-Range');
    const rangeMatches = !ifRange || ifRange === object.httpEtag ||
      (!ifRange.startsWith('"') && !ifRange.startsWith('W/') && Number.isFinite(Date.parse(ifRange)) &&
      Math.floor(new Date(object.uploaded).getTime() / 1000) <= Math.floor(Date.parse(ifRange) / 1000));
    // RFC 9110: Range applies to GET only. HEAD describes the complete resource.
    if (request.method === 'GET' && rangeHeader && rangeMatches) {
      range = parseRange(rangeHeader, object.size);
      if (!range) return errorResponse(416, 'Intervalo não disponível.', {
        'Content-Range': `bytes */${object.size}`, 'Accept-Ranges': 'bytes', 'ETag': object.httpEtag,
      });
      headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
      headers.set('Content-Length', String(range.length));
    }
    if (request.method === 'HEAD') return new Response(null, { headers });
    // The condition prevents metadata/body mismatches during manual replacement.
    const result = await env.MEDIA.get(key, {
      ...(range ? { range } : {}), onlyIf: { etagMatches: object.etag },
    });
    if (!result) return errorResponse(404, 'Arquivo não encontrado.');
    if (!result.body) return errorResponse(503, 'Arquivo atualizado. Tente novamente.');
    return new Response(result.body, { status: range ? 206 : 200, headers });
  } catch {
    return errorResponse(503, 'Não foi possível abrir o arquivo. Tente novamente.');
  }
}
