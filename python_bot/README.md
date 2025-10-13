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

> Os relatórios automáticos ignoram partidas que permaneçam com probabilidades zeradas, evitando mensagens com "0%" no Telegram.

## Monitor de jogos ao vivo

Para receber alertas em tempo real quando surgirem novas recomendações durante as partidas, utilize o módulo `python_bot.live_monitor`:

```bash
python -m python_bot.live_monitor --env .env --interval 120 --min-confidence medium
```

O monitor consulta a API a cada `--interval` segundos (mínimo 30s), analisa os jogos em andamento e envia notificações quando surgir uma recomendação inédita, quando a confiança subir para o patamar configurado (`low`, `medium`, `high`) **ou** sempre que um novo golo for marcado. Use `--dry-run` para testar no terminal sem enviar mensagens e `--chat-id` para direcionar os alertas para um destino específico.

Para manter o monitor sempre disponível num servidor Linux com systemd:

1. Ajuste `scripts/live_monitor.service.example` com os caminhos da sua `venv` e do `.env`.
2. Copie o ficheiro e ative o serviço:

   ```bash
   sudo cp scripts/live_monitor.service.example /etc/systemd/system/futebol-live-monitor.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now futebol-live-monitor.service
   ```

O serviço reinicia automaticamente o monitor em caso de falha ou reboot.
