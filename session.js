/* ══════════════════════════════════════════════════════════════
   ZWARTE MARKT — sessieherstel
   Wie de pagina herlaadt (of wiens telefoon het tabblad ververst) komt
   vanzelf terug in het potje. Wat we onthouden staat alleen op dit toestel:
   - sessionStorage: het potje van dit tabblad → vanzelf verder na herladen
   - localStorage:   het laatste potje op dit toestel → knop "Verder spelen"
                     op het startscherm (bijv. nadat het tabblad dicht was)
   Kas, koffer, tips en zendingen staan in de database en komen dus gewoon terug.
   ══════════════════════════════════════════════════════════════ */

const SESSION_KEY   = 'zm.session';
const LAST_KEY      = 'zm.last';
const RESUME_MAX_MS = 24 * 60 * 60 * 1000;   // daarna is het potje toch opgeruimd

let resumeOffer = null;   // sessie die op het startscherm wordt aangeboden
let resuming = false;

// Opslag kan geblokkeerd zijn (privémodus, instellingen): dan werkt alles gewoon, alleen zonder herstel.
function tabStore()    { try { return window.sessionStorage; } catch (e) { return null; } }
function deviceStore() { try { return window.localStorage; } catch (e) { return null; } }
function storeGet(store, key) {
  try { return JSON.parse(store.getItem(key) || 'null'); } catch (e) { return null; }
}
function storeSet(store, key, val) {
  try { if (val === null) store.removeItem(key); else store.setItem(key, JSON.stringify(val)); } catch (e) { /* geen opslag */ }
}
function validSession(s) {
  return !!s && typeof s.code === 'string' && s.code.length === 6 && typeof s.pid === 'string' && !!s.pid
    && typeof s.name === 'string' && Date.now() - (s.at || 0) < RESUME_MAX_MS;
}

// ── Bewaren ──
function saveSession() {
  if (isLocal || resuming || !code || !game?.players?.[me.pid]) return;
  const s = { code, pid: me.pid, name: me.name, at: Date.now() };
  if (locMode === 'manual' && myPos) s.loc = { lat: myPos.lat, lng: myPos.lng };
  if (me.isHost && hostPlan.length) s.host = { plan: hostPlan, lastTipRound };   // schokkenplan: alleen op het toestel van de host
  if (readTips.size) s.readTips = [...readTips].slice(-80);
  storeSet(tabStore(), SESSION_KEY, s);
  storeSet(deviceStore(), LAST_KEY, s);
}

// Vergeten: bij bewust verlaten, of als het potje niet meer bestaat
function forgetSession(s) {
  const mine = s || { code, pid: me.pid };
  const same = x => x && x.code === mine.code && x.pid === mine.pid;
  if (same(storeGet(tabStore(), SESSION_KEY))) storeSet(tabStore(), SESSION_KEY, null);
  if (same(storeGet(deviceStore(), LAST_KEY))) storeSet(deviceStore(), LAST_KEY, null);
  if (same(resumeOffer)) resumeOffer = null;
}

// ── Herstellen ──
async function resumeSession(s) {
  if (resuming) return false;
  resuming = true;
  resumeOffer = s;
  renderResumeOffer();
  try {
    let g;
    try { g = await fbGet(`games/${s.code}`); }
    catch (e) { toast('Geen verbinding. Probeer het zo nog eens.', 'bad'); return false; }

    if (!g || !g.players?.[s.pid]) {
      forgetSession(s);
      toast('Dat potje bestaat niet meer.', 'bad');
      return false;
    }

    me.pid = s.pid; me.name = s.name; code = s.code; game = g;
    me.isHost = g.hostId === s.pid;
    readTips = new Set(s.readTips || []);
    if (s.loc && g.config?.allowManualLocation !== false) { locMode = 'manual'; myPos = { lat: s.loc.lat, lng: s.loc.lng }; }
    if (me.isHost && g.status === 'playing') {
      hostPlan = s.host?.plan || [];
      lastTipRound = s.host?.lastTipRound || Date.now();
      // Plan kwijt (opslag geblokkeerd)? Maak een nieuw plan voor de rest van het potje.
      if (!hostPlan.length) hostPlan = buildPlan(g.startedAt || Date.now(), g.config.durationSec).filter(ev => ev.at > Date.now());
    }
    resumeOffer = null;

    if (g.status === 'lobby') enterLobby();
    else if (g.status === 'playing') { startPolling(); enterGame(); toast('Je bent terug in het potje', 'good'); }
    else { endedShown = false; endGame(); }
    return true;
  } finally {
    resuming = false;
    renderResumeOffer();
    saveSession();
  }
}

// Bij het openen van de pagina
function initSession() {
  if (isLocal) return;
  const own = storeGet(tabStore(), SESSION_KEY);
  if (validSession(own)) { resumeSession(own); return; }
  const last = storeGet(deviceStore(), LAST_KEY);
  resumeOffer = validSession(last) ? last : null;
  renderResumeOffer();
}

// ── Startscherm: "Verder spelen" ──
function renderResumeOffer() {
  const box = $('resume-box');
  if (!box) return;
  box.hidden = !resumeOffer;
  if (!resumeOffer) return;
  $('resume-what').textContent = `Lobby ${resumeOffer.code} · als ${resumeOffer.name}`;
  const btn = $('btn-resume');
  btn.disabled = resuming;
  btn.textContent = resuming ? 'Bezig…' : 'Verder spelen';
  $('btn-resume-forget').disabled = resuming;
}

function bindSession() {
  $('btn-resume').addEventListener('click', () => { if (resumeOffer) resumeSession(resumeOffer); });
  $('btn-resume-forget').addEventListener('click', () => {
    if (!resumeOffer) return;
    forgetSession(resumeOffer);
    resumeOffer = null;
    renderResumeOffer();
  });
  // Vlak voor het tabblad naar de achtergrond gaat of herlaadt: laatste stand vastleggen
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveSession(); });
  window.addEventListener('pagehide', saveSession);
}
