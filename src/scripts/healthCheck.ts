import "dotenv/config";

import { mastra } from "../mastra";
import { fetchFootballMatchesTool } from "../mastra/tools/fetchFootballMatches";
import { analyzeOddsAndMarketsTool } from "../mastra/tools/analyzeOddsAndMarkets";
import { monitorLiveMatchesTool } from "../mastra/tools/monitorLiveMatches";
import { sendTelegramMessageTool } from "../mastra/tools/sendTelegramMessage";
import { footballPredictionsWorkflow } from "../mastra/workflows/footballPredictionsWorkflow";
import { liveBettingWorkflow } from "../mastra/workflows/liveBettingWorkflow";

// Basic health-check utility to help validate that the Mastra bot is wired correctly
// and that the surrounding environment exposes the resources the workflows need.

type HealthStatus = "pass" | "warn" | "fail";

interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  details?: string;
}

const checks: HealthCheckResult[] = [];

function record(result: HealthCheckResult) {
  checks.push(result);
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

function checkEnvironment() {
  const requiredEnv = [
    { key: "FOOTBALL_API_KEY", description: "API-Football key used to fetch fixtures and odds" },
    { key: "TELEGRAM_BOT_TOKEN", description: "Telegram bot token used to send notifications" },
  ];
  const optionalEnv = [
    { key: "TELEGRAM_CHANNEL_ID", description: "Optional channel target for broadcast messages" },
    { key: "DATABASE_URL", description: "Postgres connection string for workflow snapshots" },
  ];

  const missingRequired = requiredEnv
    .filter((envVar) => !process.env[envVar.key])
    .map((envVar) => `${envVar.key} (${envVar.description})`);

  if (missingRequired.length > 0) {
    record({
      name: "Required environment",
      status: "fail",
      details: `Missing: ${formatList(missingRequired)}`,
    });
  } else {
    record({
      name: "Required environment",
      status: "pass",
      details: `All required variables present (${requiredEnv.map((envVar) => envVar.key).join(", ")})`,
    });
  }

  const missingOptional = optionalEnv
    .filter((envVar) => !process.env[envVar.key])
    .map((envVar) => `${envVar.key} (${envVar.description})`);

  if (missingOptional.length > 0) {
    record({
      name: "Optional environment",
      status: "warn",
      details: `Not configured: ${formatList(missingOptional)}`,
    });
  } else {
    record({
      name: "Optional environment",
      status: "pass",
      details: "All optional variables configured",
    });
  }
}

function checkWorkflowRegistration() {
  const workflows = mastra.getWorkflows?.() ?? {};
  const registeredWorkflowIds = Object.values(workflows).map((workflow: any) => workflow?.id ?? "unknown");

  if (registeredWorkflowIds.includes(footballPredictionsWorkflow.id)) {
    record({
      name: "Football predictions workflow",
      status: "pass",
      details: `Registered as ${footballPredictionsWorkflow.id}`,
    });
  } else {
    record({
      name: "Football predictions workflow",
      status: "fail",
      details: "Workflow is not registered in Mastra",
    });
  }

  if (registeredWorkflowIds.includes(liveBettingWorkflow.id)) {
    record({
      name: "Live betting workflow",
      status: "warn",
      details: "Workflow is registered but not wired to any trigger by default",
    });
  } else {
    record({
      name: "Live betting workflow",
      status: "warn",
      details: "Workflow is defined but not registered; enable manually if live alerts are required",
    });
  }

  if (registeredWorkflowIds.length > 1) {
    record({
      name: "Workflow count",
      status: "warn",
      details: `Multiple workflows registered (${formatList(registeredWorkflowIds)}) — UI currently supports a single workflow`,
    });
  } else {
    record({
      name: "Workflow count",
      status: "pass",
      details: `Single workflow registered (${formatList(registeredWorkflowIds)})`,
    });
  }
}

function checkToolConfiguration() {
  const toolIds = [
    fetchFootballMatchesTool.id,
    analyzeOddsAndMarketsTool.id,
    monitorLiveMatchesTool.id,
    sendTelegramMessageTool.id,
  ];

  const duplicates = toolIds.filter((id, index) => toolIds.indexOf(id) !== index);
  if (duplicates.length > 0) {
    record({
      name: "Tool identifiers",
      status: "fail",
      details: `Duplicate tool identifiers detected: ${formatList(Array.from(new Set(duplicates)))}`,
    });
  } else {
    record({
      name: "Tool identifiers",
      status: "pass",
      details: `All tool identifiers are unique (${formatList(toolIds)})`,
    });
  }

  const availableTools = mastra.getTools?.() ?? {};
  const missingTools = toolIds.filter((toolId) => !availableTools[toolId]);
  if (missingTools.length > 0) {
    record({
      name: "Registered tools",
      status: "warn",
      details: `Tools not registered on Mastra instance: ${formatList(missingTools)}`,
    });
  } else {
    record({
      name: "Registered tools",
      status: "pass",
      details: "All tools registered on the Mastra instance",
    });
  }
}

async function runDryRunChecks() {
  // Dry-run the odds analysis step using controlled sample data to ensure
  // the workflow logic can operate without hitting external APIs.
  const sampleMatches = [
    {
      fixtureId: 1,
      date: new Date().toISOString(),
      time: "20:00",
      league: { name: "Sample League", country: "PT", logo: "" },
      teams: {
        home: { name: "FC Mastra", logo: "" },
        away: { name: "BetSense United", logo: "" },
      },
      venue: "Mastra Arena",
      odds: [
        {
          name: "Match Winner",
          values: [
            { value: "Home", odd: "1.80" },
            { value: "Draw", odd: "3.60" },
            { value: "Away", odd: "4.20" },
          ],
        },
        {
          name: "Goals Over/Under",
          values: [
            { value: "Over 2.5", odd: "2.05" },
            { value: "Under 2.5", odd: "1.75" },
          ],
        },
        {
          name: "Both Teams Score",
          values: [
            { value: "Yes", odd: "1.95" },
            { value: "No", odd: "1.85" },
          ],
        },
      ],
    },
  ];

  try {
    const analysis = await analyzeOddsAndMarketsTool.execute({
      context: { matches: sampleMatches },
      mastra,
    });

    if (analysis.bestMatches.length > 0) {
      record({
        name: "Odds analysis dry-run",
        status: "pass",
        details: `Generated ${analysis.bestMatches.length} analyzed match(es)`,
      });
    } else {
      record({
        name: "Odds analysis dry-run",
        status: "warn",
        details: "Analysis completed but did not return any recommended matches",
      });
    }
  } catch (error) {
    record({
      name: "Odds analysis dry-run",
      status: "fail",
      details: `Error: ${(error as Error).message}`,
    });
  }

  // Mock Telegram interactions so we can verify message formatting without
  // actually reaching the Telegram API.
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const hadTelegramToken = Boolean(telegramToken);
  if (!telegramToken) {
    process.env.TELEGRAM_BOT_TOKEN = "dummy-token";
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as { url?: string }).url ?? String(input);
    if (url.includes("api.telegram.org")) {
      if (url.includes("getUpdates")) {
        return new Response(JSON.stringify({ ok: true, result: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      const rawBody = (init as any)?.body;
      const parsedBody = typeof rawBody === "string" ? JSON.parse(rawBody) : {};
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            message_id: 999,
            chat: { id: parsedBody.chat_id ?? "unknown" },
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (typeof originalFetch === "function") {
      return originalFetch(input as any, init);
    }

    throw new Error("Unexpected fetch call during health check");
  }) as typeof fetch;

  try {
    const sendResult = await sendTelegramMessageTool.execute({
      context: { message: "Health-check message", chatId: "123" },
      mastra,
    });

    if (sendResult.success) {
      record({
        name: "Telegram delivery dry-run",
        status: "pass",
        details: `Message routed to chat ${sendResult.chatId}`,
      });
    } else {
      record({
        name: "Telegram delivery dry-run",
        status: "warn",
        details: "Send tool returned without success flag",
      });
    }
  } catch (error) {
    record({
      name: "Telegram delivery dry-run",
      status: "fail",
      details: `Error: ${(error as Error).message}`,
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (!hadTelegramToken) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    }
  }

  const runExternalChecks = process.env.RUN_EXTERNAL_CHECKS === "1";

  if (runExternalChecks) {
    try {
      const date = new Date().toISOString().split("T")[0];
      const fetchResult = await fetchFootballMatchesTool.execute({
        context: { date },
        mastra,
      });

      record({
        name: "Football data fetch",
        status: "pass",
        details: `Recebeu ${fetchResult.totalMatches} jogo(s) para ${date}`,
      });
    } catch (error) {
      record({
        name: "Football data fetch",
        status: "fail",
        details: `Erro ao chamar ${fetchFootballMatchesTool.id}: ${(error as Error).message}`,
      });
    }
  } else {
    record({
      name: "Football data fetch",
      status: "warn",
      details: `Requires live API access with ${fetchFootballMatchesTool.id}; set RUN_EXTERNAL_CHECKS=1 to execute`,
    });
  }

  if (runExternalChecks) {
    try {
      const monitorResult = await monitorLiveMatchesTool.execute({ mastra });
      record({
        name: "Live match monitoring",
        status: "pass",
        details: `Monitorizou ${monitorResult.totalLiveMatches} jogo(s) ao vivo`,
      });
    } catch (error) {
      record({
        name: "Live match monitoring",
        status: "fail",
        details: `Erro ao chamar ${monitorLiveMatchesTool.id}: ${(error as Error).message}`,
      });
    }
  } else {
    record({
      name: "Live match monitoring",
      status: "warn",
      details: `Requires live API access with ${monitorLiveMatchesTool.id}; set RUN_EXTERNAL_CHECKS=1 to execute`,
    });
  }
}

function renderSummary() {
  const overallStatus: HealthStatus = checks.some((check) => check.status === "fail")
    ? "fail"
    : checks.some((check) => check.status === "warn")
      ? "warn"
      : "pass";

  console.log("\nMastra Bot Health Check Summary\n");
  for (const check of checks) {
    const label = check.status.toUpperCase().padEnd(4, " ");
    console.log(`[${label}] ${check.name}${check.details ? ` -> ${check.details}` : ""}`);
  }

  console.log(`\nOverall status: ${overallStatus.toUpperCase()}`);

  if (overallStatus === "fail") {
    process.exitCode = 1;
  }
}

async function main() {
  checkEnvironment();
  checkWorkflowRegistration();
  checkToolConfiguration();
  await runDryRunChecks();
  renderSummary();
}

main().catch((error) => {
  console.error("Health check failed unexpectedly", error);
  process.exitCode = 1;
});
