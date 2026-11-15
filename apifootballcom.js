
import * as supa from './supa.js';

const BASE = 'https://apiv3.apifootball.com/';
const TZ = 'Europe/Athens';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const num = v =>
  v === '' || v == null || !Number.isFinite(Number(v))
    ? null
    : Number(v);

const idOf = v => Number.isFinite(Number(v)) ? Number(v) : v;

const ymd = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);

const addDays = (iso, n) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function offsetMs(ms) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(new Date(ms));

  const g = t => Number(f.find(p => p.type === t).value);

  return Date.UTC(
    g('year'),
    g('month') - 1,
    g('day'),
    g('hour') % 24,
    g('minute'),
    g('second')
  ) - ms;
}

function athensTs(date, time) {
  if (!date) return 0;

  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0);
  const t1 = guess - offsetMs(guess);

  return Math.floor((guess - offsetMs(t1)) / 1000);
}

const STATUS = {
  finished: 'FT',
  'after et': 'AET',
  'after pen.': 'PEN',
  'half time': 'HT',
  postponed: 'PST',
  cancelled: 'CANC',
  canceled: 'CANC',
  awarded: 'AWD',
  abandoned: 'ABD',
  'walk over': 'WO'
};

const short = e => {
  const s = String(e.match_status || '').trim().toLowerCase();

  if (!s) return 'NS';
  if (STATUS[s]) return STATUS[s];

  if (/^\d/.test(s) || e.match_live === '1') {
    return parseInt(s, 10) > 45 ? '2H' : '1H';
  }

  return 'NS';
};

const WORLD = ['eurocups', 'intl', 'international', 'world'];

const countryName = value => {
  const c = String(value || '').trim();
  return WORLD.includes(c.toLowerCase()) ? 'World' : c;
};

function cornerTotal(e) {
  const stats = Array.isArray(e?.statistics) ? e.statistics : [];
  const c = stats.find(s => /corner/i.test(String(s.type || '')));

  if (!c) return null;

  const h = num(c.home);
  const a = num(c.away);

  return h === null || a === null ? null : h + a;
}

export function toFx(e) {
  const st = short(e);
  const gh = num(e.match_hometeam_score);
  const ga = num(e.match_awayteam_score);

  return {
    fixture: {
      id: idOf(e.match_id),
      timestamp: athensTs(e.match_date, e.match_time),
      venue: { name: e.match_stadium || null },
      status: { short: st }
    },
    league: {
      id: idOf(e.league_id),
      name: e.league_name || '',
      country: countryName(e.country_name),
      logo: e.league_logo || '',
      season: e.league_year || e.match_date?.slice(0, 4) || '',
      round: e.match_round
        ? `Round ${e.match_round}`
        : (e.stage_name || '')
    },
    teams: {
      home: {
        id: idOf(e.match_hometeam_id),
        name: e.match_hometeam_name || '',
        logo: e.team_home_badge || ''
      },
      away: {
        id: idOf(e.match_awayteam_id),
        name: e.match_awayteam_name || '',
        logo: e.team_away_badge || ''
      }
    },
    goals: { home: gh, away: ga },
    score: {
      halftime: {
        home: num(e.match_hometeam_halftime_score),
        away: num(e.match_awayteam_halftime_score)
      },
      fulltime: {
        home: num(e.match_hometeam_ft_score) ?? (st === 'FT' ? gh : null),
        away: num(e.match_awayteam_ft_score) ?? (st === 'FT' ? ga : null)
      }
    },
    corners: cornerTotal(e)
  };
}

// Διοργανώσεις που αναλύονται.
// Τα IDs του apifootball.com διαφέρουν από τα IDs του API-Sports.
const TRACK = [
  ['england', /^(premier league|championship|fa cup|league cup|efl cup)$/i],
  ['spain', /^(la liga|primera division|copa del rey)$/i],
  ['italy', /^(serie a|serie b|coppa italia)$/i],
  ['germany', /^(bundesliga|2\. bundesliga|dfb pokal)$/i],
  ['france', /^(ligue 1|ligue 2|coupe de france)$/i],
  ['greece', /^super league( 1)?$/i],
  ['netherlands', /^eredivisie$/i],
  ['portugal', /^(liga portugal|primeira liga)$/i],
  ['turkey', /^(super lig|süper lig)$/i],
  ['*', /(champions league|europa league|conference league)/i]
];

export const altTracked = l =>
  TRACK.some(([c, r]) => {
    const country = String(l?.country || '').toLowerCase();
    const name = String(l?.name || '');

    return (c === '*' || country === c) &&
      r.test(name) &&
      !/women|u\d\d|youth/i.test(name);
  });

export function makeAltApi(usage, name) {
  usage[name] = {
    limit: null,
    remaining: null,
    calls: 0,
    window: null,
    error: null,
    sample: null,
    blocked: false
  };

  const u = usage[name];
  let last = 0;

  const evById = new Map();
  const lastByTeam = new Map();
  const lineupCache = new Map();
  const statsCache = new Map();

  async function call(action, params = {}) {
    const key = process.env.API_FOOTBALL_KEY;

    if (!key) {
      throw new Error('Λείπει το API_FOOTBALL_KEY στα GitHub Secrets');
    }

    if (u.blocked) {
      throw new Error('BLOCKED: προσωρινή παύση κλήσεων API');
    }

    const wait = last + Number(process.env.API_DELAY_MS ?? 2500) - Date.now();

    if (wait > 0) await sleep(wait);

    const url = new URL(BASE);
    url.searchParams.set('action', action);

    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.set(k, String(v));
      }
    }

    url.searchParams.set('APIkey', key);

    let res;

    try {
      res = await fetch(url);
    } catch {
      u.error = `apifootball.com ${action}: αποτυχία σύνδεσης`;
      throw new Error(u.error);
    }

    last = Date.now();
    u.calls++;

    let j;

    try {
      j = await res.json();
    } catch {
      u.error = `apifootball.com ${action}: μη έγκυρη απάντηση HTTP ${res.status}`;
      throw new Error(u.error);
    }

    const fail = msg => {
      if (
        /key|suspend|expired|trial|payment|unauthor|forbidden/i.test(msg) ||
        [401, 403].includes(res.status)
      ) {
        u.blocked = true;
        msg = 'BLOCKED: ' + msg;
      } else if (/limit|too many/i.test(msg)) {
        msg = 'QUOTA: ' + msg;
      }

      u.error = msg.slice(0, 300);
      throw new Error(msg);
    };

    if (j && !Array.isArray(j) && j.error !== undefined) {
      const message = String(j.message || '');

      if (
        String(j.error) === '404' ||
        /no (event|match|result|data|standing|odd|league|prediction)/i.test(message)
      ) {
        return [];
      }

      return fail(`apifootball.com ${action}: ${j.error} ${message}`);
    }

    if (!res.ok) {
      return fail(`apifootball.com ${action}: HTTP ${res.status}`);
    }

    if (
      action === 'get_events' &&
      Array.isArray(j) &&
      j[0] &&
      !u.sample
    ) {
      u.sample = JSON.stringify(j[0]).slice(0, 700);
    }

    return j;
  }

  const events = async (from, to, extra = {}) => {
    const r = await call('get_events', {
      from,
      to,
      timezone: TZ,
      ...extra
    });

    if (Array.isArray(r)) {
      r.forEach(e => {
        if (e.match_id != null) {
          evById.set(String(e.match_id), e);
        }
      });

      return r;
    }

    return [];
  };

  const eventById = async id => {
    if (evById.has(String(id))) {
      return evById.get(String(id));
    }

    const today = ymd();

    await events(
      addDays(today, -2),
      addDays(today, 7),
      { match_id: id }
    );

    return evById.get(String(id)) || null;
  };

  const keyedMatch = (data, id) => {
    if (!data || typeof data !== 'object') return {};
    return data[String(id)] || data;
  };

  const standingsRaw = lid =>
    supa.cached(`ac:standings:${lid}`, 12 * 3600, async () => {
      const r = await call('get_standings', { league_id: lid });
      return Array.isArray(r) ? r : [];
    });

  const sRow = r => {
    const blk = p => ({
      played: num(r[`${p}_league_payed`]) ?? 0,
      win: num(r[`${p}_league_W`]) ?? 0,
      draw: num(r[`${p}_league_D`]) ?? 0,
      lose: num(r[`${p}_league_L`]) ?? 0,
      goals: {
        for: num(r[`${p}_league_GF`]) ?? 0,
        against: num(r[`${p}_league_GA`]) ?? 0
      }
    });

    return {
      rank: num(r.overall_league_position),
      team: {
        id: idOf(r.team_id),
        name: r.team_name,
        logo: r.team_badge || ''
      },
      points: num(r.overall_league_PTS) ?? 0,
      goalsDiff:
        (num(r.overall_league_GF) ?? 0) -
        (num(r.overall_league_GA) ?? 0),
      group: r.stage_name || null,
      form: null,
      description: r.overall_promotion || null,
      all: blk('overall'),
      home: blk('home'),
      away: blk('away')
    };
  };

  const teamStats = r => {
    if (!r) return {};

    const s = sRow(r);
    const avg = (a, b) => b ? +(a / b).toFixed(2) : null;

    const f = g => ({
      home: g(s.home),
      away: g(s.away),
      total: g(s.all)
    });

    return {
      league: {
        goals: {
          for: {
            average: f(x => avg(x.goals.for, x.played)),
            total: f(x => x.goals.for)
          },
          against: {
            average: f(x => avg(x.goals.against, x.played)),
            total: f(x => x.goals.against)
          }
        },
        fixtures: {
          played: f(x => x.played),
          wins: f(x => x.win),
          draws: f(x => x.draw),
          loses: f(x => x.lose)
        }
      }
    };
  };

  const getH2H = async (homeId, awayId) => {
    const raw = await call('get_H2H', {
      firstTeamId: homeId,
      secondTeamId: awayId
    });

    // Η τεκμηρίωση επιστρέφει αντικείμενο, αλλά υποστηρίζουμε
    // και απάντηση μέσα σε πίνακα για συμβατότητα.
    const data = Array.isArray(raw) ? (raw[0] || {}) : (raw || {});

    const h2h = Array.isArray(data.firstTeam_VS_secondTeam)
      ? data.firstTeam_VS_secondTeam
      : [];

    const homeRecent = Array.isArray(data.firstTeam_lastResults)
      ? data.firstTeam_lastResults
      : [];

    const awayRecent = Array.isArray(data.secondTeam_lastResults)
      ? data.secondTeam_lastResults
      : [];

    lastByTeam.set(String(homeId), homeRecent.map(toFx));
    lastByTeam.set(String(awayId), awayRecent.map(toFx));

    return h2h.map(toFx);
  };

  const getPrediction = async e => {
    const date = e.match_date || ymd();

    const raw = await call('get_predictions', {
      from: date,
      to: date,
      match_id: e.match_id
    });

    const rows = Array.isArray(raw) ? raw : [];
    const row = rows.find(x => String(x.match_id) === String(e.match_id))
      || rows[0];

    if (!row) return {};

    const home = num(row.prob_HW);
    const draw = num(row.prob_D);
    const away = num(row.prob_AW);

    const percent =
      home !== null && draw !== null && away !== null
        ? { home, draw, away }
        : null;

    return {
      percent,
      advice: row.advice || null
    };
  };

  const getLineups = async id => {
    if (lineupCache.has(String(id))) {
      return lineupCache.get(String(id));
    }

    const raw = await call('get_lineups', { match_id: id });
    const data = keyedMatch(raw, id);
    const lineup = data.lineup || data;

    lineupCache.set(String(id), lineup || {});
    return lineup || {};
  };

  const getStatistics = async id => {
    if (statsCache.has(String(id))) {
      return statsCache.get(String(id));
    }

    const raw = await call('get_statistics', { match_id: id });
    const data = keyedMatch(raw, id);
    const stats = Array.isArray(data.statistics) ? data.statistics : [];

    statsCache.set(String(id), stats);
    return stats;
  };

  const H = {
    '/fixtures': async p => {
      if (p.date) {
        return (await events(p.date, p.date)).map(toFx);
      }

      if (p.team) {
        return (lastByTeam.get(String(p.team)) || [])
          .slice(0, Number(p.last) || 5);
      }

      return [];
    },

    '/leagues': async () => {
      const rows = await call('get_leagues');

      if (!Array.isArray(rows)) return [];

      return rows.map(x => ({
        league: {
          id: idOf(x.league_id),
          name: x.league_name,
          type: 'League',
          logo: x.league_logo || ''
        },
        country: {
          name: countryName(x.country_name),
          code: ''
        }
      }));
    },

    '/standings': async p => {
      const r = await standingsRaw(p.league);

      return r.length
        ? [{ league: { standings: [r.map(sRow)] } }]
        : [];
    },

    '/predictions': async p => {
      const e = await eventById(p.fixture);

      if (!e) return [];

      const rows = await standingsRaw(e.league_id).catch(() => []);

      const find = id =>
        rows.find(r => String(r.team_id) === String(id));

      let h2h = [];
      let prediction = {};

      try {
        h2h = await getH2H(
          e.match_hometeam_id,
          e.match_awayteam_id
        );
      } catch (err) {
        if (/QUOTA|BLOCKED/.test(err.message)) throw err;
      }

      try {
        prediction = await getPrediction(e);
      } catch (err) {
        if (/QUOTA|BLOCKED/.test(err.message)) throw err;
      }

      return [{
        teams: {
          home: teamStats(find(e.match_hometeam_id)),
          away: teamStats(find(e.match_awayteam_id))
        },
        h2h,
        predictions: prediction
      }];
    },

    '/odds': async p => {
      const e = await eventById(p.fixture);
      const date = e?.match_date || ymd();

      const rows = await call('get_odds', {
        from: date,
        to: date,
        match_id: p.fixture
      });

      if (!Array.isArray(rows) || !rows.length) return [];

      return [{
        bookmakers: rows.map(r => ({
          name: r.odd_bookmakers || 'apifootball.com',
          bets: [
            {
              name: 'Match Winner',
              values: [
                { value: 'Home', odd: r.odd_1 },
                { value: 'Draw', odd: r.odd_x },
                { value: 'Away', odd: r.odd_2 }
              ]
            },
            {
              name: 'Goals Over/Under',
              values: [
                { value: 'Over 2.5', odd: r['o+2.5'] },
                { value: 'Under 2.5', odd: r['u+2.5'] }
              ]
            },
            {
              name: 'Both Teams Score',
              values: [
                { value: 'Yes', odd: r.bts_yes },
                { value: 'No', odd: r.bts_no }
              ]
            }
          ]
        }))
      }];
    },

    '/fixtures/lineups': async p => {
      const e = await eventById(p.fixture);
      if (!e) return [];

      const lineup = await getLineups(p.fixture);
      const home = lineup.home || {};
      const away = lineup.away || {};

      if (
        !home.starting_lineups?.length ||
        !away.starting_lineups?.length
      ) {
        return [];
      }

      const makeTeam = (side, id) => {
        const data = lineup[side] || {};

        return {
          team: { id: idOf(id) },
          formation: e[`match_${side}team_system`] || null,
          coach: {
            name: data.coach?.[0]?.lineup_player || null
          },
          startXI: (data.starting_lineups || []).map(x => ({
            player: {
              number: num(x.lineup_number),
              name: x.lineup_player,
              pos: x.lineup_position
            }
          })),
          substitutes: (data.substitutes || []).map(x => ({
            player: {
              number: num(x.lineup_number),
              name: x.lineup_player,
              pos: x.lineup_position
            }
          }))
        };
      };

      return [
        makeTeam('home', e.match_hometeam_id),
        makeTeam('away', e.match_awayteam_id)
      ];
    },

    '/fixtures/statistics': async p => {
      const stats = await getStatistics(p.fixture);

      const c = stats.find(s => /corner/i.test(String(s.type || '')));

      if (!c) return [];

      return [
        {
          team: { id: null },
          statistics: [{
            type: 'Corner Kicks',
            value: num(c.home)
          }]
        },
        {
          team: { id: null },
          statistics: [{
            type: 'Corner Kicks',
            value: num(c.away)
          }]
        }
      ];
    },

    '/injuries': async () => {
      throw new Error(
        'UNSUPPORTED: οι απουσίες δεν παρέχονται από αυτόν τον πάροχο'
      );
    }
  };

  return async function api(endpoint, params = {}) {
    const handler = H[endpoint];

    if (!handler) {
      throw new Error(`UNSUPPORTED: ${endpoint}`);
    }

    return handler(params);
  };
}
