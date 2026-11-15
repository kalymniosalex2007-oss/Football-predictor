
import { makeAltApi } from './apifootballcom.js';

// Κοινή καταγραφή χρήσης API
export const usage = {};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Διατηρούμε τον παλιό client για συμβατότητα με το μπάσκετ
export function makeApi(name, base) {
  let last = 0;
  usage[name] = {
    limit: null,
    remaining: null,
    calls: 0,
    window: null,
    error: null
  };

  return async function api(endpoint, params = {}) {
    const key = (name === 'basketball' && process.env.API_BASKETBALL_KEY)
      || process.env.API_FOOTBALL_KEY;

    if (!key) throw new Error('Λείπει το API key');

    const u = usage[name];
    if (u.remaining !== null && u.remaining <= 5) {
      throw new Error(`QUOTA: τέλος ημερήσιου ορίου (${name})`);
    }

    const wait = last + Number(process.env.API_DELAY_MS ?? 6500) - Date.now();
    if (wait > 0) await sleep(wait);

    const url = new URL(base + endpoint);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const res = await fetch(url, {
      headers: { 'x-apisports-key': key }
    });

    last = Date.now();
    u.calls++;

    if (!res.ok) throw new Error(`API ${name} ${res.status} ${endpoint}`);

    const j = await res.json();
    return j.response || [];
  };
}

// ΝΕΟ API ΠΟΔΟΣΦΑΙΡΟΥ
export const api = makeAltApi(usage, 'football');
