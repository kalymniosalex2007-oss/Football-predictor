
// ΜΠΑΣΚΕΤ
// Όλοι οι αγώνες αποθηκεύονται.
// Οι tracked αγώνες αναλύονται με βάση τα πραγματικά αποθηκευμένα αποτελέσματα.
// Δεν χρησιμοποιείται το παλιό API-Sports enrichment.

import fs from 'node:fs';
import path from 'node:path';
import { state, log } from './store.js';
import { athensDate, addDays, slugify } from './util.js';
import * as supa from './supa.js';
import { recordPick, registerSettler } from './ledger.js';

const DIR = 'data/basketball';
const now = () => Math.floor(Date.now() / 1000);

export const bb = {
  games: new Map(),
  meta: { lastDaily: null, lastRefresh: 0, window: null }
};

export const BB_LIVE = ['Q1', 'Q2', 'Q3', 'Q4', 'OT', 'BT', 'HT'];
export const BB_DONE = ['FT', 'AOT'];
export const BB_OVER = ['FT', 'AOT', 'CANC', 'AWD', 'ABD'];

const BB_IDS = (process.env.BB_LEAGUE_IDS || '')
  .split(',')
  .map(Number)
  .filter(Boolean);

const BB_RE = /^(NBA|Euroleague|EuroLeague|EuroCup|Eurocup|Basketball Champions League|FIBA Europe Cup|ACB|Liga ACB|LBA|Lega Basket Serie A|BSL|BBL|Basketball Bundesliga|LNB|Pro A|Betclic Elite|A1|Basket League|VTB United League|ABA League|Adriatic)/i;

const tracked = l =>
  BB_IDS.length
    ? BB_IDS.includes(Number(l.id))
    : BB_RE.test(l.name) && !/Women|U\d\d|Youth/i.test(l.name);

const prio = g =>
  /^(NBA|Euroleague|EuroLeague)/i.test(g.league_name) ? 0 : 1;

const written = new Map();

const rd = f => {
  try {
    return fs.readFileSync(f, 'utf8');
  } catch {
    return null;
  }
};

export function loadBB() {
  fs.mkdirSync(DIR, { recursive: true });

  for (const f of fs.readdirSync(DIR).filter(x => /^\d{4}-/.test(x))) {
    const t = rd(path.join(DIR, f));
    if (!t) continue;

    try {
      written.set(f, t);

      for (const g of JSON.parse(t)) {
        bb.games.set(g.game_id, g);
      }
    } catch (e) {
      log('load-bb', false, `${f}: ${e.message}`);
    }
  }

  const mt = rd(path.join(DIR, 'meta.json'));

  if (mt) {
    try {
      Object.assign(bb.meta, JSON.parse(mt));
      written.set('meta.json', mt);
    } catch {}
  }
}

export function saveBB() {
  const c1 = addDays(athensDate(), -120);
  const c2 = addDays(athensDate(), -10);

  for (const [id, g] of bb.games) {
    if (
      g.match_date < c1 ||
      (!g.tracked && g.match_date < c2)
    ) {
      bb.games.delete(id);
    }
  }

  const by = {};

  for (const g of bb.games.values()) {
    (by[g.match_date] ||= []).push(g);
  }

  const out = new Map(
    Object.entries(by).map(([d, l]) => [
      `${d}.json`,
      JSON.stringify(
        l.sort((a, b) => a.kickoff_ts - b.kickoff_ts)
      )
    ])
  );

  out.set('meta.json', JSON.stringify(bb.meta));

  for (const [f, t] of out) {
    if (written.get(f) !== t) {
      fs.writeFileSync(path.join(DIR, f), t);
      written.set(f, t);
    }
  }

  for (const f of [...written.keys()]) {
    if (/^\d{4}-/.test(f) && !out.has(f)) {
      fs.rmSync(path.join(DIR, f), { force: true });
      written.delete(f);
    }
  }
}

// --------------------------------------------------
// ΛΗΨΗ ΑΓΩΝΩΝ
// --------------------------------------------------

export async function syncGames(date) {
  const key = process.env.API_BASKETBALL_KEY;

  if (!key) {
    throw new Error('Missing API_BASKETBALL_KEY');
  }

  const url = new URL(
    'https://live-basketball-api.com/api/v2/matches'
  );

  url.searchParams.set('api_key', key);
  url.searchParams.set('date', date);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Basketball API error: ${response.status}`);
  }

  const data = await response.json();

  if (data.status !== 'ok' || !Array.isArray(data.matches)) {
    throw new Error('Invalid basketball API response');
  }

  for (const g of data.matches) {
    const competition = g.competition || {};

    const league = {
      id: competition.id,
      name: competition.name || 'Basketball',
      logo: competition.logo || competition.area?.flag || ''
    };

    const rawStart = String(g.start_time || '')
      .replace(' ', 'T');

    const start = /Z$|[+-]\d{2}:\d{2}$/.test(rawStart)
      ? rawStart
      : `${rawStart}Z`;

    const parsed = Date.parse(start);

    const ts = Number.isFinite(parsed)
      ? Math.floor(parsed / 1000)
      : now();

    const period = String(g.period || '').toLowerCase();
    const rawStatus = String(g.status || '').toLowerCase();

    let status = 'NS';

    if (/finish|ended|complete/.test(rawStatus)) {
      status = 'FT';
    } else if (/cancel/.test(rawStatus)) {
      status = 'CANC';
    } else if (/abandon/.test(rawStatus)) {
      status = 'ABD';
    } else if (/postpon/.test(rawStatus)) {
      status = 'PST';
    } else if (/play|live|progress/.test(rawStatus)) {
      if (period.includes('first')) status = 'Q1';
      else if (period.includes('second')) status = 'Q2';
      else if (period.includes('third')) status = 'Q3';
      else if (period.includes('fourth')) status = 'Q4';
      else if (period.includes('half')) status = 'HT';
      else if (period.includes('overtime')) status = 'OT';
      else status = 'Q1';
    }

    const final = g.score?.final;

    const scores = Array.isArray(final)
      ? final
      : final && typeof final === 'object'
        ? [
            final.team1 ?? final.home ?? null,
            final.team2 ?? final.away ?? null
          ]
        : [];

    const base = {
      game_id: g.id,
      tracked: tracked(league),
      match_date: date,
      kickoff_ts: ts,

      league_id: league.id,
      league_name: league.name,
      league_country: competition.area?.name || '',
      league_logo: league.logo,

      home_id: g.team1?.id,
      home_name: g.team1?.name || 'Team 1',
      home_logo: g.team1?.logo || '',

      away_id: g.team2?.id,
      away_name: g.team2?.name || 'Team 2',
      away_logo: g.team2?.logo || '',

      status,
      score_home: scores[0] ?? null,
      score_away: scores[1] ?? null,

      updated_at: now()
    };

    const old = bb.games.get(g.id);

    if (old) {
      Object.assign(old, base);
      continue;
    }

    const taken = s =>
      [...bb.games.values()].some(
        x => x.slug === s && x.game_id !== g.id
      );

    let slug =
      slugify(`${base.home_name}-vs-${base.away_name}`) ||
      `game-${g.id}`;

    const original = slug;

    if (taken(slug)) slug = `${original}-${date}`;
    if (taken(slug)) slug = `${original}-${g.id}`;

    bb.games.set(g.id, {
      ...base,
      slug,
      analysis: null,
      prediction: null,
      odds: null,
      enriched_at: null,
      tier: null
    });
  }
}

export const refreshLeaguesBB = async () => {
  const leagues = new Map();

  for (const g of bb.games.values()) {
    if (!g.league_id) continue;

    leagues.set(g.league_id, {
      id: g.league_id,
      name: g.league_name,
      type: 'Basketball',
      logo: g.league_logo,
      country: g.league_country || '',
      code: ''
    });
  }

  return [...leagues.values()];
};

// --------------------------------------------------
// ΜΟΝΤΕΛΟ ΠΡΟΒΛΕΨΕΩΝ
// --------------------------------------------------

const Phi = x => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);

  const p =
    d *
    t *
    (
      0.3193815 +
      t *
      (
        -0.3565638 +
        t *
        (
          1.781478 +
          t *
          (
            -1.821256 +
            t * 1.330274
          )
        )
      )
    );

  return x > 0 ? 1 - p : p;
};

const HCA = 2;
const SIG = 11;
const SIGT = 17;

const mean = a =>
  a.length
    ? a.reduce((s, x) => s + x, 0) / a.length
    : 0;

const rate = (t, r) =>
  t && t.p >= 5
    ? {
        pf: t.pf / t.p,
        pa: t.pa / t.p,
        src: 'season'
      }
    : r.length >= 3
      ? {
          pf: mean(r.map(x => x.pf)),
          pa: mean(r.map(x => x.pa)),
          src: 'recent'
        }
      : null;

// --------------------------------------------------
// ΠΡΟΣΦΑΤΗ ΦΟΡΜΑ ΑΠΟ ΤΑ ΑΠΟΘΗΚΕΥΜΕΝΑ ΑΠΟΤΕΛΕΣΜΑΤΑ
// --------------------------------------------------

function recentGames(teamId, currentGameId, limit = 10) {
  return [...bb.games.values()]
    .filter(g =>
      String(g.game_id) !== String(currentGameId) &&
      BB_DONE.includes(g.status) &&
      g.score_home !== null &&
      g.score_away !== null &&
      Number.isFinite(Number(g.score_home)) &&
      Number.isFinite(Number(g.score_away)) &&
      (
        String(g.home_id) === String(teamId) ||
        String(g.away_id) === String(teamId)
      )
    )
    .map(g => {
      const home = String(g.home_id) === String(teamId);

      return {
        ts: g.kickoff_ts,
        date: g.match_date,
        opp: home ? g.away_name : g.home_name,
        home,
        pf: Number(home ? g.score_home : g.score_away),
        pa: Number(home ? g.score_away : g.score_home)
      };
    })
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit);
}

function recentH2H(homeId, awayId, currentGameId) {
  return [...bb.games.values()]
    .filter(g =>
      String(g.game_id) !== String(currentGameId) &&
      BB_DONE.includes(g.status) &&
      g.score_home !== null &&
      g.score_away !== null &&
      (
        (
          String(g.home_id) === String(homeId) &&
          String(g.away_id) === String(awayId)
        ) ||
        (
          String(g.home_id) === String(awayId) &&
          String(g.away_id) === String(homeId)
        )
      )
    )
    .sort((a, b) => b.kickoff_ts - a.kickoff_ts)
    .slice(0, 6)
    .map(g => ({
      ts: g.kickoff_ts,
      home_id: g.home_id,
      home: g.home_name,
      away: g.away_name,
      gh: Number(g.score_home),
      ga: Number(g.score_away)
    }));
}

// --------------------------------------------------
// ΠΡΟΒΛΕΨΗ
// --------------------------------------------------

export function bbPredict(g, a) {
  const H = rate(a.table.home, a.form.home);
  const A = rate(a.table.away, a.form.away);

  if (!H || !A) {
    return {
      status: 'no_data',
      note: 'Δεν υπάρχουν τουλάχιστον 3 πρόσφατοι αγώνες για κάθε ομάδα. Η πρόβλεψη θα δημιουργηθεί μόλις συγκεντρωθούν επαρκή δεδομένα.'
    };
  }

  const he = (H.pf + A.pa) / 2;
  const ae = (A.pf + H.pa) / 2;

  const total = he + ae;
  const margin = he - ae + HCA;

  let ph = Phi(margin / SIG);
  let mk = null;

  const o = a.odds;

  if (o?.home && o?.away) {
    const s = 1 / o.home + 1 / o.away;
    mk = 1 / o.home / s;
    ph = (ph + mk) / 2;
  }

  const C = [
    {
      id: 'B1',
      label: `Νίκη ${g.home_name} (1)`,
      market: 'Νικητής αγώνα',
      p: ph,
      w: 1.05
    },
    {
      id: 'B2',
      label: `Νίκη ${g.away_name} (2)`,
      market: 'Νικητής αγώνα',
      p: 1 - ph,
      w: 1.05
    }
  ];

  if (o?.line) {
    const po = 1 - Phi((o.line - total) / SIGT);

    C.push(
      {
        id: `BO${o.line}`,
        label: `Over ${o.line} πόντοι`,
        market: 'Over/Under πόντων',
        p: po,
        w: 0.95
      },
      {
        id: `BU${o.line}`,
        label: `Under ${o.line} πόντοι`,
        market: 'Over/Under πόντων',
        p: 1 - po,
        w: 0.95
      }
    );
  }

  C.sort((x, y) => y.p * y.w - x.p * x.w);

  const alts = C.map(x => ({
    label: x.label,
    pct: Math.round(Math.min(0.85, x.p) * 100)
  }));

  const b = C[0];

  const reasons = [
    `Το μοντέλο εκτιμά ${he.toFixed(1)} πόντους για ${g.home_name} και ${ae.toFixed(1)} για ${g.away_name}, με εκτιμώμενο συνολικό σκορ ${total.toFixed(1)} πόντων.`,
    `Η εκτίμηση χρησιμοποιεί τους πρόσφατους αγώνες των δύο ομάδων και το πλεονέκτημα έδρας των ${HCA} πόντων, που αποτελεί παραδοχή του μοντέλου.`
  ];

  reasons.push(
    `Δείγμα φόρμας: ${g.home_name} (${a.form.home.length} αγώνες), ${g.away_name} (${a.form.away.length} αγώνες).`
  );

  if (mk !== null) {
    reasons.push(
      'Η πιθανότητα νίκης συνδυάζει την εκτίμηση του μοντέλου με τις διαθέσιμες αποδόσεις.'
    );
  }

  if (a.h2h.list.length) {
    reasons.push(
      `Στα ${a.h2h.list.length} πρόσφατα μεταξύ τους παιχνίδια, ${g.home_name}: ${a.h2h.hw} νίκες και ${g.away_name}: ${a.h2h.aw} νίκες.`
    );
  }

  if (b.p < 0.56) {
    return {
      status: 'no_pick',
      alts,
      note: 'Καμία αγορά δεν ξεπερνά το όριο 56%. Δεν προτείνεται επιλογή για αυτόν τον αγώνα.',
      reasons
    };
  }

  let conf =
    b.p >= 0.70 ? 2 :
    b.p >= 0.62 ? 1 : 0;

  // Μικρό δείγμα: δεν επιτρέπουμε υψηλή εμπιστοσύνη.
  if (H.src === 'recent' || A.src === 'recent') {
    conf = Math.max(0, conf - 1);
  }

  return {
    status: 'ok',
    id: b.id,
    label: b.label,
    market: b.market,
    pct: Math.round(Math.min(0.85, b.p) * 100),
    confidence: ['Χαμηλό', 'Μέτριο', 'Υψηλό'][conf],
    alts,
    reasons,
    source: 'auto'
  };
}

export const bbPickOdds = (o, id) =>
  !o
    ? null
    : id === 'B1'
      ? o.home
      : id === 'B2'
        ? o.away
        : null;

const PREM = () =>
  Number(process.env.PREMIUM_MIN_PCT || 68);

// --------------------------------------------------
// ΑΝΑΛΥΣΗ ΑΓΩΝΩΝ ΧΩΡΙΣ ΕΞΩΤΕΡΙΚΟ ENRICHMENT API
// --------------------------------------------------

export async function enrichBB(date) {
  const top = [...bb.games.values()]
    .filter(g =>
      g.match_date === date &&
      g.tracked !== false &&
      !g.enriched_at &&
      !BB_OVER.includes(g.status) &&
      g.kickoff_ts > now()
    )
    .sort((a, b) =>
      prio(a) - prio(b) ||
      a.kickoff_ts - b.kickoff_ts
    );

  for (const g of top) {
    try {
      const homeForm = recentGames(g.home_id, g.game_id);
      const awayForm = recentGames(g.away_id, g.game_id);

      const h2h = recentH2H(
        g.home_id,
        g.away_id,
        g.game_id
      );

      const hw = h2h.filter(x => {
        const homeWon =
          x.home_id === g.home_id
            ? x.gh > x.ga
            : x.ga > x.gh;

        return homeWon;
      }).length;

      const a = {
        form: {
          home: homeForm,
          away: awayForm
        },

        table: {
          home: null,
          away: null
        },

        odds: null,

        h2h: {
          list: h2h.map(x => ({
            date: athensDate(new Date(x.ts * 1000)),
            home: x.home,
            away: x.away,
            gh: x.gh,
            ga: x.ga
          })),

          hw,
          aw: h2h.length - hw,

          avg: h2h.length
            ? +mean(h2h.map(x => x.gh + x.ga)).toFixed(1)
            : null
        }
      };

      const prediction = bbPredict(g, a);

      const premium =
        supa.enabled() &&
        prediction.status === 'ok' &&
        prediction.pct >= PREM() &&
        prediction.confidence !== 'Χαμηλό';

      if (prediction.status === 'ok') {
        await recordPick({
          sport: 'basketball',
          key: `b:${g.game_id}`,

          tier: premium ? 'premium' : 'free',

          league: g.league_name,
          home: g.home_name,
          away: g.away_name,
          kickoff_ts: g.kickoff_ts,

          pick: prediction,
          odds: null,

          legacy: () => {
            state.picks[`b${g.game_id}`] = {
              key: `b:${g.game_id}`,
              sport: 'basketball',
              pick_id: prediction.id,
              label: prediction.label,
              market: prediction.market,
              pct: prediction.pct,
              confidence: prediction.confidence,
              source: 'auto',
              created_at: now(),
              result: null,
              league: g.league_name,
              kickoff_ts: g.kickoff_ts,
              home: g.home_name,
              away: g.away_name,
              date: g.match_date,
              odds: null
            };
          }
        });
      }

      Object.assign(g, {
        analysis: a,
        odds: null,

        prediction: premium
          ? { status: 'locked', tier: 'premium' }
          : prediction,

        tier: premium ? 'premium' : 'free',

        // Αν δεν υπάρχουν αρκετά δεδομένα, ξαναδοκιμάζουμε
        // σε επόμενο κύκλο αφού κατέβουν περισσότερα αποτελέσματα.
        enriched_at: prediction.status === 'no_data'
          ? null
          : now()
      });

    } catch (e) {
      log('enrich-bb', false, `${g.slug}: ${e.message}`);
    }
  }
}

// --------------------------------------------------
// ΕΛΕΓΧΟΣ ΑΠΟΤΕΛΕΣΜΑΤΩΝ
// --------------------------------------------------

export const evalBB = (id, gh, ga) => {
  const t = gh + ga;

  if (id === 'B1') return gh > ga;
  if (id === 'B2') return ga > gh;

  const m = /^B([OU])(\d+(?:\.\d+)?)$/.exec(id);

  if (!m) return null;

  const L = Number(m[2]);

  if (t === L) return 'push';

  return m[1] === 'O'
    ? t > L
    : t < L;
};

const settleOne = r => {
  const g = bb.games.get(
    Number(r.event_key.slice(2))
  );

  if (!g) return null;

  if (['CANC', 'AWD', 'ABD'].includes(g.status)) {
    return {
      result: 'void',
      score: null
    };
  }

  if (
    !BB_DONE.includes(g.status) ||
    g.score_home == null ||
    g.score_away == null
  ) {
    return null;
  }

  const ok = evalBB(
    r.pick_id,
    Number(g.score_home),
    Number(g.score_away)
  );

  if (ok === null) return null;

  return {
    result:
      ok === 'push'
        ? 'void'
        : ok
          ? 'win'
          : 'loss',

    score: `${g.score_home}-${g.score_away}`
  };
};

registerSettler('basketball', async r =>
  settleOne(r)
);

export function settleBBLegacy() {
  for (const pk of Object.values(state.picks)) {
    if (
      pk.sport !== 'basketball' ||
      pk.result
    ) continue;

    const s = settleOne({
      event_key: pk.key,
      pick_id: pk.pick_id
    });

    if (s) {
      pk.result = s.result;
      pk.score = s.score;
      pk.settled_at = now();
    }
  }
}

// --------------------------------------------------
// ΚΕΝΤΡΙΚΗ ΛΕΙΤΟΥΡΓΙΑ
// --------------------------------------------------

export async function runBasketball() {
  const today = athensDate();

  const n = Math.max(
    0,
    Math.min(14, Number(process.env.DAYS_AHEAD || 1))
  );

  if (bb.meta.lastDaily !== today) {
    let ok = false;

    // Κρατάμε και προηγούμενες ημέρες ώστε να υπάρχει
    // ιστορικό αποτελεσμάτων για τη φόρμα των ομάδων.
    const dates = [
      ...Array.from(
        { length: 10 },
        (_, i) => addDays(today, -(i + 1))
      ),
      today,
      ...Array.from(
        { length: n },
        (_, i) => addDays(today, i + 1)
      )
    ];

    for (const d of dates) {
      try {
        await syncGames(d);

        if (d === today) {
          ok = true;
        }

      } catch (e) {
        log('games-bb', false, `${d}: ${e.message}`);
      }
    }

    try {
      await refreshLeaguesBB();
    } catch (e) {
      log('leagues-bb', false, e.message);
    }

    if (ok) {
      bb.meta.lastDaily = today;

      log(
        'daily',
        true,
        `Φορτώθηκαν παιχνίδια μπάσκετ και ιστορικά αποτελέσματα ${today}`
      );
    }

  } else {
    const t = now();

    // Ελέγχουμε αγώνες από 30 λεπτά πριν την έναρξη
    // μέχρι και 6 ώρες μετά την προγραμματισμένη έναρξη.
    const pend = [...bb.games.values()].filter(g =>
      !BB_OVER.includes(g.status) &&
      g.kickoff_ts < t + 1800 &&
      g.kickoff_ts > t - 6 * 3600
    );

    // Ανανέωση δεδομένων ανά 15 λεπτά.
    if (
      pend.length &&
      t - (bb.meta.lastRefresh || 0) > 900
    ) {
      bb.meta.lastRefresh = t;

      for (const d of new Set(
        pend.map(g => g.match_date)
      )) {
        try {
          await syncGames(d);
        } catch (e) {
          log('games-bb', false, e.message);
        }
      }
    }
  }

  // Αναλύουμε όλους τους επιλέξιμους tracked αγώνες
  // των ημερών που έχουν ήδη φορτωθεί.
  const datesToAnalyze = new Set(
    [...bb.games.values()]
      .filter(g =>
        g.tracked !== false &&
        !BB_OVER.includes(g.status) &&
        g.kickoff_ts > now() &&
        !g.enriched_at
      )
      .map(g => g.match_date)
  );

  for (const date of datesToAnalyze) {
    await enrichBB(date);
  }
}
