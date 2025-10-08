import { createWorkflow, createStep } from "../inngest";
import { z } from "zod";
import { RuntimeContext } from "@mastra/core/di";

import { fetchFootballMatchesTool } from "../tools/fetchFootballMatches";
import { analyzeOddsAndMarketsTool } from "../tools/analyzeOddsAndMarkets";
import { sendTelegramMessageTool } from "../tools/sendTelegramMessage";
import { COMPETITION_REGIONS } from "../constants/competitions";

const runtimeContext = new RuntimeContext();

// Define common schemas for type safety
const RegionEnum = z.enum(COMPETITION_REGIONS);

const RegionBreakdown = z.object({
  region: RegionEnum,
  label: z.string(),
  total: z.number(),
  highConfidence: z.number(),
  mediumConfidence: z.number(),
});

const RegionMatches = z.object({
  region: RegionEnum,
  label: z.string(),
  matches: z.array(z.any()),
});

const MatchData = z.object({
  date: z.string(),
  totalMatches: z.number(),
  matches: z.array(z.any()),
  metadata: z.object({
    totalFixtures: z.number(),
    supportedFixtures: z.number(),
    processedFixtures: z.number(),
    perRegion: z.array(
      z.object({
        region: RegionEnum,
        label: z.string(),
        total: z.number(),
      }),
    ),
  }),
});

const AnalysisResult = z.object({
  originalData: z.object({
    date: z.string(),
    totalMatches: z.number(),
  }),
  analysis: z.object({
    totalAnalyzed: z.number(),
    bestMatches: z.array(z.any()),
    highConfidenceCount: z.number(),
    mediumConfidenceCount: z.number(),
    breakdownByRegion: z.array(RegionBreakdown),
    bestMatchesByRegion: z.array(RegionMatches),
  }),
});

const FinalResult = z.object({
  success: z.boolean(),
  messageId: z.number().optional(),
  chatId: z.string(),
  sentAt: z.string(),
  summary: z.object({
    date: z.string(),
    totalMatches: z.number(),
    analyzedMatches: z.number(),
    highConfidenceMatches: z.number(),
    regionBreakdown: z.array(RegionBreakdown),
  }),
});

// Step 1: Fetch today's football matches
const fetchMatchesStep = createStep({
  id: "fetch-football-matches-step",
  description: "Fetch today's European football matches with odds from API-Football",
  inputSchema: z.object({}),
  outputSchema: MatchData,
  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [FetchMatchesStep] Starting execution");

    // Get today's date in YYYY-MM-DD format
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];

    logger?.info("📝 [FetchMatchesStep] Fetching matches for date", { date: dateStr });

    const result = await fetchFootballMatchesTool.execute({
      context: { date: dateStr },
      runtimeContext,
      mastra,
    });

    logger?.info("✅ [FetchMatchesStep] Completed successfully", {
      totalMatches: result.totalMatches,
      perRegion: result.metadata.perRegion,
    });

    return result;
  },
});

// Step 2: Analyze odds and generate predictions
const analyzeOddsStep = createStep({
  id: "analyze-odds-step",
  description: "Analyze football odds and generate betting recommendations",
  inputSchema: MatchData,
  outputSchema: AnalysisResult,
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [AnalyzeOddsStep] Starting execution", { 
      totalMatches: inputData.totalMatches 
    });

    const analysis = await analyzeOddsAndMarketsTool.execute({
      context: { matches: inputData.matches },
      runtimeContext,
      mastra,
    });

    logger?.info("✅ [AnalyzeOddsStep] Completed successfully", { 
      bestMatches: analysis.bestMatches.length,
      highConfidence: analysis.highConfidenceCount 
    });

    return {
      originalData: {
        date: inputData.date,
        totalMatches: inputData.totalMatches,
      },
      analysis,
    };
  },
});

// Step 3: Format and send Telegram message
const sendPredictionsStep = createStep({
  id: "send-predictions-step",
  description: "Format predictions and send via Telegram",
  inputSchema: AnalysisResult,
  outputSchema: FinalResult,
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [SendPredictionsStep] Starting execution", { 
      bestMatches: inputData.analysis.bestMatches.length 
    });

    // Format the message
    const { originalData, analysis } = inputData;
    const date = new Date(originalData.date).toLocaleDateString('pt-PT', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    let message = `🏆 <b>PREVISÕES FUTEBOL - ${date.toUpperCase()}</b>\n\n`;
    message += `📊 <b>Resumo Global:</b>\n`;
    message += `• ${originalData.totalMatches} jogos elegíveis nas competições suportadas\n`;
    message += `• ${analysis.totalAnalyzed} jogos com odds válidas analisados\n`;
    message += `• ${analysis.highConfidenceCount} jogos de alta confiança | ${analysis.mediumConfidenceCount} de média confiança\n\n`;

    const activeRegions = analysis.breakdownByRegion.filter((region) => region.total > 0);
    if (activeRegions.length > 0) {
      message += `🌍 <b>Distribuição por Região:</b>\n`;
      activeRegions.forEach((region) => {
        message += `• ${region.label}: ${region.total} jogos (${region.highConfidence} alta | ${region.mediumConfidence} média)\n`;
      });
      message += `\n`;
    }

    const globalHighlights = analysis.bestMatches.slice(0, Math.min(5, analysis.bestMatches.length));
    if (globalHighlights.length > 0) {
      message += `🔥 <b>TOP GLOBAL (${globalHighlights.length})</b>\n`;
      globalHighlights.forEach((match: any, index: number) => {
        const confidenceEmoji = match.confidence === 'high' ? '🔥' : match.confidence === 'medium' ? '⚡' : '💡';
        const competitionLabel = match.competition ? `${match.competition.name} • ${match.competition.country}` : match.league.name;
        message += `${confidenceEmoji} <b>${match.teams.home.name} vs ${match.teams.away.name}</b> — ${competitionLabel}\n`;
        message += `⏰ ${match.time} | 🏆 ${match.league.name}\n`;
        if (match.recommendedBets && match.recommendedBets.length > 0) {
          message += `🎯 ${match.recommendedBets.join(' | ')}\n`;
        }
        if (match.predictions) {
          message += `📈 Prob: Casa ${match.predictions.homeWinProbability}% | Empate ${match.predictions.drawProbability}% | Fora ${match.predictions.awayWinProbability}%\n`;
        }
        if (match.analysisNotes && match.analysisNotes.length > 0) {
          message += `📝 PK: ${match.analysisNotes.slice(0, 2).join(' • ')}\n`;
        }
        message += `\n`;
      });
    }

    if (analysis.bestMatches.length === 0) {
      message += `😔 <b>Não há jogos com odds interessantes hoje.</b>\n`;
      message += `Voltamos amanhã com mais análises!\n\n`;
      message += `📈 Tip: Verifique os jogos ao vivo durante o dia para oportunidades em tempo real.`;
    } else {
      const regionalHighlights = analysis.bestMatchesByRegion.filter((region) => region.matches.length > 0);

      if (regionalHighlights.length > 0) {
        message += `🌎 <b>Destaques por Região</b>\n\n`;
        regionalHighlights.forEach((region) => {
          const matches = region.matches.slice(0, 3);
          message += `🔹 <b>${region.label}</b> — ${matches.length} recomendações\n`;
          matches.forEach((match: any) => {
            const confidenceEmoji = match.confidence === 'high' ? '🔥' : match.confidence === 'medium' ? '⚡' : '💡';
            const competitionLabel = match.competition ? `${match.competition.name} (${match.competition.type === 'cup' ? 'Taça' : match.competition.type === 'supercup' ? 'Supertaça' : 'Liga'})` : match.league.name;
            message += `${confidenceEmoji} <b>${match.teams.home.name} vs ${match.teams.away.name}</b>\n`;
            message += `🏟️ ${competitionLabel} | ⏰ ${match.time}\n`;

            if (match.recommendedBets && match.recommendedBets.length > 0) {
              message += `🎯 ${match.recommendedBets.join(' | ')}\n`;
            }

            if (match.predictions) {
              const predictions = match.predictions;
              message += `📈 Casa ${predictions.homeWinProbability}% | Empate ${predictions.drawProbability}% | Fora ${predictions.awayWinProbability}%\n`;
              if (predictions.over25Probability > 0 || predictions.under25Probability > 0) {
                message += `⚽ O/U 2.5: ${predictions.over25Probability}% / ${predictions.under25Probability}%\n`;
              }
              if (predictions.bttsYesProbability > 0 || predictions.bttsNoProbability > 0) {
                message += `🥅 BTTS: Sim ${predictions.bttsYesProbability}% | Não ${predictions.bttsNoProbability}%\n`;
              }
            }
            if (match.analysisNotes && match.analysisNotes.length > 0) {
              message += `📝 PK: ${match.analysisNotes.slice(0, 2).join(' • ')}\n`;
            }

            message += `\n`;
          });
        });
      }
    }

    message += `\n💡 <b>Lembre-se:</b>\n`;
    message += `• Aposte com responsabilidade\n`;
    message += `• Nunca aposte mais do que pode perder\n`;
    message += `• Estas são apenas previsões baseadas em probabilidades\n\n`;
    message += `🔴 Lives: o bot monitoriza jogos em tempo real e envia alertas quentes via fluxo <i>live-betting</i>.\n`;
    message += `⚽ Boa sorte com as suas apostas!\n`;
    message += `🤖 Bot de Previsões Futebol`;

    logger?.info("📝 [SendPredictionsStep] Message formatted", { 
      messageLength: message.length 
    });

    // Send the message
    const result = await sendTelegramMessageTool.execute({
      context: { message },
      runtimeContext,
      mastra,
    });

    logger?.info("✅ [SendPredictionsStep] Completed successfully", { 
      messageId: result.messageId,
      success: result.success 
    });

    return {
      ...result,
      summary: {
        date: originalData.date,
        totalMatches: originalData.totalMatches,
        analyzedMatches: analysis.totalAnalyzed,
        highConfidenceMatches: analysis.highConfidenceCount,
        regionBreakdown: analysis.breakdownByRegion,
      },
    };
  },
});

// Create the workflow
export const footballPredictionsWorkflow = createWorkflow({
  id: "football-predictions-workflow",
  description: "Daily football predictions workflow that fetches matches, analyzes odds, and sends Telegram notifications",
  inputSchema: z.object({}),
  outputSchema: FinalResult,
})
  .then(fetchMatchesStep)
  .then(analyzeOddsStep)
  .then(sendPredictionsStep)
  .commit();