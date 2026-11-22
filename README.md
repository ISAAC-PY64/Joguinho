# Monster Haven

Jogo React/Vite com progresso salvo no dispositivo e batalhas privadas de dois jogadores. O frontend e o servidor Node.js são processos e pacotes separados; nenhum computador de jogador precisa ficar ligado para hospedar partidas.

## Rodar localmente

Requisitos para desenvolvimento: Node.js 20+ e npm.

1. Copie `.env.example` para `.env` (PowerShell: `Copy-Item .env.example .env`).
2. Na raiz do projeto, instale os pacotes do frontend e do servidor:

   ```bash
   npm install
   npm run server:install
   ```

3. Abra dois terminais na pasta do projeto:

   ```bash
   npm run dev
   ```

   ```bash
   npm run server
   ```

4. Abra a URL mostrada pelo Vite, normalmente `http://localhost:5173`. O status do servidor pode ser conferido em `http://localhost:3001/health`.

Sem `DATABASE_URL`, o servidor local salva salas e backups em arquivos JSON dentro de `data/`. Para testes locais, dois navegadores ou abas podem entrar com o mesmo código de sala.

## Publicar o servidor e o frontend

O exemplo de implantação usa **Render** para o Node.js e **Vercel** para o frontend. Os dois oferecem opções gratuitas, sujeitas a limites e alterações dos provedores. No plano gratuito do Render o servidor pode dormir quando não está sendo usado; a primeira conexão pode demorar. PostgreSQL mantém a recuperação das partidas e dos backups mesmo se o processo do servidor reiniciar.

### 1. Criar banco de dados persistente

1. Crie um projeto PostgreSQL em um serviço gerenciado, por exemplo Supabase.
2. Copie a URL de conexão PostgreSQL privada do projeto. Ela é uma credencial: não a publique nem a inclua no código.

O servidor cria automaticamente as tabelas `game_rooms` e `profile_backups` no primeiro início. Use a URL de conexão fornecida pelo serviço, incluindo SSL quando exigido.

### 2. Publicar o servidor no Render

1. Importe este repositório no Render e crie um **Blueprint** a partir do `render.yaml` (ou configure um Web Service com diretório raiz `server`, build `npm install` e comando `npm start`).
2. Configure as variáveis privadas do serviço:
   - `DATABASE_URL`: URL do PostgreSQL.
   - `ALLOWED_ORIGINS`: origens exatas da página Vercel, separadas por vírgula. Exemplo: `https://monster-haven.vercel.app,https://localhost,capacitor://localhost`.
   - `PGSSLMODE=require`.
3. Aguarde a implantação e anote a URL HTTPS pública do serviço, por exemplo `https://monster-haven-server.onrender.com`. `/health` deve responder com `{"ok":true,...}`.

Não use `*` em `ALLOWED_ORIGINS`. Inclua o domínio de produção da Vercel e, se usar o aplicativo Capacitor, as origens locais do WebView (`https://localhost` e `capacitor://localhost`). CORS valida as origens do navegador; não substitui autenticação de contas.

### 3. Publicar o frontend na Vercel

1. Importe o mesmo repositório na Vercel, mantendo a raiz do projeto.
2. Nas variáveis de ambiente de produção, defina `VITE_SERVER_URL` como a URL HTTPS do serviço Render, sem caminho adicional, por exemplo `https://monster-haven-server.onrender.com`.
3. Publique. O build de produção falha intencionalmente se `VITE_SERVER_URL` não estiver definido, evitando que o jogo publicado tente conectar a `localhost`.
4. Se a Vercel atribuir outro domínio, adicione a origem exata a `ALLOWED_ORIGINS` no Render e reinicie/reimplante o servidor.

HTTPS no navegador conecta por WSS automaticamente. Não exponha uma porta local, não encaminhe portas do roteador e não use Tailscale.

## Conectar dois jogadores

1. Compartilhe a URL pública Vercel com seu amigo. O jogo abre no navegador de computador, Android ou iPhone; seu amigo não precisa instalar Node.js, VS Code ou o servidor.
2. Na aba **Amigos**, ambos pressionam **Conectar**. A URL é incluída no build por `VITE_SERVER_URL`.
3. Um jogador cria uma sala e compartilha o código de seis caracteres; o outro digita o código e entra.
4. Cada um escolhe três criaturas da própria coleção e confirma. As escolhas simultâneas, ataques, habilidades, HP e vitória são resolvidos pelo servidor.
5. Se alguém perder a conexão, a partida pode ser recuperada por até 60 segundos. O jogador deve reabrir a página e conectar novamente usando o mesmo perfil e navegador.

As salas e o estado atual da batalha são gravados no PostgreSQL em cada mudança necessária para recuperação. O progresso principal continua salvo localmente no navegador; os backups de perfil enviados pela tela **Perfil** também usam PostgreSQL quando `DATABASE_URL` está configurado. No desenvolvimento sem banco, esses dados ficam em arquivos locais e não são adequados para hospedagem com disco efêmero.

## Gerar APK Android

O APK é gerado pelo desenvolvedor, não por cada jogador. É necessário Node.js, Android Studio, Android SDK e Java compatíveis com a versão do Android Gradle Plugin instalada pelo Capacitor.

1. Configure `.env` na raiz com o servidor online:

   ```env
   VITE_SERVER_URL=https://monster-haven-server.onrender.com
   ```

2. Instale e sincronize o app:

   ```bash
   npm install
   npx cap add android
   npm run cap:sync
   npm run android
   ```

3. No Android Studio, use **Build > Build Bundle(s) / APK(s) > Build APK(s)** para um APK de teste. Para distribuir, gere uma versão assinada pelo Android Studio e mantenha a chave privada fora do repositório.
4. Após alterar o frontend ou `VITE_SERVER_URL`, rode `npm run cap:sync` novamente.

O mesmo layout funciona em Safari no iPhone. Um app iOS nativo requer macOS/Xcode; o Capacitor pode adicionar a plataforma iOS nesse ambiente.

## Desenvolvimento e testes

```bash
npm test
npm run build
```

O build de produção precisa de `VITE_SERVER_URL`; crie `.env` com o endereço HTTPS público antes de executá-lo.

## Compatibilidade e dados

- Baús, incubação, coleção, fusão, salvamento local e batalha contra IA continuam disponíveis.
- As partidas multiplayer não consomem criaturas nem recursos da coleção.
- O servidor valida os atributos enviados dentro das faixas possíveis, mas não consegue confirmar a propriedade da coleção sem contas/inventários centralizados.
- A hospedagem gratuita pode suspender o processo por inatividade e impor limites ao banco. Isso pode atrasar a conexão; não é necessário manter um computador de jogador ligado.
