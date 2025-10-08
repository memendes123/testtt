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

  for (const fixture of fixturesToProcess) {
    const competition = identifyCompetition(fixture.league);
    if (!competition) continue;

    const fixtureId = fixture.fixture?.id;
    if (!fixtureId) continue;

    let odds = [];
    try {
      const oddsPayload = await fetchJson(
        'https://v3.football.api-sports.io/odds',
        { fixture: fixtureId, bookmaker: settings.bookmakerId },
        headers,
      );
      odds = oddsPayload.response?.[0]?.bookmakers?.[0]?.bets ?? [];
    } catch (error) {
      logger.warn(`Failed to fetch odds for fixture ${fixtureId}: ${error.message}`);
    }

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
  const value = Number(odd);
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
    };

    const markets = new Map();
    for (const market of match.odds || []) {
      markets.set(market.name, market.values || []);
    }

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

    entry.recommendedBets = recommendations;
    if (confidenceScore >= 5) entry.confidence = 'high';
    else if (confidenceScore >= 3) entry.confidence = 'medium';
    return entry;
  });

  const score = (match) => {
    const base = { high: 3, medium: 2, low: 1 }[match.confidence] || 0;
    return base * 10 + (match.recommendedBets?.length || 0);
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
