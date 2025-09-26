import { z } from "zod";

export const COMPETITION_REGIONS = [
  "Europe",
  "South America",
  "North America",
  "Asia",
  "Africa",
  "International",
  "Intercontinental",
] as const;

export type CompetitionRegion = (typeof COMPETITION_REGIONS)[number];

export type CompetitionType = "league" | "cup" | "supercup";

export interface CompetitionMetadata {
  key: string;
  displayName: string;
  region: CompetitionRegion;
  type: CompetitionType;
  country: string;
  aliases?: string[];
  apiFootballIds?: number[];
}

export const competitionMetadataSchema = z.object({
  key: z.string(),
  displayName: z.string(),
  region: z.enum(COMPETITION_REGIONS),
  type: z.enum(["league", "cup", "supercup"]),
  country: z.string(),
  aliases: z.array(z.string()).optional(),
  apiFootballIds: z.array(z.number()).optional(),
});

type NormalizedCompetition = CompetitionMetadata & {
  normalizedAliases: Set<string>;
};

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();

const buildNormalizedCompetition = (competition: CompetitionMetadata): NormalizedCompetition => {
  const normalizedAliases = new Set<string>();
  const names = [competition.displayName, competition.country, `${competition.country} ${competition.displayName}`];
  competition.aliases?.forEach((alias) => names.push(alias, `${competition.country} ${alias}`));

  names
    .map((name) => normalize(name))
    .filter((name) => name.length > 0)
    .forEach((normalizedName) => normalizedAliases.add(normalizedName));

  return {
    ...competition,
    normalizedAliases,
  };
};

export const SUPPORTED_COMPETITIONS: CompetitionMetadata[] = [
  // Europe - Domestic Leagues
  {
    key: "premier-league",
    displayName: "Premier League",
    region: "Europe",
    type: "league",
    country: "England",
    aliases: ["English Premier League", "EPL"],
    apiFootballIds: [39],
  },
  {
    key: "la-liga",
    displayName: "La Liga",
    region: "Europe",
    type: "league",
    country: "Spain",
    aliases: ["LaLiga", "Primera Division"],
    apiFootballIds: [140],
  },
  {
    key: "serie-a",
    displayName: "Serie A",
    region: "Europe",
    type: "league",
    country: "Italy",
    aliases: ["Serie A TIM", "Italian Serie A"],
    apiFootballIds: [135],
  },
  {
    key: "bundesliga",
    displayName: "Bundesliga",
    region: "Europe",
    type: "league",
    country: "Germany",
    aliases: ["1. Bundesliga"],
    apiFootballIds: [78],
  },
  {
    key: "ligue-1",
    displayName: "Ligue 1",
    region: "Europe",
    type: "league",
    country: "France",
    aliases: ["Ligue 1 Uber Eats"],
    apiFootballIds: [61],
  },
  {
    key: "eredivisie",
    displayName: "Eredivisie",
    region: "Europe",
    type: "league",
    country: "Netherlands",
    aliases: ["Dutch Eredivisie"],
    apiFootballIds: [88],
  },
  {
    key: "primeira-liga",
    displayName: "Primeira Liga",
    region: "Europe",
    type: "league",
    country: "Portugal",
    aliases: ["Liga Portugal"],
    apiFootballIds: [94],
  },
  {
    key: "super-lig",
    displayName: "Super Lig",
    region: "Europe",
    type: "league",
    country: "Turkey",
    aliases: ["Turkish Super Lig"],
    apiFootballIds: [203],
  },
  {
    key: "belgian-pro-league",
    displayName: "Belgian Pro League",
    region: "Europe",
    type: "league",
    country: "Belgium",
    aliases: ["Jupiler Pro League"],
    apiFootballIds: [144],
  },
  {
    key: "scottish-premiership",
    displayName: "Scottish Premiership",
    region: "Europe",
    type: "league",
    country: "Scotland",
    aliases: ["Scotland Premiership"],
    apiFootballIds: [179],
  },
  {
    key: "russian-premier-league",
    displayName: "Russian Premier League",
    region: "Europe",
    type: "league",
    country: "Russia",
    aliases: ["Russian Premier Liga", "RPL"],
  },
  {
    key: "ukrainian-premier-league",
    displayName: "Ukrainian Premier League",
    region: "Europe",
    type: "league",
    country: "Ukraine",
    aliases: ["UPL"],
  },

  // Europe - Domestic Cups and Supercups
  {
    key: "taca-de-portugal",
    displayName: "Taça de Portugal",
    region: "Europe",
    type: "cup",
    country: "Portugal",
    aliases: ["Taca de Portugal Placard"],
  },
  {
    key: "taca-da-liga-portugal",
    displayName: "Taça da Liga",
    region: "Europe",
    type: "cup",
    country: "Portugal",
    aliases: ["Allianz Cup", "League Cup Portugal"],
  },
  {
    key: "copa-del-rey",
    displayName: "Copa del Rey",
    region: "Europe",
    type: "cup",
    country: "Spain",
  },
  {
    key: "supercopa-espana",
    displayName: "Supercopa de España",
    region: "Europe",
    type: "supercup",
    country: "Spain",
    aliases: ["Spanish Super Cup"],
  },
  {
    key: "fa-cup",
    displayName: "FA Cup",
    region: "Europe",
    type: "cup",
    country: "England",
    aliases: ["Emirates FA Cup"],
    apiFootballIds: [45],
  },
  {
    key: "efl-cup",
    displayName: "EFL Cup",
    region: "Europe",
    type: "cup",
    country: "England",
    aliases: ["Carabao Cup", "League Cup"],
    apiFootballIds: [46],
  },
  {
    key: "dfb-pokal",
    displayName: "DFB-Pokal",
    region: "Europe",
    type: "cup",
    country: "Germany",
  },
  {
    key: "german-supercup",
    displayName: "Supercopa da Alemanha",
    region: "Europe",
    type: "supercup",
    country: "Germany",
    aliases: ["DFL-Supercup"],
  },
  {
    key: "coppa-italia",
    displayName: "Coppa Italia",
    region: "Europe",
    type: "cup",
    country: "Italy",
  },
  {
    key: "supercoppa-italiana",
    displayName: "Supercoppa Italiana",
    region: "Europe",
    type: "supercup",
    country: "Italy",
  },
  {
    key: "coupe-de-france",
    displayName: "Coupe de France",
    region: "Europe",
    type: "cup",
    country: "France",
  },
  {
    key: "coupe-de-la-ligue",
    displayName: "Coupe de la Ligue",
    region: "Europe",
    type: "cup",
    country: "France",
    aliases: ["French League Cup"],
  },
  {
    key: "trophee-des-champions",
    displayName: "Trophée des Champions",
    region: "Europe",
    type: "supercup",
    country: "France",
    aliases: ["French Super Cup"],
  },
  {
    key: "knvb-beker",
    displayName: "KNVB Beker",
    region: "Europe",
    type: "cup",
    country: "Netherlands",
    aliases: ["Dutch Cup"],
  },
  {
    key: "johan-cruyff-shield",
    displayName: "Johan Cruyff Shield",
    region: "Europe",
    type: "supercup",
    country: "Netherlands",
    aliases: ["Dutch Super Cup", "Supercopa da Holanda"],
  },
  {
    key: "turkey-cup",
    displayName: "Turkish Cup",
    region: "Europe",
    type: "cup",
    country: "Turkey",
    aliases: ["Taça da Turquia", "Türkiye Kupası"],
  },
  {
    key: "belgian-cup",
    displayName: "Belgian Cup",
    region: "Europe",
    type: "cup",
    country: "Belgium",
    aliases: ["Taça da Bélgica", "Croky Cup"],
  },
  {
    key: "scottish-cup",
    displayName: "Scottish Cup",
    region: "Europe",
    type: "cup",
    country: "Scotland",
  },
  {
    key: "scottish-league-cup",
    displayName: "Scottish League Cup",
    region: "Europe",
    type: "cup",
    country: "Scotland",
    aliases: ["Viaplay Cup", "Taça da Liga Escocesa"],
  },

  // South America
  {
    key: "brasileirao-serie-a",
    displayName: "Brasileirão Série A",
    region: "South America",
    type: "league",
    country: "Brazil",
    aliases: ["Serie A Brazil", "Brasileirao"],
  },
  {
    key: "copa-do-brasil",
    displayName: "Copa do Brasil",
    region: "South America",
    type: "cup",
    country: "Brazil",
  },
  {
    key: "supercopa-do-brasil",
    displayName: "Supercopa do Brasil",
    region: "South America",
    type: "supercup",
    country: "Brazil",
  },
  {
    key: "liga-argentina",
    displayName: "Liga Profesional",
    region: "South America",
    type: "league",
    country: "Argentina",
    aliases: ["Liga Argentina", "Primera Division Argentina"],
  },
  {
    key: "copa-liga-argentina",
    displayName: "Copa de la Liga",
    region: "South America",
    type: "cup",
    country: "Argentina",
  },
  {
    key: "copa-argentina",
    displayName: "Copa Argentina",
    region: "South America",
    type: "cup",
    country: "Argentina",
  },
  {
    key: "supercopa-argentina",
    displayName: "Supercopa Argentina",
    region: "South America",
    type: "supercup",
    country: "Argentina",
  },
  {
    key: "campeonato-chileno",
    displayName: "Campeonato Chileno",
    region: "South America",
    type: "league",
    country: "Chile",
    aliases: ["Primera División Chile"],
  },
  {
    key: "copa-chile",
    displayName: "Copa Chile",
    region: "South America",
    type: "cup",
    country: "Chile",
  },
  {
    key: "campeonato-uruguaio",
    displayName: "Campeonato Uruguaio",
    region: "South America",
    type: "league",
    country: "Uruguay",
    aliases: ["Primera División Uruguay"],
  },
  {
    key: "copa-uruguay",
    displayName: "Copa Uruguay",
    region: "South America",
    type: "cup",
    country: "Uruguay",
  },
  {
    key: "campeonato-colombiano",
    displayName: "Liga BetPlay",
    region: "South America",
    type: "league",
    country: "Colombia",
    aliases: ["Campeonato Colombiano"],
  },
  {
    key: "copa-colombia",
    displayName: "Copa Colombia",
    region: "South America",
    type: "cup",
    country: "Colombia",
  },
  {
    key: "campeonato-peruano",
    displayName: "Liga 1",
    region: "South America",
    type: "league",
    country: "Peru",
    aliases: ["Liga Peruana"],
  },
  {
    key: "campeonato-paraguaio",
    displayName: "Primera División Paraguay",
    region: "South America",
    type: "league",
    country: "Paraguay",
    aliases: ["Liga Paraguaya"],
  },
  {
    key: "campeonato-equatoriano",
    displayName: "Liga Pro Ecuador",
    region: "South America",
    type: "league",
    country: "Ecuador",
    aliases: ["Liga Equatoriana"],
  },

  // North America
  {
    key: "mls",
    displayName: "MLS",
    region: "North America",
    type: "league",
    country: "USA",
    aliases: ["Major League Soccer"],
  },
  {
    key: "us-open-cup",
    displayName: "US Open Cup",
    region: "North America",
    type: "cup",
    country: "USA",
  },
  {
    key: "liga-mx",
    displayName: "Liga MX",
    region: "North America",
    type: "league",
    country: "Mexico",
  },
  {
    key: "copa-mx",
    displayName: "Copa MX",
    region: "North America",
    type: "cup",
    country: "Mexico",
    aliases: ["Copa Mexico"],
  },
  {
    key: "campeones-cup",
    displayName: "Campeones Cup",
    region: "North America",
    type: "supercup",
    country: "Mexico",
    aliases: ["Mexico vs USA Campeones Cup"],
  },

  // Asia & Middle East
  {
    key: "saudi-pro-league",
    displayName: "Saudi Pro League",
    region: "Asia",
    type: "league",
    country: "Saudi Arabia",
  },
  {
    key: "kings-cup",
    displayName: "King's Cup",
    region: "Asia",
    type: "cup",
    country: "Saudi Arabia",
    aliases: ["Kings Cup"],
  },
  {
    key: "qatar-stars-league",
    displayName: "Qatar Stars League",
    region: "Asia",
    type: "league",
    country: "Qatar",
  },
  {
    key: "copa-do-emir",
    displayName: "Copa do Emir",
    region: "Asia",
    type: "cup",
    country: "Qatar",
    aliases: ["Emir Cup"],
  },
  {
    key: "uae-pro-league",
    displayName: "UAE Pro League",
    region: "Asia",
    type: "league",
    country: "United Arab Emirates",
    aliases: ["Emirates League", "UAE Arabian Gulf League"],
  },
  {
    key: "emirates-fa-cup-uae",
    displayName: "Emirates FA Cup",
    region: "Asia",
    type: "cup",
    country: "United Arab Emirates",
    aliases: ["UAE President Cup"],
  },
  {
    key: "iran-pro-league",
    displayName: "Persian Gulf Pro League",
    region: "Asia",
    type: "league",
    country: "Iran",
    aliases: ["Iran Pro League"],
  },
  {
    key: "j1-league",
    displayName: "J1 League",
    region: "Asia",
    type: "league",
    country: "Japan",
  },
  {
    key: "emperors-cup",
    displayName: "Emperor's Cup",
    region: "Asia",
    type: "cup",
    country: "Japan",
  },
  {
    key: "k-league-1",
    displayName: "K League 1",
    region: "Asia",
    type: "league",
    country: "South Korea",
  },
  {
    key: "fa-cup-korea",
    displayName: "Korean FA Cup",
    region: "Asia",
    type: "cup",
    country: "South Korea",
    aliases: ["FA Cup Coreia do Sul"],
  },
  {
    key: "chinese-super-league",
    displayName: "Chinese Super League",
    region: "Asia",
    type: "league",
    country: "China",
  },
  {
    key: "china-fa-cup",
    displayName: "China FA Cup",
    region: "Asia",
    type: "cup",
    country: "China",
  },
  {
    key: "indian-super-league",
    displayName: "Indian Super League",
    region: "Asia",
    type: "league",
    country: "India",
  },
  {
    key: "india-super-cup",
    displayName: "India Super Cup",
    region: "Asia",
    type: "cup",
    country: "India",
  },

  // Africa
  {
    key: "egypt-cup",
    displayName: "Egypt Cup",
    region: "Africa",
    type: "cup",
    country: "Egypt",
  },
  {
    key: "moroccan-throne-cup",
    displayName: "Moroccan Throne Cup",
    region: "Africa",
    type: "cup",
    country: "Morocco",
  },
  {
    key: "nedbank-cup",
    displayName: "Nedbank Cup",
    region: "Africa",
    type: "cup",
    country: "South Africa",
    aliases: ["South African Nedbank Cup"],
  },
  {
    key: "tunisian-cup",
    displayName: "Tunisian Cup",
    region: "Africa",
    type: "cup",
    country: "Tunisia",
  },
  {
    key: "algerian-cup",
    displayName: "Algerian Cup",
    region: "Africa",
    type: "cup",
    country: "Algeria",
  },

  // International Club Competitions
  {
    key: "uefa-champions-league",
    displayName: "UEFA Champions League",
    region: "International",
    type: "cup",
    country: "UEFA",
    aliases: [
      "Champions League",
      "Liga dos Campeões",
      "UCL",
      "World UEFA Champions League",
    ],
    apiFootballIds: [2],
  },
  {
    key: "uefa-europa-league",
    displayName: "UEFA Europa League",
    region: "International",
    type: "cup",
    country: "UEFA",
    aliases: ["Europa League", "Liga Europa", "UEL", "World UEFA Europa League"],
    apiFootballIds: [3],
  },
  {
    key: "uefa-europa-conference-league",
    displayName: "UEFA Europa Conference League",
    region: "International",
    type: "cup",
    country: "UEFA",
    aliases: [
      "Europa Conference League",
      "Liga Conferência",
      "UECL",
      "World UEFA Conference League",
    ],
    apiFootballIds: [848],
  },
  {
    key: "uefa-super-cup",
    displayName: "UEFA Super Cup",
    region: "International",
    type: "supercup",
    country: "UEFA",
    aliases: ["Supertaça Europeia", "European Super Cup", "UEFA Supercup"],
    apiFootballIds: [528],
  },
  {
    key: "copa-libertadores",
    displayName: "Copa Libertadores",
    region: "International",
    type: "cup",
    country: "CONMEBOL",
    aliases: ["CONMEBOL Libertadores", "Libertadores", "Taça Libertadores"],
    apiFootballIds: [13],
  },
  {
    key: "copa-sudamericana",
    displayName: "Copa Sudamericana",
    region: "International",
    type: "cup",
    country: "CONMEBOL",
    aliases: ["CONMEBOL Sudamericana", "Sudamericana", "Copa Sul-Americana"],
    apiFootballIds: [44],
  },
  {
    key: "recopa-sudamericana",
    displayName: "Recopa Sudamericana",
    region: "International",
    type: "supercup",
    country: "CONMEBOL",
    aliases: ["CONMEBOL Recopa", "Recopa", "Supercopa CONMEBOL"],
    apiFootballIds: [215],
  },
  {
    key: "concacaf-champions-cup",
    displayName: "CONCACAF Champions Cup",
    region: "International",
    type: "cup",
    country: "CONCACAF",
    aliases: [
      "CONCACAF Champions League",
      "Liga dos Campeões CONCACAF",
      "CCL",
    ],
    apiFootballIds: [32],
  },
  {
    key: "leagues-cup",
    displayName: "Leagues Cup",
    region: "International",
    type: "cup",
    country: "CONCACAF",
    aliases: ["Leagues Cup MLS", "Copa das Ligas", "MLS vs Liga MX"],
    apiFootballIds: [719],
  },
  {
    key: "afc-champions-league",
    displayName: "AFC Champions League",
    region: "International",
    type: "cup",
    country: "AFC",
    aliases: ["Liga dos Campeões da AFC", "Asian Champions League", "ACL"],
    apiFootballIds: [17],
  },
  {
    key: "afc-cup",
    displayName: "AFC Cup",
    region: "International",
    type: "cup",
    country: "AFC",
    aliases: ["Taça AFC", "AFC Cup", "Copa AFC"],
    apiFootballIds: [18],
  },
  {
    key: "caf-champions-league",
    displayName: "CAF Champions League",
    region: "International",
    type: "cup",
    country: "CAF",
    aliases: ["Liga dos Campeões CAF", "African Champions League", "CAF CL"],
    apiFootballIds: [10],
  },
  {
    key: "caf-confederation-cup",
    displayName: "CAF Confederation Cup",
    region: "International",
    type: "cup",
    country: "CAF",
    aliases: ["Taça das Confederações CAF", "CAF CC", "African Confederation Cup"],
    apiFootballIds: [11],
  },
  {
    key: "fifa-club-world-cup",
    displayName: "FIFA Club World Cup",
    region: "Intercontinental",
    type: "cup",
    country: "FIFA",
    aliases: ["Mundial de Clubes", "Club World Cup", "FIFA CWC"],
    apiFootballIds: [8],
  },

  // International & National Team Tournaments
  {
    key: "fifa-world-cup",
    displayName: "FIFA World Cup",
    region: "Intercontinental",
    type: "cup",
    country: "FIFA",
    aliases: ["World Cup", "Mundial", "Copa do Mundo"],
    apiFootballIds: [1],
  },
  {
    key: "copa-america",
    displayName: "Copa América",
    region: "International",
    type: "cup",
    country: "CONMEBOL",
    aliases: ["Copa America", "CONMEBOL Copa América", "Copa América de Seleções"],
    apiFootballIds: [6],
  },
  {
    key: "uefa-euro",
    displayName: "UEFA Euro",
    region: "International",
    type: "cup",
    country: "UEFA",
    aliases: ["Euro", "European Championship", "Eurocopa"],
    apiFootballIds: [4],
  },
  {
    key: "africa-cup-of-nations",
    displayName: "Africa Cup of Nations",
    region: "International",
    type: "cup",
    country: "CAF",
    aliases: ["Copa Africana de Nações", "CAN", "AFCON"],
    apiFootballIds: [7],
  },
  {
    key: "afc-asian-cup",
    displayName: "AFC Asian Cup",
    region: "International",
    type: "cup",
    country: "AFC",
    aliases: ["Taça Asiática", "Asian Cup", "Copa da Ásia"],
    apiFootballIds: [34],
  },
  {
    key: "concacaf-gold-cup",
    displayName: "CONCACAF Gold Cup",
    region: "International",
    type: "cup",
    country: "CONCACAF",
    aliases: ["Gold Cup", "Taça Ouro", "Copa Ouro"],
    apiFootballIds: [24],
  },
  {
    key: "olympic-games-football",
    displayName: "Olympic Football Tournament",
    region: "Intercontinental",
    type: "cup",
    country: "IOC",
    aliases: ["Jogos Olímpicos", "Olympics Football", "Torneio Olímpico"],
    apiFootballIds: [679],
  },
];

const normalizedCompetitions: NormalizedCompetition[] = SUPPORTED_COMPETITIONS.map(buildNormalizedCompetition);

const competitionsById = new Map<number, NormalizedCompetition>();
normalizedCompetitions.forEach((competition) => {
  competition.apiFootballIds?.forEach((id) => competitionsById.set(id, competition));
});

export const REGION_ORDER: CompetitionRegion[] = [
  "Europe",
  "South America",
  "North America",
  "Asia",
  "Africa",
  "International",
  "Intercontinental",
];

export const REGION_LABEL: Record<CompetitionRegion, string> = {
  Europe: "Europa",
  "South America": "América do Sul",
  "North America": "América do Norte",
  Asia: "Ásia & Médio Oriente",
  Africa: "África",
  International: "Competições Continentais",
  Intercontinental: "Competições Mundiais",
};

export const identifyCompetition = (
  league: { id?: number | null; name?: string | null; country?: string | null } | null | undefined,
): CompetitionMetadata | null => {
  if (!league) {
    return null;
  }

  if (league.id && competitionsById.has(league.id)) {
    return competitionsById.get(league.id)!;
  }

  const normalizedName = league.name ? normalize(league.name) : null;
  const normalizedCountry = league.country ? normalize(league.country) : null;

  for (const competition of normalizedCompetitions) {
    if (normalizedName && competition.normalizedAliases.has(normalizedName)) {
      return competition;
    }

    if (normalizedName && normalizedCountry) {
      const combined = `${normalizedCountry} ${normalizedName}`;
      if (competition.normalizedAliases.has(combined)) {
        return competition;
      }
    }
  }

  return null;
};

export const isCompetitionSupported = (
  league: { id?: number | null; name?: string | null; country?: string | null } | null | undefined,
): boolean => identifyCompetition(league) !== null;

export const getCompetitionKey = (
  league: { id?: number | null; name?: string | null; country?: string | null } | null | undefined,
): string | null => identifyCompetition(league)?.key ?? null;

