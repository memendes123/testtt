import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";

const analyzeMatchOdds = ({
  matches,
  logger,
}: {
  matches: any[];
  logger?: IMastraLogger;
}) => {
  logger?.info("🔧 [AnalyzeOddsAndMarkets] Starting analysis", { matchCount: matches.length });

  const analyzedMatches = matches.map((match) => {
    logger?.info("📝 [AnalyzeOddsAndMarkets] Analyzing match", { 
      homeTeam: match.teams.home.name, 
      awayTeam: match.teams.away.name 
    });

    const analysis = {
      ...match,
      predictions: {
        homeWinProbability: 0,
        drawProbability: 0,
        awayWinProbability: 0,
        over25Probability: 0,
        under25Probability: 0,
        bttsYesProbability: 0,
        bttsNoProbability: 0,
      },
      recommendedBets: [] as string[],
      confidence: "low" as "low" | "medium" | "high",
    };

    if (!match.odds || match.odds.length === 0) {
      logger?.warn("📝 [AnalyzeOddsAndMarkets] No odds available for match", { 
        fixtureId: match.fixtureId 
      });
      return analysis;
    }

    try {
      // Find different betting markets
      const matchWinnerBet = match.odds.find((bet: any) => bet.name === "Match Winner");
      const overUnderBet = match.odds.find((bet: any) => bet.name === "Goals Over/Under");
      const bttsBet = match.odds.find((bet: any) => bet.name === "Both Teams Score");

      // Convert odds to probabilities (probability = 1 / decimal_odds)
      if (matchWinnerBet && matchWinnerBet.values) {
        const homeOdd = parseFloat(matchWinnerBet.values.find((v: any) => v.value === "Home")?.odd || "0");
        const drawOdd = parseFloat(matchWinnerBet.values.find((v: any) => v.value === "Draw")?.odd || "0");
        const awayOdd = parseFloat(matchWinnerBet.values.find((v: any) => v.value === "Away")?.odd || "0");

        if (homeOdd > 0) analysis.predictions.homeWinProbability = Math.round((1 / homeOdd) * 100);
        if (drawOdd > 0) analysis.predictions.drawProbability = Math.round((1 / drawOdd) * 100);
        if (awayOdd > 0) analysis.predictions.awayWinProbability = Math.round((1 / awayOdd) * 100);

        logger?.info("📝 [AnalyzeOddsAndMarkets] 1X2 probabilities calculated", {
          home: analysis.predictions.homeWinProbability,
          draw: analysis.predictions.drawProbability,
          away: analysis.predictions.awayWinProbability
        });
      }

      // Over/Under 2.5 goals analysis
      if (overUnderBet && overUnderBet.values) {
        const over25Odd = parseFloat(overUnderBet.values.find((v: any) => v.value === "Over 2.5")?.odd || "0");
        const under25Odd = parseFloat(overUnderBet.values.find((v: any) => v.value === "Under 2.5")?.odd || "0");

        if (over25Odd > 0) analysis.predictions.over25Probability = Math.round((1 / over25Odd) * 100);
        if (under25Odd > 0) analysis.predictions.under25Probability = Math.round((1 / under25Odd) * 100);

        logger?.info("📝 [AnalyzeOddsAndMarkets] Over/Under 2.5 probabilities calculated", {
          over25: analysis.predictions.over25Probability,
          under25: analysis.predictions.under25Probability
        });
      }

      // Both Teams to Score (BTTS) analysis
      if (bttsBet && bttsBet.values) {
        const bttsYesOdd = parseFloat(bttsBet.values.find((v: any) => v.value === "Yes")?.odd || "0");
        const bttsNoOdd = parseFloat(bttsBet.values.find((v: any) => v.value === "No")?.odd || "0");

        if (bttsYesOdd > 0) analysis.predictions.bttsYesProbability = Math.round((1 / bttsYesOdd) * 100);
        if (bttsNoOdd > 0) analysis.predictions.bttsNoProbability = Math.round((1 / bttsNoOdd) * 100);

        logger?.info("📝 [AnalyzeOddsAndMarkets] BTTS probabilities calculated", {
          bttsYes: analysis.predictions.bttsYesProbability,
          bttsNo: analysis.predictions.bttsNoProbability
        });
      }

      // Generate recommendations based on probability analysis
      const recommendations = [];
      let totalConfidence = 0;

      // Strong favorite (high probability)
      const maxProbability = Math.max(
        analysis.predictions.homeWinProbability,
        analysis.predictions.awayWinProbability
      );
      
      if (maxProbability >= 70) {
        const favoriteTeam = analysis.predictions.homeWinProbability > analysis.predictions.awayWinProbability 
          ? match.teams.home.name 
          : match.teams.away.name;
        recommendations.push(`🏆 Forte favorito: ${favoriteTeam} (${maxProbability}%)`);
        totalConfidence += 3;
      } else if (maxProbability >= 55) {
        const favoriteTeam = analysis.predictions.homeWinProbability > analysis.predictions.awayWinProbability 
          ? match.teams.home.name 
          : match.teams.away.name;
        recommendations.push(`✅ Favorito: ${favoriteTeam} (${maxProbability}%)`);
        totalConfidence += 2;
      }

      // Over/Under 2.5 recommendations
      if (analysis.predictions.over25Probability >= 60) {
        recommendations.push(`⚽ Over 2.5 golos (${analysis.predictions.over25Probability}%)`);
        totalConfidence += 2;
      } else if (analysis.predictions.under25Probability >= 60) {
        recommendations.push(`🛡️ Under 2.5 golos (${analysis.predictions.under25Probability}%)`);
        totalConfidence += 2;
      }

      // BTTS recommendations
      if (analysis.predictions.bttsYesProbability >= 60) {
        recommendations.push(`🥅 Ambos marcam: SIM (${analysis.predictions.bttsYesProbability}%)`);
        totalConfidence += 1;
      } else if (analysis.predictions.bttsNoProbability >= 60) {
        recommendations.push(`🚫 Ambos marcam: NÃO (${analysis.predictions.bttsNoProbability}%)`);
        totalConfidence += 1;
      }

      analysis.recommendedBets = recommendations;
      
      // Determine overall confidence
      if (totalConfidence >= 5) {
        analysis.confidence = "high";
      } else if (totalConfidence >= 3) {
        analysis.confidence = "medium";
      } else {
        analysis.confidence = "low";
      }

      logger?.info("📝 [AnalyzeOddsAndMarkets] Analysis completed for match", {
        fixtureId: match.fixtureId,
        confidence: analysis.confidence,
        recommendationsCount: recommendations.length
      });

    } catch (error) {
      logger?.error("❌ [AnalyzeOddsAndMarkets] Error analyzing match", {
        error: error instanceof Error ? error.message : String(error),
        fixtureId: match.fixtureId
      });
    }

    return analysis;
  });

  // Sort matches by confidence and probability strength
  const sortedMatches = analyzedMatches.sort((a, b) => {
    const confidenceScore: Record<string, number> = { high: 3, medium: 2, low: 1 };
    const aScore = (confidenceScore[a.confidence] || 0) * 10 + a.recommendedBets.length;
    const bScore = (confidenceScore[b.confidence] || 0) * 10 + b.recommendedBets.length;
    return bScore - aScore;
  });

  logger?.info("✅ [AnalyzeOddsAndMarkets] Analysis completed successfully", { 
    totalMatches: analyzedMatches.length,
    highConfidenceMatches: sortedMatches.filter(m => m.confidence === "high").length
  });

  return {
    totalAnalyzed: analyzedMatches.length,
    bestMatches: sortedMatches.slice(0, 10), // Return top 10 best matches
    highConfidenceCount: sortedMatches.filter(m => m.confidence === "high").length,
    mediumConfidenceCount: sortedMatches.filter(m => m.confidence === "medium").length,
  };
};

export const analyzeOddsAndMarketsTool = createTool({
  id: "analyze-odds-and-markets",
  description: "Converts odds to percentages and analyzes betting markets (1X2, Over/Under 2.5, BTTS) to generate betting recommendations",
  inputSchema: z.object({
    matches: z.array(z.any()).describe("Array of football matches with odds data"),
  }),
  outputSchema: z.object({
    totalAnalyzed: z.number(),
    bestMatches: z.array(z.any()),
    highConfidenceCount: z.number(),
    mediumConfidenceCount: z.number(),
  }),
  execute: async ({ context: { matches }, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [AnalyzeOddsAndMarkets] Starting execution with params", { 
      matchCount: matches.length 
    });
    
    return analyzeMatchOdds({ matches, logger });
  },
});