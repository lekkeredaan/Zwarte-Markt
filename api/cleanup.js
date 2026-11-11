/* ══════════════════════════════════════════════════════════════
   ZWARTE MARKT — opruimtaak (Vercel-functie, draait 1× per dag via cron)
   Verwijdert oude lobby's uit Firebase, zodat er geen spelgegevens
   (bijnamen, standen, gedeelde plekken) blijven rondslingeren.

   Weg gaat:
   - een gespeeld potje, 24 uur na de eindtijd
   - een lobby die nooit gestart is, 24 uur na het aanmaken
   - restjes zonder aanmaakdatum (geen echte lobby)

   Nodig in Vercel (Environment Variables):
   - FIREBASE_SERVICE_ACCOUNT  de service-account-JSON uit de Firebase-console
   - CRON_SECRET               willekeurige tekst; Vercel stuurt hem zelf mee met de cron
   Geen van beide staat in de code of in de browser.
   ══════════════════════════════════════════════════════════════ */

const crypto = require('crypto');

const DB_URL = (process.env.FIREBASE_DB_URL || 'https://zwarte-markt-default-rtdb.europe-west1.firebasedatabase.app').replace(/\/+$/, '');
const DAY = 24 * 60 * 60 * 1000;
const KEEP_AFTER_END_MS = DAY;    // gespeeld potje: nog een dag de eindstand kunnen terugkijken
const KEEP_UNSTARTED_MS = DAY;    // nooit gestart: na een dag weg
const MAX_REMOVE = 500;           // rem per run
const PARALLEL = 10;

// Mag deze lobby weg?
function isExpired(meta, now) {
  const endsAt = Number(meta?.endsAt), createdAt = Number(meta?.createdAt);
  if (endsAt > 0) return now > endsAt + KEEP_AFTER_END_MS;
  if (createdAt > 0) return now > createdAt + KEEP_UNSTARTED_MS;
  return true;   // geen eindtijd en geen aanmaakdatum: een restje, geen lobby
}

function readServiceAccount() {
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (!raw) return null;
  let sa = null;
  try { sa = JSON.parse(raw); }
  catch (e) {
    try { sa = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); } catch (e2) { return null; }
  }
  if (!sa || !sa.client_email || !sa.private_key) return null;
  return { client_email: sa.client_email, private_key: String(sa.private_key).replace(/\\n/g, '\n') };
}

const b64url = x => Buffer.from(x).toString('base64url');

function signedJwt(sa, nowSec) {
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token',
    iat: nowSec,
    exp: nowSec + 600,
  }));
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${claim}`).sign(sa.private_key);
  return `${head}.${claim}.${b64url(sig)}`;
}

// Tijdelijk toegangsbewijs van Google (10 minuten geldig), op naam van het service-account
async function accessToken(sa) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedJwt(sa, Math.floor(Date.now() / 1000)),
    }),
  });
  if (!r.ok) throw new Error(`Inloggen bij Google mislukt (${r.status})`);
  const j = await r.json();
  if (!j.access_token) throw new Error('Geen toegangsbewijs gekregen van Google');
  return j.access_token;
}

async function db(path, token, { method = 'GET', query = '' } = {}) {
  const r = await fetch(`${DB_URL}/${path}.json${query}`, { method, headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Database ${method} mislukt (${r.status})`);
  return r.json();
}

async function inBatches(items, size, fn) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

function allowed(req) {
  const secret = process.env.CRON_SECRET || '';
  const given = String(req.headers?.authorization || '');
  const want = `Bearer ${secret}`;
  if (!secret || given.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(want));
}

async function handler(req, res) {
  if (!allowed(req)) return res.status(401).json({ ok: false, error: 'Niet toegestaan' });
  const sa = readServiceAccount();
  if (!sa) return res.status(500).json({ ok: false, error: 'FIREBASE_SERVICE_ACCOUNT ontbreekt of is ongeldig' });

  const dryRun = req.query?.dry === '1';   // ?dry=1: alleen tellen, niets weggooien
  const now = Date.now();
  try {
    const token = await accessToken(sa);
    const codes = Object.keys((await db('games', token, { query: '?shallow=true' })) || {});

    const expired = [];
    let failed = 0;
    await inBatches(codes, PARALLEL, async code => {
      try {
        const safe = encodeURIComponent(code);
        const [createdAt, endsAt] = await Promise.all([
          db(`games/${safe}/createdAt`, token),
          db(`games/${safe}/endsAt`, token),
        ]);
        if (isExpired({ createdAt, endsAt }, now)) expired.push(safe);
      } catch (e) { failed++; }
    });

    const todo = expired.slice(0, MAX_REMOVE);
    let removed = 0;
    if (!dryRun) {
      await inBatches(todo, PARALLEL, async safe => {
        try { await db(`games/${safe}`, token, { method: 'DELETE' }); removed++; } catch (e) { failed++; }
      });
    }

    const out = { ok: true, dryRun, lobbies: codes.length, expired: expired.length, removed, failed };
    console.log('cleanup', JSON.stringify(out));
    return res.status(200).json(out);
  } catch (e) {
    console.error('cleanup mislukt:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}

module.exports = handler;
module.exports.isExpired = isExpired;
module.exports.signedJwt = signedJwt;
