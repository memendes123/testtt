# Plano Premium e Auditoria do Bot

## Visão geral do fluxo actual
- O pipeline recolhe competições configuradas, chama a API-Football, aplica cálculos próprios e gera um relatório Telegram único. 【F:README.md†L5-L73】【F:python_bot/main.py†L7-L92】
- A versão Python concentra toda a lógica crítica (fetch → análise → formatação → envio) e é a base recomendada para execuções contínuas e monitorização em tempo real. 【F:python_bot/fetcher.py†L510-L723】【F:python_bot/analyzer.py†L87-L430】【F:python_bot/message_builder.py†L1-L278】
- O repositório também oferece uma porta Node.js alinhada com o fluxo original do Mastra; útil para ambientes que já orquestram jobs em JavaScript. 【F:README.md†L92-L157】【F:js_bot/index.js†L1-L200】

## Principais pontos de atenção (antes da melhoria)
1. **Falta de resiliência a falhas de rede** – Um `requests.get` que explode com `RequestException` terminava o processo inteiro, impactando alertas pagos. 【F:python_bot/fetcher.py†L62-L150】
2. **Pouca visibilidade da qualidade dos dados** – A análise não sinalizava quando odds vinham incompletas ou quando dependíamos de fontes alternativas; difícil gerir SLAs com clientes. 【F:python_bot/analyzer.py†L90-L347】
3. **Relatório sem indicadores de saúde** – O texto enviado ao Telegram não destacava lacunas de dados, o que pode gerar dúvidas em assinantes premium. 【F:python_bot/message_builder.py†L152-L210】
4. **Documentação dispersa** – Não existia um guia que unificasse pontos fracos, melhorias e roadmap comercial, dificultando apresentar o produto a investidores/parceiros. 【F:docs/bot-health.md†L1-L120】

## Melhorias implementadas nesta revisão
1. **Retry defensivo e mensagens claras** – `_request_with_retry` agora captura exceções de rede, aplica backoff exponencial e gera erros específicos para 401/403/5xx, protegendo a operação contínua. 【F:python_bot/fetcher.py†L62-L150】
2. **Métricas de qualidade na análise** – `analyze_matches` agrega contadores de lacunas (odds ausentes, fallback Forebet/API, uso de forma recente) e devolve a secção `dataQuality` pronta para dashboards ou alertas internos. 【F:python_bot/analyzer.py†L90-L443】
3. **Resumo premium no Telegram** – `format_predictions_message` incorpora a nova secção “Saúde dos dados”, permitindo transparência proactiva com clientes VIP. 【F:python_bot/message_builder.py†L152-L210】
4. **Relatório estratégico** – Este ficheiro consolida visão técnica/comercial e serve como guia rápido para equipa de vendas ou onboarding de parceiros. 【F:docs/premium_upgrade.md†L1-L34】

## Roadmap para tornar o serviço premium
1. **Painel e histórico** – Persistir `analysis` e `dataQuality` em base de dados para oferecer dashboard com métricas, histórico de acertos, ROI estimado e alertas de degradação. Integrar com Superset/Metabase ou painel personalizado.
2. **Segmentação por planos** – Criar camadas de acesso (free, pro, elite) limitando número de regiões entregues e habilitando insights LLM exclusivos para níveis superiores.
3. **Automação de billing** – Integrar Stripe/PagSeguro e um CRM leve (ex.: HubSpot) para gerir trial, recorrência, churn e acesso ao bot via `TELEGRAM_ADMIN_IDS` dinâmicos.
4. **Alertas em tempo real diferenciados** – Expandir `live_monitor` para suportar triggers personalizadas (handicap asiático, momento do jogo, variação de odds), oferecendo alerts “push” premium.
5. **Monitorização e SLAs** – Activar prometheus/grafana ou serviços de logging (Datadog) com as métricas extraídas, garantindo relatórios de uptime e latência para clientes corporativos.
6. **Localização e copy** – Internacionalizar mensagens (pt-PT, pt-BR, en) e permitir branding white-label através de templates no `message_builder`.

## Checklist de lançamento comercial
- [ ] Configurar ambiente CI/CD com testes (`pytest`, lint) e healthcheck antes de deploy.
- [ ] Criar landing page explicando planos, exemplos de relatórios e percentuais de acerto.
- [ ] Oferecer canal de suporte (Discord/Telegram privado) com automações baseadas no `dataQuality`.
- [ ] Preparar contrato/termos de uso destacando natureza probabilística das dicas.
- [ ] Definir política de privacidade para utilização de dados (especialmente quando LLM estiver activo).

Com estas acções, o bot torna-se robusto para operar como produto premium e oferece transparência sobre as fontes de dados e confiabilidade das recomendações.
