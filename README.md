# VHS · Memórias em vídeo

Videoteca familiar em `https://vhs.tiarlesbutzk.com.br`, com **uma senha compartilhada pela família**. HTML, CSS e JavaScript nativos; Cloudflare Pages Functions e bucket R2 privado. Sem framework, AWS, banco de dados ou dependência de frontend. O login por senha substitui o plano anterior de Cloudflare Access por e-mail.

**Implementado e validado localmente. Publicação, DNS e configuração dos segredos na conta Cloudflare ainda estão pendentes. Não envie vídeos pessoais antes de concluir [o checklist](docs/SEGURANCA.md).**

## Desenvolvimento

Requisitos: Node.js 22+ (versão usada em `.node-version`), npm. FFmpeg para gerar a mídia sintética; Chromium para o teste funcional.

```sh
cd /workspace/VHS # ou o diretório do clone
npm ci
npm run setup:local
npm test
npm run check
npm run seed:local
npm run dev
```

`setup:local` gera senha e chave de sessão aleatórias em `.dev.vars`, arquivo ignorado pelo Git. Não imprime valores e preserva um arquivo existente. Consulte sua cópia local desse arquivo para entrar no navegador. Credenciais locais nunca são padrões de produção. Reinicie `npm run dev` depois de criar ou alterar `.dev.vars`.

O servidor escuta em `127.0.0.1:8788`, usa R2 emulado persistido em `.wrangler/state` e não faz login na Cloudflare. A semente cria três MP4 sintéticos em dois álbuns, somente localmente. Com o servidor ativo, use outro terminal:

```sh
# Se Chromium não estiver instalado:
npx playwright install chromium
npm run test:browser
# Opcional: CHROMIUM_PATH=/caminho/do/chromium npm run test:browser
```

O teste lê a senha local sem imprimi-la. Valida bloqueio sem sessão, login/logout, catálogo, bytes de MP4, HTTP Range, upload/exclusão no R2 emulado e reprodução/seek no Chromium em desktop e celular. Também exercita estados vazio, erro, link ausente e sessão expirada. Capturas ficam em `.local/`. Não execute testes concorrentes que alterem os mesmos objetos locais.

Se a pasta pessoal for somente leitura, instale com `npm ci --cache /tmp/vhs-npm-cache`. Para manter logs locais nos comandos Wrangler, use `WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH=.local/wrangler.log`. `npm run dev` já faz isso. Não altere `XDG_CONFIG_HOME` no deploy se sua sessão autenticada estiver no diretório padrão.

## Senha e sessão

Toda rota passa por `functions/_middleware.js`, incluindo HTML, JavaScript, catálogo, capas e vídeos. Sem sessão, as páginas redirecionam para `/login`; `/api/*` e `/media/*` retornam `401`. Apenas a tela de login, seu CSS e o favicon podem ser acessados sem login. A proteção está no servidor, não no JavaScript do navegador.

- `SITE_PASSWORD`: senha compartilhada, entre 12 e 256 caracteres. Use uma senha longa e aleatória, preferencialmente gerada por gerenciador de senhas; compartilhe somente com a família.
- `SESSION_SECRET`: chave independente e aleatória com ao menos 32 caracteres. Não compartilhe com familiares; ela assina sessões.
- Esses valores são **Secrets do Cloudflare Pages**, não variáveis de build, arquivos em `public/` nem configurações de frontend. Sem ambos, o servidor bloqueia todo o acervo com `503`.
- O servidor verifica a senha usando HMAC/WebCrypto. A senha nunca é incluída no HTML, na URL, nos cookies ou nos logs da aplicação.
- A sessão dura 24 horas e usa cookie assinado HMAC-SHA-256, `__Host-`, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/` e sem Domain. Somente no localhost HTTP é usado um cookie separado sem Secure.
- A sessão é vinculada ao host e à senha atual. Trocar a senha ou a chave de sessão invalida todas as sessões anteriores após a nova configuração entrar em vigor.
- Login e logout exigem POST com Origin do próprio site, limitam o tamanho do formulário e não aceitam redirecionamentos informados pelo visitante.
- **Sair** apaga a sessão no navegador. Como as sessões são assinadas e não há banco de dados, um cookie copiado continua válido até expirar ou haver rotação da senha/chave. Para revogar todos, troque a senha ou a chave. Não há revogação individual ou identificação de familiares.
- HTTPS é obrigatório fora do localhost. Não remova `Secure` para resolver erros de publicação.

Configure uma regra de **rate limiting da Cloudflare** para POST `/login` no domínio principal, com bloqueio após tentativas repetidas por IP. Use os limites disponíveis no plano da conta, por exemplo 5 tentativas em 10 segundos com bloqueio temporário; teste a regra antes dos vídeos pessoais. O código não apresenta um contador em memória como se fosse proteção distribuída: as Functions não compartilham memória entre instâncias. Uma senha forte continua indispensável.

`SITE_HOSTNAME` restringe todos os caminhos ao domínio principal; `vhs-familia.pages.dev`, hashes, aliases e previews retornam `404`, inclusive para arquivos estáticos e login. Não há necessidade de configurar Access por e-mail. Caso existam políticas Access antigas no projeto, remova-as somente depois de validar a proteção por senha, para que não seja exigido um segundo login. Não altere a lista de hosts para contornar uma falha de autenticação.

## Publicação na Cloudflare

É necessária uma conta com controle da zona `tiarlesbutzk.com.br`, Pages e R2. Use login seguro do Wrangler ou um token restrito às operações necessárias. Nunca envie credenciais pelo chat nem as versiona no repositório. A ativação do R2 pode exigir informações de faturamento mesmo com uso dentro da franquia.

1. Crie o bucket **Standard** `vhs-familia`. Confirme **r2.dev / Public Development URL desativada**, sem qualquer domínio público personalizado. Mantenha-o vazio ou somente com vídeos sintéticos durante a configuração.
2. Crie o projeto e faça o primeiro deploy:

   ```sh
   npx wrangler login
   npx wrangler whoami
   npx wrangler r2 bucket create vhs-familia
   # Pule a criação se o bucket já existir.
   npx wrangler pages project create vhs-familia --production-branch main
   npm run deploy -- --project-name vhs-familia --branch main
   ```

   `wrangler.jsonc` define `MEDIA → vhs-familia`, domínio permitido e saída `public`. Confirme binding e variável de host em produção e preview. O primeiro deploy sem Secrets falha fechado com `503`. Previews permanecem bloqueados por host.
3. No painel **Workers & Pages → vhs-familia → Settings → Variables and Secrets**, crie **Secrets** `SITE_PASSWORD` e `SESSION_SECRET` com valores reais, independentes da instalação local. Para gerar a chave, use seu gerenciador de senhas ou `openssl rand -hex 32` em sua máquina confiável. Não cole o resultado no chat. Configure os valores também em preview se necessário, mantendo a restrição de host. **Não transforme a senha em variável pública de build.**
4. Faça novo deploy para os Secrets entrarem em vigor. Como alternativa ao painel, use os prompts seguros do Wrangler:

   ```sh
   npx wrangler pages secret put SITE_PASSWORD --project-name vhs-familia
   npx wrangler pages secret put SESSION_SECRET --project-name vhs-familia
   npm run deploy -- --project-name vhs-familia --branch main
   ```

   Não inclua valores na linha de comando, no histórico ou em arquivos versionados.
5. Em **Pages → Custom domains**, associe `vhs.tiarlesbutzk.com.br` e aguarde DNS e certificado HTTPS. Não crie somente um CNAME sem registrar o domínio no Pages. Habilite o redirecionamento de HTTP para HTTPS na zona.
6. Configure a regra de rate limiting de login no painel da zona, confirme que nenhuma regra de cache expõe conteúdo privado e execute [o checklist](docs/SEGURANCA.md) com vídeo sintético.
7. Depois dos testes de acesso, envie os vídeos pessoais e compartilhe domínio e senha com a família por um meio privado.

Se usar integração Git, a saída é `public` e não é necessário build de frontend. Inclua `functions/` no deploy via Wrangler ou build do Pages; arrastar apenas `public/` para upload estático no painel não publica a proteção. Não use `wrangler deploy --temporary` para a aplicação privada. Não crie um segundo projeto estático desprotegido.

### Autorizar a publicação por este ambiente

O campo seguro `CLOUDFLARE_API_TOKEN` foi declarado nas configurações do ambiente, restrito à API `api.cloudflare.com`. Ele ainda precisa ser preenchido pelo proprietário. Esse token permite ao agente administrar a implantação; **não é a senha dos familiares**.

No Cloudflare, crie um token personalizado limitado à conta do projeto e à zona `tiarlesbutzk.com.br`, com as permissões necessárias: **Account → Cloudflare Pages: Edit**, **Workers R2 Storage: Edit**, **Account Settings: Read**; **Zone → DNS: Edit**, **Zone: Read**, **Zone Settings: Edit** e **Zone WAF: Edit** para HTTPS e rate limiting. Os nomes no painel podem variar; não conceda recursos de outras contas/zonas. Se preferir configurar DNS, HTTPS e rate limiting manualmente, esses escopos de edição da zona podem ser omitidos, deixando as etapas correspondentes como manuais.

Preencha o valor somente no campo seguro das configurações do ambiente, revise e salve as alterações e publique o ambiente conforme o produto solicitar. Não cole o token no chat. O salvamento do rascunho não autentica nem publica o site automaticamente; depois da configuração, o agente deve verificar o token e as permissões antes de criar recursos. A senha real do site e a chave de sessão são Secrets separados no Pages, conforme as etapas acima.

### Trocar a senha

Atualize o Secret `SITE_PASSWORD` no Pages e faça novo deploy. Avise a família pelo meio privado escolhido. Sessões da senha anterior serão recusadas no novo deploy, inclusive para vídeos diretos. Trocar `SESSION_SECRET` também encerra todas as sessões. Remova deployments antigos se não forem mais necessários; os hosts alternativos continuam bloqueados por código. Não há cadastro nem lista de e-mails.

## Organização dos objetos

`vhs-familia` é o **bucket**, não uma pasta adicional:

```text
videos/2025-gramado/passeio-centro.mp4
videos/2025-gramado/natal-luz.mp4
videos/2026-florianopolis/praia.mp4
posters/2025-gramado/natal-luz.jpg
```

Use exatamente `videos/<álbum>/<arquivo>.mp4`. Pastas vazias, arquivos vazios, subpastas extras e outras extensões são ignorados. Hífens e sublinhados viram espaços nos títulos; acentos e espaços são aceitos e os caminhos são codificados. A data exibida é o upload no R2, não a gravação. Álbuns e vídeos são ordenados pelo upload mais recente, com desempate estável por caminho.

Capas opcionais: `posters/<álbum>/<mesmo-nome>.jpg`, `.jpeg`, `.png` ou `.webp`. Sem capa ou com erro, aparece um placeholder. Se existir mais de uma extensão para o mesmo nome, a primeira chave em ordem lexical é usada. Não envie SVG ou HTML como capa.

`GET /api/videos` percorre todas as páginas de `videos/` e `posters/` por cursor. Retorna `{ albums: [{ id, title, updated, count, videos: [{ key, title, album, size, uploaded, url, poster }] }] }`. Não há JSON estático ou cache compartilhado. Clique **Atualizar** após upload/exclusão; não precisa redeploy.

## Reprodução e cache

- `/media/videos/<álbum>/<arquivo>.mp4` transmite o corpo diretamente do R2 privado, sem carregar o arquivo inteiro na memória.
- `/media/posters/<álbum>/<capa>` usa a mesma leitura privada.
- Após autenticação, os endpoints de dados aceitam somente GET/HEAD; métodos de escrita retornam `405`. Sem sessão, retornam `401` antes de acessar R2.
- HTTP `200`, `206`, `304`, `404`, `416`, `503`; ETag, Last-Modified, Accept-Ranges e Content-Length.
- Range simples fechado, aberto ou sufixo; intervalos fora do arquivo ou múltiplas faixas retornam `416`. HEAD ignora Range conforme HTTP. If-Range incompatível retorna o arquivo completo.
- Uma leitura condicional por ETag evita misturar cabeçalhos antigos e conteúdo de substituição concorrente; se houver mudança, o servidor pede nova tentativa.
- Só os prefixos e formatos documentados são permitidos. Não há endpoint público de upload/exclusão, URL pública ou URL assinada R2.
- Cache privado `no-store` em todas as respostas, inclusive login e erros. CSP restrita ao próprio domínio e `nosniff`; textos da interface usam `textContent`.
- `_routes.json` inclui **todas as rotas** para que a autenticação também cubra estáticos. Isso consome Functions nas requisições de páginas e assets, além de catálogo/mídia; não retorne à configuração antiga que incluía só `/api/*` e `/media/*`.

O player HTML5 tem controles nativos, `playsinline`, `preload="none"`, sem autoplay, proporção preservada e tela cheia quando suportada. Navegar pelo catálogo ou álbum não baixa corpos MP4. A grade usa links com Tab/Enter e aceita setas de controles de TV. Smart TVs precisam de navegador moderno e H.264/AAC; teste os modelos utilizados.

## Upload e exclusão

Somente o administrador usa **R2 → vhs-familia → Objects** no painel; familiares apenas assistem.

1. Prepare MP4 com vídeo H.264, áudio AAC e preferencialmente `faststart`.
2. Envie para `videos/<álbum>/<arquivo>.mp4` com Content-Type **video/mp4**. Não inclua o nome do bucket na chave.
3. Opcionalmente envie a capa correspondente, com `image/jpeg`, `image/png` ou `image/webp`.
4. Atualize o site e confira reprodução e avanço.
5. Para substituir, sobrescreva a mesma chave, atualize e reabra o player. Reprodução em andamento pode precisar de nova tentativa.
6. Para excluir, apague vídeo/capa e atualize o catálogo. Uma cópia já recebida pelo familiar não pode ser revogada; o site não implementa DRM.

Para uploads grandes que o painel não aceitar, o proprietário pode usar **rclone**, backend S3, provider Cloudflare, endpoint privado `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`. É o protocolo compatível do R2, sem conta AWS. Restrinja a credencial R2 ao bucket, mantenha a configuração do rclone fora do repositório e use upload multipart:

```sh
rclone copyto ./praia.mp4 r2:vhs-familia/videos/2026-florianopolis/praia.mp4 --progress
```

`r2` é o remote configurado pelo proprietário. Evite `sync`, que pode excluir objetos. Endpoint e credenciais não vão para o frontend. O uso remoto de rclone não foi testado nesta conta.

### FFmpeg local

Inspecione com `ffprobe -hide_banner entrada.mp4`. Para converter sem sobrescrever o original:

```sh
ffmpeg -i entrada.mov -map 0:v:0 -map '0:a:0?' \
  -c:v libx264 -crf 22 -preset medium -pix_fmt yuv420p \
  -c:a aac -b:a 128k -movflags +faststart saida.mp4
```

Se os codecs já forem H.264/AAC, mova o índice para o início: `ffmpeg -i entrada.mp4 -c copy -movflags +faststart saida.mp4`. HDR pode exigir ajuste de cor adicional. O servidor não faz transcoding nem valida codecs no upload; o player informa falhas de reprodução.

## Custo e limites

Planeje até **10 GB somando vídeos e capas**, com margem para substituições. Não há quota automática de upload no site. A franquia R2 Standard publicada é 10 GB-mês, 1 milhão de operações Class A/mês e 10 milhões Class B/mês; egress R2 sem cobrança. Limites são compartilhados pela conta e podem mudar. Listagens usam Class A; HEAD/leitura e seek usam Class B.

**Agora todas as páginas, assets, logins e mídia passam pelas Pages Functions** para manter a proteção por senha. Isso usa a franquia Workers (Free: tipicamente 100 mil requests/dia e limite de CPU). Rate limiting e disponibilidade de regras dependem do plano da zona. Confira [R2 pricing](https://developers.cloudflare.com/r2/pricing/) e [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), configure alertas e acompanhe o uso. Custo zero é uma expectativa dentro das franquias, não garantia nem teto automático de cobrança. Nunca habilite cache público para economizar conteúdo privado.

## Arquivos e validação

- `functions/_middleware.js`: proteção global, login/logout e políticas de segurança.
- `functions/lib/session.js`: senha, cookies e sessões assinadas.
- `functions/api/videos.js`: catálogo paginado.
- `functions/media/[[path]].js`: streaming privado e Range/HEAD.
- `public/`: interface, CSS, ícone e rotas.
- `tests/`: testes de autenticação e funções com R2 simulado.
- `scripts/`: credenciais locais, servidor, semente e testes com Chromium/R2 emulado.
- `docs/SEGURANCA.md`: aceite e configuração manual pendente.

Validado localmente: autenticação, expiração/rotação, proteção de rotas, catálogo/R2, bytes de vídeo, upload/exclusão, HTTP Range e reprodução Chromium em desktop/celular. Não validado na conta real: deploy, Secrets remotos, DNS/HTTPS, rate limiting, Safari/Firefox, celulares físicos, Smart TVs e consumo. Nenhum vídeo pessoal ou recurso remoto foi publicado.

Referências: [Pages + R2](https://developers.cloudflare.com/pages/functions/bindings/#r2-buckets), [Pages middleware](https://developers.cloudflare.com/pages/functions/middleware/), [Pages Secrets](https://developers.cloudflare.com/pages/functions/bindings/#environment-variables), [R2 API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), [rclone](https://developers.cloudflare.com/r2/examples/rclone/).
