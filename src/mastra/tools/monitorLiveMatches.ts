import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";

import { identifyCompetition, isCompetitionSupported, REGION_LABEL, REGION_ORDER } from "../constants/competitions";

const monitorLiveMatchesFromAPI = async ({
  logger,
}: {
  logger?: IMastraLogger;
}) => {
  logger?.info("🔧 [MonitorLiveMatches] Starting live match monitoring");

  const apiKey = process.env.FOOTBALL_API_KEY;
  if (!apiKey) {
    throw new Error("FOOTBALL_API_KEY environment variable is required");
  }

  try {
    logger?.info("📝 [MonitorLiveMatches] Fetching live fixtures for supported competitions");

    // Fetch live fixtures (status: 1H, 2H, HT, ET, P, etc.)
    const liveResponse = await fetch(
      `https://v3.football.api-sports.io/fixtures?live=all`,
      {
        headers: {
          "X-RapidAPI-Key": apiKey,
          "X-RapidAPI-Host": "v3.football.api-sports.io",
        },
      }
    );

    if (!liveResponse.ok) {
      throw new Error(`API request failed: ${liveResponse.status} ${liveResponse.statusText}`);
    }

    const liveData = await liveResponse.json();
    const totalFixtures = liveData.response?.length || 0;
    logger?.info("📝 [MonitorLiveMatches] Received live fixtures data", {
      liveMatchCount: totalFixtures,
    });

    const supportedFixtures = (liveData.response || []).filter((fixture: any) => isCompetitionSupported(fixture.league));

    logger?.info("📝 [MonitorLiveMatches] Filtered live fixtures for supported competitions", {
      totalSupported: supportedFixtures.length,
    });

    const MAX_LIVE_FIXTURES = 120;
    const fixturesToProcess = supportedFixtures.slice(0, MAX_LIVE_FIXTURES);

    if (supportedFixtures.length > MAX_LIVE_FIXTURES) {
      logger?.warn("📝 [MonitorLiveMatches] Limiting live fixtures due to processing cap", {
        cap: MAX_LIVE_FIXTURES,
        skipped: supportedFixtures.length - MAX_LIVE_FIXTURES,
      });
    }

    const liveMatches: any[] = [];
    const regionCounters: Record<string, { total: number; high: number; medium: number }> = {};
    REGION_ORDER.forEach((region) => {
      regionCounters[region] = { total: 0, high: 0, medium: 0 };
    });

    // Process each live match
    for (const fixture of fixturesToProcess) {
      try {
        logger?.info("📝 [MonitorLiveMatches] Processing live match", {
          homeTeam: fixture.teams.home.name,
          awayTeam: fixture.teams.away.name,
          status: fixture.fixture.status.short,
          elapsed: fixture.fixture.status.elapsed
        });

        const competition = identifyCompetition(fixture.league);
        if (!competition) {
          logger?.warn("📝 [MonitorLiveMatches] Competition not supported after filtering", {
            leagueName: fixture.league?.name,
            leagueId: fixture.league?.id,
            country: fixture.league?.country,
          });
          continue;
        }

        // Get detailed match statistics
        const statsResponse = await fetch(
          `https://v3.football.api-sports.io/fixtures/statistics?fixture=${fixture.fixture.id}`,
          {
            headers: {
              "X-RapidAPI-Key": apiKey,
              "X-RapidAPI-Host": "v3.football.api-sports.io",
            },
          }
        );

        let statistics = null;
        if (statsResponse.ok) {
          const statsData = await statsResponse.json();
          statistics = statsData.response || null;
        }

        // Get live events (goals, cards, substitutions)
        const eventsResponse = await fetch(
          `https://v3.football.api-sports.io/fixtures/events?fixture=${fixture.fixture.id}`,
          {
            headers: {
              "X-RapidAPI-Key": apiKey,
              "X-RapidAPI-Host": "v3.football.api-sports.io",
            },
          }
        );

        let events = [];
        if (eventsResponse.ok) {
          const eventsData = await eventsResponse.json();
          events = eventsData.response || [];
        }

        // Calculate danger level based on stats and recent events
        let dangerLevel = "low";
        let dangerIndicators = [];

        if (statistics && statistics.length >= 2) {
          const homeStats = statistics[0]?.statistics || [];
          const awayStats = statistics[1]?.statistics || [];

          // Get key statistics
          const homeShotsOnTarget = parseInt(homeStats.find((s: any) => s.type === "Shots on Goal")?.value || "0");
          const awayShotsOnTarget = parseInt(awayStats.find((s: any) => s.type === "Shots on Goal")?.value || "0");
          const homeCorners = parseInt(homeStats.find((s: any) => s.type === "Corner Kicks")?.value || "0");
          const awayCorners = parseInt(awayStats.find((s: any) => s.type === "Corner Kicks")?.value || "0");
          const homePossession = parseInt(homeStats.find((s: any) => s.type === "Ball Possession")?.value?.replace('%', '') || "0");

          logger?.info("📝 [MonitorLiveMatches] Match statistics", {
            homeShotsOnTarget,
            awayShotsOnTarget,
            homeCorners,
            awayCorners,
            homePossession
          });

          // Danger level calculation
          const totalShotsOnTarget = homeShotsOnTarget + awayShotsOnTarget;
          const totalCorners = homeCorners + awayCorners;
          const isHighPossessionGap = Math.abs(homePossession - 50) > 20;

          if (totalShotsOnTarget >= 6 || totalCorners >= 8) {
            dangerLevel = "high";
            dangerIndicators.push(`${totalShotsOnTarget} remates à baliza`);
            dangerIndicators.push(`${totalCorners} cantos`);
          } else if (totalShotsOnTarget >= 3 || totalCorners >= 5 || isHighPossessionGap) {
            dangerLevel = "medium";
            if (totalShotsOnTarget >= 3) dangerIndicators.push(`${totalShotsOnTarget} remates à baliza`);
            if (totalCorners >= 5) dangerIndicators.push(`${totalCorners} cantos`);
            if (isHighPossessionGap) dangerIndicators.push(`Posse desequilibrada: ${homePossession}%-${100-homePossession}%`);
          }
        }

        // Check for recent goal events (last 10 minutes)
        const recentGoals = events.filter((event: any) => 
          event.type === "Goal" && 
          fixture.fixture.status.elapsed && 
          event.time.elapsed >= (fixture.fixture.status.elapsed - 10)
        );

        if (recentGoals.length > 0) {
          dangerLevel = "high";
          dangerIndicators.push(`${recentGoals.length} golos recentes`);
        }

        const match = {
          fixtureId: fixture.fixture.id,
          league: {
            name: fixture.league.name,
            country: fixture.league.country,
          },
          competition: {
            key: competition.key,
            name: competition.displayName,
            region: competition.region,
            type: competition.type,
            country: competition.country,
          },
          teams: {
            home: {
              name: fixture.teams.home.name,
              score: fixture.goals.home,
            },
            away: {
              name: fixture.teams.away.name,
              score: fixture.goals.away,
            },
          },
          status: {
            long: fixture.fixture.status.long,
            short: fixture.fixture.status.short,
            elapsed: fixture.fixture.status.elapsed,
          },
          dangerLevel,
          dangerIndicators,
          totalGoals: (fixture.goals.home || 0) + (fixture.goals.away || 0),
          statistics,
          recentEvents: events.slice(-5), // Last 5 events
          lastUpdated: new Date().toISOString(),
        };

        liveMatches.push(match);

        const counters = regionCounters[competition.region];
        counters.total += 1;
        if (match.dangerLevel === "high") {
          counters.high += 1;
        } else if (match.dangerLevel === "medium") {
          counters.medium += 1;
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (error) {
        logger?.warn("📝 [MonitorLiveMatches] Error processing match", { 
          error: error instanceof Error ? error.message : String(error),
          fixtureId: fixture.fixture.id 
        });
        continue;
      }
    }

    logger?.info("✅ [MonitorLiveMatches] Completed successfully", {
      totalLiveMatches: liveMatches.length,
      highDangerMatches: liveMatches.filter(m => m.dangerLevel === "high").length,
      perRegion: REGION_ORDER.map((region) => ({
        region,
        label: REGION_LABEL[region],
        total: regionCounters[region].total,
        high: regionCounters[region].high,
        medium: regionCounters[region].medium,
      })),
    });

    return {
      totalLiveMatches: liveMatches.length,
      highDangerCount: liveMatches.filter(m => m.dangerLevel === "high").length,
      mediumDangerCount: liveMatches.filter(m => m.dangerLevel === "medium").length,
      matches: liveMatches,
      lastUpdated: new Date().toISOString(),
      metadata: {
        totalFixtures,
        supportedFixtures: supportedFixtures.length,
        processedFixtures: fixturesToProcess.length,
        perRegion: REGION_ORDER.map((region) => ({
          region,
          label: REGION_LABEL[region],
          total: regionCounters[region].total,
          high: regionCounters[region].high,
          medium: regionCounters[region].medium,
        })),
      },
    };

  } catch (error) {
    logger?.error("❌ [MonitorLiveMatches] Error occurred", { 
      error: error instanceof Error ? error.message : String(error) 
    });
    throw error;
  }
};

export const monitorLiveMatchesTool = createTool({
  id: "monitor-live-matches",
  description: "Monitors live football matches across supported global competitions for betting opportunities and goal events",
  inputSchema: z.object({}),
  outputSchema: z.object({
    totalLiveMatches: z.number(),
    highDangerCount: z.number(),
    mediumDangerCount: z.number(),
    matches: z.array(z.object({
      fixtureId: z.number(),
      league: z.object({
        name: z.string(),
        country: z.string(),
      }),
      competition: z.object({
        key: z.string(),
        name: z.string(),
        region: z.enum(["Europe", "South America", "North America", "Asia", "Africa"]),
        type: z.enum(["league", "cup", "supercup"]),
        country: z.string(),
      }),
      teams: z.object({
        home: z.object({
          name: z.string(),
          score: z.number().nullable(),
        }),
        away: z.object({
          name: z.string(),
          score: z.number().nullable(),
        }),
      }),
      status: z.object({
        long: z.string(),
        short: z.string(),
        elapsed: z.number().nullable(),
      }),
      dangerLevel: z.enum(["low", "medium", "high"]),
      dangerIndicators: z.array(z.string()),
      totalGoals: z.number(),
      statistics: z.any().nullable(),
      recentEvents: z.array(z.any()),
      lastUpdated: z.string(),
    })),
    lastUpdated: z.string(),
    metadata: z.object({
      totalFixtures: z.number(),
      supportedFixtures: z.number(),
      processedFixtures: z.number(),
      perRegion: z.array(
        z.object({
          region: z.enum(["Europe", "South America", "North America", "Asia", "Africa"]),
          label: z.string(),
          total: z.number(),
          high: z.number(),
          medium: z.number(),
        }),
      ),
    }),
  }),
  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [MonitorLiveMatches] Starting execution");
    
    return await monitorLiveMatchesFromAPI({ logger });
  },
});