
import fs from 'node:fs';
import path from 'node:path';

import { load, save, state, log } from './store.js';
import { loadBB, saveBB, runBasketball, bb, settleBBLegacy } from './basketball.js';
import { dailyJob, refreshLive, refreshInjuries } from './sync.js';
import { usage } from './api.js';
import * as supa from './supa.js';
import {
  loadLedger,
  settleLedger,
  publicRows,
  premiumPendingCount,
  revealed,
  resultMap
} from './ledger.js';
import { applyOverrides } from './overrides.js';
import { matchPage, notFound, SITE } from './render.js';
import * as P from './pages.js';
import { athensDate, addDays } from './util.js';

// ---------- Φόρτωση δεδομένων

load();
loadBB();

const hasFootballKey = !!process.env.API_FOOTBALL_KEY;
const hasBasketballKey = !!process.env.API_BASKETBALL_KEY;
const hasKey = hasFootballKey;

let handled = [];

if (!hasFootballKey) {
  log('config', false, 'Λείπει το API_FOOTBALL_KEY: δεν φορτώθηκαν νέα δεδομένα ποδοσφαίρου');
}

if (!hasBasketballKey) {
  log('config', false, 'Λείπει το API_BASKETBALL_KEY: δεν φορτώθηκαν νέα δεδομένα μπάσκετ');
}

// ---------- Χειροκίνητη ανανέωση από Admin

if (supa.enabled()) {
  try {
    const rq = await supa.select(
      'refresh_requests',
      'handled_at=is.null&select=id'
    );

    if (rq.length) {
      state.meta.lastDaily = null;
      bb.meta.lastDaily = null;
      handled = rq.map(r => r.id);
    }
  } catch (e) {
    log('refresh', false, e.message);
  }
}

// ---------- Ποδόσφαιρο

if (hasFootballKey) {
  for (const [n, f] of [
    ['daily', dailyJob],
    ['live', refreshLive],
    ['injuries', refreshInjuries]
  ]) {
    try {
      await f();
    } catch (e) {
      log(n, false, e.message);
    }
  }
}

// ---------- Μπάσκετ

if (hasBasketballKey) {
  try {
    await runBasketball();
  } catch (e) {
    log('basketball', false, e.message);
  }

  if (!supa.enabled()) {
    try {
      settleBBLegacy();
    } catch (e) {
      log('basketball-settle', false, e.message);
    }
  }
}

// ---------- Αυτόματη ενημέρωση αποτελεσμάτων ledger

if (supa.enabled()) {
  try {
    await settleLedger(hasFootballKey);
  } catch (e) {
    log('ledger-settle', false, e.message);
  }
}

// ---------- Όρια API

if (usage.football?.window) {
  state.meta.window = usage.football.window;
}

if (usage.basketball?.window) {
  bb.meta.window = usage.basketball.window;
}

// ---------- Αποθήκευση

applyOverrides();

save();
saveBB();

// ---------- Καταγραφή χρήσης API και ολοκλήρωση αιτημάτων

if (supa.enabled()) {
  const day = new Date().toISOString().slice(0, 10);

  const rows = Object.entries(usage)
    .filter(([, u]) => u.limit !== null || u.error)
    .map(([api, u]) => ({
      day,
      api,
      daily_limit: u.limit,
      remaining: u.remaining,
      used:
        u.limit != null && u.remaining != null
          ? u.limit - u.remaining
          : null,
      error: u.error,
      updated_at: new Date().toISOString()
    }));

  try {
    if (rows.length) {
      await supa.upsert('api_usage', rows, 'day,api');
    }

    if (handled.length) {
      await supa.patch(
        'refresh_requests',
        `id=in.(${handled.join(',')})`,
        { handled_at: new Date().toISOString() }
      );
    }
  } catch (e) {
    log('usage', false, e.message);
    save();
  }
}

// ---------- Ιστορικό προγνωστικών

try {
  await loadLedger();
} catch (e) {
  log('ledger', false, e.message);
}

// ---------- Δημιουργία σελίδων

const out = 'dist';

const put = (p, c) => {
  const f = path.join(out, p);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, c);
};

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const W = process.env.WORK_DIR || '.';

fs.copyFileSync(
  path.join(W, 'style.css'),
  path.join(out, 'style.css')
);

fs.copyFileSync(
  path.join(W, 'app.js'),
  path.join(out, 'app.js')
);

put('.nojekyll', '');

const today = athensDate();
const nowTs = Math.floor(Date.now() / 1000);

const minDate = addDays(today, -60);
const maxDate = addDays(today, 30);

const rev = revealed();
const res = resultMap();

const fromRow = r => ({
  status: 'ok',
  id: r.pick_id,
  label: r.label,
  market: r.market,
  pct: r.pct,
  confidence: r.confidence,
  reasons: r.reasoning || [],
  alts: [],
  source: r.source
});

// ---------- Ποδόσφαιρο και μπάσκετ

const fbList = [...state.matches.values()]
  .filter(m => !m.hidden)
  .map(m => {
    const r =
      m.tier === 'premium' &&
      rev.get(`f:${m.fixture_id}`);

    return r
      ? {
          ...m,
          prediction: fromRow(r),
          analysis: m.analysis && {
            ...m.analysis,
            ai: r.analysis
              ? { text: r.analysis }
              : undefined
          }
        }
      : m;
  });

const bbList = [...bb.games.values()]
  .filter(g => !g.hidden)
  .map(g => {
    const r =
      g.tier === 'premium' &&
      rev.get(`b:${g.game_id}`);

    return r
      ? {
          ...g,
          prediction: fromRow(r)
        }
      : g;
  });

const fb = fbList.map(P.adaptFb);
const bk = bbList.map(P.adaptBb);

const all = [...fb, ...bk].sort(
  (a, b) => a.ts - b.ts
);

// ---------- Στατιστικά

const pub = publicRows();

const settled = pub.filter(
  r => r.result === 'win' || r.result === 'loss'
);

const wins = settled.filter(
  r => r.result === 'win'
).length;

const wu = settled.filter(r => r.odds);

const kpi = {
  n: settled.length,
  w: wins,
  rate: settled.length
    ? Math.round(wins * 100 / settled.length)
    : null,

  yield: wu.length
    ? +(
        wu.reduce(
          (s, r) =>
            s + (r.result === 'win' ? r.odds - 1 : -1),
          0
        ) * 100 / wu.length
      ).toFixed(1)
    : null
};

// ---------- Κατάλογοι διοργανώσεων

const dir = async (sp, key, rows) => {
  const l = ((await supa.peek(key))?.payload || []).slice();

  const ids = new Set(l.map(x => x.id));

  for (const r of rows) {
    if (!ids.has(r.lid)) {
      ids.add(r.lid);

      l.push({
        id: r.lid,
        name: r.lname,
        country: r.national ? 'World' : r.lcountry,
        type: '',
        logo: r.llogo,
        code: ''
      });
    }
  }

  return l.sort(
    (a, b) =>
      a.country.localeCompare(b.country) ||
      a.name.localeCompare(b.name)
  );
};

const lg = {
  football: await dir(
    'football',
    'leagues:football',
    fb
  ),

  basketball: await dir(
    'basketball',
    'leagues:basketball',
    bk
  )
};

// ---------- Ημερομηνίες

const dates = [];

for (
  let d = minDate;
  d <= maxDate;
  d = addDays(d, 1)
) {
  dates.push(d);
}

// ---------- Σελίδες ημερών και πρωταθλημάτων

for (const [sp, rows, win] of [
  ['football', fb, state.meta.window],
  ['basketball', bk, bb.meta.window]
]) {
  const cfg = P.S[sp];

  for (const d of dates) {
    const day = rows
      .filter(r => r.date === d)
      .sort((a, b) => a.ts - b.ts);

    const days = {
      list: [-2, -1, 0, 1, 2, 3, 4].map(
        i => addDays(d, i)
      ),
      prev: addDays(d, -1),
      next: addDays(d, 1)
    };

    const o = {
      sp,
      date: d,
      today,
      rows: day,
      days,
      win,
      res,
      minDate,
      maxDate
    };

    put(
      `${cfg.day.slice(1)}${d}/index.html`,
      P.dayPageG({
        ...o,
        isRoot: false
      })
    );

    if (d === today) {
      put(
        `${cfg.base.slice(1)}index.html`,
        P.dayPageG({
          ...o,
          isRoot: true,
          days: {
            list: [-1, 0, 1, 2, 3, 4, 5].map(
              i => addDays(d, i)
            ),
            prev: addDays(d, -1),
            next: addDays(d, 1)
          }
        })
      );
    }
  }

  put(
    `${cfg.leagues.slice(1)}index.html`,
    P.leaguesPage(sp, lg[sp])
  );

  for (const L of lg[sp]) {
    const lr = rows
      .filter(r => r.lid === L.id)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 40);

    const season =
      sp === 'football'
        ? state.matches
        : bb.games;

    let st = null;

    if (lr.length) {
      const m = [...season.values()].find(
        x => x.league_id === L.id
      );

      if (m) {
        st =
          (await supa.peek(
            `standings:${sp}:${L.id}:${m.season}`
          ))?.payload || null;
      }
    }

    put(
      `${cfg.league.slice(1)}${L.id}/index.html`,
      P.leaguePage(sp, L, lr, st, win, res)
    );
  }
}

// ---------- Σελίδες αγώνων

for (const m of fbList) {
  if (m.tracked !== false) {
    put(
      `predictions/${m.slug}/index.html`,
      matchPage(m)
    );
  }
}

for (const g of bbList) {
  if (g.tracked !== false) {
    put(
      `basketball/game/${g.slug}/index.html`,
      P.bbGamePage(g, res)
    );
  }
}

// ---------- Δημοφιλείς διοργανώσεις

const popularFootball = lg.football
  .filter(l =>
    /Premier League|La Liga|Serie A|Bundesliga|Ligue 1|Champions League|Europa League|Conference League/i.test(l.name)
  )
  .slice(0, 8)
  .map(l => ({
    ...l,
    sp: 'football'
  }));

const popularBasketball = lg.basketball
  .filter(l =>
    /^(NBA|Euroleague|EuroLeague)$/i.test(l.name)
  )
  .map(l => ({
    ...l,
    sp: 'basketball'
  }));

const pop = [
  ...popularFootball,
  ...popularBasketball
];

// ---------- Αρχική σελίδα και υπόλοιπες σελίδες

put(
  'index.html',
  P.homePage({
    today,
    rows: all,
    res,
    premCount: premiumPendingCount(today),
    popular: pop,
    kpi,
    window: state.meta.window
  })
);

put(
  'history/index.html',
  P.historyPage(
    pub.slice().sort(
      (a, b) =>
        b.kickoff_at.localeCompare(a.kickoff_at)
    )
  )
);

put('premium/index.html', P.premiumPage());
put('login/index.html', P.loginPage());
put('account/index.html', P.accountPage());
put('admin/index.html', P.adminPage());
put('contact/index.html', P.contactPage());

put('terms/index.html', P.termsPage());
put('privacy/index.html', P.privacyPage());
put('cookies/index.html', P.cookiesPage());
put('subscription-terms/index.html', P.subTermsPage());
put('responsible-gaming/index.html', P.responsiblePage());

// ---------- Stats

put(
  'stats/index.html',
  `<!doctype html><meta http-equiv="refresh" content="0;url=${process.env.BASE || ''}/history/"><a href="${process.env.BASE || ''}/history/">Ιστορικό</a>`
);

// ---------- Events

put(
  'events.json',
  JSON.stringify(P.eventsJson(all, nowTs))
);

// ---------- Κατάσταση συστήματος

const dayN = (rows, d) =>
  rows.filter(r => r.date === d).length;

const st = (rows, d) => ({
  total: rows.length,
  yesterday: dayN(rows, addDays(d, -1)),
  today: dayN(rows, d),
  tomorrow: dayN(rows, addDays(d, 1)),
  analysed: rows.filter(
    r => r.date === d && r.analysed
  ).length
});

put(
  'status/index.html',
  P.statusPage({
    builtAt: nowTs,
    hasKey,
    supabase: supa.enabled(),
    fb: st(fb, today),
    bb: st(bk, today),
    winFb: state.meta.window,
    winBb: bb.meta.window,
    usage,
    picks: pub.length,
    errors: state.meta.log
      .filter(l => !l.ok)
      .slice(0, 20)
  })
);

put('404.html', notFound());

// ---------- Sitemap

const base = SITE;

const urls = [
  '/',
  '/football/',
  '/basketball/',
  '/history/',
  '/premium/',
  '/contact/',
  '/terms/',
  '/privacy/',
  '/cookies/',
  '/subscription-terms/',
  '/responsible-gaming/',
  '/football/leagues/',
  '/basketball/leagues/',

  ...[0, 1, 2].map(
    i => `/day/${addDays(today, i)}/`
  ),

  ...[0, 1, 2].map(
    i => `/basketball/day/${addDays(today, i)}/`
  ),

  ...fbList
    .filter(m => m.tracked !== false)
    .map(m => `/predictions/${m.slug}/`),

  ...bbList
    .filter(g => g.tracked !== false)
    .map(g => `/basketball/game/${g.slug}/`)
];

put(
  'robots.txt',
  `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /account/\nSitemap: ${base}/sitemap.xml\n`
);

put(
  'sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(x => `<url><loc>${base}${x}</loc></url>`).join('')}</urlset>`
);

// ---------- Τελική αναφορά

console.log(
  `Έτοιμο: ${fbList.length} αγώνες ποδοσφαίρου, ` +
  `${bbList.length} μπάσκετ, ` +
  `${pub.length} προγνωστικά στο ιστορικό, ` +
  `${state.meta.log.filter(l => !l.ok).length} σφάλματα στο ιστορικό`
);
