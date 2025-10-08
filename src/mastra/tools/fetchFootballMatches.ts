import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";

import {
  COMPETITION_REGIONS,
  identifyCompetition,
  isCompetitionSupported,
  REGION_LABEL,
  REGION_ORDER,
} from "../constants/competitions";

const decodeHtml = (value: string | null | undefined): string => {
  if (!value) return "";
  return value
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();
};

const buildForebetKey = (home: string | null | undefined, away: string | null | undefined): string | null => {
  const normalize = (text: string | null | undefined) =>
    (text ?? "")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-z0-9]+/gi, " ")
      .trim()
      .toLowerCase();

  const homeKey = normalize(home);
  const awayKey = normalize(away);
  if (!homeKey || !awayKey) return null;
  return `${homeKey}|${awayKey}`;
};

const parsePercentages = (text: string): number[] => {
  const matches = [...text.matchAll(/(-?\d+(?:\.\d+)?)\s*%/g)];
  return matches.map((match) => Number(match[1]));
};

const parseForebetHtml = (html: string, logger?: IMastraLogger) => {
  const results = new Map<string, Record<string, number | string | undefined>>();
  if (!html) return results;

  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowHtml = rowMatch[1];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      cells.push(decodeHtml(cellMatch[1]));
    }

    if (cells.length < 3) continue;

    let homeTeam = null as string | null;
    let awayTeam = null as string | null;

    const homeMatch = rowHtml.match(/class="[^"]*(home|tnms|team1)[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    const awayMatch = rowHtml.match(/class="[^"]*(away|tnms2|team2)[^"]*"[^>]*>([\s\S]*?)<\/td>/i);

    if (homeMatch) homeTeam = decodeHtml(homeMatch[2]);
    if (awayMatch) awayTeam = decodeHtml(awayMatch[2]);

    if (!homeTeam || !awayTeam) {
      homeTeam = homeTeam || cells[1] || null;
      awayTeam = awayTeam || cells[2] || null;
    }

    if (!homeTeam || !awayTeam) continue;

    const percentages = cells.flatMap((cell) => parsePercentages(cell));
    if (percentages.length < 3) continue;

    const key = buildForebetKey(homeTeam, awayTeam);
    if (!key || results.has(key)) continue;

    const [homeProb, drawProb, awayProb] = percentages;
    const overProb = percentages[3];
    const underProb = percentages[4];
    const bttsYes = percentages[5];
    const bttsNo = percentages[6];

    results.set(key, {
      source: "Forebet",
      homeWinProbability: Math.round(homeProb ?? 0),
      drawProbability: Math.round(drawProb ?? 0),
      awayWinProbability: Math.round(awayProb ?? 0),
      over25Probability: overProb !== undefined ? Math.round(overProb) : undefined,
      under25Probability: underProb !== undefined ? Math.round(underProb) : undefined,
      bttsYesProbability: bttsYes !== undefined ? Math.round(bttsYes) : undefined,
      bttsNoProbability: bttsNo !== undefined ? Math.round(bttsNo) : undefined,
    });
  }

  logger?.info("📝 [FetchFootballMatches] Parsed Forebet predictions", { total: results.size });
  return results;
};

const fetchForebetPredictions = async (date: string, logger?: IMastraLogger) => {
  try {
    const target = new Date(`${date}T00:00:00Z`);
    const now = new Date();
    const isToday =
      target.getUTCFullYear() === now.getUTCFullYear() &&
      target.getUTCMonth() === now.getUTCMonth() &&
      target.getUTCDate() === now.getUTCDate();
    const slug = isToday ? "today" : date;
    const response = await fetch(
      `https://www.forebet.com/en/football-tips-and-predictions-for-${slug}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      },
    );

    if (!response.ok) {
      logger?.warn("📝 [FetchFootballMatches] Forebet request failed", { status: response.status });
      return new Map<string, Record<string, number | string | undefined>>();
    }

    const html = await response.text();
    return parseForebetHtml(html, logger);
  } catch (error) {
    logger?.warn("📝 [FetchFootballMatches] Unable to fetch Forebet predictions", {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Map<string, Record<string, number | string | undefined>>();
  }
};

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
    const forebetPredictions = await fetchForebetPredictions(date, logger);

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
        const preferredId = Number(process.env.FOOTBALL_API_BOOKMAKER || "6");
        const oddsResponse = await fetch(
          `https://v3.football.api-sports.io/odds?fixture=${fixture.fixture.id}`,
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
            const bookmakers = oddsData.response[0]?.bookmakers ?? [];
            const preferredId = Number(process.env.FOOTBALL_API_BOOKMAKER || "6");
            const ordered = [
              ...bookmakers.filter((bookmaker: any) => bookmaker.id === preferredId),
              ...bookmakers.filter((bookmaker: any) => bookmaker.id !== preferredId),
            ];

            const marketMap = new Map<string, any[]>();
            for (const bookmaker of ordered) {
              for (const bet of bookmaker?.bets ?? []) {
                if (!bet?.name) continue;
                if (!marketMap.has(bet.name) || !(marketMap.get(bet.name)?.length > 0)) {
                  marketMap.set(bet.name, bet.values ?? []);
                }
              }
            }

            odds = Array.from(marketMap.entries()).map(([name, values]) => ({ name, values }));
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

        const forebetKey = buildForebetKey(
          fixture.teams?.home?.name,
          fixture.teams?.away?.name,
        );
        const forebet = forebetKey ? forebetPredictions.get(forebetKey) ?? null : null;

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
          odds,
          forebet,
        });

        if (!regionCounters[competition.region]) {
          regionCounters[competition.region] = { total: 0 };
        }

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
        total: regionCounters[region]?.total ?? 0,
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
          total: regionCounters[region]?.total ?? 0,
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
        region: z.enum(COMPETITION_REGIONS),
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
          region: z.enum(COMPETITION_REGIONS),
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