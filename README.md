# SuperVISOR Demo

Versão independente da aplicação, preparada para `https://demo.supervisor.umsoftware.com.br`. A aplicação original continua na pasta superior. Publique somente esta pasta `demo`, sem copiar dados ou sessões da produção.

## Funcionamento

- Cada empresa recebe um convite privado, um administrador e uma senha inicial gerada automaticamente.
- O teste começa no **primeiro login válido** e dura **168 horas (7 dias)**. Abrir o convite ou errar a senha não inicia a contagem.
- Todos os administradores criados dentro da empresa compartilham o mesmo prazo. Criar usuários, alterar e-mail/senha, limpar cookies e reiniciar o servidor não renovam a demo.
- Ao vencer, o servidor bloqueia páginas, APIs e novas conexões. Interrompe os agendamentos e encerra o processo do cliente e o navegador do WhatsApp. Uma mensagem já entregue ao WhatsApp antes do vencimento não é desfeita.
- A demo mantém contatos, conversas, agendamentos, estatísticas, histórico, administração de usuários e conexão por QR Code. O cliente conecta o próprio WhatsApp e as mensagens são reais.
- A área Integrações, seu código de interface, suas rotas e os módulos de gUMperformance não fazem parte desta edição.
- Não existe cadastro público. Você libera o acesso pelo terminal do servidor. O domínio sem convite mostra uma orientação de acesso.

Um gateway recebe o tráfego e abre um processo por empresa. Cada processo possui banco JSON local, segredo de sessão, autenticação e cache de WhatsApp próprios. As portas dos processos são escolhidas automaticamente e escutam apenas em `127.0.0.1`. MongoDB não é usado nesta versão. As preferências e rascunhos do navegador também são separados por empresa.

O gateway e os processos precisam rodar em uma única máquina, com uma única instância do gateway no PM2. Não usar cluster. Cada demo ativa inicia seu próprio Chromium: acompanhe a memória com `pm2 monit` e ajuste `DEMO_MAX_WORKERS` à capacidade do servidor. O valor padrão é um limite de 10 processos de clientes, incluindo ambientes abertos que ainda aguardam o primeiro login; não é uma garantia de capacidade. O Chromium só inicia após o primeiro login. Processos de demos iniciadas são retomados quando o cliente volta a abrir o ambiente após um reinício.

## Publicar no Ubuntu/Debian com Nginx e PM2

Os comandos abaixo usam `/var/www/supervisor-demo`, a porta interna `3100` e o mesmo usuário de serviço do seu PM2. Não execute o Node/Chromium como root. Se o servidor já tem Node, Nginx, PM2 e Certbot configurados, reutilize essas instalações.

### 1. Organização no mesmo servidor

O SuperVISOR e a demo podem rodar no mesmo servidor, com instalações separadas:

| Item | SuperVISOR contratado | Demo |
| --- | --- | --- |
| Pasta | Pasta atual da produção | `/var/www/supervisor-demo` |
| Processo PM2 | `supervisor` | `supervisor-demo` |
| Porta | Porta atual da produção, geralmente 3000 | 3100 |
| Domínio | Domínio atual da produção | `demo.supervisor.umsoftware.com.br` |
| Dados | Dados atuais da produção | `instances/IDENTIFICADOR/` por empresa |

O Nginx já instalado atende os dois domínios com configurações separadas. Preserve a configuração e o processo da produção. Entre via SSH com o usuário que já executa o PM2 e confira:

```bash
pm2 list
sudo ss -ltnp '( sport = :3100 )'
```

Se 3100 já estiver ocupada, escolha outra porta e ajuste tanto `PORT` no `.env` da demo quanto os dois `proxy_pass` em `deploy/nginx.conf` antes de instalar o site. O servidor compartilha CPU e memória: acompanhe o consumo das demos para não prejudicar a operação contratada.

### 2. Colocar a demo no GitHub

O caminho principal deste guia considera um repositório próprio chamado `supervisor-demo`, com **o conteúdo da pasta local `demo` na raiz do repositório**. Assim, `package.json`, `src`, `public`, `scripts`, `deploy`, `.env.example` e `.gitignore` ficam na raiz, sem uma pasta `demo` adicional.

Crie esse repositório no GitHub. Na pasta SuperVISOR do seu computador, use PowerShell (substitua `SEU_USUARIO` pelo usuário ou organização do GitHub):

```powershell
cd .\demo
git init
git add .
git commit -m "Adiciona SuperVISOR Demo com teste de 7 dias"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/supervisor-demo.git
git push -u origin main
```

Esses comandos são para uma pasta `demo` que ainda não tenha um repositório próprio. Se já houver, use o remoto existente. Você também pode enviar os arquivos pela interface do GitHub; inclua `.env.example` e `.gitignore`. O ZIP é uma alternativa de distribuição e não é necessário para a publicação pelo GitHub.

O `.gitignore` da demo exclui `.env`, `instances`, `node_modules`, `.cache`, logs e capturas de teste. Não adicione esses arquivos com `git add -f`. O repositório deve conter somente o código e os exemplos de configuração.

**Se preferir o mesmo repositório do SuperVISOR:** mantenha `demo/` dentro dele e não execute `git init` dentro dessa pasta. No servidor, faça um segundo clone em `/var/www/supervisor-demo` e execute os comandos do aplicativo em `/var/www/supervisor-demo/demo`. Todos os caminhos relativos do aplicativo continuam corretos. Na atualização, faça `git pull --ff-only` na raiz do segundo clone e retorne para `demo` antes de `npm ci` e PM2. O clone atual da produção continua separado.

### 3. DNS e clone no servidor

Crie no DNS um registro **A** de `demo.supervisor.umsoftware.com.br` apontando para o IP público do servidor. Só adicione AAAA se o servidor também atender em IPv6. As portas públicas 80 e 443 precisam estar acessíveis.

Prepare a pasta vazia no servidor, conectado por SSH como o usuário que executa o PM2:

```bash
sudo mkdir -p /var/www/supervisor-demo
sudo chown "$(id -un):$(id -gn)" /var/www/supervisor-demo
```

Clone o repositório próprio da demo, substituindo `SEU_USUARIO`:

```bash
git clone https://github.com/SEU_USUARIO/supervisor-demo.git /var/www/supervisor-demo
cd /var/www/supervisor-demo
ls -a
```

Confirme que `package.json` e `.env.example` aparecem nessa pasta. Para repositório privado, use a autenticação GitHub já configurada no servidor ou uma chave SSH de implantação; não coloque tokens dentro da URL. A documentação do clone está em [git clone](https://git-scm.com/docs/git-clone).

### 4. Dependências e configuração

Use Node.js LTS compatível com as dependências (Node 22 ou 24). Confira `node --version`, `npm --version` e `pm2 --version`. Se precisar instalar Node, siga a [documentação oficial do Node.js](https://nodejs.org/en/download).

```bash
sudo apt update
sudo apt install -y nginx ca-certificates fonts-liberation libatk-bridge2.0-0 libatk1.0-0 libcups2 libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 xdg-utils
```

No Ubuntu 24.04, instale também `sudo apt install -y libasound2t64`. No Ubuntu 22.04 e Debian 12, use `sudo apt install -y libasound2`.

```bash
cd /var/www/supervisor-demo
export PUPPETEER_CACHE_DIR="$PWD/.cache/puppeteer"
npm ci
cp .env.example .env
chmod 600 .env
nano .env
```

Conteúdo:

```dotenv
PORT=3100
DEMO_PUBLIC_URL=https://demo.supervisor.umsoftware.com.br
DEMO_COOKIE_SECURE=true
DEMO_MAX_WORKERS=10
```

Não adicionar credenciais MongoDB ou gUMperformance da aplicação principal. Os segredos de sessão são gerados individualmente ao criar cada cliente. O comando `npm ci` instala as dependências e o Chrome do Puppeteer. A variável de cache acima é a mesma usada pela configuração PM2.

Se PM2 ainda não estiver instalado, use `sudo npm install -g pm2`. Em seguida, como usuário de serviço, inicie somente a demo:

```bash
pm2 start ecosystem.config.cjs --update-env
pm2 save
pm2 list
```

Os processos `supervisor` e `supervisor-demo` devem aparecer separadamente. Se o PM2 já inicia automaticamente no servidor, `pm2 save` atualiza a lista com a demo. Caso não exista início automático, execute `pm2 startup` e depois o comando que ele imprimir. [Referência do PM2](https://pm2.keymetrics.io/docs/usage/startup/).

Verifique o gateway:

```bash
curl http://127.0.0.1:3100/health
pm2 logs supervisor-demo --lines 50
```

A resposta de saúde deve ser `{"ok":true}`. Não exponha a porta 3100 no firewall; Nginx acessará o gateway localmente.

### 5. Nginx e HTTPS

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/supervisor-demo
sudo ln -s /etc/nginx/sites-available/supervisor-demo /etc/nginx/sites-enabled/supervisor-demo
sudo nginx -t
sudo systemctl reload nginx
```

Se o link em `sites-enabled` já existir, pule o comando `ln -s`. A configuração inclui suporte a WebSocket, limite de upload de 16 MB e omite os convites dos access logs. A configuração de WebSocket segue a [documentação do Nginx](https://nginx.org/en/docs/http/websocket.html).

Com o DNS já apontado, use o Certbot instalado no servidor:

```bash
sudo certbot --nginx -d demo.supervisor.umsoftware.com.br --redirect
sudo certbot renew --dry-run
```

Se Certbot não estiver instalado, siga as [instruções oficiais para Nginx](https://certbot.eff.org/instructions?ws=nginx&os=snap), usando um único método de instalação. Conclua o HTTPS antes de distribuir convites, pois os cookies de produção exigem conexão segura.

### 6. Criar a empresa e seu login de demo

No servidor, como o mesmo usuário que executa o PM2:

```bash
cd /var/www/supervisor-demo
npm run client -- create empresa-exemplo "Empresa Exemplo" responsavel@empresa.com.br
```

O comando imprime:

```text
Convite: https://demo.supervisor.umsoftware.com.br/convite/TOKEN_PRIVADO
E-mail: responsavel@empresa.com.br
Senha inicial: SENHA_GERADA
Prazo: 7 dias a partir do primeiro login válido.
```

Envie ao cliente o convite, o e-mail e a senha. O token não fica armazenado em texto aberto e não pode ser recuperado pelo comando de listagem. Guarde o link em um local privado. Ao entrar, o cliente pode trocar a senha pelo menu da conta e vincular seu WhatsApp na aba WhatsApp.

Use um identificador diferente para cada empresa, com letras minúsculas, números e hífens. O comando recusa um identificador existente. Não é preciso reiniciar o PM2 para liberar novos clientes.

O comando `create` cria **uma empresa e seu administrador principal**, não apenas um usuário em um ambiente compartilhado. Por exemplo, para duas empresas:

```bash
npm run client -- create alfa "Empresa Alfa" gestor@alfa.com.br
npm run client -- create beta "Empresa Beta" gestor@beta.com.br
```

Cada comando imprime um convite e uma senha diferentes. A Alfa usa `instances/alfa` e a Beta usa `instances/beta`. Elas não compartilham contatos, conversas, agendamentos, histórico, estatísticas, usuários ou sessão do WhatsApp. No mesmo navegador, abra o convite da empresa correspondente antes de entrar; para testar duas simultaneamente, use perfis de navegador separados.

Para criar **mais pessoas na mesma empresa**, o administrador acessa a aba **Administradores** dentro do painel e cadastra os usuários. Todos entram pelo convite dessa empresa e usam suas próprias credenciais. Compartilham o ambiente, um único WhatsApp e o prazo de 7 dias da empresa. Não execute `create` novamente para cada colaborador.

O prazo começa no primeiro login válido de qualquer usuário dessa empresa. Depois de começar, ele não é reiniciado por novos administradores ou novos logins. A empresa continua sem acesso após vencer; as rotas de gUMperformance também não existem nesta edição.

Listar clientes e prazos:

```bash
npm run client -- list
```

Revogar antes dos 7 dias:

```bash
npm run client -- revoke empresa-exemplo
```

A revogação bloqueia novas requisições imediatamente e inicia o encerramento do processo em até 1 segundo. O fechamento do Chromium pode levar alguns segundos.

### 7. Conferir a publicação

1. Acesse `https://demo.supervisor.umsoftware.com.br`: deve aparecer a orientação para usar um convite.
2. Crie uma empresa de teste pelo terminal e abra o convite em janela privada.
3. Entre com as credenciais: deve aparecer o aviso do prazo e não deve haver menu Integrações.
4. Conecte um WhatsApp de teste por QR Code e confira grupos, conversa e agendamento com um destinatário autorizado.
5. Crie outra empresa em outra janela privada e confirme que ela não vê contatos, agendamentos ou WhatsApp da primeira.
6. Revogue a primeira demo pelo terminal e confirme que ela perde o acesso enquanto a segunda continua funcionando.

## Atualizações e dados

No computador, envie as alterações do código ao GitHub:

```powershell
cd CAMINHO_DO_REPOSITORIO_DEMO
git add .
git commit -m "Atualiza SuperVISOR Demo"
git push
```

No servidor, atualize somente o clone da demo. Preserve `.env` e `instances`, que são ignorados pelo Git. Faça backup consistente dos dados com somente a demo parada antes de atualizar:

```bash
cd /var/www/supervisor-demo
pm2 stop supervisor-demo
mkdir -p instances
tar -czf "$HOME/supervisor-demo-backup-$(date +%Y%m%d-%H%M%S).tar.gz" instances .env
git pull --ff-only
export PUPPETEER_CACHE_DIR="$PWD/.cache/puppeteer"
npm ci
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
```

Se qualquer comando falhar, corrija a causa antes de prosseguir. A pasta `instances` estará vazia se ainda não houver empresas. Não use `pm2 stop all`, `pm2 delete all`, `git clean -fdx` ou substitua a pasta inteira: isso pode interromper a produção ou apagar dados das demos. Alterações em `deploy/nginx.conf` precisam ser aplicadas separadamente à configuração instalada; se o Certbot já adicionou HTTPS, preserve os blocos de certificado ao editar o arquivo do Nginx.

As sessões de login ficam em memória; reinícios exigem novo login, sem renovar os 7 dias. A sessão do WhatsApp e o prazo ficam em disco. O cliente precisa voltar a acessar o ambiente para que seu processo seja aberto após o reinício.

Estrutura por empresa:

```text
instances/empresa-exemplo/
  trial.json          # Identificação, hash do convite, segredo e prazo
  data/store.json     # Usuários, contatos, agendamentos e estatísticas
  .wwebjs_auth/       # Sessão do WhatsApp
  .wwebjs_cache/      # Cache do WhatsApp
  whatsapp-debug.log # Diagnóstico
```

O vencimento preserva os dados para análise posterior e eventual migração assistida. Não há limpeza automática nem conversão automática para contrato pago. Não apague `trial.json` para renovar uma demo. Antes de excluir uma empresa, revogue o acesso, aguarde o encerramento e aplique sua política de retenção/backup. Os backups contêm dados e sessões de WhatsApp; mantenha-os privados.

## Testes locais

```bash
npm test
```

Os testes usam clientes fictícios e desativam o Chromium/WhatsApp nos processos de cliente. Verificam prazo, login, isolamento, ausência das rotas de integração, autenticação Socket.IO, expiração, revogação e bloqueio de envios/agendamentos.

Para verificar também o painel com Puppeteer, execute os testes com `DEMO_UI_TEST=true` e, se necessário, `DEMO_BROWSER_PATH` apontando para o Chrome. As capturas ficam em `qa`. Esse modo testa o WebSocket real, os layouts desktop/móvel e o logout. `DEMO_TEST_MODE` é apenas para testes e não deve estar no `.env` de produção.

Para executar a demo localmente sem HTTPS, configure `DEMO_COOKIE_SECURE=false` e `DEMO_PUBLIC_URL=http://127.0.0.1:3100` no `.env`, crie um cliente e rode `npm start`. Em produção, mantenha `DEMO_COOKIE_SECURE=true`.
