// Προσαρμογέας για το apifootball.com (v3). Δέχεται τα ίδια αιτήματα με το API-Football και επιστρέφει δεδομένα στην ίδια μορφή,
// ώστε ο υπόλοιπος κώδικας να μην αλλάξει. ΠΡΟΣΟΧΗ: γράφτηκε από την τεκμηρίωση, χωρίς δοκιμή με πραγματικό κλειδί. Η σελίδα «Κατάσταση» δείχνει δείγμα της απάντησης για έλεγχο.
import * as supa from './supa.js';
const BASE = 'https://apiv3.apifootball.com/', TZ = 'Europe/Athens', sleep = ms => new Promise(r => setTimeout(r, ms));
const num = v => v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v), idOf = v => Number.isFinite(Number(v)) ? Number(v) : v;
const ymd = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d), addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function offsetMs(ms) { const f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms)), g = t => Number(f.find(p => p.type === t).value); return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) - ms; }
function athensTs(date, time) { const [y, m, d] = date.split('-').map(Number), [hh, mm] = (time || '00:00').split(':').map(Number), guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0); const t1 = guess - offsetMs(guess); return Math.floor((guess - offsetMs(t1)) / 1000); }
const STATUS = { finished: 'FT', 'after et': 'AET', 'after pen.': 'PEN', 'half time': 'HT', postponed: 'PST', cancelled: 'CANC', canceled: 'CANC', awarded: 'AWD', abandoned: 'ABD', 'walk over': 'WO' };
const short = e => { const s = String(e.match_status || '').trim().toLowerCase(); if (!s) return 'NS'; if (STATUS[s]) return STATUS[s]; if (/^\d/.test(s) || e.match_live === '1') return parseInt(s) > 45 ? '2H' : '1H'; return 'NS'; };
const WORLD = ['eurocups', 'intl', 'international', 'world'];
export function toFx(e) {
  const st = short(e), gh = num(e.match_hometeam_score), ga = num(e.match_awayteam_score), cn = String(e.country_name || '');
  return { fixture: { id: idOf(e.match_id), timestamp: athensTs(e.match_date, e.match_time), venue: { name: e.match_stadium || null }, status: { short: st } },
    league: { id: idOf(e.league_id), name: e.league_name, country: WORLD.includes(cn.toLowerCase()) ? 'World' : cn, logo: e.league_logo || '', season: e.league_year || e.match_date.slice(0, 4), round: e.match_round ? `Round ${e.match_round}` : (e.stage_name || '') },
    teams: { home: { id: idOf(e.match_hometeam_id), name: e.match_hometeam_name, logo: e.team_home_badge || '' }, away: { id: idOf(e.match_awayteam_id), name: e.match_awayteam_name, logo: e.team_away_badge || '' } },
    goals: { home: gh, away: ga }, score: { halftime: { home: num(e.match_hometeam_halftime_score), away: num(e.match_awayteam_halftime_score) }, fulltime: { home: num(e.match_hometeam_ft_score) ?? (st === 'FT' ? gh : null), away: num(e.match_awayteam_ft_score) ?? (st === 'FT' ? ga : null) } } };
}
// Ποιες διοργανώσεις αναλύονται (το apifootball.com έχει άλλα id από το API-Football, άρα κρίνουμε από χώρα και όνομα)
const TRACK = [['england', /^(premier league|championship|fa cup|league cup|efl cup)$/i], ['spain', /^(la liga|primera division|copa del rey)$/i], ['italy', /^(serie a|serie b|coppa italia)$/i], ['germany', /^(bundesliga|2\. bundesliga|dfb pokal)$/i],
  ['france', /^(ligue 1|ligue 2|coupe de france)$/i], ['greece', /^super league( 1)?$/i], ['netherlands', /^eredivisie$/i], ['portugal', /^(liga portugal|primeira liga)$/i], ['turkey', /^(super lig|süper lig)$/i], ['*', /(champions league|europa league|conference league)/i]];
export const altTracked = l => TRACK.some(([c, r]) => (c === '*' || String(l.country || '').toLowerCase() === c || (c === '*' && l.country === 'World')) && r.test(l.name || '') && !/women|u\d\d|youth/i.test(l.name || ''));

export function makeAltApi(usage, name) {
  usage[name] = { limit: null, remaining: null, calls: 0, window: null, error: null, sample: null }; const u = usage[name];
  let last = 0; const evById = new Map(), lastByTeam = new Map();
  async function call(action, params = {}) {
    const key = process.env.API_FOOTBALL_KEY; if (!key) throw new Error('Λείπει το API_FOOTBALL_KEY στα GitHub Secrets');
    if (u.blocked) throw new Error('BLOCKED: προσωρινή παύση κλήσεων (λογαριασμός/κλειδί API)');
    const wait = last + Number(process.env.API_DELAY_MS ?? 2500) - Date.now(); if (wait > 0) await sleep(wait);
    const url = new URL(BASE); url.searchParams.set('action', action); for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v); url.searchParams.set('APIkey', key);
    let res; try { res = await fetch(url); } catch { throw new Error(`apifootball.com ${action}: αποτυχία σύνδεσης`); } // δεν συμπεριλαμβάνεται ποτέ το URL (περιέχει το κλειδί)
    last = Date.now(); u.calls++;
    const fail = msg => { if (/key|suspend|expired|trial|payment|unauthor|forbidden/i.test(msg) || [401, 403].includes(res.status)) { u.blocked = u.blockedNew = true; msg = 'BLOCKED: ' + msg; } else if (/limit|too many/i.test(msg)) msg = 'QUOTA: ' + msg; u.error = msg.slice(0, 300); throw new Error(msg); };
    let j; try { j = await res.json(); } catch { return fail(`apifootball.com ${action}: μη έγκυρη απάντηση (HTTP ${res.status})`); }
    if (j && !Array.isArray(j) && j.error !== undefined) { if (String(j.error) === '404' || /no (event|match|result|data|standing|odd|league)/i.test(j.message || '')) return []; return fail(`apifootball.com ${action}: ${j.error} ${j.message || ''}`); }
    if (!res.ok) return fail(`apifootball.com ${action}: HTTP ${res.status}`);
    if (action === 'get_events' && Array.isArray(j) && j[0] && !u.sample) u.sample = JSON.stringify(j[0]).slice(0, 700);
    return j;
  }
  const events = async (from, to, extra = {}) => { const r = await call('get_events', { from, to, timezone: TZ, ...extra }); if (Array.isArray(r)) r.forEach(e => evById.set(String(e.match_id), e)); return Array.isArray(r) ? r : []; };
  const eventById = async id => { if (evById.has(String(id))) return evById.get(String(id)); const t = ymd(); await events(addDays(t, -2), addDays(t, 7), { match_id: id }); return evById.get(String(id)) || null; };
  const standingsRaw = lid => supa.cached(`ac:standings:${lid}`, 12 * 3600, async () => { const r = await call('get_standings', { league_id: lid }); return Array.isArray(r) ? r : []; });
  const sRow = r => { const blk = p => ({ played: num(r[`${p}_league_payed`]) ?? 0, win: num(r[`${p}_league_W`]) ?? 0, draw: num(r[`${p}_league_D`]) ?? 0, lose: num(r[`${p}_league_L`]) ?? 0, goals: { for: num(r[`${p}_league_GF`]) ?? 0, against: num(r[`${p}_league_GA`]) ?? 0 } });
    return { rank: num(r.overall_league_position), team: { id: idOf(r.team_id), name: r.team_name, logo: r.team_badge || '' }, points: num(r.overall_league_PTS) ?? 0, goalsDiff: (num(r.overall_league_GF) ?? 0) - (num(r.overall_league_GA) ?? 0), group: r.stage_name || null, form: null, description: r.overall_promotion || null, all: blk('overall'), home: blk('home'), away: blk('away') }; };
  const teamStats = r => { if (!r) return {}; const s = sRow(r), avg = (a, b) => b ? +(a / b).toFixed(2) : null, f = (k, g) => ({ home: g(s.home), away: g(s.away), total: g(s.all) });
    return { league: { goals: { for: { average: f('f', x => avg(x.goals.for, x.played)), total: f('f', x => x.goals.for) }, against: { average: f('a', x => avg(x.goals.against, x.played)), total: f('a', x => x.goals.against) } }, fixtures: { played: f('p', x => x.played), wins: f('w', x => x.win), draws: f('d', x => x.draw), loses: f('l', x => x.lose) } } }; };
  const H = {
    '/fixtures': async p => p.date ? (await events(p.date, p.date)).map(toFx) : p.team ? (lastByTeam.get(String(p.team)) || []).slice(0, Number(p.last) || 5) : [],
    '/leagues': async () => (await call('get_leagues')).map(x => ({ league: { id: idOf(x.league_id), name: x.league_name, type: 'League', logo: x.league_logo || '' }, country: { name: WORLD.includes(String(x.country_name).toLowerCase()) ? 'World' : x.country_name, code: '' } })),
    '/standings': async p => { const r = await standingsRaw(p.league); return r.length ? [{ league: { standings: [r.map(sRow)] } }] : []; },
    '/predictions': async p => {
      const e = await eventById(p.fixture); if (!e) return [];
      const rows = await standingsRaw(e.league_id).catch(() => []), find = id => rows.find(r => String(r.team_id) === String(id));
      let h2h = []; try { const r = await call('get_H2H', { firstTeamId: e.match_hometeam_id, secondTeamId: e.match_awayteam_id }); h2h = (r.firstTeam_VS_secondTeam || []).map(toFx); lastByTeam.set(String(e.match_hometeam_id), (r.firstTeam_lastResults || []).map(toFx)); lastByTeam.set(String(e.match_awayteam_id), (r.secondTeam_lastResults || []).map(toFx)); } catch (x) { if (/QUOTA|BLOCKED/.test(x.message)) throw x; }
      return [{ teams: { home: teamStats(find(e.match_hometeam_id)), away: teamStats(find(e.match_awayteam_id)) }, h2h, predictions: {} }];
    },
    '/odds': async p => {
      const e = await eventById(p.fixture), d = e?.match_date || ymd(); const rows = await call('get_odds', { from: d, to: d, match_id: p.fixture });
      return [{ bookmakers: rows.map(r => ({ bets: [{ name: 'Match Winner', values: [{ value: 'Home', odd: r.odd_1 }, { value: 'Draw', odd: r.odd_x }, { value: 'Away', odd: r.odd_2 }] }, { name: 'Goals Over/Under', values: [{ value: 'Over 2.5', odd: r['o+2.5'] }, { value: 'Under 2.5', odd: r['u+2.5'] }] }, { name: 'Both Teams Score', values: [{ value: 'Yes', odd: r.bts_yes }, { value: 'No', odd: r.bts_no }] }] })) }];
    },
    '/fixtures/lineups': async p => {
      const e = await eventById(p.fixture), L = e?.lineup; if (!L?.home?.starting_lineups?.length || !L?.away?.starting_lineups?.length) return [];
      const t = (side, id) => ({ team: { id: idOf(id) }, formation: e[`match_${side}team_system`] || null, coach: { name: L[side].coach?.[0]?.lineup_player || null }, startXI: L[side].starting_lineups.map(x => ({ player: { number: x.lineup_number, name: x.lineup_player, pos: x.lineup_position } })) });
      return [t('home', e.match_hometeam_id), t('away', e.match_awayteam_id)];
    },
    '/fixtures/statistics': async p => {
      const e = await eventById(p.fixture), c = (e?.statistics || []).find(s => /corner/i.test(s.type)); return c ? [{ statistics: [{ type: 'Corner Kicks', value: num(c.home) }] }, { statistics: [{ type: 'Corner Kicks', value: num(c.away) }] }] : [];
    },
    '/injuries': async () => { throw new Error('UNSUPPORTED: οι απουσίες δεν παρέχονται από αυτόν τον πάροχο'); }
  };
  return async function api(endpoint, params = {}) { const h = H[endpoint]; if (!h) throw new Error(`UNSUPPORTED: ${endpoint}`); return h(params); };
}
