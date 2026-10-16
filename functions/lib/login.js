export function loginPage(failed = false) {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#111412"><title>Entrar · VHS</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/css/login.css"></head>
<body><main><a class="brand" href="/">VHS<span>●</span></a><p class="eyebrow">MEMÓRIAS EM VÍDEO</p><h1>Um lugar só<br>para <em>a gente.</em></h1><p class="intro">Entre com a senha da família para rever nossos momentos.</p>
${failed ? '<p class="error" role="alert">Senha incorreta. Tente novamente.</p>' : ''}
<form method="post" action="/login"><label for="password">Senha da família</label><input type="password" id="password" name="password" autocomplete="current-password" required maxlength="256" autofocus><button type="submit">Entrar no acervo <span aria-hidden="true">→</span></button></form><p class="note">Esqueceu a senha? Peça a quem compartilhou o site com você.</p></main><footer>SÓ ENTRE NÓS ◈</footer></body></html>`;
}
