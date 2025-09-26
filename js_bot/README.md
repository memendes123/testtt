# JavaScript Football Predictions Bot

`js_bot/index.js` is a minimal Node.js port of the football predictions workflow. It reads the same `shared/competitions.json` catalogue and can run without the Mastra runtime so you can deploy it on any VPS with Node 20+.

## Usage

```bash
node js_bot/index.js --env .env --dry-run
```

Available flags:

- `--env <path>` – optional path to a `.env` file with API credentials
- `--date YYYY-MM-DD` – fetch fixtures for a specific day (defaults to today)
- `--dry-run` – print the Telegram message instead of sending it
- `--chat-id` – override the destination chat
- `--output <file>` – write a JSON summary to disk
- `--verbose` – log extra information

Required environment variables:

```env
FOOTBALL_API_KEY=your_api_sports_key
TELEGRAM_BOT_TOKEN=your_bot_token
# optional helpers
TELEGRAM_DEFAULT_CHAT_ID=123456789
TELEGRAM_CHANNEL_ID=@your_channel
FOOTBALL_API_BOOKMAKER=6
FOOTBALL_MAX_FIXTURES=120
```

The script relies on the global `fetch` available in Node 20. For older Node versions install a fetch polyfill or upgrade your runtime.
