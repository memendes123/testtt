#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnv(filePath) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return;
  const content = fs.readFileSync(resolved, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const [key, ...rest] = line.split('=');
    if (!key) continue;
    const value = rest.join('=').trim();
    if (!(key in process.env)) {
      process.env[key.trim()] = value;
    }
  }
}

const competitionData = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../shared/competitions.json'), 'utf-8'),
);

const competitionsById = new Map();
const aliasIndex = [];

function normalize(value) {
  if (!value) return null;
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

for (const competition of competitionData.competitions) {
  if (competition.apiFootballIds) {
    for (const id of competition.apiFootballIds) {
      competitionsById.set(id, competition);
    }
  }
  const names = [
    competition.displayName,
    competition.country,
    `${competition.country} ${competition.displayName}`,
  ];
  for (const alias of competition.aliases || []) {
    names.push(alias);
    names.push(`${competition.country} ${alias}`);
  }
  const normalized = new Set();
  for (const name of names) {
    const norm = normalize(name);
    if (norm) normalized.add(norm);
  }
  aliasIndex.push({ aliases: normalized, competition });
}

function identifyCompetition(league) {
  if (!league) return null;
  if (typeof league.id === 'number' && competitionsById.has(league.id)) {
    return competitionsById.get(league.id);
  }
  const name = normalize(league.name);
  const country = normalize(league.country);
  if (!name) return null;
  for (const entry of aliasIndex) {
    if (entry.aliases.has(name)) return entry.competition;
    if (country && entry.aliases.has(`${country} ${name}`)) return entry.competition;
  }
  return null;
}

function decodeHtml(text) {
  if (!text) return '';
  return text
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim();
}

function buildForebetKey(home, away) {
  const homeKey = normalize(home);
  const awayKey = normalize(away);
  if (!homeKey || !awayKey) return null;
  return `${homeKey}|${awayKey}`;
}

function parsePercentages(text) {
  if (!text) return [];
  const matches = [...text.matchAll(/(-?\d+(?:\.\d+)?)\s*%/g)];
  return matches.map((match) => Number(match[1]));
}

function parseForebetHtml(html, logger) {
  const results = new Map();
  if (!html) return results;

  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowHtml = rowMatch[1];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells = [];
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      cells.push(decodeHtml(cellMatch[1]));
    }

    if (cells.length < 3) continue;

    let homeTeam = null;
    let awayTeam = null;

    const homeMatch = rowHtml.match(/class="[^"]*(home|tnms|team1)[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    const awayMatch = rowHtml.match(/class="[^"]*(away|tnms2|team2)[^"]*"[^>]*>([\s\S]*?)<\/td>/i);

    if (homeMatch) homeTeam = decodeHtml(homeMatch[2]);
    if (awayMatch) awayTeam = decodeHtml(awayMatch[2]);

    if (!homeTeam || !awayTeam) {
      homeTeam = homeTeam || cells[1];
      awayTeam = awayTeam || cells[2];
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
      source: 'Forebet',
      homeWinProbability: Math.round(homeProb ?? 0),
      drawProbability: Math.round(drawProb ?? 0),
      awayWinProbability: Math.round(awayProb ?? 0),
      over25Probability: overProb !== undefined ? Math.round(overProb) : undefined,
      under25Probability: underProb !== undefined ? Math.round(underProb) : undefined,
      bttsYesProbability: bttsYes !== undefined ? Math.round(bttsYes) : undefined,
      bttsNoProbability: bttsNo !== undefined ? Math.round(bttsNo) : undefined,
    });
  }

  logger?.info?.(`Loaded ${results.size} Forebet predictions`);
  return results;
}

async function fetchForebetPredictions(date, logger) {
  try {
    const targetDate = new Date(`${date}T00:00:00Z`);
    const today = new Date();
    const isToday =
      targetDate.getUTCFullYear() === today.getUTCFullYear() &&
      targetDate.getUTCMonth() === today.getUTCMonth() &&
      targetDate.getUTCDate() === today.getUTCDate();
    const slug = isToday ? 'today' : date;
    const url = `https://www.forebet.com/en/football-tips-and-predictions-for-${slug}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!response.ok) {
      logger?.warn?.(`Forebet request failed: ${response.status}`);
      return new Map();
    }

    const html = await response.text();
    return parseForebetHtml(html, logger);
  } catch (error) {
    logger?.warn?.(`Unable to load Forebet predictions: ${error.message}`);
    return new Map();
  }
}

async function fetchJson(url, params, headers, timeout = 30000) {
  const urlObj = new URL(url);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        urlObj.searchParams.set(key, value);
      }
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const response = await fetch(urlObj, { headers, signal: controller.signal });
  clearTimeout(timer);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function extractScore(fixture) {
  const goals = fixture.goals ?? {};
  const score = fixture.score ?? {};
  const fullTime = score.fulltime ?? {};
  const extra = score.extratime ?? {};
  const penalties = score.penalty ?? {};

  const homeGoals = goals.home ?? fullTime.home ?? extra.home ?? penalties.home ?? 0;
  const awayGoals = goals.away ?? fullTime.away ?? extra.away ?? penalties.away ?? 0;

  return { homeGoals: Number(homeGoals) || 0, awayGoals: Number(awayGoals) || 0 };
}

function summarizeTeamFixtures(teamId, fixtures = []) {
  if (!teamId || !Array.isArray(fixtures) || fixtures.length === 0) {
    return null;
  }

  const ordered = [...fixtures].sort((a, b) => (b.fixture?.timestamp || 0) - (a.fixture?.timestamp || 0));
  const matches = [];
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  let cleanSheets = 0;
  let failedToScore = 0;

  for (const fixture of ordered) {
    const { homeGoals, awayGoals } = extractScore(fixture);
    const isHome = fixture.teams?.home?.id === teamId;
    const opponent = isHome ? fixture.teams?.away : fixture.teams?.home;
    const goalsForMatch = isHome ? homeGoals : awayGoals;
    const goalsAgainstMatch = isHome ? awayGoals : homeGoals;

    let winner = null;
    if (fixture.teams?.home?.winner === true && fixture.teams?.away?.winner === false) {
      winner = 'home';
    } else if (fixture.teams?.home?.winner === false && fixture.teams?.away?.winner === true) {
      winner = 'away';
    } else if (homeGoals > awayGoals) {
      winner = 'home';
    } else if (awayGoals > homeGoals) {
      winner = 'away';
    } else {
      winner = 'draw';
    }

    const resultCode =
      winner === 'draw' ? 'E' : winner === (isHome ? 'home' : 'away') ? 'V' : 'D';

    matches.push({
      fixtureId: fixture.fixture?.id,
      date: fixture.fixture?.date,
      opponent: opponent?.name,
      competition: fixture.league?.name,
      score: `${homeGoals}-${awayGoals}`,
      result: resultCode,
    });

    goalsFor += goalsForMatch;
    goalsAgainst += goalsAgainstMatch;

    if (resultCode === 'V') wins += 1;
    else if (resultCode === 'E') draws += 1;
    else losses += 1;

    if (goalsAgainstMatch === 0) cleanSheets += 1;
    if (goalsForMatch === 0) failedToScore += 1;
  }

  const total = matches.length;
  if (total === 0) return null;

  const recentRecord = matches.map((match) => match.result).join('');
  const firstResult = matches[0]?.result ?? 'E';
  let streakCount = 0;
  for (const match of matches) {
    if (match.result === firstResult) streakCount += 1;
    else break;
  }

  const streakType =
    firstResult === 'V' ? 'win' : firstResult === 'D' ? 'loss' : firstResult === 'E' ? 'draw' : 'unknown';

  const avgGoalsFor = Number((goalsFor / total).toFixed(2));
  const avgGoalsAgainst = Number((goalsAgainst / total).toFixed(2));

  return {
    sampleSize: total,
    matches,
    wins,
    draws,
    losses,
    winRate: total ? wins / total : 0,
    drawRate: total ? draws / total : 0,
    lossRate: total ? losses / total : 0,
    formPoints: wins * 3 + draws,
    avgGoalsFor,
    avgGoalsAgainst,
    avgGoalsTotal: Number(((goalsFor + goalsAgainst) / total).toFixed(2)),
    goalDifferenceAvg: Number((avgGoalsFor - avgGoalsAgainst).toFixed(2)),
    cleanSheets,
    failedToScore,
    recentRecord,
    currentStreak: { type: streakType, count: streakCount },
  };
}

function summarizeHeadToHead(homeId, awayId, fixtures = []) {
  if (!homeId || !awayId || fixtures.length === 0) {
    return null;
  }

  const ordered = [...fixtures].sort((a, b) => (b.fixture?.timestamp || 0) - (a.fixture?.timestamp || 0));
  const matches = [];
  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;
  let totalGoals = 0;

  for (const fixture of ordered) {
    const { homeGoals, awayGoals } = extractScore(fixture);
    const fixtureHomeId = fixture.teams?.home?.id;
    const fixtureAwayId = fixture.teams?.away?.id;
    const upcomingHomeWasHome = fixtureHomeId === homeId;

    let result = 'E';
    if (homeGoals !== awayGoals) {
      const didHomeWin = fixture.teams?.home?.winner ?? homeGoals > awayGoals;
      const upcomingHomeWon = upcomingHomeWasHome ? didHomeWin : !(didHomeWin);
      if (upcomingHomeWon) {
        result = 'V';
        homeWins += 1;
      } else {
        result = 'D';
        awayWins += 1;
      }
    } else {
      draws += 1;
    }

    matches.push({
      fixtureId: fixture.fixture?.id,
      date: fixture.fixture?.date,
      venue: fixture.fixture?.venue?.name,
      score: `${homeGoals}-${awayGoals}`,
      result,
    });

    totalGoals += homeGoals + awayGoals;
  }

  const sampleSize = matches.length;
  if (sampleSize === 0) return null;

  return {
    sampleSize,
    matches,
    homeWins,
    awayWins,
    draws,
    avgGoalsTotal: Number((totalGoals / sampleSize).toFixed(2)),
  };
}

const teamFormCache = new Map();
const headToHeadCache = new Map();

async function fetchTeamForm(teamId, headers, logger) {
  if (!teamId) return null;
  if (teamFormCache.has(teamId)) return teamFormCache.get(teamId);

  try {
    const payload = await fetchJson(
      'https://v3.football.api-sports.io/fixtures',
      { team: teamId, last: 5 },
      headers,
    );
    const fixtures = payload.response || [];
    const summary = summarizeTeamFixtures(teamId, fixtures);
    teamFormCache.set(teamId, summary);
    return summary;
  } catch (error) {
    logger.warn(`Failed to fetch form for team ${teamId}: ${error.message}`);
    teamFormCache.set(teamId, null);
    return null;
  }
}

async function fetchHeadToHead(homeId, awayId, headers, logger) {
  if (!homeId || !awayId) return null;
  const key = `${homeId}-${awayId}`;
  if (headToHeadCache.has(key)) return headToHeadCache.get(key);

  try {
    const payload = await fetchJson(
      'https://v3.football.api-sports.io/fixtures/headtohead',
      { h2h: `${homeId}-${awayId}`, last: 5 },
      headers,
    );
    const fixtures = payload.response || [];
    const summary = summarizeHeadToHead(homeId, awayId, fixtures);
    headToHeadCache.set(key, summary);
    return summary;
  } catch (error) {
    logger.warn(`Failed to fetch head-to-head for ${homeId}-${awayId}: ${error.message}`);
    headToHeadCache.set(key, null);
    return null;
  }
}

async function fetchMatches(date, settings, logger) {
  const headers = {
    'X-RapidAPI-Key': settings.footballApiKey,
    'X-RapidAPI-Host': 'v3.football.api-sports.io',
  };

  logger.info(`Fetching fixtures for ${date}`);
  const fixturesPayload = await fetchJson(
    'https://v3.football.api-sports.io/fixtures',
    { date, status: 'NS' },
    headers,
  );

  const fixtures = fixturesPayload.response || [];
  const supportedFixtures = fixtures.filter((fixture) => identifyCompetition(fixture.league));
  const fixturesToProcess = supportedFixtures
    .sort((a, b) => (a.fixture?.timestamp || 0) - (b.fixture?.timestamp || 0))
    .slice(0, settings.maxFixtures);

  const matches = [];
  const regionCounters = Object.fromEntries(competitionData.regionOrder.map((region) => [region, 0]));
  const forebetPredictions = await fetchForebetPredictions(date, logger);

  for (const fixture of fixturesToProcess) {
    const competition = identifyCompetition(fixture.league);
    if (!competition) continue;

    const fixtureId = fixture.fixture?.id;
    if (!fixtureId) continue;

    let odds = [];
    try {
      const oddsPayload = await fetchJson(
        'https://v3.football.api-sports.io/odds',
        { fixture: fixtureId },
        headers,
      );

      const bookmakers = oddsPayload.response?.[0]?.bookmakers ?? [];
      const preferred = settings.bookmakerId;
      const orderedBookmakers = [
        ...bookmakers.filter((bookmaker) => bookmaker.id === preferred),
        ...bookmakers.filter((bookmaker) => bookmaker.id !== preferred),
      ];

      const markets = new Map();
      for (const bookmaker of orderedBookmakers) {
        for (const bet of bookmaker.bets ?? []) {
          if (!bet?.name) continue;
          if (!markets.has(bet.name) || !(markets.get(bet.name)?.length > 0)) {
            markets.set(bet.name, bet.values ?? []);
          }
        }
      }

      odds = Array.from(markets.entries()).map(([name, values]) => ({ name, values }));
    } catch (error) {
      logger.warn(`Failed to fetch odds for fixture ${fixtureId}: ${error.message}`);
    }

    const homeTeamId = fixture.teams?.home?.id;
    const awayTeamId = fixture.teams?.away?.id;

    const [homeForm, awayForm, headToHead] = await Promise.all([
      fetchTeamForm(homeTeamId, headers, logger),
      fetchTeamForm(awayTeamId, headers, logger),
      fetchHeadToHead(homeTeamId, awayTeamId, headers, logger),
    ]);

    const forebetKey = buildForebetKey(fixture.teams?.home?.name, fixture.teams?.away?.name);
    const forebet = forebetKey ? forebetPredictions.get(forebetKey) ?? null : null;


    let time = '';
    if (fixture.fixture?.date) {
      try {
        time = new Date(fixture.fixture.date).toLocaleTimeString('pt-PT', {
          hour: '2-digit',
          minute: '2-digit',
        });
      } catch {
        time = fixture.fixture.date;
      }
    }

    matches.push({
      fixtureId,
      date: fixture.fixture?.date,
      time,
      league: fixture.league,
      competition: {
        key: competition.key,
        name: competition.displayName,
        region: competition.region,
        type: competition.type,
        country: competition.country,
      },
      teams: fixture.teams,
      venue: fixture.fixture?.venue?.name ?? 'TBD',
      odds,
      forebet,

      form: {
        home: homeForm,
        away: awayForm,
        headToHead,
      },
    });

    regionCounters[competition.region] = (regionCounters[competition.region] || 0) + 1;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return {
    date,
    totalMatches: matches.length,
    matches,
    metadata: {
      totalFixtures: fixtures.length,
      supportedFixtures: supportedFixtures.length,
      processedFixtures: fixturesToProcess.length,
      perRegion: competitionData.regionOrder.map((region) => ({
        region,
        label: competitionData.regionLabel[region] || region,
        total: regionCounters[region] || 0,
      })),
    },
  };
}

function normalizeMarketValue(value) {
  if (value === undefined || value === null) return '';
  return value
    .toString()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[,]/g, '.')
    .replace(/[()]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

const HOME_LABELS = new Set(['home', '1', 'home team', 'team 1', '1 home']);
const DRAW_LABELS = new Set(['draw', 'x', 'empate']);
const AWAY_LABELS = new Set(['away', '2', 'away team', 'team 2', '2 away']);
const YES_LABELS = new Set(['yes', 'sim', 'y', 's']);
const NO_LABELS = new Set(['no', 'nao', 'n']);

const MARKET_ALIASES = new Map([
  [
    'match_winner',
    new Set(['match winner', '1x2', 'full time result', 'match result', 'result', 'win-draw-win']),
  ],
  [
    'goals_over_under',
    new Set(['goals over/under', 'over/under', 'goals', 'goals o/u', 'total goals']),
  ],
  [
    'both_teams_score',
    new Set(['both teams score', 'both teams to score', 'btts', 'gg/ng', 'goal goal']),
  ],
]);

function normalizeMarketName(value) {
  const normalized = normalizeMarketValue(value);
  if (!normalized) return '';
  for (const [key, aliases] of MARKET_ALIASES.entries()) {
    if (aliases.has(normalized)) return key;
  }
  return normalized;
}

function isOver25Label(value) {
  const normalized = normalizeMarketValue(value);
  if (!normalized) return false;
  if (normalized.includes('over') || normalized.includes('mais de')) {
    return normalized.includes('2.5') || normalized.includes('25');
  }
  return false;
}

function isUnder25Label(value) {
  const normalized = normalizeMarketValue(value);
  if (!normalized) return false;
  if (normalized.includes('under') || normalized.includes('menos de')) {
    return normalized.includes('2.5') || normalized.includes('25');
  }
  return false;
}

function probabilityFromOdd(odd) {
  const value = normalizeOdd(odd);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round((1 / value) * 100);
}

function analyzeMatches(matches, logger) {
  logger.info(`Analyzing ${matches.length} matches`);
  const analyzed = matches.map((match) => {
    const entry = {
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
      recommendedBets: [],
      confidence: 'low',
      analysisNotes: [],
    };

    const markets = new Map();
    const forebet = match.forebet || null;
    let forebetUsed = false;
    for (const market of match.odds || []) {
      const key = normalizeMarketName(market?.name);
      if (!key) continue;
      const values = Array.isArray(market?.values) ? market.values : [];
      if (!markets.has(key) || !(markets.get(key)?.length > 0)) {
        markets.set(key, values);
      }
    }

    for (const value of markets.get('match_winner') || []) {
      const normalized = normalizeMarketValue(value.value);
      if (HOME_LABELS.has(normalized)) entry.predictions.homeWinProbability = probabilityFromOdd(value.odd);
      if (DRAW_LABELS.has(normalized)) entry.predictions.drawProbability = probabilityFromOdd(value.odd);
      if (AWAY_LABELS.has(normalized)) entry.predictions.awayWinProbability = probabilityFromOdd(value.odd);
    }

    for (const value of markets.get('goals_over_under') || []) {
      if (isOver25Label(value.value)) entry.predictions.over25Probability = probabilityFromOdd(value.odd);
      if (isUnder25Label(value.value)) entry.predictions.under25Probability = probabilityFromOdd(value.odd);
    }

    for (const value of markets.get('both_teams_score') || []) {
      const normalized = normalizeMarketValue(value.value);
      if (YES_LABELS.has(normalized)) entry.predictions.bttsYesProbability = probabilityFromOdd(value.odd);
      if (NO_LABELS.has(normalized)) entry.predictions.bttsNoProbability = probabilityFromOdd(value.odd);
    }

    if (forebet) {
      const applyForebet = (sourceKey, targetKey) => {
        if (entry.predictions[targetKey]) return;
        const raw = forebet[sourceKey];
        const value = Number(raw);
        if (Number.isFinite(value) && value > 0) {
          entry.predictions[targetKey] = Math.max(0, Math.min(100, Math.round(value)));
          forebetUsed = true;
        }
      };

      applyForebet('homeWinProbability', 'homeWinProbability');
      applyForebet('drawProbability', 'drawProbability');
      applyForebet('awayWinProbability', 'awayWinProbability');
      applyForebet('over25Probability', 'over25Probability');
      applyForebet('under25Probability', 'under25Probability');
      applyForebet('bttsYesProbability', 'bttsYesProbability');
      applyForebet('bttsNoProbability', 'bttsNoProbability');
    for (const value of markets.get('Match Winner') || []) {
      const normalized = normalizeMarketValue(value.value);
      if (HOME_LABELS.has(normalized)) entry.predictions.homeWinProbability = probabilityFromOdd(value.odd);
      if (DRAW_LABELS.has(normalized)) entry.predictions.drawProbability = probabilityFromOdd(value.odd);
      if (AWAY_LABELS.has(normalized)) entry.predictions.awayWinProbability = probabilityFromOdd(value.odd);
    }

    for (const value of markets.get('Goals Over/Under') || []) {
      if (isOver25Label(value.value)) entry.predictions.over25Probability = probabilityFromOdd(value.odd);
      if (isUnder25Label(value.value)) entry.predictions.under25Probability = probabilityFromOdd(value.odd);
    }

    for (const value of markets.get('Both Teams Score') || []) {
      const normalized = normalizeMarketValue(value.value);
      if (YES_LABELS.has(normalized)) entry.predictions.bttsYesProbability = probabilityFromOdd(value.odd);
      if (NO_LABELS.has(normalized)) entry.predictions.bttsNoProbability = probabilityFromOdd(value.odd);
    }

    const recommendations = [];
    let confidenceScore = 0;
    const maxProbability = Math.max(
      entry.predictions.homeWinProbability,
      entry.predictions.awayWinProbability,
      entry.predictions.drawProbability,
    );

    if (maxProbability >= 70) {
      const team =
        entry.predictions.homeWinProbability >= entry.predictions.awayWinProbability
          ? match.teams?.home?.name
          : match.teams?.away?.name;
      recommendations.push(`🏆 Forte favorito: ${team} (${maxProbability}%)`);
      confidenceScore += 3;
    } else if (maxProbability >= 55) {
      const team =
        entry.predictions.homeWinProbability >= entry.predictions.awayWinProbability
          ? match.teams?.home?.name
          : match.teams?.away?.name;
      recommendations.push(`✅ Favorito: ${team} (${maxProbability}%)`);
      confidenceScore += 2;
    }

    if (entry.predictions.over25Probability >= 60) {
      recommendations.push(`⚽ Over 2.5 golos (${entry.predictions.over25Probability}%)`);
      confidenceScore += 2;
    } else if (entry.predictions.under25Probability >= 60) {
      recommendations.push(`🛡️ Under 2.5 golos (${entry.predictions.under25Probability}%)`);
      confidenceScore += 2;
    }

    if (entry.predictions.bttsYesProbability >= 60) {
      recommendations.push(`🥅 Ambos marcam: SIM (${entry.predictions.bttsYesProbability}%)`);
      confidenceScore += 1;
    } else if (entry.predictions.bttsNoProbability >= 60) {
      recommendations.push(`🚫 Ambos marcam: NÃO (${entry.predictions.bttsNoProbability}%)`);
      confidenceScore += 1;
    }

    const notes = [];
    let qualitativeBoost = 0;
    const homeForm = match.form?.home;
    const awayForm = match.form?.away;
    const headToHead = match.form?.headToHead;

    if (homeForm?.currentStreak?.type === 'win' && homeForm.currentStreak.count >= 3) {
      notes.push(
        `Casa com ${homeForm.currentStreak.count} vitórias seguidas (${homeForm.recentRecord.slice(0, 5)})`,
      );
      qualitativeBoost += 1;
    }

    if (awayForm?.currentStreak?.type === 'loss' && awayForm.currentStreak.count >= 2) {
      notes.push(`Visitante sem vencer há ${awayForm.currentStreak.count} jogos (${awayForm.recentRecord.slice(0, 5)})`);
      qualitativeBoost += 1;
    }

    if ((homeForm?.avgGoalsFor ?? 0) + (awayForm?.avgGoalsFor ?? 0) >= 3.2) {
      notes.push('Tendência de muitos golos (médias ofensivas altas nas últimas partidas)');
    } else if ((homeForm?.avgGoalsFor ?? 0) + (awayForm?.avgGoalsFor ?? 0) <= 2.0) {
      notes.push('Tendência de poucos golos nos últimos jogos das equipas');
    }

    if (headToHead?.homeWins && headToHead.homeWins >= 3) {
      notes.push('Histórico recente favorável ao mandante no confronto direto');
      qualitativeBoost += 1;
    }

    if (headToHead?.avgGoalsTotal && headToHead.avgGoalsTotal >= 3) {
      notes.push('Confrontos diretos recentes com média superior a 3 golos');
    }

    if (forebetUsed) {
      notes.push('Probabilidades 1X2 complementadas com dados da Forebet');
    }

    entry.analysisNotes = notes.slice(0, 3);

    confidenceScore += qualitativeBoost;

    if (
      entry.predictions.homeWinProbability === 0 &&
      entry.predictions.awayWinProbability === 0 &&
      entry.predictions.drawProbability === 0 &&
      (homeForm || awayForm)
    ) {
      const formCount = (homeForm ? 1 : 0) + (awayForm ? 1 : 0) || 1;
      const drawRate = ((homeForm?.drawRate ?? 0) + (awayForm?.drawRate ?? 0)) / formCount;
      const drawProbability = Math.round(Math.min(drawRate, 0.45) * 100);
      const homeScore =
        (homeForm?.winRate ?? 0) + (awayForm ? awayForm.lossRate * 0.6 : 0) + Math.max(homeForm?.goalDifferenceAvg ?? 0, 0);
      const awayScore =
        (awayForm?.winRate ?? 0) + (homeForm ? homeForm.lossRate * 0.6 : 0) + Math.max(awayForm?.goalDifferenceAvg ?? 0, 0);
      const total = homeScore + awayScore;
      const available = Math.max(0, 100 - drawProbability);
      if (total > 0) {
        entry.predictions.homeWinProbability = Math.round((homeScore / total) * available);
        entry.predictions.awayWinProbability = Math.max(
          0,
          available - entry.predictions.homeWinProbability,
        );
        entry.predictions.drawProbability = drawProbability;
      } else {
        entry.predictions.homeWinProbability = Math.round(available / 2);
        entry.predictions.awayWinProbability = available - entry.predictions.homeWinProbability;
        entry.predictions.drawProbability = drawProbability;
      }
    }

    entry.recommendedBets = recommendations;
    if (confidenceScore >= 5) entry.confidence = 'high';
    else if (confidenceScore >= 3) entry.confidence = 'medium';
    return entry;
  });

  const score = (match) => {
    const base = { high: 3, medium: 2, low: 1 }[match.confidence] || 0;
    const predictions = match.predictions || {};
    const maxProbability = Math.max(
      Number(predictions.homeWinProbability) || 0,
      Number(predictions.drawProbability) || 0,
      Number(predictions.awayWinProbability) || 0,
    );
    return base * 1000 + (match.recommendedBets?.length || 0) * 10 + maxProbability;
  };

  const sorted = [...analyzed].sort((a, b) => score(b) - score(a));

  const buckets = new Map();
  for (const match of analyzed) {
    const region = match.competition?.region;
    if (!region) continue;
    if (!buckets.has(region)) buckets.set(region, []);
    buckets.get(region).push(match);
  }

  const breakdown = competitionData.regionOrder.map((region) => {
    const matchesForRegion = buckets.get(region) || [];
    return {
      region,
      label: competitionData.regionLabel[region] || region,
      total: matchesForRegion.length,
      highConfidence: matchesForRegion.filter((match) => match.confidence === 'high').length,
      mediumConfidence: matchesForRegion.filter((match) => match.confidence === 'medium').length,
    };
  });

  const bestByRegion = competitionData.regionOrder.map((region) => {
    const matchesForRegion = buckets.get(region) || [];
    const ordered = [...matchesForRegion].sort((a, b) => score(b) - score(a));
    return {
      region,
      label: competitionData.regionLabel[region] || region,
      matches: ordered.slice(0, 5),
    };
  });

  return {
    totalAnalyzed: analyzed.length,
    bestMatches: sorted.slice(0, 10),
    highConfidenceCount: sorted.filter((match) => match.confidence === 'high').length,
    mediumConfidenceCount: sorted.filter((match) => match.confidence === 'medium').length,
    breakdownByRegion: breakdown,
    bestMatchesByRegion: bestByRegion,
  };
}

function buildMessage(matchData, analysis) {
  const date = new Date(matchData.date);
  const formatted = date.toLocaleDateString('pt-PT', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const lines = [];
  lines.push(`🏆 <b>PREVISÕES FUTEBOL - ${formatted.toUpperCase()}</b>`);
  lines.push('');
  lines.push('📊 <b>Resumo Global:</b>');
  lines.push(`• ${matchData.totalMatches} jogos elegíveis nas competições suportadas`);
  lines.push(`• ${analysis.totalAnalyzed} jogos com odds válidas analisados`);
  lines.push(
    `• ${analysis.highConfidenceCount} jogos de alta confiança | ${analysis.mediumConfidenceCount} de média confiança`,
  );
  lines.push('');

  const activeRegions = analysis.breakdownByRegion.filter((region) => region.total > 0);
  if (activeRegions.length) {
    lines.push('🌍 <b>Distribuição por Região:</b>');
    for (const region of activeRegions) {
      lines.push(`• ${region.label}: ${region.total} jogos (${region.highConfidence} alta | ${region.mediumConfidence} média)`);
    }
    lines.push('');
  }

  if (analysis.bestMatches.length) {
    const highlights = analysis.bestMatches.slice(0, Math.min(5, analysis.bestMatches.length));
    lines.push(`🔥 <b>TOP GLOBAL (${highlights.length})</b>`);
    for (const match of highlights) {
      const emoji = match.confidence === 'high' ? '🔥' : match.confidence === 'medium' ? '⚡' : '💡';
      const competition = match.competition?.name || match.league?.name;
      lines.push(`${emoji} <b>${match.teams?.home?.name} vs ${match.teams?.away?.name}</b> — ${competition}`);
      if (match.time) {
        lines.push(`⏰ ${match.time} | 🏆 ${match.league?.name}`);
      }
      if (match.recommendedBets?.length) {
        lines.push(`🎯 ${match.recommendedBets.join(' | ')}`);
      }
      const predictions = match.predictions || {};
      lines.push(
        `📈 Prob: Casa ${predictions.homeWinProbability}% | Empate ${predictions.drawProbability}% | Fora ${predictions.awayWinProbability}%`,
      );
      if (match.analysisNotes?.length) {
        lines.push(`📝 PK: ${match.analysisNotes.slice(0, 2).join(' • ')}`);
      }
      lines.push('');
    }
  } else {
    lines.push('😔 <b>Não há jogos com odds interessantes hoje.</b>');
    lines.push('Voltamos amanhã com mais análises!');
    lines.push('');
    lines.push('📈 Tip: Verifique os jogos ao vivo durante o dia para oportunidades em tempo real.');
  }

  return lines.join('\n');
}

async function sendTelegram(message, settings, chatId, logger) {
  const baseUrl = `https://api.telegram.org/bot${settings.telegramBotToken}`;

  async function post(path, payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(`${baseUrl}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) {
      throw new Error(`Telegram API error: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  async function getRecentChatId() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(`${baseUrl}/getUpdates?limit=10&offset=-10`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) return null;
    const payload = await response.json();
    for (const update of payload.result?.slice().reverse() || []) {
      const chat = update.message?.chat;
      if (chat?.type === 'private') {
        return String(chat.id);
      }
    }
    return null;
  }

  let targetChatId = chatId || process.env.TELEGRAM_DEFAULT_CHAT_ID;
  if (!targetChatId) {
    targetChatId = await getRecentChatId();
  }

  if (!targetChatId) {
    throw new Error('Unable to determine Telegram chat id. Provide TELEGRAM_DEFAULT_CHAT_ID or send a message to the bot first.');
  }

  logger.info(`Sending Telegram message to ${targetChatId}`);
  const privateResult = await post('sendMessage', {
    chat_id: targetChatId,
    text: message,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });

  const results = [
    {
      type: 'private_chat',
      success: true,
      messageId: privateResult.result?.message_id,
      chatId: targetChatId,
    },
  ];

  if (settings.telegramChannelId) {
    try {
      const channelResult = await post('sendMessage', {
        chat_id: settings.telegramChannelId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
      results.push({
        type: 'channel',
        success: true,
        messageId: channelResult.result?.message_id,
        chatId: settings.telegramChannelId,
      });
    } catch (error) {
      logger.error(`Failed to send Telegram message to channel: ${error.message}`);
    }
  }

  return {
    success: true,
    results,
  };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    date: null,
    env: null,
    dryRun: false,
    chatId: null,
    output: null,
    verbose: false,
  };

  const requireValue = (flag, value) => {
    if (value === undefined) {
      throw new Error(`Missing value for ${flag}`);
    }
    return value;
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--date':
        parsed.date = requireValue('--date', args[++i]);
        break;
      case '--env':
        parsed.env = requireValue('--env', args[++i]);
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      case '--chat-id':
        parsed.chatId = requireValue('--chat-id', args[++i]);
        break;
      case '--output':
        parsed.output = requireValue('--output', args[++i]);
        break;
      case '--verbose':
        parsed.verbose = true;
        break;
      default:
        break;
    }
  }

  if (!parsed.date) {
    parsed.date = new Date().toISOString().split('T')[0];
  }

  return parsed;
}

function createLogger(verbose) {
  return {
    info: (message) => {
      console.log(`${new Date().toISOString()} INFO ${message}`);
    },
    warn: (message) => {
      console.warn(`${new Date().toISOString()} WARN ${message}`);
    },
    error: (message) => {
      console.error(`${new Date().toISOString()} ERROR ${message}`);
    },
  };
}

async function main() {
  let args;
  try {
    args = parseArgs();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  loadEnv(args.env);
  const logger = createLogger(args.verbose);

  const settings = {
    footballApiKey: process.env.FOOTBALL_API_KEY,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChannelId: process.env.TELEGRAM_CHANNEL_ID,
    bookmakerId: Number(process.env.FOOTBALL_API_BOOKMAKER || '6'),
    maxFixtures: Number(process.env.FOOTBALL_MAX_FIXTURES || '120'),
  };

  if (!settings.footballApiKey) {
    console.error('FOOTBALL_API_KEY is required');
    process.exit(1);
  }
  if (!settings.telegramBotToken) {
    console.error('TELEGRAM_BOT_TOKEN is required');
    process.exit(1);
  }

  const matchData = await fetchMatches(args.date, settings, logger);
  const analysis = analyzeMatches(matchData.matches, logger);
  const message = buildMessage(matchData, analysis);

  if (args.output) {
    fs.writeFileSync(
      path.resolve(args.output),
      JSON.stringify({ matchData, analysis, message }, null, 2),
      'utf-8',
    );
  }

  if (args.dryRun) {
    console.log(message);
    return;
  }

  await sendTelegram(message, settings, args.chatId, logger);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
