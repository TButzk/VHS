const $ = id => document.getElementById(id);
const grid = $('grid');
const player = $('player');
let albums = [];
let loaded = false;
let failed = false;
class CatalogError extends Error {}
const date = value => new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
const quantity = (n, singular, plural) => `${n} ${n === 1 ? singular : plural}`;
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function status(message, error = false) {
  $('status').textContent = message;
  $('status').hidden = !message;
  $('status').classList.toggle('error', error);
}
function stopVideo() {
  player.pause();
  player.removeAttribute('src');
  player.removeAttribute('poster');
  player.load();
  $('player-panel').hidden = true;
  $('player-error').hidden = true;
}
function route(album, video) {
  return `#album/${encodeURIComponent(album.id)}${video ? '/video/' + encodeURIComponent(video.key) : ''}`;
}
function card(item, album, isAlbum) {
  const link = element('a', 'card');
  link.href = route(album, isAlbum ? null : item);
  const cover = element('div', 'cover');
  cover.append(element('span', 'placeholder', /^(\d{4})/.exec(album.id)?.[1] || 'VHS'));
  const poster = isAlbum ? album.videos.find(v => v.poster)?.poster : item.poster;
  if (poster) {
    const img = element('img');
    img.alt = '';
    img.loading = 'lazy';
    img.src = poster;
    img.addEventListener('error', () => img.remove());
    cover.append(img);
  }
  cover.append(element('span', 'cover-badge', isAlbum ? quantity(album.count, 'vídeo', 'vídeos') : 'VÍDEO DE FAMÍLIA'));
  const play = element('span', 'play-icon', '▶');
  play.setAttribute('aria-hidden', 'true');
  cover.append(play);
  link.append(cover, element('h3', 'card-title', item.title));
  const meta = element('div', 'card-meta');
  meta.append(element('span', '', isAlbum ? `Atualizado em ${date(album.updated)}` : date(item.uploaded)), element('span', '', isAlbum ? 'Abrir álbum ↗' : 'Assistir ↗'));
  link.append(meta);
  return link;
}
function crumb(text, href) {
  const node = element(href ? 'a' : 'span', '', text);
  if (href) node.href = href;
  $('breadcrumb').append(node);
}
function render() {
  stopVideo();
  grid.replaceChildren();
  $('breadcrumb').replaceChildren();
  $('breadcrumb').hidden = true;
  $('intro').hidden = false;
  $('section-title').textContent = 'Nossos álbuns';
  $('section-label').textContent = 'BONS MOMENTOS, JUNTOS';
  $('count').textContent = '';
  if (!loaded) return;
  if (failed) return;
  status('');
  const match = /^#album\/([^/]+)(?:\/video\/([^/]+))?$/.exec(location.hash);
  let album, video;
  try {
    album = match && albums.find(a => a.id === decodeURIComponent(match[1]));
    video = album && match[2] && album.videos.find(v => v.key === decodeURIComponent(match[2]));
  } catch { /* malformed deep link uses the not-found state */ }
  if (location.hash && location.hash !== '#' && (!album || (match?.[2] && !video))) {
    $('intro').hidden = true;
    $('breadcrumb').hidden = false;
    crumb('← Todos os álbuns', '#');
    status('Este álbum ou vídeo não está mais disponível. Atualize o catálogo ou volte aos álbuns.');
    return;
  }
  if (!album) {
    $('count').textContent = quantity(albums.length, 'álbum', 'álbuns');
    if (!albums.length) status('Nossa coleção começa aqui. Os vídeos aparecerão assim que forem adicionados pela família.');
    albums.forEach(a => grid.append(card(a, a, true)));
    document.title = 'VHS · Memórias em vídeo';
    return;
  }
  $('intro').hidden = true;
  $('breadcrumb').hidden = false;
  crumb('← Todos os álbuns', '#');
  if (video) { crumb('/', null); crumb(album.title, route(album)); }
  $('section-title').textContent = video ? video.title : album.title;
  $('section-label').textContent = video ? 'AGORA, É SÓ APERTAR O PLAY' : 'UM PEDACINHO DA NOSSA HISTÓRIA';
  document.title = `${video ? video.title : album.title} · VHS`;
  if (video) {
    player.src = video.url;
    if (video.poster) player.poster = video.poster;
    $('player-panel').hidden = false;
    $('player-title').textContent = video.title;
    $('player-date').textContent = date(video.uploaded);
  } else {
    $('count').textContent = quantity(album.count, 'vídeo', 'vídeos');
    album.videos.forEach(v => grid.append(card(v, album, false)));
  }
}
async function load() {
  $('refresh').disabled = true;
  failed = false;
  loaded = false;
  render();
  status('Abrindo o acervo…');
  try {
    const response = await fetch('/api/videos', { cache: 'no-store', credentials: 'same-origin' });
    if (response.status === 401) { window.location.assign('/login'); return; }
    if (response.redirected || !response.headers.get('content-type')?.includes('application/json')) {
      throw new CatalogError('Sua sessão pode ter expirado. Recarregue a página para digitar a senha novamente.');
    }
    if (!response.ok) throw new CatalogError('Não foi possível carregar o acervo. Tente atualizar em instantes.');
    const data = await response.json();
    if (!Array.isArray(data.albums)) throw new CatalogError('O catálogo está indisponível. Tente novamente.');
    albums = data.albums;
    loaded = true;
    render();
  } catch (error) {
    failed = true;
    status(error instanceof CatalogError ? error.message : 'Não foi possível abrir o acervo. Verifique sua conexão ou recarregue a página para digitar a senha novamente.', true);
  } finally { $('refresh').disabled = false; }
}
player.addEventListener('error', () => {
  if (!player.hasAttribute('src')) return;
  $('player-error').textContent = 'Não foi possível reproduzir este vídeo. Confira sua conexão ou entre novamente no site. Se o problema continuar, peça ao proprietário uma versão MP4 com vídeo H.264 e áudio AAC.';
  $('player-error').hidden = false;
});
$('refresh').addEventListener('click', load);
window.addEventListener('hashchange', () => {
  render();
  $('main').focus({ preventScroll: true });
  window.scrollTo(0, 0);
});
// Native links work with Tab/Enter. Directional focus also supports TV remotes.
grid.addEventListener('keydown', event => {
  const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const direction = directions[event.key];
  const current = event.target.closest('.card');
  if (!direction || !current) return;
  const rect = current.getBoundingClientRect();
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  let best, distance = Infinity;
  for (const node of grid.querySelectorAll('.card')) {
    if (node === current) continue;
    const r = node.getBoundingClientRect();
    const dx = r.x + r.width / 2 - x, dy = r.y + r.height / 2 - y;
    const forward = dx * direction[0] + dy * direction[1];
    const sideways = Math.abs(dx * direction[1] + dy * direction[0]);
    if (forward > 1 && sideways < (direction[0] ? rect.height : rect.width) / 2 && forward + sideways < distance) {
      best = node; distance = forward + sideways;
    }
  }
  if (best) { event.preventDefault(); best.focus(); }
});
load();
