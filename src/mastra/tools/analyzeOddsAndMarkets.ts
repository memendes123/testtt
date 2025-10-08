import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";

import {
  COMPETITION_REGIONS,
  REGION_LABEL,
  REGION_ORDER,
} from "../constants/competitions";
import type { CompetitionRegion } from "../constants/competitions";

type AnalyzedMatch = any & {
  competition?: {
    region?: string;
  };
  confidence: "low" | "medium" | "high";
  recommendedBets: string[];
  analysisNotes?: string[];
};

type TeamFormSummary = {
  currentStreak?: { type?: string; count?: number } | null;
  recentRecord?: string;
  avgGoalsFor?: number;
  avgGoalsAgainst?: number;
  goalDifferenceAvg?: number;
  winRate?: number;
  drawRate?: number;
  lossRate?: number;
};

type HeadToHeadSummary = {
  homeWins?: number;
  awayWins?: number;
  draws?: number;
  avgGoalsTotal?: number;
} | null;

const normalizeMarketValue = (value: unknown): string => {
  if (value === undefined || value === null) {
    return "";
  }

  return value
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[,]/g, ".")
    .replace(/[()]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
};

const HOME_LABELS = new Set([
  "home",
  "1",
  "home team",
  "team 1",
  "1 home",
]);

const DRAW_LABELS = new Set([
  "draw",
  "x",
  "empate",
]);

const AWAY_LABELS = new Set([
  "away",
  "2",
  "away team",
  "team 2",
  "2 away",
]);

const YES_LABELS = new Set([
  "yes",
  "sim",
  "y",
  "s",
]);

const NO_LABELS = new Set([
  "no",
  "nao",
  "n",
]);

const MARKET_ALIASES = new Map<string, Set<string>>([
  [
    "match_winner",
    new Set(["match winner", "1x2", "full time result", "match result", "result", "win-draw-win"]),
  ],
  [
    "goals_over_under",
    new Set(["goals over/under", "over/under", "goals", "goals o/u", "total goals"]),
  ],
  [
    "both_teams_score",
    new Set(["both teams score", "both teams to score", "btts", "gg/ng", "goal goal"]),
  ],
]);

const normalizeMarketName = (value: unknown): string => {
  const normalized = normalizeMarketValue(value);
  if (!normalized) return "";
  for (const [key, aliases] of MARKET_ALIASES.entries()) {
    if (aliases.has(normalized)) return key;
  }
  return normalized;
};

const isOver25Label = (value: unknown): boolean => {
  const normalized = normalizeMarketValue(value);
  if (!normalized) return false;

  if (normalized.includes("over") || normalized.includes("mais de")) {
    return normalized.includes("2.5") || normalized.includes("25");
  }

  return false;
};

const isUnder25Label = (value: unknown): boolean => {
  const normalized = normalizeMarketValue(value);
  if (!normalized) return false;

  if (normalized.includes("under") || normalized.includes("menos de")) {
    return normalized.includes("2.5") || normalized.includes("25");
  }

  return false;
};

const analyzeMatchOdds = ({
  matches,
  logger,
}: {
  matches: any[];
  logger?: IMastraLogger;
}) => {
  logger?.info("🔧 [AnalyzeOddsAndMarkets] Starting analysis", { matchCount: matches.length });

  const analyzedMatches: AnalyzedMatch[] = matches.map((match) => {
    logger?.info("📝 [AnalyzeOddsAndMarkets] Analyzing match", {
      homeTeam: match.teams.home.name,
      awayTeam: match.teams.away.name
    });

    const analysis: AnalyzedMatch = {
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
      analysisNotes: [] as string[],
    };

    if (!match.odds || match.odds.length === 0) {
      logger?.warn("📝 [AnalyzeOddsAndMarkets] No odds available for match", {
        fixtureId: match.fixtureId
      });
      return analysis;
    }

    try {
      const marketMap = new Map<string, any[]>();
      const forebet = match.forebet ?? null;
      let forebetUsed = false;
      for (const market of match.odds) {
        const key = normalizeMarketName(market?.name);
        if (!key) continue;
        const values = Array.isArray(market?.values) ? market.values : [];
        if (!marketMap.has(key) || !(marketMap.get(key)?.length > 0)) {
          marketMap.set(key, values);
        }
      }

      // Find different betting markets
      const matchWinnerBet = marketMap.get("match_winner");
      const overUnderBet = marketMap.get("goals_over_under");
      const bttsBet = marketMap.get("both_teams_score");

      // Convert odds to probabilities (probability = 1 / decimal_odds)
      if (matchWinnerBet) {
        const homeEntry = matchWinnerBet.find((v: any) => HOME_LABELS.has(normalizeMarketValue(v.value)));
        const drawEntry = matchWinnerBet.find((v: any) => DRAW_LABELS.has(normalizeMarketValue(v.value)));
        const awayEntry = matchWinnerBet.find((v: any) => AWAY_LABELS.has(normalizeMarketValue(v.value)));

        const homeOdd = parseFloat(homeEntry?.odd ?? "0");
        const drawOdd = parseFloat(drawEntry?.odd ?? "0");
        const awayOdd = parseFloat(awayEntry?.odd ?? "0");

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
      if (overUnderBet) {
        const overEntry = overUnderBet.find((v: any) => isOver25Label(v.value));
        const underEntry = overUnderBet.find((v: any) => isUnder25Label(v.value));

        const over25Odd = parseFloat(overEntry?.odd ?? "0");
        const under25Odd = parseFloat(underEntry?.odd ?? "0");

        if (over25Odd > 0) analysis.predictions.over25Probability = Math.round((1 / over25Odd) * 100);
        if (under25Odd > 0) analysis.predictions.under25Probability = Math.round((1 / under25Odd) * 100);

        logger?.info("📝 [AnalyzeOddsAndMarkets] Over/Under 2.5 probabilities calculated", {
          over25: analysis.predictions.over25Probability,
          under25: analysis.predictions.under25Probability
        });
      }

      // Both Teams to Score (BTTS) analysis
      if (bttsBet) {
        const yesEntry = bttsBet.find((v: any) => YES_LABELS.has(normalizeMarketValue(v.value)));
        const noEntry = bttsBet.find((v: any) => NO_LABELS.has(normalizeMarketValue(v.value)));

        const bttsYesOdd = parseFloat(yesEntry?.odd ?? "0");
        const bttsNoOdd = parseFloat(noEntry?.odd ?? "0");

        if (bttsYesOdd > 0) analysis.predictions.bttsYesProbability = Math.round((1 / bttsYesOdd) * 100);
        if (bttsNoOdd > 0) analysis.predictions.bttsNoProbability = Math.round((1 / bttsNoOdd) * 100);

        logger?.info("📝 [AnalyzeOddsAndMarkets] BTTS probabilities calculated", {
          bttsYes: analysis.predictions.bttsYesProbability,
          bttsNo: analysis.predictions.bttsNoProbability
        });
      }

      if (forebet) {
        const applyForebet = (
          sourceKey: string,
          targetKey: keyof typeof analysis.predictions,
        ) => {
          const current = analysis.predictions[targetKey];
          if (current && current > 0) return;
          const raw = Number(forebet[sourceKey as keyof typeof forebet]);
          if (Number.isFinite(raw) && raw > 0) {
            analysis.predictions[targetKey] = Math.max(0, Math.min(100, Math.round(raw)));
            forebetUsed = true;
          }
        };

        applyForebet("homeWinProbability", "homeWinProbability");
        applyForebet("drawProbability", "drawProbability");
        applyForebet("awayWinProbability", "awayWinProbability");
        applyForebet("over25Probability", "over25Probability");
        applyForebet("under25Probability", "under25Probability");
        applyForebet("bttsYesProbability", "bttsYesProbability");
        applyForebet("bttsNoProbability", "bttsNoProbability");
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

      const notes: string[] = [];
      let qualitativeBoost = 0;

      const homeForm = (match.form?.home ?? null) as TeamFormSummary | null;
      const awayForm = (match.form?.away ?? null) as TeamFormSummary | null;
      const headToHead = (match.form?.headToHead ?? null) as HeadToHeadSummary;

      const summarizeRecord = (record?: string) => (record ?? "").slice(0, 5);

      if (homeForm?.currentStreak?.type === "win" && (homeForm.currentStreak.count ?? 0) >= 3) {
        notes.push(
          `Casa com ${homeForm.currentStreak.count} vitórias seguidas (${summarizeRecord(homeForm.recentRecord)})`,
        );
        qualitativeBoost += 1;
      }

      if (awayForm?.currentStreak?.type === "loss" && (awayForm.currentStreak.count ?? 0) >= 2) {
        notes.push(
          `Visitante sem vencer há ${awayForm.currentStreak.count} jogos (${summarizeRecord(awayForm.recentRecord)})`,
        );
        qualitativeBoost += 1;
      }

      const avgAttack = (homeForm?.avgGoalsFor ?? 0) + (awayForm?.avgGoalsFor ?? 0);
      if (avgAttack >= 3.2) {
        notes.push("Tendência de muitos golos (médias ofensivas altas nas últimas partidas)");
      } else if (avgAttack <= 2.0) {
        notes.push("Tendência de poucos golos nos últimos jogos das equipas");
      }

      if ((headToHead?.homeWins ?? 0) >= 3) {
        notes.push("Histórico recente favorável ao mandante no confronto direto");
        qualitativeBoost += 1;
      }

      if ((headToHead?.avgGoalsTotal ?? 0) >= 3) {
        notes.push("Confrontos diretos recentes com média superior a 3 golos");
      }

      if (forebetUsed) {
        notes.push("Probabilidades 1X2 complementadas com dados da Forebet");
      }

      analysis.analysisNotes = notes.slice(0, 3);

      const formCount = (homeForm ? 1 : 0) + (awayForm ? 1 : 0) || 1;
      const drawRate = ((homeForm?.drawRate ?? 0) + (awayForm?.drawRate ?? 0)) / formCount;
      const shouldBackfillProbabilities =
        analysis.predictions.homeWinProbability === 0 &&
        analysis.predictions.awayWinProbability === 0 &&
        analysis.predictions.drawProbability === 0 &&
        (homeForm || awayForm);

      if (shouldBackfillProbabilities) {
        const drawProbability = Math.round(Math.min(drawRate, 0.45) * 100);
        const homeScore =
          (homeForm?.winRate ?? 0) +
          Math.max(homeForm?.goalDifferenceAvg ?? 0, 0) +
          (awayForm?.lossRate ?? 0) * 0.6;
        const awayScore =
          (awayForm?.winRate ?? 0) +
          Math.max(awayForm?.goalDifferenceAvg ?? 0, 0) +
          (homeForm?.lossRate ?? 0) * 0.6;

        const total = homeScore + awayScore;
        const available = Math.max(0, 100 - drawProbability);

        if (total > 0) {
          analysis.predictions.homeWinProbability = Math.round((homeScore / total) * available);
          analysis.predictions.awayWinProbability = Math.max(
            0,
            available - analysis.predictions.homeWinProbability,
          );
        } else {
          analysis.predictions.homeWinProbability = Math.round(available / 2);
          analysis.predictions.awayWinProbability = available - analysis.predictions.homeWinProbability;
        }

        analysis.predictions.drawProbability = drawProbability;
      }

      totalConfidence += qualitativeBoost;
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
  const confidenceScore: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const computeScore = (match: AnalyzedMatch) => {
    const predictions = match.predictions ?? {};
    const maxProbability = Math.max(
      Number(predictions.homeWinProbability ?? 0),
      Number(predictions.drawProbability ?? 0),
      Number(predictions.awayWinProbability ?? 0),
    );
    return (
      (confidenceScore[match.confidence] || 0) * 1000 +
      (match.recommendedBets?.length || 0) * 10 +
      maxProbability
    );
  };

  const sortedMatches = analyzedMatches.sort((a, b) => computeScore(b) - computeScore(a));

  const regionBuckets: Record<string, AnalyzedMatch[]> = {};
  REGION_ORDER.forEach((region) => {
    regionBuckets[region] = [];
  });

  analyzedMatches.forEach((match) => {
    const region = match.competition?.region as CompetitionRegion | undefined;
    if (!region) {
      return;
    }

    if (!regionBuckets[region]) {
      regionBuckets[region] = [];
    }

    regionBuckets[region].push(match);
  });

  const orderedRegions = Array.from(
    new Set<CompetitionRegion>([...REGION_ORDER, ...(Object.keys(regionBuckets) as CompetitionRegion[])]),
  );

  const breakdownByRegion = orderedRegions.map((region) => {
    const matchesForRegion = regionBuckets[region];
    return {
      region,
      label: REGION_LABEL[region],
      total: matchesForRegion.length,
      highConfidence: matchesForRegion.filter((match) => match.confidence === "high").length,
      mediumConfidence: matchesForRegion.filter((match) => match.confidence === "medium").length,
    };
  });

  const bestMatchesByRegion = orderedRegions.map((region) => {
    const matchesForRegion = regionBuckets[region];
    const sortedRegionMatches = matchesForRegion.sort((a, b) => computeScore(b) - computeScore(a));
    return {
      region,
      label: REGION_LABEL[region],
      matches: sortedRegionMatches.slice(0, 5),
    };
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
    breakdownByRegion,
    bestMatchesByRegion,
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
    breakdownByRegion: z.array(
      z.object({
        region: z.enum(COMPETITION_REGIONS),
        label: z.string(),
        total: z.number(),
        highConfidence: z.number(),
        mediumConfidence: z.number(),
      }),
    ),
    bestMatchesByRegion: z.array(
      z.object({
        region: z.enum(COMPETITION_REGIONS),
        label: z.string(),
        matches: z.array(z.any()),
      }),
    ),
  }),
  execute: async ({ context: { matches }, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [AnalyzeOddsAndMarkets] Starting execution with params", { 
      matchCount: matches.length 
    });
    
    return analyzeMatchOdds({ matches, logger });
  },
});