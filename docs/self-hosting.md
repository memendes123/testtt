# Self-hosting the Football Predictions Bot

This repository now includes lightweight Python and Node.js ports of the Mastra workflow so you can run the bot on a regular VPS without the Mastra runtime.

## Options

| Stack | Entry point | Requirements |
| --- | --- | --- |
| Python | `python -m python_bot.main` | Python 3.11+, `requests`, `python-dotenv` |
| Node.js | `node js_bot/index.js` | Node 20+ with global `fetch` |

Both ports share the same competition metadata stored in `shared/competitions.json`, which is generated from the TypeScript source of the Mastra project. They expose similar CLI flags (`--env`, `--date`, `--dry-run`, `--chat-id`, `--output`) and expect the same environment variables.

See the README files inside `python_bot/` and `js_bot/` for hands-on instructions.
