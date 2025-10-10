# Python Football Predictions Bot

This directory contains a standalone Python port of the original Mastra workflow. It uses the same competition catalogue and reproduces the fetch → analyse → Telegram send pipeline so it can be hosted on a VPS or cron job without the Mastra runtime.

## Quick start

1. Create and fill a `.env` file with the required environment variables:

```env
FOOTBALL_API_KEY=your_api_sports_key
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
# Optional but recommended
TELEGRAM_DEFAULT_CHAT_ID=123456789
TELEGRAM_CHANNEL_ID=@your_channel
FOOTBALL_API_BOOKMAKER=6
FOOTBALL_MAX_FIXTURES=120
TELEGRAM_OWNER_ID=123456789
TELEGRAM_ADMIN_IDS=987654321,111111111
```

2. Install dependencies (Python 3.11+ recommended):

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r python_bot/requirements.txt
```

3. Run a dry run for today (no Telegram message is sent):

```bash
python -m python_bot.main --dry-run --env .env
```

4. Send the formatted predictions to Telegram:

```bash
python -m python_bot.main --env .env
```

Use `--date YYYY-MM-DD` to backfill a specific day, `--chat-id` to override the destination, and `--output` to export the raw JSON payload.

The bot shares the competition metadata stored in `shared/competitions.json`, which is extracted directly from the TypeScript implementation.

## Execução automática diária

Uma rotina para enviar o relatório principal todos os dias às 00:10 está disponível no módulo `python_bot.scheduler`:

```bash
python -m python_bot.scheduler --env .env --timezone Europe/Lisbon --time 00:10
```

Argumentos úteis:

- `--chat-id`: substitui o chat padrão configurado no `.env`.
- `--run-immediately`: dispara uma execução assim que o script inicia, além do agendamento diário.
- `--time HH:MM`: ajusta o horário alvo (padrão `00:10`).
- `--timezone`: fuso IANA usado para calcular o horário local (padrão `UTC`).

## Monitor de jogos ao vivo

Para receber alertas em tempo real quando surgirem novas recomendações durante as partidas, utilize o módulo `python_bot.live_monitor`:

```bash
python -m python_bot.live_monitor --env .env --interval 120 --min-confidence medium
```

O monitor consulta a API a cada `--interval` segundos (mínimo 30s), analisa os jogos em andamento e envia notificações quando surgir uma recomendação inédita, quando a confiança subir para o patamar configurado (`low`, `medium`, `high`) **ou** sempre que um novo golo for marcado. Use `--dry-run` para testar no terminal sem enviar mensagens e `--chat-id` para direcionar os alertas para um destino específico. Ajuste o intervalo conforme o limite da sua API; valores entre 60 e 180 segundos equilibram bem resposta rápida e consumo de requests.

Para manter o monitor sempre disponível num servidor Linux com systemd:

1. Ajuste `scripts/live_monitor.service.example` com os caminhos da sua `venv` e do `.env`.
2. Copie o ficheiro e ative o serviço:

   ```bash
   sudo cp scripts/live_monitor.service.example /etc/systemd/system/futebol-live-monitor.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now futebol-live-monitor.service
   ```

O serviço reinicia automaticamente o monitor em caso de falha ou reboot.

## Iniciar monitor + comandos privados com um único processo

Se quiser deixar os alertas ao vivo **e** o comando `/insight` disponíveis sem abrir duas shells, utilize o orquestrador incluído em `python_bot.runner`:

```bash
python -m python_bot.runner start --env .env --interval 120 --min-confidence medium
```

O comando acima inicia o monitor contínuo e o listener de comandos privados simultaneamente. Ambos são reiniciados automaticamente em caso de falha e podem ser encerrados com `Ctrl+C`. Opções úteis:

- `--no-live`: inicia apenas o listener `/insight`.
- `--no-owner`: inicia apenas o monitor ao vivo.
- `--restart-delay`: controla a pausa antes de reiniciar um serviço que caiu (padrão 15s).
- `--owner-poll-interval`: define a cadência de leitura de mensagens privadas (padrão 5s).

Para uma experiência "liga tudo" basta invocar o script auxiliar:

```bash
bash scripts/ligxyz.sh --env .env --interval 120 --min-confidence medium
```

Ele ativa automaticamente a `venv` localizada em `.venv` (quando existir) e chama o runner com os parâmetros fornecidos.

## Mantendo o monitor ligado depois de fechar o terminal

Caso esteja numa VPS, Replit ou qualquer ambiente em que fechar o navegador encerra a sessão interativa, use uma das abordagens abaixo para manter o processo ativo:

### `tmux` / `screen`

```bash
tmux new -s futebol
python -m python_bot.live_monitor --env /caminho/.env --interval 120 --min-confidence medium
# Pressione Ctrl+B depois D para destacar e deixar rodando
```

Para voltar, use `tmux attach -t futebol`. O mesmo fluxo funciona com `screen` (`screen -S futebol` … `Ctrl+A` + `D`).

### `nohup`

```bash
nohup python -m python_bot.live_monitor --env /caminho/.env --interval 120 --min-confidence medium > monitor.log 2>&1 &
```

O comando continua ativo mesmo após encerrar a shell, e os logs ficam em `monitor.log`. Verifique o processo com `ps aux | grep live_monitor` e encerre usando `kill <PID>` quando desejar.

### Replit (sempre on)

1. No painel **Run**, configure o comando para `python -m python_bot.live_monitor --env .env --interval 120 --min-confidence medium`.
2. Cadastre as variáveis na aba **Secrets**.
3. Ative um ping externo (UptimeRobot, BetterStack etc.) ou contrate o plano Always On para evitar que o container hiberne.
4. Use a aba **Shell** apenas para depuração; mesmo que feche o navegador, o processo configurado no botão Run continuará ativo.

## Comando `/insight` e pesquisas manuais

O listener privado (`python_bot.owner_command`) continua disponível para atender pedidos específicos via Telegram. Configure `TELEGRAM_OWNER_ID` e/ou `TELEGRAM_ADMIN_IDS` no `.env` e, após iniciar o runner ou o comando individual, envie mensagens como:

```
/insight portugal
/insight porto-benfica
```

O bot agora prioriza correspondências exatas, seleções nacionais e equipas cujo país coincide com o termo pesquisado, tornando mais fácil obter jogos da selecção portuguesa ou de equipas com nomes parecidos. Caso o adversário seja omitido, ele procura automaticamente o próximo jogo agendado pela equipa encontrada.
