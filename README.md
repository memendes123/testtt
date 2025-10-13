# Bot de Previsões de Futebol – Guia Completo de Auto-hospedagem

Este repositório contém duas portas independentes (Python e Node.js) do fluxo original criado no Mastra. Ambas implementam o mesmo pipeline:

1. **Busca dos jogos e odds** na API Football para as competições listadas em `shared/competitions.json`.
2. **Análise das probabilidades**, convertendo as odds em percentuais, destacando favoritos, mercados de gols e ambos marcam (ver `python_bot/analyzer.py`).
3. **Formatação do relatório** em blocos por região, com destaques de confiança e resumo agregado.
4. **Envio opcional via Telegram**, usando o bot e canal que você configurar.

> As duas versões produzem o mesmo texto e podem ser usadas tanto para execuções avulsas quanto para rotinas automatizadas (cron, PM2, systemd etc.).

---

## 1. Credenciais necessárias

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `FOOTBALL_API_KEY` | ✅ | Chave da [API-Football](https://dashboard.api-football.com/). Usada para baixar partidas, odds e estatísticas. |
| `TELEGRAM_BOT_TOKEN` | ✅ | Token do bot criado com o @BotFather. Necessário mesmo para testes locais (as mensagens de teste ficam em memória). |
| `TELEGRAM_DEFAULT_CHAT_ID` | ⚪️ | Chat ou usuário que receberá o relatório por padrão. Pode ser o ID numérico do seu usuário ou de um grupo. |
| `TELEGRAM_CHANNEL_ID` | ⚪️ | Canal público (ex.: `@meucanal`) caso queira publicar automaticamente. |
| `FOOTBALL_API_BOOKMAKER` | ⚪️ | ID do bookmaker desejado (padrão `6` – Pinnacle). |
| `FOOTBALL_MAX_FIXTURES` | ⚪️ | Limite de jogos carregados por execução (padrão `120`). |
| `TELEGRAM_OWNER_ID` | ⚪️ | ID numérico da conta que poderá usar o comando exclusivo `/insight`. |
| `TELEGRAM_ADMIN_IDS` | ⚪️ | Lista de IDs adicionais (separados por vírgula ou ponto e vírgula) autorizados a usar o `/insight`. |
| `OPENAI_API_KEY` | ⚪️ | Chave da OpenAI para gerar resumos via ChatGPT (opcional). |
| `OPENAI_MODEL` | ⚪️ | Modelo da OpenAI a utilizar (padrão `gpt-4o-mini`). |

### Guardando os segredos com segurança

1. Crie um arquivo `.env` na raiz do projeto (ele já está ignorado pelo git).
2. Copie o exemplo abaixo e preencha com seus dados reais:

```env
FOOTBALL_API_KEY=coloque_sua_chave_aqui
TELEGRAM_BOT_TOKEN=coloque_seu_token_do_bot
TELEGRAM_DEFAULT_CHAT_ID=123456789
TELEGRAM_CHANNEL_ID=@seu_canal
FOOTBALL_API_BOOKMAKER=6
FOOTBALL_MAX_FIXTURES=120
```

> Nunca compartilhe esse arquivo ou faça commit. Em VPS ou serviços como Replit, cadastre as variáveis de ambiente diretamente no painel para evitar expor as credenciais.

---

## 2. Executando no seu computador (recomendado)

### Python

1. **Instale as dependências:**
   *Linux/macOS*
   ```bash
   python -m venv .venv
   source .venv/bin/activate
   pip install -r python_bot/requirements.txt
   ```

   *Windows (PowerShell)*
   ```powershell
   py -m venv .venv
   .venv\Scripts\Activate.ps1
   py -m pip install -r python_bot/requirements.txt
   ```
2. **Rode um teste sem enviar mensagem:**
   ```bash
   python -m python_bot.main --env .env --dry-run
   ```
   O script baixa os jogos do dia, calcula probabilidades e imprime o relatório formatado no terminal.
3. **Envie para o Telegram:**
   ```bash
   python -m python_bot.main --env .env
   ```
4. **Executar diariamente automaticamente:** use um agendador do sistema:
   * **Linux/macOS:** `crontab -e` → `0 9 * * * /caminho/para/.venv/bin/python -m python_bot.main --env /caminho/para/.env`
   * **Windows:** Agendador de Tarefas apontando para `python.exe -m python_bot.main --env C:\caminho\.env`
   * Alternativa embutida: `python -m python_bot.scheduler --env .env --time 00:10 --timezone Europe/Lisbon`

5. **Alertas em jogos ao vivo (sem intervalo de 1h):**
   ```bash
   python -m python_bot.live_monitor --env .env --interval 120 --min-confidence medium
   ```
   Esse processo consulta os jogos em andamento a cada `--interval` segundos (mínimo 30s) e dispara imediatamente qualquer nova análise ou aumento de confiança. Ele é o comando indicado para manter avisos em tempo real sem depender de um loop com `sleep 3600`.

### Node.js

1. **Instale dependências (Node 18+):** `npm install`
   *O projeto mantém o `@mastra/core` na série 0.18 para continuar compatível com `@mastra/libsql`. Caso personalize as dependências, mantenha versões < 0.19 ou atualize os dois pacotes em conjunto.*
2. **Execute o CLI em modo teste:**
   ```bash
   node js_bot/index.js --env .env --dry-run
   ```
3. **Envie para o Telegram:**
   ```bash
   node js_bot/index.js --env .env
   ```
4. **Mantenha rodando continuamente:** use `pm2` ou `forever` para agendar execuções:
   ```bash
   npx pm2 start "node js_bot/index.js --env /caminho/.env" --name futebol-bot --cron "0 9 * * *"
   ```

> Ambas as versões aceitam `--date YYYY-MM-DD` para backfill e `--output arquivo.json` para salvar o payload completo.

### Comando privado com ChatGPT (owner)

Quando quiser pedir uma análise sob demanda directamente pelo Telegram:

1. Defina no `.env` (pode usar múltiplos admins):
   ```env
   TELEGRAM_OWNER_ID=123456789
   TELEGRAM_ADMIN_IDS=987654321,111111111
   OPENAI_API_KEY=sk-...
   ```
   (`OPENAI_API_KEY` é opcional; sem ele, o resumo GPT não será anexado.)
2. Inicie o listener dedicado:
   ```bash
   python -m python_bot.owner_command --env .env
   ```
3. No chat privado com o bot, envie comandos como:
   * `/insight city` → procura o próximo jogo do Manchester City e gera análise completa.
   * `/insight city-psg` → foca no confronto directo entre City e PSG.

O bot devolve as probabilidades calculadas, recomendações do modelo, notas PK e, se configurado, um resumo em linguagem natural vindo do ChatGPT. Todos os IDs listados em `TELEGRAM_OWNER_ID` e `TELEGRAM_ADMIN_IDS` podem usar o comando; pedidos de outros utilizadores são recusados automaticamente.

---

## 3. Deixando online 24/7 na sua máquina

Se quiser manter o bot emitindo alertas frequentes (ex.: a cada hora) enquanto seu PC está ligado:

1. **Use o monitor contínuo:** rode `python -m python_bot.live_monitor --env /caminho/.env --interval 120 --min-confidence medium` para receber alertas assim que surgirem, sem aguardar 1 hora.
2. **Execute dentro de `tmux`, `screen` ou `nohup`** para não depender da sessão aberta.
   * `tmux new -s futebol` → execute o monitor → `Ctrl+B` seguido de `D` para destacar.
   * `screen -S futebol` → execute o monitor → `Ctrl+A` seguido de `D` para destacar.
   * `nohup python -m python_bot.live_monitor --env /caminho/.env --interval 120 --min-confidence medium > monitor.log 2>&1 &` para deixar rodando em segundo plano com log.
3. **Configure o sistema para iniciar com o computador:**
   * Linux (systemd): use o ficheiro de exemplo `scripts/live_monitor.service.example`, ajuste os caminhos e copie para `/etc/systemd/system/futebol-bot-live.service`.
   * Windows: use o [NSSM](https://nssm.cc/) para transformar o comando em serviço.

Lembre-se: se o computador for desligado, o bot para. Para ficar online 24/7 use um VPS ou serviço na nuvem.

---

## 4. Publicando no Replit com execução contínua

1. Faça upload dos diretórios `python_bot`, `js_bot`, `shared` e do arquivo `shared/competitions.json` para o seu Replit.
2. No painel **Secrets**, cadastre as variáveis `FOOTBALL_API_KEY`, `TELEGRAM_BOT_TOKEN` etc.
3. Escolha qual runtime deseja manter:
   * **Python (recomendado para alertas 24/7):** defina o comando de execução para `python -m python_bot.live_monitor --env .env --interval 120 --min-confidence medium`.
   * **Node:** defina o comando de execução para `node js_bot/index.js`.
4. Para manter o Replit sempre ativo:
   * Use o plano Hacker (mantém a instância viva) **ou**
   * Configure um ping externo (ex.: UptimeRobot) chamando a webview gerada pelo Replit a cada 5 minutos.
5. Ative o modo `--dry-run` durante testes para não enviar mensagens acidentais. Caso use o monitor contínuo, reduza o `--interval` conforme necessário (ex.: 60s) para tornar os avisos mais frequentes sem exceder o limite da API.

> Replit pausa o container após inatividade em contas gratuitas. O ping externo mantém a execução, mas se o processo falhar será necessário abrir o projeto e reiniciar manualmente.

---

## 5. Como a análise funciona

* **Conversão de odds em probabilidade:** cada odd decimal é convertida em percentual (`100 / odd`).
* **Sinais externos (Forebet):** quando a API não devolve odds ou mercados completos, o bot tenta capturar as probabilidades 1X2/Over 2.5/BTTS disponibilizadas publicamente pela Forebet para preencher os buracos sem deixar valores zerados.
* **Form vs. histórico:** quando uma casa de apostas não oferece odds para 1X2, usamos o desempenho recente (últimos 5 jogos) e o confronto direto para estimar probabilidades, evitando relatórios zerados.
* **Notas chave (PK):** para cada destaque são listados até 2 “pontos-chave” baseados na forma das equipas (sequência de vitórias/derrotas, média de golos, confrontos diretos).
* **Classificação de confiança:** partidas com probabilidades altas geram recomendações "Forte favorito" ou "Favorito". Mercados Over/Under e Ambos Marcam entram na lista caso ultrapassem 60%.
* **Pontuação e ordenação:** os jogos são reordenados por confiança e quantidade de recomendações, exibindo os melhores primeiro e organizando por região/competição.
* **Sem ruído de 0%:** partidas que permanecem com probabilidades zeradas após todos os cálculos são ignoradas nos destaques e listas regionais, evitando relatórios vazios no Telegram.
* **Resumo agregado:** o relatório mostra quantos jogos de alta ou média confiança existem por região, ajudando a priorizar ligas.

Para ver a lógica exata consulte:

* `python_bot/analyzer.py` – regras de probabilidade, recomendações e agrupamento.
* `python_bot/fetcher.py` – chamada à API-Football com filtros de liga, bookmaker e data.
* `python_bot/message_builder.py` – montagem do texto final (usado também pela versão Node).

---

## 6. Próximos passos sugeridos

* Ajuste a lista de competições em `shared/competitions.json` para focar apenas nos campeonatos desejados.
* Ajuste os thresholds de confiança no `analyzer.py` caso queira alertas mais conservadores ou agressivos.
* Integre com outras saídas (Discord, e-mail) reutilizando a função `message_builder.build_message`.

---

## 7. Gerindo jobs agendados (cron/PM2)

Quando precisar parar o bot para aplicar atualizações ou trocar credenciais, basta seguir os passos abaixo conforme a ferramenta usada:

### Cron (Linux/macOS)

1. **Listar o agendamento atual:**
   ```bash
   crontab -l
   ```
2. **Editar/pausar temporariamente:** comente a linha do bot adicionando `#` no início.
   ```bash
   crontab -e
   # 0 9 * * * /caminho/para/.venv/bin/python -m python_bot.main --env /caminho/.env
   ```
3. **Aplicar a atualização (pull/commit/etc.)**
4. **Reativar:** remova o `#` e salve novamente com `crontab -e`.

### PM2 (Node.js)

```bash
# Parar o processo
npx pm2 stop futebol-bot

# Aplicar atualizações no código
git pull
npm install

# Subir novamente (ajuste o comando conforme seu fluxo)
npx pm2 start "node js_bot/index.js --env /caminho/.env" --name futebol-bot --cron "0 9 * * *"

# Verificar status
npx pm2 status futebol-bot
```

Para remover definitivamente um job agendado, use `crontab -e` (removendo a linha) ou `npx pm2 delete futebol-bot`. Depois de reinstalar dependências ou atualizar o código, execute os comandos de start novamente.

Com esse guia você consegue hospedar o bot no seu PC, VPS ou Replit, mantendo as credenciais seguras e garantindo execuções automáticas confiáveis.
