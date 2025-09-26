# Bot Health Checklist

Este projeto contém dois fluxos principais de apostas de futebol construídos sobre Mastra:

- `football-predictions-workflow` — fluxo diário que recolhe jogos, analisa probabilidades e envia o resumo formatado.
- `live-betting-workflow` — fluxo opcional para alertas ao vivo que depende do monitoramento contínuo de jogos.

Para confirmar se o bot está configurado correctamente, siga os passos abaixo.

## 1. Variáveis de ambiente

O bot depende de variáveis para comunicar com APIs externas e persistir estado:

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `FOOTBALL_API_KEY` | ✅ | Chave do API-Football (plano gratuito disponível com limites) para recolher jogos, estatísticas e odds. |
| `FOOTBALL_API_KEY` | ✅ | Chave do API-Football para recolher jogos, estatísticas e odds. |
| `TELEGRAM_BOT_TOKEN` | ✅ | Token do bot Telegram usado para enviar mensagens. |
| `TELEGRAM_CHANNEL_ID` | ⚠️ | ID opcional de canal para difusão pública. |
| `DATABASE_URL` | ⚠️ | URL Postgres usado pelo armazenamento do Mastra e pelo `inngest-cli`. |

> Sem as variáveis obrigatórias o fluxo diário falha logo no primeiro passo.

## 2. Script de verificação

Execute o novo comando de health-check para inspecionar a configuração e fazer dry-runs das partes que não dependem de serviços externos:

```bash
npm run healthcheck
```

O script:

1. Valida a presença das variáveis de ambiente obrigatórias e opcionalmente alerta para as que faltam.
2. Confirma que o `football-predictions-workflow` está registado e pronto a ser executado. Também assinala que o fluxo de alertas ao vivo existe mas não está registado por omissão.
3. Garante que os IDs das tools (`fetch-football-matches`, `analyze-odds-and-markets`, `monitor-live-matches`, `send-telegram-message`) são únicos e registados no servidor MCP.
4. Faz um dry-run local da tool `analyze-odds-and-markets` com dados fictícios para validar o cálculo de probabilidades, o agrupamento por região e as recomendações.
5. Simula o envio Telegram injectando uma resposta mock à API, assegurando que a mensagem formatada é produzida sem contactar a internet.
6. Quando `RUN_EXTERNAL_CHECKS=1`, chama `fetchFootballMatchesTool` e `monitorLiveMatchesTool` contra o API real (com a respectiva chave) e reporta o resultado, incluindo a contagem por região; caso contrário, assinala que esses testes ficaram pendentes.
4. Faz um dry-run local da tool `analyze-odds-and-markets` com dados fictícios para validar o cálculo de probabilidades e recomendações.
5. Simula o envio Telegram injectando uma resposta mock à API, assegurando que a mensagem formatada é produzida sem contactar a internet.
6. Quando `RUN_EXTERNAL_CHECKS=1`, chama `fetchFootballMatchesTool` e `monitorLiveMatchesTool` contra o API real (com a respectiva chave) e reporta o resultado; caso contrário, assinala que esses testes ficaram pendentes.

O resultado é apresentado no terminal com o estado **PASS/WARN/FAIL** de cada verificação.

## 3. Trigger agendado

O cron configurado em `src/mastra/index.ts` corre às 09:00 (fuso configurável via `SCHEDULE_CRON_TIMEZONE` e `SCHEDULE_CRON_EXPRESSION`). Certifique-se de que o processo tem a timezone correcta e acesso à base de dados configurada em `DATABASE_URL`.

## 4. Execução do Inngest

O script `scripts/inngest.sh` cria a configuração do `inngest-cli`. Após a correcção aplicada, quando `DATABASE_URL` está definido a configuração aponta para Postgres; caso contrário usa SQLite local. Verifique se o ficheiro `.config/inngest/inngest.yaml` reflecte o destino desejado antes de iniciar o dev server.

## 5. Testes manuais recomendados

Além do health-check automático, recomenda-se:

1. **API-Football** — executar `fetchFootballMatchesTool` com uma data conhecida e confirmar se devolve jogos e odds coerentes.
2. **Canal Telegram** — enviar manualmente uma mensagem com `sendTelegramMessageTool` para validar permissões e formato.
3. **Workflow completo** — lançar `footballPredictionsWorkflow.createRunAsync()` em modo desenvolvimento e seguir os logs para confirmar a sequência `fetch → analyze → send`.

## 6. Cobertura de competições e APIs grátis

- A tool `fetchFootballMatches` suporta automaticamente as ligas e taças listadas pelo utilizador, agora agrupadas por Europa, América do Sul, América do Norte, Ásia/Médio Oriente, África, competições continentais (UEFA Champions League, Libertadores, Champions Cup, etc.) e torneios mundiais (Mundial, Euro, Copa América, Jogos Olímpicos, Club World Cup). O resumo diário apresenta os totais e destaques por região, garantindo que cada grupo recebe pelo menos três recomendações sempre que existam odds disponíveis.
- O monitoramento ao vivo (`monitor-live-matches` + `live-betting-workflow`) usa o mesmo filtro de competições, pelo que os alertas consideram campeonatos, torneios continentais e eventos globais sem ajustes adicionais.
- Como a lista de torneios inclui fases finais com calendários intensivos, confirme se o `FOOTBALL_API_KEY` pertence a um plano com limite diário suficiente ou prepare chaves alternativas para períodos de Mundial, Jogos Olímpicos e outras fases concentradas. Ajuste também o cron ou janelas de execução para abranger partidas em fusos distintos (Ásia/Oceânia) durante esses eventos.
- Todos os dados provêm do API-Football, que oferece um escalão gratuito suficiente para testes e para uma execução diária. Caso seja necessário reforçar o número de chamadas gratuitas para mercados específicos, prepare chaves adicionais de APIs públicas (por exemplo, API-FOOTBALL free tier adicional, Football-Data.org ou APIs federativas) e partilhe-as para integração futura.


Com estes passos consegue garantir que o bot está funcional e pronto para produção ou demonstração.
