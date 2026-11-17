
import { num } from './util.js';

const pois = (l, k) => {
  let p = Math.exp(-l);
  for (let i = 1; i <= k; i++) p *= l / i;
  return p;
};

const cdf = (l, k) => {
  let s = 0;
  for (let i = 0; i <= k; i++) s += pois(l, i);
  return s;
};

export function expectedGoals(pred) {
  const t = pred?.teams;
  if (!t) return null;

  const g = (s, k, loc) =>
    num(t[s]?.league?.goals?.[k]?.average?.[loc]);

  const v = (s, k, loc) => g(s, k, loc) ?? g(s, k, 'total');

  const ha = v('home', 'for', 'home');
  const hd = v('home', 'against', 'home');
  const aa = v('away', 'for', 'away');
  const ad = v('away', 'against', 'away');

  if ([ha, hd, aa, ad].some(x => x === null)) return null;

  const c = x => Math.min(4, Math.max(0.2, x));

  return {
    lh: c((ha + ad) / 2),
    la: c((aa + hd) / 2)
  };
}

// Υπολογισμός πιθανοτήτων σκορ και αγορών γκολ.
function grid(lh, la) {
  const r = {
    h: 0,
    d: 0,
    a: 0,
    o05: 0,
    o15: 0,
    o25: 0,
    o35: 0,
    gg: 0,
    t: 0
  };

  for (let i = 0; i <= 9; i++) {
    for (let j = 0; j <= 9; j++) {
      const p = pois(lh, i) * pois(la, j);
      const goals = i + j;

      r.t += p;

      if (i > j) r.h += p;
      else if (i === j) r.d += p;
      else r.a += p;

      if (goals > 0) r.o05 += p;
      if (goals > 1) r.o15 += p;
      if (goals > 2) r.o25 += p;
      if (goals > 3) r.o35 += p;

      if (i > 0 && j > 0) r.gg += p;
    }
  }

  for (const k of Object.keys(r)) {
    if (k !== 't') r[k] /= r.t;
  }

  return r;
}

// Ημίχρονο/Τελικό.
function htft(lh, la, s) {
  const a1 = lh * s;
  const b1 = la * s;
  const a2 = lh * (1 - s);
  const b2 = la * (1 - s);

  let h = 0;
  let a = 0;
  let t = 0;

  for (let i1 = 0; i1 < 6; i1++) {
    for (let j1 = 0; j1 < 6; j1++) {
      const p1 = pois(a1, i1) * pois(b1, j1);

      for (let i2 = 0; i2 < 6; i2++) {
        for (let j2 = 0; j2 < 6; j2++) {
          const p = p1 * pois(a2, i2) * pois(b2, j2);
          t += p;

          const half = i1 - j1;
          const full = i1 + i2 - j1 - j2;

          if (half > 0 && full > 0) h += p;
          if (half < 0 && full < 0) a += p;
        }
      }
    }
  }

  return {
    h11: h / t,
    a22: a / t
  };
}

// Όλες οι αγορές που υποστηρίζει το μοντέλο.
const STATIC = {
  '1': '1Χ2',
  'X': '1Χ2',
  '2': '1Χ2',

  '1X': 'Διπλή Ευκαιρία',
  'X2': 'Διπλή Ευκαιρία',
  '12': 'Διπλή Ευκαιρία',

  'O0.5': 'Over/Under',
  'U0.5': 'Over/Under',
  'O1.5': 'Over/Under',
  'U1.5': 'Over/Under',
  'O2.5': 'Over/Under',
  'U2.5': 'Over/Under',
  'O3.5': 'Over/Under',
  'U3.5': 'Over/Under',

  'GG': 'Goal/No Goal',
  'NG': 'Goal/No Goal',

  'HT1': 'Ημίχρονο 1Χ2',
  'HTX': 'Ημίχρονο 1Χ2',
  'HT2': 'Ημίχρονο 1Χ2',

  'HT1X': 'Διπλή Ευκαιρία Ημιχρόνου',
  'HTX2': 'Διπλή Ευκαιρία Ημιχρόνου',
  'HT12': 'Διπλή Ευκαιρία Ημιχρόνου',

  'HTO0.5': 'Over/Under Ημιχρόνου',
  'HTU0.5': 'Over/Under Ημιχρόνου',
  'HTO1.5': 'Over/Under Ημιχρόνου',
  'HTU1.5': 'Over/Under Ημιχρόνου',

  'HT0.5': 'Ημίχρονο',
  'HF11': 'Ημίχρονο/Τελικό',
  'HF22': 'Ημίχρονο/Τελικό'
};

export const PICK_IDS = [
  ...Object.keys(STATIC),
  'CO7.5', 'CU7.5',
  'CO8.5', 'CU8.5',
  'CO9.5', 'CU9.5',
  'CO10.5', 'CU10.5',
  'CO11.5', 'CU11.5',
  'CO12.5', 'CU12.5'
];

export const marketOf = id =>
  STATIC[id] || (/^C[OU]/.test(id) ? 'Κόρνερ' : 'Άλλο');

export function labelOf(id, m) {
  const c = /^C([OU])(\d+\.5)$/.exec(id);

  if (c) {
    return `${c[1] === 'O' ? 'Over' : 'Under'} ${c[2]} κόρνερ`;
  }

  const labels = {
    '1': `Νίκη ${m.home_name} (1)`,
    'X': 'Ισοπαλία (Χ)',
    '2': `Νίκη ${m.away_name} (2)`,

    '1X': 'Διπλή Ευκαιρία 1Χ',
    'X2': 'Διπλή Ευκαιρία Χ2',
    '12': 'Διπλή Ευκαιρία 12',

    'O0.5': 'Over 0.5 γκολ',
    'U0.5': 'Under 0.5 γκολ',
    'O1.5': 'Over 1.5 γκολ',
    'U1.5': 'Under 1.5 γκολ',
    'O2.5': 'Over 2.5 γκολ',
    'U2.5': 'Under 2.5 γκολ',
    'O3.5': 'Over 3.5 γκολ',
    'U3.5': 'Under 3.5 γκολ',

    'GG': 'Goal/Goal (GG)',
    'NG': 'No Goal (NG)',

    'HT1': 'Νίκη γηπεδούχου στο ημίχρονο',
    'HTX': 'Ισοπαλία στο ημίχρονο',
    'HT2': 'Νίκη φιλοξενούμενου στο ημίχρονο',

    'HT1X': 'Διπλή Ευκαιρία ημιχρόνου 1Χ',
    'HTX2': 'Διπλή Ευκαιρία ημιχρόνου Χ2',
    'HT12': 'Διπλή Ευκαιρία ημιχρόνου 12',

    'HTO0.5': 'Over 0.5 γκολ ημιχρόνου',
    'HTU0.5': 'Under 0.5 γκολ ημιχρόνου',
    'HTO1.5': 'Over 1.5 γκολ ημιχρόνου',
    'HTU1.5': 'Under 1.5 γκολ ημιχρόνου',

    'HT0.5': 'Over 0.5 γκολ στο 1ο ημίχρονο',
    'HF11': 'Ημίχρονο/Τελικό 1/1',
    'HF22': 'Ημίχρονο/Τελικό 2/2'
  };

  return labels[id] || id;
}

export function computePrediction(m, pred, ctx = {}) {
  let xg = expectedGoals(pred);
  let fb = false;

  // Εναλλακτική εκτίμηση όταν δεν υπάρχουν στατιστικά πρωταθλήματος.
  if (!xg && ctx.recentAvg) {
    const r = ctx.recentAvg;
    const c = x => Math.min(4, Math.max(0.2, x));

    xg = {
      lh: c((r.hf + r.ag) / 2),
      la: c((r.af + r.hg) / 2)
    };

    fb = true;
  }

  if (!xg) {
    return {
      status: 'no_data',
      note: 'Δεν υπάρχουν επαρκή στατιστικά δεδομένα για υπολογισμό πιθανοτήτων.'
    };
  }

  const g = grid(xg.lh, xg.la);

  let h = g.h;
  let d = g.d;
  let a = g.a;

  // Συνδυασμός Poisson με τις προβλέψεις της πηγής, εφόσον υπάρχουν.
  const pc = pred?.predictions?.percent;

  if (pc && num(pc.home) !== null) {
    h = (h + num(pc.home) / 100) / 2;
    d = (d + (num(pc.draw) ?? g.d * 100) / 100) / 2;
    a = (a + (num(pc.away) ?? g.a * 100) / 100) / 2;

    const total = h + d + a;

    if (total > 0) {
      h /= total;
      d /= total;
      a /= total;
    }
  }

  // Όλες οι πιθανότητες τελικού αποτελέσματος.
  const P = {
    h,
    d,
    a,
    oneX: h + d,
    Xtwo: d + a,
    twelve: h + a,

    o05: g.o05,
    u05: 1 - g.o05,

    o15: g.o15,
    u15: 1 - g.o15,

    o25: g.o25,
    u25: 1 - g.o25,

    o35: g.o35,
    u35: 1 - g.o35,

    gg: g.gg,
    ng: 1 - g.gg
  };

  const all = [];

  const mk = (id, p) => {
    const probability = Math.min(1, Math.max(0, p));

    all.push({
      id,
      label: labelOf(id, m),
      market: marketOf(id),
      p: probability,
      pct: Math.round(probability * 100)
    });
  };

  // 1Χ2: και οι τρεις επιλογές.
  mk('1', h);
  mk('X', d);
  mk('2', a);

  // Όλες οι διπλές ευκαιρίες.
  mk('1X', h + d);
  mk('X2', d + a);
  mk('12', h + a);

  // Όλες οι βασικές γραμμές γκολ.
  mk('O0.5', g.o05);
  mk('U0.5', 1 - g.o05);

  mk('O1.5', g.o15);
  mk('U1.5', 1 - g.o15);

  mk('O2.5', g.o25);
  mk('U2.5', 1 - g.o25);

  mk('O3.5', g.o35);
  mk('U3.5', 1 - g.o35);

  // Goal / No Goal.
  mk('GG', g.gg);
  mk('NG', 1 - g.gg);

  // Αγορές ημιχρόνου, εφόσον υπάρχουν σχετικά δεδομένα.
  if (ctx.htShare != null) {
    const s = Math.min(0.6, Math.max(0.3, ctx.htShare));

    const firstHalf = grid(
      xg.lh * s,
      xg.la * s
    );

    const hf = htft(xg.lh, xg.la, s);

    mk('HT1', firstHalf.h);
    mk('HTX', firstHalf.d);
    mk('HT2', firstHalf.a);

    mk('HT1X', firstHalf.h + firstHalf.d);
    mk('HTX2', firstHalf.d + firstHalf.a);
    mk('HT12', firstHalf.h + firstHalf.a);

    mk('HTO0.5', firstHalf.o05);
    mk('HTU0.5', 1 - firstHalf.o05);

    mk('HTO1.5', firstHalf.o15);
    mk('HTU1.5', 1 - firstHalf.o15);

    mk('HT0.5', firstHalf.o05);

    mk('HF11', hf.h11);
    mk('HF22', hf.a22);
  }

  // Αγορές κόρνερ, μόνο όταν υπάρχουν διαθέσιμα δεδομένα.
  if (ctx.corners && Number.isFinite(Number(ctx.corners.lambda))) {
    const l = Number(ctx.corners.lambda);

    const adj = p => 0.5 + (p - 0.5) * 0.7;

    for (const L of [7.5, 8.5, 9.5, 10.5, 11.5, 12.5]) {
      if (Math.abs(L - l) <= 1.5) {
        const over = 1 - cdf(l, Math.floor(L));

        mk(`CO${L}`, adj(over));
        mk(`CU${L}`, adj(1 - over));
      }
    }
  }

  // Ταξινόμηση όλων των αγορών με βάση την πιθανότητα.
  all.sort((x, y) => y.p - x.p);

  // Πλήρης λίστα για εμφάνιση στην ιστοσελίδα.
  const picks = all.map(x => ({
    id: x.id,
    label: x.label,
    market: x.market,
    pct: x.pct,
    probability: x.p
  }));

  // Διατηρούμε το παλιό πεδίο alts για συμβατότητα.
  // Πλέον περιέχει ΟΛΕΣ τις αγορές, όχι μόνο τις 5 καλύτερες.
  const alts = picks.map(x => ({
    id: x.id,
    label: x.label,
    market: x.market,
    pct: x.pct
  }));

  // Κρατάμε το παλιό βασικό πεδίο για τα υπόλοιπα αρχεία.
  // Δεν αποκλείουμε πλέον τον αγώνα με όριο 56%.
  const best = all[0];

  const xgTxt =
    `Το μοντέλο Poisson εκτιμά αναμενόμενα γκολ ` +
    `${xg.lh.toFixed(2)} για ${m.home_name} και ` +
    `${xg.la.toFixed(2)} για ${m.away_name}.`;

  let conf = best.p >= 0.70 ? 2 : best.p >= 0.62 ? 1 : 0;

  if (!ctx.hasForm || ctx.lowSample || fb) {
    conf = Math.max(0, conf - 1);
  }

  const reasons = [
    xgTxt,
    ...(Array.isArray(ctx.reasons) ? ctx.reasons : [])
  ];

  if (ctx.htShare != null) {
    reasons.push(
      `Στους τελευταίους ${ctx.htN || 0} αγώνες των δύο ομάδων ` +
      `το ${Math.round(ctx.htShare * 100)}% των γκολ μπήκε στο 1ο ημίχρονο.`
    );
  }

  if (ctx.corners && Number.isFinite(Number(ctx.corners.lambda))) {
    reasons.push(
      `Μέσος όρος κόρνερ: ${Number(ctx.corners.lambda).toFixed(1)} ` +
      `στους τελευταίους ${ctx.corners.n || 0} αγώνες.`
    );
  }

  const advice = pred?.predictions?.advice;

  if (advice) {
    reasons.push(`Η πηγή δεδομένων προτείνει: «${advice}».`);
  }

  return {
    status: 'ok',

    // Παλιά πεδία για συμβατότητα.
    id: best.id,
    label: best.label,
    market: best.market,
    pct: best.pct,
    confidence: ['Χαμηλό', 'Μέτριο', 'Υψηλό'][conf],

    // Νέα πλήρης λίστα όλων των αγορών.
    picks,
    alts,

    reasons,
    probs: P,
    source: 'auto'
  };
}

// Επαλήθευση αποτελεσμάτων.
export function evalPick(p, gh, ga, x = {}) {
  if (!p || gh == null || ga == null) return null;

  const { hth, hta, corners } = x;
  const id = p.id;
  const total = gh + ga;

  // Αγορές ημιχρόνου.
  if (id.startsWith('HT') || id.startsWith('HF')) {
    if (hth == null || hta == null) {
      return null;
    }

    const halfTotal = hth + hta;

    if (id === 'HT1') return hth > hta;
    if (id === 'HTX') return hth === hta;
    if (id === 'HT2') return hth < hta;

    if (id === 'HT1X') return hth >= hta;
    if (id === 'HTX2') return hth <= hta;
    if (id === 'HT12') return hth !== hta;

    if (id === 'HTO0.5' || id === 'HT0.5') return halfTotal > 0;
    if (id === 'HTU0.5') return halfTotal === 0;

    if (id === 'HTO1.5') return halfTotal > 1;
    if (id === 'HTU1.5') return halfTotal < 2;

    if (id === 'HF11') return hth > hta && gh > ga;
    if (id === 'HF22') return hth < hta && ga > gh;

    return null;
  }

  // Αγορές κόρνερ.
  const c = /^C([OU])(\d+\.5)$/.exec(id);

  if (c) {
    if (corners == null) return null;

    return c[1] === 'O'
      ? corners > Number(c[2])
      : corners < Number(c[2]);
  }

  // Τελικό αποτέλεσμα.
  if (id === '1') return gh > ga;
  if (id === 'X') return gh === ga;
  if (id === '2') return ga > gh;

  // Διπλές ευκαιρίες.
  if (id === '1X') return gh >= ga;
  if (id === 'X2') return ga >= gh;
  if (id === '12') return gh !== ga;

  // Over / Under γκολ.
  const goal = /^([OU])(\d+\.5)$/.exec(id);

  if (goal) {
    return goal[1] === 'O'
      ? total > Number(goal[2])
      : total < Number(goal[2]) + 1;
  }

  // Goal / No Goal.
  if (id === 'GG') return gh > 0 && ga > 0;
  if (id === 'NG') return !(gh > 0 && ga > 0);

  return null;
}
