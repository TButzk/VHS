import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as catalog } from '../functions/api/videos.js';
import { onRequest as media, parseRange } from '../functions/media/[[path]].js';
import { validKey } from '../functions/lib/http.js';

const origin = 'https://vhs.tiarlesbutzk.com.br';
const uploaded = new Date('2026-01-02T12:00:00Z');
function object(key, size = 10, date = uploaded) {
  return { key, size, uploaded: date, etag: 'v1', httpEtag: '"v1"' };
}
function context(path, bucket, init = {}) {
  return { request: new Request(origin + path, init), env: { MEDIA: bucket } };
}
function bucketForMedia() {
  const calls = [];
  const bytes = new TextEncoder().encode('0123456789');
  return {
    calls,
    head: async key => key === 'videos/trip/test.mp4' ? object(key) : null,
    get: async (key, options) => {
      calls.push({ key, options });
      const { offset = 0, length = 10 } = options.range || {};
      return { body: new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(offset, offset + length)); controller.close(); } }) };
    },
  };
}

test('catalog traverses both R2 cursors, filters keys, matches posters and sorts dates', async () => {
  const calls = [];
  const bucket = { list: async options => {
    calls.push(options);
    if (options.prefix === 'posters/') return options.cursor
      ? { objects: [object('posters/2026-praia/sol.jpg')], truncated: false }
      : { objects: [object('posters/2026-praia/invalid.svg')], truncated: true, cursor: 'p2' };
    return options.cursor
      ? { objects: [object('videos/2026-praia/sol.MP4', 15, new Date('2026-03-01')), object('videos/2026-praia/ontem.mp4')], truncated: false }
      : { objects: [object('videos/2025-viagem/passeio-centro.mp4'), object('videos/2026-praia/'), object('videos/2026-praia/readme.txt'), object('videos/2026-praia/vazio.mp4', 0), object('videos/2026-praia/nested/no.mp4')], truncated: true, cursor: 'v2' };
  } };
  const response = await catalog(context('/api/videos', bucket));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const { albums } = await response.json();
  assert.equal(albums.length, 2);
  assert.equal(albums[0].title, '2026 praia');
  assert.equal(albums[0].count, 2);
  assert.equal(albums[0].videos[0].poster, '/media/posters/2026-praia/sol.jpg');
  assert.equal(albums[1].videos[0].title, 'passeio centro');
  assert.equal(albums[0].videos[0].size, 15);
  assert.equal(calls.filter(c => c.cursor).length, 2);
});

test('catalog discovery reflects additions and deletions without persisted cache', async () => {
  let objects = [];
  const bucket = { list: async ({ prefix }) => ({ objects: objects.filter(o => o.key.startsWith(prefix)), truncated: false }) };
  const read = async () => (await (await catalog(context('/api/videos', bucket))).json()).albums;
  assert.deepEqual(await read(), []);
  objects.push(object('videos/trip/new.mp4'));
  assert.equal((await read())[0].count, 1);
  objects = [];
  assert.deepEqual(await read(), []);
});

test('catalog errors and invalid cursors fail without leaking internal messages', async () => {
  for (const bucket of [
    { list: async () => { throw new Error('private bucket details'); } },
    { list: async () => ({ objects: [], truncated: true }) },
    { list: async () => ({ objects: [], truncated: true, cursor: 'same' }) },
  ]) {
    const response = await catalog(context('/api/videos', bucket));
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /private bucket/);
  }
});

test('catalog HEAD exposes headers with no body', async () => {
  const response = await catalog(context('/api/videos', { list: async () => ({ objects: [], truncated: false }) }, { method: 'HEAD' }));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
});

for (const [range, expected] of [
  ['bytes=0-0', { offset: 0, length: 1 }],
  ['bytes=2-5', { offset: 2, length: 4 }],
  ['bytes=7-', { offset: 7, length: 3 }],
  ['bytes=-3', { offset: 7, length: 3 }],
  ['bytes=-100', { offset: 0, length: 10 }],
  ['bytes=8-999', { offset: 8, length: 2 }],
]) test(`range ${range}`, () => assert.deepEqual(parseRange(range, 10), expected));

for (const range of ['bytes=10-', 'bytes=3-2', 'bytes=-0', 'bytes=-', 'bytes=abc', 'bytes=0-1,3-4', 'items=0-2', 'bytes=999999999999999999999-', 'bytes=0-9007199254740992']) {
  test(`unsatisfiable range ${range}`, async () => {
    const bucket = bucketForMedia();
    const response = await media(context('/media/videos/trip/test.mp4', bucket, { headers: { Range: range } }));
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('content-range'), 'bytes */10');
    assert.equal(bucket.calls.length, 0);
  });
}

test('zero-byte resource has no satisfiable range', () => assert.equal(parseRange('bytes=0-', 0), null));

test('full streaming response has correct metadata and conditional object read', async () => {
  const bucket = bucketForMedia();
  const response = await media(context('/media/videos/trip/test.mp4', bucket));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '0123456789');
  assert.equal(response.headers.get('content-type'), 'video/mp4');
  assert.equal(response.headers.get('content-length'), '10');
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal(response.headers.get('etag'), '"v1"');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(bucket.calls[0].options.onlyIf, { etagMatches: 'v1' });
});

test('partial response delivers exact selected bytes', async () => {
  const response = await media(context('/media/videos/trip/test.mp4', bucketForMedia(), { headers: { Range: 'bytes=2-5' } }));
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(response.headers.get('content-length'), '4');
  assert.equal(await response.text(), '2345');
});

test('HEAD ignores Range and never reads object body', async () => {
  const bucket = bucketForMedia();
  const response = await media(context('/media/videos/trip/test.mp4', bucket, { method: 'HEAD', headers: { Range: 'bytes=2-5' } }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-length'), '10');
  assert.equal(await response.text(), '');
  assert.equal(bucket.calls.length, 0);
});

for (const header of ['"v1"', 'W/"v1"', '"other", "v1"', '*']) {
  test(`conditional request ${header}`, async () => {
    const bucket = bucketForMedia();
    const response = await media(context('/media/videos/trip/test.mp4', bucket, { headers: { 'If-None-Match': header } }));
    assert.equal(response.status, 304);
    assert.equal(await response.text(), '');
    assert.equal(bucket.calls.length, 0);
    assert.equal(response.headers.has('content-length'), false);
  });
}

test('If-Range selects partial body only for current validator', async () => {
  for (const [validator, status] of [['"v1"', 206], ['"old"', 200], ['W/"v1"', 200], [uploaded.toUTCString(), 206], ['Wed, 01 Jan 2020 00:00:00 GMT', 200]]) {
    const response = await media(context('/media/videos/trip/test.mp4', bucketForMedia(), { headers: { Range: 'bytes=2-5', 'If-Range': validator } }));
    assert.equal(response.status, status);
  }
});

test('missing, removed, replaced and unavailable objects have useful failures', async () => {
  assert.equal((await media(context('/media/videos/trip/missing.mp4', bucketForMedia()))).status, 404);
  for (const [get, status] of [
    [async () => null, 404],
    [async () => ({ etag: 'v2' }), 503],
    [async () => { throw new Error('service down'); }, 503],
  ]) {
    const bucket = bucketForMedia(); bucket.get = get;
    assert.equal((await media(context('/media/videos/trip/test.mp4', bucket))).status, status);
  }
});

test('allowed media prefixes exclude traversal, other formats and nested files', async () => {
  for (const key of ['secret.mp4', 'private/a/b.mp4', 'videos/../test.mp4', 'videos/a/../b.mp4', 'videos/a/b/c.mp4', 'videos/a/file.svg', 'posters/a/file.svg', 'videos/a/file\\x.mp4', 'videos/a/file\0.mp4', 'videos//file.mp4']) {
    assert.equal(validKey(key), false, key);
  }
  for (const key of ['videos/viagem/praia verão.mp4', 'posters/viagem/praia.webp']) assert.equal(validKey(key), true);
  for (const path of ['/media/%ZZ', '/media/videos/a%2F..%2Fsecret.mp4', '/media/videos/a/file%00.mp4']) {
    assert.equal((await media(context(path, bucketForMedia()))).status, 404);
  }
});

test('encoded filenames and poster MIME types', async () => {
  const key = 'posters/família/capa #1.png';
  const bucket = { head: async requested => { assert.equal(requested, key); return object(key); }, get: async () => ({ body: new Blob(['image']).stream() }) };
  const response = await media(context('/media/posters/fam%C3%ADlia/capa%20%231.png', bucket));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
});

test('both endpoints reject write methods before touching R2', async () => {
  for (const handler of [catalog, media]) {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      const response = await handler(context('/media/videos/trip/test.mp4', {}, { method }));
      assert.equal(response.status, 405);
      assert.equal(response.headers.get('allow'), 'GET, HEAD');
    }
  }
});

test('alternate hostnames fail closed, and missing binding returns 503', async () => {
  for (const handler of [catalog, media]) {
    for (const host of ['vhs-familia.pages.dev', 'preview.vhs-familia.pages.dev', 'untrusted.example']) {
      const response = await handler({ request: new Request(`https://${host}/api/videos`), env: { MEDIA: {} } });
      assert.equal(response.status, 404);
    }
    assert.equal((await handler({ request: new Request(origin + '/api/videos'), env: {} })).status, 503);
  }
});
