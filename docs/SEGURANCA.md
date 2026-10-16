# Publicação e aceite — VHS com senha compartilhada

A pedido do proprietário, **o login por uma senha da família substitui o plano anterior de Access por e-mail**. Não é necessário cadastrar e-mails. Código e mídia sintética foram validados localmente. Produção continua pendente de acesso à conta Cloudflare. Não publique mídia pessoal antes dos testes abaixo.

## Configuração manual

| Item | Esperado | Situação |
| --- | --- | --- |
| Conta/zona | Controle de `tiarlesbutzk.com.br`, Pages e R2 | Proprietário confirmou conta/domínio; sessão neste ambiente ausente |
| Bucket | `vhs-familia`, Standard, privado, r2.dev desativado, sem domínio público | Pendente na conta |
| Pages | Projeto `vhs-familia`, produção `main`, saída `public` com Functions | Arquivos prontos; remoto pendente |
| Binding | `MEDIA → vhs-familia` | Arquivo pronto; remoto pendente |
| Host | `SITE_HOSTNAME=vhs.tiarlesbutzk.com.br` | Arquivo pronto; remoto pendente |
| Secrets | `SITE_PASSWORD` e `SESSION_SECRET`, valores independentes da instalação local | Pendente na conta |
| HTTPS | Domínio associado no Pages, certificado e redirecionamento HTTP | Pendente |
| Rate limiting | POST `/login`, regra na zona com bloqueio temporário por IP | Pendente |
| Cache | Sem Cache Everything ou outra regra pública sobre o acervo | Pendente |
| Access anterior | Desnecessário para a nova autenticação; retirar eventual dupla proteção só após validar senha | Verificar na conta |
| Limites | Uso de Workers/R2 e alertas revisados | Pendente |

Crie os dois Secrets no Cloudflare Pages pelo painel ou prompt seguro do Wrangler. Nunca envie senha, chave de sessão ou token pelo chat; não coloque segredos no Git ou em `public/`. Sem configuração válida, o servidor retorna `503` e não abre o acervo. O formulário de login e as Functions precisam ser publicados juntos; upload somente estático de `public/` não implementa a proteção.

## Checklist antes de compartilhar o site ou enviar vídeos pessoais

Use somente um MP4 sintético e uma capa sintética:

- [ ] Confirmar que todo caminho é processado por middleware (`_routes.json` inclui `/*`, sem exclusões).
- [ ] Confirmar ausência de publicação R2 por `r2.dev`, domínios próprios públicos, Workers alternativos ou cópias antigas desprotegidas.
- [ ] Em janela privada sem senha, `/` e `/index.html` devem redirecionar a `/login`; nenhum conteúdo de álbum deve aparecer.
- [ ] Sem sessão, `/api/videos`, um MP4 e uma capa conhecidos devem retornar `401`, inclusive HEAD e GET com Range. Não aceitar conteúdo privado ou metadados R2.
- [ ] Repetir as verificações em `vhs-familia.pages.dev`, URLs de hash, aliases de branch e previews antigos. Todos os caminhos nesses hosts devem retornar `404`.
- [ ] Confirmar HTTPS válido e redirecionamento HTTP. Cookies de produção devem usar `__Host-`, Secure, HttpOnly, SameSite=Strict, Path=/ e nenhum Domain.
- [ ] Uma senha incorreta não deve criar cookie nem abrir o acervo. Uma senha correta deve liberar página, catálogo, capas e vídeo.
- [ ] Conferir que senha e chave de sessão não estão em HTML, JS, URLs, respostas, logs de aplicação, analytics ou arquivos versionados. Não registrar corpos de POST `/login` em ferramentas de observabilidade.
- [ ] Confirmar limite do formulário e rejeição de POST de outra origem; logout deve exigir POST do próprio site.
- [ ] Testar a regra Cloudflare de rate limiting com senha incorreta e depois confirmar recuperação após o bloqueio temporário. O código não usa um contador local como proteção distribuída.
- [ ] Conferir Cache-Control privado/no-store nas páginas, no login, nos erros e na mídia; nenhuma regra da zona deve sobrepor isso.
- [ ] Entrar, usar **Sair**, voltar à página e confirmar que API/vídeos voltam a exigir senha. Uma sessão apagada no navegador não é uma revogação de cópias do cookie: para revogação global, troque a senha/chave.
- [ ] Trocar a senha no Secret e fazer novo deploy; confirmar que cookies da senha anterior são recusados e que a nova senha funciona. Compartilhar a mudança somente por meio privado.
- [ ] Enviar vídeo sintético pelo painel, atualizar e confirmar descoberta sem redeploy. Apagar e confirmar remoção após atualizar.
- [ ] Confirmar Content-Type video/mp4, reprodução progressiva, pausa, volume, tela cheia, HTTP 206 e seek distante sem exigir arquivo completo na memória da Function.
- [ ] Com sessão válida, confirmar 404 para arquivo inexistente, 416 para faixa fora do tamanho e 405 para métodos de escrita nos endpoints de dados.
- [ ] Testar Chrome, Firefox, Safari, celulares e Smart TVs utilizados pela família, incluindo teclado/controle remoto e entrada da senha.
- [ ] Revisar armazenamento total de até 10 GB, operações R2, requests/CPU de Functions em todas as páginas/assets e os limites/alertas da conta.
- [ ] Só depois desses testes críticos, enviar vídeos pessoais e compartilhar o domínio e a senha.

Inspeção **sem sessão**, sem seguir redirecionamentos:

```sh
curl -sS -D - -o /dev/null https://vhs.tiarlesbutzk.com.br/
curl -sS -D - -o /dev/null https://vhs.tiarlesbutzk.com.br/api/videos
curl -sS -D - -o /dev/null -H 'Range: bytes=0-99' \
  https://vhs.tiarlesbutzk.com.br/media/videos/album-de-teste/amostra.mp4
```

Espere `303` para `/login` na página e `401` para dados/mídia, nunca catálogo ou bytes do vídeo. O status 503 sem Secrets é um bloqueio seguro, mas não comprova que a aplicação está pronta.

## Evidências locais

Testes de Functions verificam senha exata, configuração ausente, cookie seguro, sessão assinada, expiração, adulteração, host, rotação de senha/chave, proteção de estáticos/API/Range/HEAD, logout/CSRF, limite do formulário, métodos, paginação R2, ordenação, erros, traversal, intervalos e substituição concorrente.

O teste funcional usa Wrangler e R2 emulado, autentica com credenciais locais não impressas e valida bytes/HEAD/Range, descoberta após upload/exclusão, login/logout e reprodução/seek no Chromium em desktop e viewport móvel. Dados de exemplo permanecem locais. Essas evidências não substituem o aceite na conta real ou nos dispositivos da família.
