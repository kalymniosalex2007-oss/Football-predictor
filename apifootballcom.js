
const BASE = 'https://live-football-api.com/api/v1';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const number = value => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const id = value => String(value ?? '');

const TRACK = /(Premier League|Championship|La Liga|Primera Division|Bundesliga|Serie A|Serie B|Ligue 1|Ligue 2|Eredivisie|Primeira Liga|Liga Portugal|Super League|Super Lig|Scottish Premiership|Champions League|Europa League|Conference League|Europa Conference|FA Cup|EFL Cup|Copa del Rey|Coppa Italia|DFB Pokal|Coupe de France|World Cup|Nations League|Euro Championship|Copa America|Africa Cup|Asian Cup|Gold Cup|Greek Super League|Super League Greece|Belgian Pro League|MLS|Major League Soccer|Liga MX|Brasileirao|J League|A League)/i;

export function altTracked(league) {
  return TRACK.test(`${league?.name || ''} ${league?.country || ''}`);
}

function athensDate(timestamp) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Athens',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(timestamp * 1000));

  const get = type => parts.find(x => x.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function previousDate(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function kickoffTimestamp(date, kickoff) {
  if (!date || !kickoff) return null;

  const value = String(kickoff);

  const iso = value.includes('T')
    ? value
    : `${date}T${value.length === 5 ? `${value}:00` : value}Z`;

  const timestamp = Math.floor(Date.parse(iso) / 1000);
  return Number.isFinite(timestamp) ? timestamp : null;
}

// Μετατρέπει οποιαδήποτε μορφή status σε ενιαίο κείμενο.
function statusText(status) {
  if (status === null || status === undefined) return '';

  if (typeof status !== 'object') {
    return String(status);
  }

  return [
    status.short,
    status.long,
    status.status,
    status.state,
    status.display,
    status.name,
    status.description,
    status.type
  ]
    .filter(Boolean)
    .join(' ');
}

// Αναγνωρίζει την κατάσταση του αγώνα ανεξάρτητα από τη μορφή του API.
function statusCode(status) {
  const raw = statusText(status).toLowerCase();

  if (/cancel|canceled|cancelled/.test(raw)) return 'CANC';
  if (/postpon|delayed/.test(raw)) return 'PST';
  if (/abandon/.test(raw)) return 'ABD';
  if (/suspend/.test(raw)) return 'SUSP';
  if (/walk.?over|awarded/.test(raw)) return 'AWD';
  if (/not.?played/.test(raw)) return 'WO';

  if (
    /\bpen\b|penalty shootout|penalties|after penalties|finished after penalties/.test(raw)
  ) return 'PEN';

  if (/after extra time|aet|extra.?time.*finish|finished.*extra.?time/.test(raw)) {
    return 'AET';
  }

  if (
    /finish|finished|postgame|full.?time|fulltime|\bft\b|\bms\b|completed|ended/.test(raw)
  ) return 'FT';

  if (/half.?time|\bht\b/.test(raw)) return 'HT';

  if (/second.?half|\b2h\b/.test(raw)) return '2H';

  if (/first.?half|\b1h\b|inplay|in.?progress|live/.test(raw)) {
    return '1H';
  }

  if (/extra.?time/.test(raw)) return 'ET';

  if (/upcoming|scheduled|not.?started|not started|\bns\b/.test(raw)) {
    return 'NS';
  }

  if (/to be determined|\btbd\b/.test(raw)) return 'TBD';

  return 'NS';
}

function scoreValue(value) {
  return number(value);
}

function mapMatch(match, utcDate) {
  const ts = match.timestamp
    ? number(match.timestamp)
    : kickoffTimestamp(utcDate, match.kickoff);

  if (!ts) return null;

  const home = match.home || {};
  const away = match.away || {};
  const league = match.league || {};

  const status = statusCode(match.status);

  const gh = scoreValue(home.score);
  const ga = scoreValue(away.score);

  const finished = ['FT', 'AET', 'PEN'].includes(status);

  return {
    fixture: {
      id: match.id,
      timestamp: ts,
      date: {
        timestamp: ts,
        date: new Date(ts * 1000).toISOString()
      },
      venue: {
        name: match.venue?.name || null
      },
      status: {
        short: status,
        long: statusText(match.status) || status
      }
    },

    league: {
      id: league.id,
      name: league.name,
      country: league.country || 'World',
      logo: league.logo || null,
      season: match.season || null,
      round: match.week || match.round || null
    },

    teams: {
      home: {
        id: home.id,
        name: home.name,
        logo: home.logo || null
      },
      away: {
        id: away.id,
        name: away.name,
        logo: away.logo || null
      }
    },

    goals: {
      home: gh,
      away: ga
    },

    score: {
      halftime: {
        home: number(match.halftime?.home),
        away: number(match.halftime?.away)
      },
      fulltime: {
        home: finished ? gh : null,
        away: finished ? ga : null
      }
    },

    corners: null
  };
}

function mapTeamMatch(match) {
  const date = match.date
    ? String(match.date).replace(' ', 'T') + 'Z'
    : null;

  const ts = number(match.timestamp) ||
    (date ? Math.floor(Date.parse(date) / 1000) : null);

  if (!ts) return null;

  const home = match.home || {};
  const away = match.away || {};
  const status = statusCode(match.status);

  return {
    fixture: {
      id: match.id,
      timestamp: ts,
      status: {
        short: status,
        long: statusText(match.status) || status
      }
    },

    league: {
      id: match.league?.id,
      name: match.league?.name || '',
      country: match.league?.country || ''
    },

    teams: {
      home: {
        id: home.id,
        name: home.name,
        logo: home.logo || null
      },
      away: {
        id: away.id,
        name: away.name,
        logo: away.logo || null
      }
    },

    goals: {
      home: number(home.score),
      away: number(away.score)
    },

    score: {
      halftime: {
        home: null,
        away: null
      }
    },

    corners: null
  };
}

function parseScore(score) {
  const match = String(score || '').match(/(\d+)\s*[-:]\s*(\d+)/);

  return match
    ? {
        home: Number(match[1]),
        away: Number(match[2])
      }
    : {
        home: null,
        away: null
      };
}

function mapH2H(match) {
  const score = parseScore(match.score);

  const timestamp = Math.floor(
    Date.parse(`${match.date}T00:00:00Z`) / 1000
  );

  if (!Number.isFinite(timestamp)) return null;

  return {
    fixture: {
      id: `${match.home?.id}-${match.away?.id}-${match.date}`,
      timestamp
    },

    teams: {
      home: {
        id: match.home?.id,
        name: match.home?.name
      },
      away: {
        id: match.away?.id,
        name: match.away?.name
      }
    },

    goals: score
  };
}

function mapStandingRow(row, homeRow, awayRow) {
  const played = number(row.played);
  const goalsFor = number(row.goals_for);
  const goalsAgainst = number(row.goals_against);

  const mapSplit = split => ({
    played: number(split?.played),
    win: number(split?.won),
    draw: number(split?.drawn),
    lose: number(split?.lost),
    goals: {
      for: number(split?.goals_for),
      against: number(split?.goals_against)
    }
  });

  return {
    rank: number(row.rank),
    points: number(row.points),
    description: row.zone?.name || null,
    form: row.form || null,

    team: {
      id: row.team?.id,
      name: row.team?.name,
      logo: row.team?.logo || null
    },

    all: {
      played,
      win: number(row.won),
      draw: number(row.drawn),
      lose: number(row.lost),
      goals: {
        for: goalsFor,
        against: goalsAgainst
      }
    },

    home: mapSplit(homeRow),
    away: mapSplit(awayRow)
  };
}

function mapStandings(data) {
  const main = data?.standings || [];
  const homeGroups = data?.home_standings || [];
  const awayGroups = data?.away_standings || [];

  return main.map((group, index) => {
    const homeTable = homeGroups[index]?.table || [];
    const awayTable = awayGroups[index]?.table || [];

    const homeById = new Map(
      homeTable.map(row => [id(row.team?.id), row])
    );

    const awayById = new Map(
      awayTable.map(row => [id(row.team?.id), row])
    );

    return (group.table || []).map(row =>
      mapStandingRow(
        row,
        homeById.get(id(row.team?.id)),
        awayById.get(id(row.team?.id))
      )
    );
  });
}

function mapLineups(data) {
  if (!data?.home || !data?.away) return [];

  return ['home', 'away'].map(side => {
    const team = data[side];
    const formation = data.formation?.[side];

    return {
      team: {
        id: team.id || null
      },
      formation: formation ? String(formation) : null,
      coach: team.coach || null,

      startXI: (team.starting || []).map(player => ({
        player: {
          id: player.id,
          name: player.name,
          number: number(player.number),
          pos: player.position || null
        }
      })),

      substitutes: (team.subs || []).map(player => ({
        player: {
          id: player.id,
          name: player.name,
          number: number(player.number),
          pos: player.position || null
        }
      }))
    };
  });
}

function mapInjuries(data) {
  const injuries = data?.injuries;

  if (!injuries) return [];

  return [
    ...(injuries.home || []).map(player => ({
      team_id: data.home?.id,
      name: player.name,
      reason: player.status || '',
      type: /questionable|doubtful/i.test(player.status || '')
        ? 'Questionable'
        : 'Missing'
    })),

    ...(injuries.away || []).map(player => ({
      team_id: data.away?.id,
      name: player.name,
      reason: player.status || '',
      type: /questionable|doubtful/i.test(player.status || '')
        ? 'Questionable'
        : 'Missing'
    }))
  ];
}

export function makeAltApi(usage, name = 'football') {
  let lastRequest = 0;

  usage[name] = {
    limit: null,
    remaining: null,
    calls: 0,
    window: null,
    error: null
  };

  const cache = new Map();

  async function request(endpoint, params = {}, ttl = 0) {
    const clean = Object.fromEntries(
      Object.entries(params).filter(([, value]) =>
        value !== undefined && value !== null && value !== ''
      )
    );

    const cacheKey = `${endpoint}:${JSON.stringify(clean)}`;

    const cached = cache.get(cacheKey);

    if (ttl && cached && Date.now() - cached.time < ttl) {
      return cached.data;
    }

    const key = process.env.API_FOOTBALL_KEY;

    if (!key) {
      throw new Error('Λείπει το API_FOOTBALL_KEY');
    }

    const u = usage[name];

    if (u.remaining !== null && u.remaining <= 0) {
      throw new Error('QUOTA: εξαντλήθηκαν τα διαθέσιμα credits του Football API');
    }

    const delay = Number(process.env.API_DELAY_MS ?? 6500);
    const wait = lastRequest + delay - Date.now();

    if (wait > 0) await sleep(wait);

    const url = new URL(`${BASE}/${endpoint}`);

    url.searchParams.set('api_key', key);
    url.searchParams.set('lang', 'en');

    for (const [k, v] of Object.entries(clean)) {
      url.searchParams.set(k, String(v));
    }

    let response;

    try {
      response = await fetch(url);
    } catch (error) {
      u.error = error.message;
      throw error;
    }

    lastRequest = Date.now();
    u.calls++;

    let json;

    try {
      json = await response.json();
    } catch {
      throw new Error(`Football API: μη έγκυρη απάντηση (${response.status})`);
    }

    if (Number.isFinite(Number(json.credits_remaining))) {
      u.remaining = Number(json.credits_remaining);
    }

    if (!response.ok || json.success === false) {
      const message = json.message || json.error || `HTTP ${response.status}`;

      u.error = message;

      if (response.status === 403) {
        throw new Error(`QUOTA: ${message}`);
      }

      if (response.status === 429) {
        throw new Error(`RATE LIMIT: ${message}`);
      }

      throw new Error(`Football API ${response.status}: ${message}`);
    }

    u.error = null;

    const data = json.data ?? {};

    if (ttl) {
      cache.set(cacheKey, {
        time: Date.now(),
        data
      });
    }

    return data;
  }

  return async function api(endpoint, params = {}) {
    // Αγώνες ημέρας
    if (endpoint === '/fixtures' && params.date) {
      const date = params.date;
      const dates = [previousDate(date), date];

      const results = await Promise.all(
        dates.map(async utcDate => {
          const data = await request(
            '/matches',
            { date: utcDate },
            45_000
          );

          return (data.matches || [])
            .map(match => mapMatch(match, utcDate))
            .filter(Boolean);
        })
      );

      const matches = results
        .flat()
        .filter(match =>
          athensDate(match.fixture.timestamp) === date
        );

      return [...new Map(
        matches.map(match => [id(match.fixture.id), match])
      ).values()];
    }

    // Πρόσφατοι αγώνες ομάδας
    if (endpoint === '/fixtures' && params.team) {
      const data = await request(
        '/team_matches',
        { team_id: params.team },
        30 * 60_000
      );

      return (data.matches || [])
        .map(mapTeamMatch)
        .filter(Boolean)
        .sort((a, b) =>
          b.fixture.timestamp - a.fixture.timestamp
        );
    }

    // Κατάλογος διοργανώσεων
    if (endpoint === '/leagues') {
      const data = await request(
        '/leagues',
        {},
        12 * 60 * 60_000
      );

      return (data.data || []).flatMap(country =>
        (country.leagues || []).map(league => ({
          league: {
            id: league.id,
            name: league.name,
            type: 'League',
            logo: league.logo || null
          },
          country: {
            name: country.country || '',
            code: ''
          }
        }))
      );
    }

    // Βαθμολογίες
    if (endpoint === '/standings') {
      const data = await request(
        '/league_standings',
        {
          league_id: params.league,
          season: params.season
        },
        12 * 60 * 60_000
      );

      const standings = mapStandings(data);

      return [{
        league: {
          standings
        }
      }];
    }

    // H2H: χρησιμοποιείται από το μοντέλο ανάλυσης
    if (endpoint === '/predictions') {
      const data = await request(
        '/h2h',
        { match_id: params.fixture },
        12 * 60 * 60_000
      );

      return [{
        h2h: (data.h2h || [])
          .map(mapH2H)
          .filter(Boolean)
      }];
    }

    // Ενδεκάδες
    if (endpoint === '/fixtures/lineups') {
      const data = await request(
        '/lineups',
        { match_id: params.fixture },
        5 * 60_000
      );

      return mapLineups(data);
    }

    // Τραυματισμοί/τιμωρίες
    if (endpoint === '/injuries') {
      const data = await request(
        '/injuries',
        { match_id: params.fixture },
        30 * 60_000
      );

      return mapInjuries(data);
    }

    // Στατιστικά αγώνα
    if (endpoint === '/fixtures/statistics') {
      const data = await request(
        '/live_match_details',
        { match_id: params.fixture },
        60_000
      );

      return data.stats || [];
    }

    // Το Live Football API δεν διαθέτει endpoint αποδόσεων.
    if (endpoint === '/odds') {
      return [];
    }

    throw new Error(`Μη υποστηριζόμενο Football API endpoint: ${endpoint}`);
  };
}
