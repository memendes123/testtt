import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";

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
    // European leagues (Premier League, La Liga, Bundesliga, Serie A, Ligue 1, etc.)
    const europeanLeagues = [39, 140, 78, 135, 61, 2, 3, 88, 94, 203]; // Top European leagues
    
    logger?.info("📝 [FetchFootballMatches] Fetching matches for European leagues", { leagues: europeanLeagues });

    // Fetch fixtures for today
    const fixturesResponse = await fetch(
      `https://v3.football.api-sports.io/fixtures?date=${date}&league=${europeanLeagues.join(',')}&status=NS`,
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
    logger?.info("📝 [FetchFootballMatches] Received fixtures data", { 
      matchCount: fixturesData.response?.length || 0 
    });

    const matches = [];

    // Process each match and fetch odds
    for (const fixture of fixturesData.response || []) {
      try {
        logger?.info("📝 [FetchFootballMatches] Processing match", { 
          homeTeam: fixture.teams.home.name, 
          awayTeam: fixture.teams.away.name 
        });

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
      totalMatches: matches.length 
    });

    return {
      date,
      totalMatches: matches.length,
      matches: matches.slice(0, 20), // Limit to top 20 matches to avoid overwhelming
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
  description: "Fetches daily European football matches with odds from API-Football for betting analysis",
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
  }),
  execute: async ({ context: { date }, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [FetchFootballMatches] Starting execution with params", { date });
    
    return await fetchFootballMatchesFromAPI({ date, logger });
  },
});