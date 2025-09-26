import { createWorkflow, createStep } from "../inngest";
import { z } from "zod";
import { RuntimeContext } from "@mastra/core/di";

import { monitorLiveMatchesTool } from "../tools/monitorLiveMatches";
import { sendTelegramMessageTool } from "../tools/sendTelegramMessage";
import { REGION_LABEL } from "../constants/competitions";

const runtimeContext = new RuntimeContext();

// Define schemas
const RegionEnum = z.enum(["Europe", "South America", "North America", "Asia", "Africa"]);

const LiveMatchData = z.object({
  totalLiveMatches: z.number(),
  highDangerCount: z.number(),
  mediumDangerCount: z.number(),
  matches: z.array(z.any()),
  lastUpdated: z.string(),
  metadata: z.object({
    totalFixtures: z.number(),
    supportedFixtures: z.number(),
    processedFixtures: z.number(),
    perRegion: z.array(
      z.object({
        region: RegionEnum,
        label: z.string(),
        total: z.number(),
        high: z.number(),
        medium: z.number(),
      }),
    ),
  }),
});

const AlertResult = z.object({
  alertsSent: z.number(),
  hotMatches: z.array(z.any()),
  sentAt: z.string(),
});

// Step 1: Monitor live matches
const monitorLiveStep = createStep({
  id: "monitor-live-step",
  description: "Monitor live football matches in all supported competitions for betting opportunities",
  inputSchema: z.object({}),
  outputSchema: LiveMatchData,
  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [MonitorLiveStep] Starting live monitoring");

    const result = await monitorLiveMatchesTool.execute({
      context: {},
      runtimeContext,
      mastra,
    });

    logger?.info("✅ [MonitorLiveStep] Completed", {
      liveMatches: result.totalLiveMatches,
      highDanger: result.highDangerCount,
      perRegion: result.metadata.perRegion,
    });

    return result;
  },
});

// Step 2: Send live alerts for hot matches
const sendLiveAlertsStep = createStep({
  id: "send-live-alerts-step",
  description: "Send live betting alerts for high-danger matches",
  inputSchema: LiveMatchData,
  outputSchema: AlertResult,
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [SendLiveAlertsStep] Starting", { 
      totalMatches: inputData.totalLiveMatches,
      highDanger: inputData.highDangerCount 
    });

    const hotMatches = inputData.matches.filter((match: any) => 
      match.dangerLevel === "high" || 
      (match.dangerLevel === "medium" && match.dangerIndicators.length >= 2)
    );

    logger?.info("📝 [SendLiveAlertsStep] Hot matches identified", { 
      hotMatchCount: hotMatches.length 
    });

    let alertsSent = 0;

    if (hotMatches.length > 0) {
      // Format live alert message
      const now = new Date();
      let alertMessage = `🔥 <b>ALERTAS AO VIVO - ${now.toLocaleTimeString('pt-PT')}</b>\n\n`;
      alertMessage += `⚡ <b>${hotMatches.length} JOGOS QUENTES DETECTADOS!</b>\n\n`;

      hotMatches.forEach((match: any, index: number) => {
        const dangerEmoji = match.dangerLevel === "high" ? "🔥" : "⚡";
        const score = `${match.teams.home.score || 0}-${match.teams.away.score || 0}`;
        const elapsed = match.status.elapsed ? `${match.status.elapsed}'` : match.status.short;
        
        alertMessage += `${dangerEmoji} <b>${match.teams.home.name} ${score} ${match.teams.away.name}</b>\n`;
        alertMessage += `⏱️ ${elapsed} | 🏆 ${match.league.name}\n`;
        if (match.competition && REGION_LABEL[match.competition.region as keyof typeof REGION_LABEL]) {
          alertMessage += `🌍 ${REGION_LABEL[match.competition.region as keyof typeof REGION_LABEL]} • ${match.competition.country}\n`;
        }

        if (match.dangerIndicators && match.dangerIndicators.length > 0) {
          alertMessage += `📈 ${match.dangerIndicators.join(", ")}\n`;
        }
        
        // Add betting suggestions based on current situation
        const suggestions = [];
        if (match.totalGoals >= 2) {
          suggestions.push("Over 2.5 ✅");
        } else if (match.status.elapsed >= 60 && match.totalGoals === 0) {
          suggestions.push("Under 2.5 📈");
        }
        
        if (match.dangerLevel === "high" && match.totalGoals < 3) {
          suggestions.push("Próximo golo 🎯");
        }
        
        if (suggestions.length > 0) {
          alertMessage += `💡 ${suggestions.join(" | ")}\n`;
        }
        
        alertMessage += `\n`;
      });

      alertMessage += `\n🎯 <b>DICAS LIVE:</b>\n`;
      alertMessage += `• Jogos com muitos remates/cantos = oportunidade de golos\n`;
      alertMessage += `• Aproveite odds ao vivo quando a pressão aumenta\n`;
      alertMessage += `• Cuidado com jogos sem golos após 60min\n\n`;
      
      alertMessage += `⏰ Próximo update: ${new Date(Date.now() + 5*60*1000).toLocaleTimeString('pt-PT')}\n`;
      alertMessage += `🔴 <b>@BetSenseTips - Apostas ao Vivo</b>`;

      try {
        const result = await sendTelegramMessageTool.execute({
          context: { message: alertMessage },
          runtimeContext,
          mastra,
        });

        if (result.success) {
          alertsSent = 1;
          logger?.info("✅ [SendLiveAlertsStep] Live alert sent successfully");
        }
      } catch (error) {
        logger?.error("❌ [SendLiveAlertsStep] Failed to send alert", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    } else {
      logger?.info("📝 [SendLiveAlertsStep] No hot matches found, skipping alerts");
    }

    return {
      alertsSent,
      hotMatches,
      sentAt: new Date().toISOString(),
    };
  },
});

// Create the live betting workflow
export const liveBettingWorkflow = createWorkflow({
  id: "live-betting-workflow",
  description: "Live betting workflow that monitors matches and sends real-time alerts for hot betting opportunities",
  inputSchema: z.object({}),
  outputSchema: AlertResult,
})
  .then(monitorLiveStep)
  .then(sendLiveAlertsStep)
  .commit();