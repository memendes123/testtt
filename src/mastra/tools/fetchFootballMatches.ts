import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";

import { identifyCompetition, isCompetitionSupported, REGION_LABEL, REGION_ORDER } from "../constants/competitions";

const fetchFootballMatchesFromAPI = async ({
  date,
  logger,
}: {
  date: string;
  logger?: IMastraLogger;
}) => {
  logger?.info("🔧 [FetchFootballMatches] Starting execution", { date });

  const apiKey = process.env.FOOTBALL_API_KEY;
  if (!apiKey) {
    throw new Error("FOOTBALL_API_KEY environment variable is required");
  }

  try {
    logger?.info("📝 [FetchFootballMatches] Fetching fixtures for supported competitions", { date });

    const fixturesResponse = await fetch(
      `https://v3.football.api-sports.io/fixtures?date=${date}&status=NS`,
      {
        headers: {
          "X-RapidAPI-Key": apiKey,
          "X-RapidAPI-Host": "v3.football.api-sports.io",
        },
      }
    );

    if (!fixturesResponse.ok) {
      throw new Error(`API request failed: ${fixturesResponse.status} ${fixturesResponse.statusText}`);
    }

    const fixturesData = await fixturesResponse.json();
    const totalFixtures = fixturesData.response?.length || 0;
    logger?.info("📝 [FetchFootballMatches] Received fixtures data", {
      totalFixtures,
    });

    const supportedFixtures = (fixturesData.response || []).filter((fixture: any) => {
      if (!isCompetitionSupported(fixture.league)) {
        return false;
      }

      return true;
    });

    logger?.info("📝 [FetchFootballMatches] Filtered fixtures for supported competitions", {
      totalSupported: supportedFixtures.length,
    });

    const MAX_FIXTURES_TO_PROCESS = 120;
    const fixturesToProcess = supportedFixtures
      .sort((a: any, b: any) => (a.fixture.timestamp || 0) - (b.fixture.timestamp || 0))
      .slice(0, MAX_FIXTURES_TO_PROCESS);

    if (supportedFixtures.length > MAX_FIXTURES_TO_PROCESS) {
      logger?.warn("📝 [FetchFootballMatches] Limiting fixtures due to processing cap", {
        cap: MAX_FIXTURES_TO_PROCESS,
        skipped: supportedFixtures.length - MAX_FIXTURES_TO_PROCESS,
      });
    }

    const matches: any[] = [];

    const regionCounters: Record<string, { total: number }> = {};
    REGION_ORDER.forEach((region) => {
      regionCounters[region] = { total: 0 };
    });

    // Process each match and fetch odds
    for (const fixture of fixturesToProcess) {
      try {
        logger?.info("📝 [FetchFootballMatches] Processing match", {
          homeTeam: fixture.teams.home.name,
          awayTeam: fixture.teams.away.name
        });

        const competition = identifyCompetition(fixture.league);
        if (!competition) {
          logger?.warn("📝 [FetchFootballMatches] Competition not supported after filtering", {
            leagueName: fixture.league?.name,
            leagueId: fixture.league?.id,
            country: fixture.league?.country,
          });
          continue;
        }

        // Fetch odds for this specific match
        const oddsResponse = await fetch(
          `https://v3.football.api-sports.io/odds?fixture=${fixture.fixture.id}&bookmaker=6`, // Bet365
          {
            headers: {
              "X-RapidAPI-Key": apiKey,
              "X-RapidAPI-Host": "v3.football.api-sports.io",
            },
          }
        );

        let odds = null;
        if (oddsResponse.ok) {
          const oddsData = await oddsResponse.json();
          if (oddsData.response && oddsData.response.length > 0) {
            odds = oddsData.response[0].bookmakers[0]?.bets || [];
            logger?.info("📝 [FetchFootballMatches] Retrieved odds", { 
              fixtureId: fixture.fixture.id,
              oddsCount: odds.length 
            });
          }
        } else {
          logger?.warn("📝 [FetchFootballMatches] Could not fetch odds", { 
            fixtureId: fixture.fixture.id,
            status: oddsResponse.status 
          });
        }

        matches.push({
          fixtureId: fixture.fixture.id,
          date: fixture.fixture.date,
          time: new Date(fixture.fixture.date).toLocaleTimeString('pt-PT', {
            hour: '2-digit',
            minute: '2-digit'
          }),
          league: {
            name: fixture.league.name,
            country: fixture.league.country,
            logo: fixture.league.logo,
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
              logo: fixture.teams.home.logo,
            },
            away: {
              name: fixture.teams.away.name,
              logo: fixture.teams.away.logo,
            },
          },
          venue: fixture.fixture.venue?.name || "TBD",
          odds: odds,
        });

        regionCounters[competition.region].total += 1;

        // Add small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        logger?.warn("📝 [FetchFootballMatches] Error processing match", { 
          error: error instanceof Error ? error.message : String(error),
          fixtureId: fixture.fixture.id 
        });
        continue;
      }
    }

    logger?.info("✅ [FetchFootballMatches] Completed successfully", {
      totalMatches: matches.length,
      perRegion: REGION_ORDER.map((region) => ({
        region,
        label: REGION_LABEL[region],
        total: regionCounters[region].total,
      })),
    });

    return {
      date,
      totalMatches: matches.length,
      matches,
      metadata: {
        totalFixtures,
        supportedFixtures: supportedFixtures.length,
        processedFixtures: fixturesToProcess.length,
        perRegion: REGION_ORDER.map((region) => ({
          region,
          label: REGION_LABEL[region],
          total: regionCounters[region].total,
        })),
      },
    };

  } catch (error) {
    logger?.error("❌ [FetchFootballMatches] Error occurred", { 
      error: error instanceof Error ? error.message : String(error) 
    });
    throw error;
  }
};

export const fetchFootballMatchesTool = createTool({
  id: "fetch-football-matches",
  description: "Fetches daily football fixtures and odds for all supported global competitions",
  inputSchema: z.object({
    date: z.string().describe("Date in YYYY-MM-DD format to fetch matches for"),
  }),
  outputSchema: z.object({
    date: z.string(),
    totalMatches: z.number(),
    matches: z.array(z.object({
      fixtureId: z.number(),
      date: z.string(),
      time: z.string(),
      league: z.object({
        name: z.string(),
        country: z.string(),
        logo: z.string(),
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
          logo: z.string(),
        }),
        away: z.object({
          name: z.string(),
          logo: z.string(),
        }),
      }),
      venue: z.string(),
      odds: z.any().nullable(),
    })),
    metadata: z.object({
      totalFixtures: z.number(),
      supportedFixtures: z.number(),
      processedFixtures: z.number(),
      perRegion: z.array(
        z.object({
          region: z.enum(["Europe", "South America", "North America", "Asia", "Africa"]),
          label: z.string(),
          total: z.number(),
        }),
      ),
    }),
  }),
  execute: async ({ context: { date }, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [FetchFootballMatches] Starting execution with params", { date });
    
    return await fetchFootballMatchesFromAPI({ date, logger });
  },
});