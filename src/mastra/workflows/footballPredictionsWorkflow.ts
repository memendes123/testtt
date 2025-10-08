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
  topMatches: z.array(z.any()),
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
    allMatches: z.array(z.any()),
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

    const escapeHtml = (value: unknown) =>
      value === null || value === undefined
        ? ''
        : String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const confidenceLabel = (confidence?: string | null) => {
      if (confidence === 'high') return '🔥 Alta';
      if (confidence === 'medium') return '⚡ Média';
      if (confidence === 'low') return '💡 Baixa';
      return confidence ? escapeHtml(confidence) : null;
    };

    const formatProbabilities = (predictions: any) => {
      const lines: string[] = [];
      if (!predictions) return lines;
      const home = Number(predictions.homeWinProbability || 0);
      const draw = Number(predictions.drawProbability || 0);
      const away = Number(predictions.awayWinProbability || 0);
      if (home || draw || away) {
        lines.push(`↳ 📈 1X2: Casa ${home}% | Empate ${draw}% | Fora ${away}%`);
      }
      const over25 = Number(predictions.over25Probability || 0);
      const under25 = Number(predictions.under25Probability || 0);
      if (over25 || under25) {
        lines.push(`↳ ⚽ Linhas 2.5: Over ${over25}% | Under ${under25}%`);
      }
      const bttsYes = Number(predictions.bttsYesProbability || 0);
      const bttsNo = Number(predictions.bttsNoProbability || 0);
      if (bttsYes || bttsNo) {
        lines.push(`↳ 🤝 Ambos marcam: Sim ${bttsYes}% | Não ${bttsNo}%`);
      }
      return lines;
    };

    const escapeJoin = (values: unknown[], separator = ' | ') =>
      values
        .filter((value) => value !== undefined && value !== null)
        .map((value) => escapeHtml(String(value)))
        .join(separator);

    const formatMatchDetails = (match: any, prefix: string) => {
      const teams = match.teams || {};
      const home = escapeHtml(teams.home?.name || 'Casa');
      const away = escapeHtml(teams.away?.name || 'Fora');
      const competitionLabel = match.competition?.name || match.league?.name || '';
      const timeLabel = match.time ? `(${escapeHtml(match.time)})` : '';

      const header = [prefix, `<b>${home} vs ${away}</b>`, timeLabel, competitionLabel ? `— ${escapeHtml(competitionLabel)}` : '']
        .filter(Boolean)
        .join(' ');

      const lines: string[] = [header];
      const confidence = confidenceLabel(match.confidence);
      if (confidence) {
        lines.push(`↳ Confiança: ${confidence}`);
      }
      if (match.recommendedBets?.length) {
        lines.push(`↳ 🎯 ${escapeJoin(match.recommendedBets)}`);
      }
      lines.push(...formatProbabilities(match.predictions));
      if (match.analysisNotes?.length) {
        lines.push(`↳ 📝 ${escapeJoin(match.analysisNotes.slice(0, 2), ' • ')}`);
      }
      return lines;
    };

    const date = new Date(originalData.date).toLocaleDateString('pt-PT', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });

    const lines: string[] = [];
    lines.push(`🏆 <b>PREVISÕES FUTEBOL - ${date}</b>`, '');
    lines.push('📊 <b>Resumo Global:</b>');
    lines.push(`• ${originalData.totalMatches} jogos elegíveis nas competições suportadas`);
    lines.push(`• ${analysis.totalAnalyzed} jogos com odds válidas analisados`);
    lines.push(`• ${analysis.highConfidenceCount} jogos de alta confiança | ${analysis.mediumConfidenceCount} de média confiança`, '');

    const activeRegions = analysis.breakdownByRegion.filter((region) => region.total > 0);
    if (activeRegions.length) {
      lines.push('🌍 <b>Distribuição por Região:</b>');
      activeRegions.forEach((region) => {
        lines.push(`• ${escapeHtml(region.label)}: ${region.total} jogos (${region.highConfidence} alta | ${region.mediumConfidence} média)`);
      });
      lines.push('');
    }

    const highlights = analysis.bestMatches.slice(0, Math.min(5, analysis.bestMatches.length));
    if (highlights.length) {
      lines.push(`🔥 <b>TOP GLOBAL (${highlights.length})</b>`);
      highlights.forEach((match: any) => {
        const emoji = match.confidence === 'high' ? '🔥' : match.confidence === 'medium' ? '⚡' : '💡';
        const formattedLines = formatMatchDetails(match, emoji);
        if (match.time) {
          const league = match.competition?.name || match.league?.name || 'Horário a definir';
          formattedLines.splice(1, 0, `↳ ⏰ ${escapeHtml(match.time)} | 🏆 ${escapeHtml(league)}`);
        }
        lines.push(...formattedLines, '');
      });
    } else {
      lines.push('😔 <b>Não há jogos com odds interessantes hoje.</b>');
      lines.push('Voltamos amanhã com mais análises!', '');
      lines.push('📈 Tip: Verifique os jogos ao vivo durante o dia para oportunidades em tempo real.');
    }

    const detailedRegions = analysis.bestMatchesByRegion.filter((region) => region.matches.length > 0);
    if (detailedRegions.length) {
      lines.push('🗺️ <b>Lista completa por região/competição:</b>');
      detailedRegions.forEach((region) => {
        lines.push(`📍 <b>${escapeHtml(region.label)}</b>`);
        region.matches.forEach((match: any) => {
          lines.push(...formatMatchDetails(match, '•'), '');
        });
      });
      if (lines[lines.length - 1] === '') {
        lines.pop();
      }
    }

    const message = lines.join('\n');

    const reminderLines = [
      '',
      '💡 <b>Lembre-se:</b>',
      '• Aposte com responsabilidade',
      '• Nunca aposte mais do que pode perder',
      '• Estas são apenas previsões baseadas em probabilidades',
      '',
      '🔴 Lives: o bot monitoriza jogos em tempo real e envia alertas quentes via fluxo <i>live-betting</i>.',
      '⚽ Boa sorte com as suas apostas!',
      '🤖 Bot de Previsões Futebol'
    ];

    const finalMessage = `${message}\n${reminderLines.join('\n')}`;

    logger?.info("📝 [SendPredictionsStep] Message formatted", {
      messageLength: finalMessage.length
    });

    // Send the message
    const result = await sendTelegramMessageTool.execute({
      context: { message: finalMessage },
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