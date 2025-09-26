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
