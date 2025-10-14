# Self-hosting the Football Predictions Bot

The Node.js helper has been fully replaced by the Python toolchain. You only need a recent Python runtime to mirror the Mastra workflow locally or on a VPS.

## Runtime

| Stack | Entry point | Requirements |
| --- | --- | --- |
| Python | `python -m python_bot.main` | Python 3.11+, `requests`, `python-dotenv` |

The Python modules read the shared competition metadata stored in `shared/competitions.json`, exposing the same CLI flags (`--env`, `--date`, `--dry-run`, `--chat-id`, `--output`) e reutilizando toda a lógica de análise e envio do projeto original.

Consulte `python_bot/README.md` para um passo a passo completo de instalação, agendamento e monitorização em tempo real.
