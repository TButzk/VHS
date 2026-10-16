import { randomBytes } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';
if (existsSync('.dev.vars')) {
  console.log('.dev.vars existente preservado.');
} else {
  const password = randomBytes(18).toString('base64url');
  const secret = randomBytes(48).toString('base64url');
  writeFileSync('.dev.vars', `SITE_PASSWORD=${JSON.stringify(password)}\nSESSION_SECRET=${JSON.stringify(secret)}\n`, { flag: 'wx', mode: 0o600 });
  console.log('Credenciais locais criadas em .dev.vars (ignorado pelo Git). Nenhum valor foi exibido.');
}
