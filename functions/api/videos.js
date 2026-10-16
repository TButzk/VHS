import { guard, privateHeaders, errorResponse, validKey, mediaUrl } from '../lib/http.js';

function readable(value) {
  return value.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

async function listAll(bucket, prefix) {
  const objects = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
    objects.push(...page.objects);
    if (!page.truncated) break;
    if (!page.cursor || page.cursor === cursor) throw new Error('Invalid R2 cursor');
    cursor = page.cursor;
  } while (true);
  return objects;
}

export async function onRequest({ request, env }) {
  const rejected = guard(request, env);
  if (rejected) return rejected;
  try {
    const [objects, posters] = await Promise.all([listAll(env.MEDIA, 'videos/'), listAll(env.MEDIA, 'posters/')]);
    const posterMap = new Map();
    for (const object of posters.sort((a, b) => a.key.localeCompare(b.key))) {
      if (validKey(object.key)) {
        const stem = object.key.replace(/^posters\//, '').replace(/\.[^.]+$/, '');
        if (!posterMap.has(stem)) posterMap.set(stem, mediaUrl(object.key));
      }
    }
    const byAlbum = new Map();
    for (const object of objects) {
      if (!validKey(object.key) || !object.key.startsWith('videos/') || object.size === 0) continue;
      const [, album, file] = object.key.split('/');
      const stem = file.replace(/\.mp4$/i, '');
      const video = {
        key: object.key,
        title: readable(stem),
        album,
        size: object.size,
        uploaded: new Date(object.uploaded).toISOString(),
        url: mediaUrl(object.key),
        poster: posterMap.get(`${album}/${stem}`) || null,
      };
      if (!byAlbum.has(album)) byAlbum.set(album, { id: album, title: readable(album), videos: [] });
      byAlbum.get(album).videos.push(video);
    }
    const albums = [...byAlbum.values()];
    for (const album of albums) {
      album.videos.sort((a, b) => b.uploaded.localeCompare(a.uploaded) || a.key.localeCompare(b.key));
      album.updated = album.videos[0].uploaded;
      album.count = album.videos.length;
    }
    albums.sort((a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id));
    return new Response(request.method === 'HEAD' ? null : JSON.stringify({ albums }), {
      headers: privateHeaders({ 'Content-Type': 'application/json; charset=utf-8' }),
    });
  } catch {
    return errorResponse(503, 'Não foi possível carregar os vídeos. Tente novamente.');
  }
}
