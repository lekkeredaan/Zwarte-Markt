/* ══════════════════════════════════════════════════════════════
   ZWARTE MARKT — kernlogica
   Realtime via Firebase RTDB (REST + polling). Zonder DB_URL = lokale testmodus.
   Zie ook: location.js (GPS / handmatige locatie), bluff.js (tips, schokken),
   teams.js, risk.js en session.js (terugkomen na herladen).
   ══════════════════════════════════════════════════════════════ */

// ── Firebase config ───────────────────────────────────────────────
// Realtime Database-URL (van de Firebase-console). Leeg ('') = lokaal testen.
const DB_URL = 'https://zwarte-markt-default-rtdb.europe-west1.firebasedatabase.app';
const isLocal = !DB_URL;

// ── Constanten ────────────────────────────────────────────────────
const GOODS = [
  { id: 'horloges', name: 'Namaakhorloges',    short: 'Horloges', ill: 'ill-horloges', base: 60  },
  { id: 'kruiden',  name: 'Exotische kruiden', short: 'Kruiden',  ill: 'ill-kruiden',  base: 25  },
  { id: 'munten',   name: 'Zeldzame munten',   short: 'Munten',   ill: 'ill-munten',   base: 120 },
  { id: 'sigaren',  name: 'Smokkelsigaren',    short: 'Sigaren',  ill: 'ill-sigaren',  base: 40  },
];
const GOOD = Object.fromEntries(GOODS.map(g => [g.id, g]));

const MARKET_NAMES = ['De Haven', 'Het Pakhuis', 'Steeg 7', 'De Loods', 'Achterom', 'Het Souterrain', "'t Rangeerterrein", 'De Kade', 'Blok C', 'De Werf'];

const POLL_MS       = 2000;   // hoe vaak we de database uitlezen
const PRICE_TICK_MS = 9000;   // hoe vaak de host de markt bijwerkt
const TRADE_RADIUS  = 60;     // meter: binnen deze afstand mag je handelen
const MAX_MARKETS   = 6;
const MIN_MARKETS   = 2;
const NL_CENTER     = [52.1, 5.1];
const ME_HOLD_MS    = 5000;   // eigen kas/koffer na een schrijfactie even lokaal vasthouden

// ── State ─────────────────────────────────────────────────────────
let me = { pid: genId(), name: '', isHost: false };
let code = '';
let game = null;              // volledige game-state (lokaal spiegelbeeld)
let setupMarkets = [];        // tijdens speelveld opzetten
let setupMap = null, gameMap = null;
let marketLayer = null, meMarker = null;
let myPos = null;             // {lat,lng}: GPS of handmatig (zie location.js)
let pollTimer = null, tickTimer = null, clockTimer = null, geoWatch = null;
let activeMarketId = null;    // open handelspaneel
let tradeQty = 1;             // aantal per klik (×1 / ×5 / ×10)
let tradeTab = 'trade';       // 'trade' | 'ship' | 'customs' (zie risk.js)
let endedShown = false;
let localMe = null;           // {capital, inv, at}: laatste eigen schrijfactie
const setupMarkerLayer = { layer: null };

// ══════════════════════════════════════════════════════════════════
//  Helpers
// ══════════════════════════════════════════════════════════════════
function genId() { return Math.random().toString(36).slice(2, 10); }
function genCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 6; i++) c += A[Math.floor(Math.random() * A.length)];
  return c;
}
function $(id) { return document.getElementById(id); }
function euro(n) { return '€' + Math.round(n).toLocaleString('nl-NL'); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Alleen opnieuw opbouwen als de inhoud echt verandert. Zo worden knoppen niet
// elke poll vervangen (anders kan een tik op een telefoon "wegvallen").
function setHtml(elOrId, html) {
  const el = typeof elOrId === 'string' ? $(elOrId) : elOrId;
  if (el && el._html !== html) { el.innerHTML = html; el._html = html; }
}
// Illustratie of icoon uit de sprite in index.html
function ill(id, cls = 'ill') {
  return `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="#${id}"></use></svg>`;
}

function haversine(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

let toastTimer = null;
function toast(msg, kind) {
  const t = $('toast');
  t.textContent = msg;
  // Is er een paneel open? Dan bovenin tonen, zodat de melding niet over de knoppen valt
  const sheetOpen = !!document.querySelector('.sheet:not([hidden])');
  t.className = 'toast' + (kind ? ' ' + kind : '') + (sheetOpen ? ' toast--top' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('screen--active'));
  $(id).classList.add('screen--active');
}

// ── Sheets (onderlades) ──
function openSheet(id) { $(id).hidden = false; }
function closeSheet(id) {
  $(id).hidden = true;
  if (id === 'trade-modal') activeMarketId = null;
}
function closeAllSheets() { document.querySelectorAll('.sheet').forEach(s => closeSheet(s.id)); }

// ══════════════════════════════════════════════════════════════════
//  Firebase REST (met foutafhandeling)
// ══════════════════════════════════════════════════════════════════
async function fbGet(path) {
  const r = await fetch(`${DB_URL}/${path}.json`);
  if (!r.ok) throw new Error(`Database leesfout (${r.status})`);
  return r.json();
}
async function fbPut(path, data) {
  const r = await fetch(`${DB_URL}/${path}.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`Database schrijffout (${r.status})`);
  return r.json();
}
async function fbPatch(path, data) {
  const r = await fetch(`${DB_URL}/${path}.json`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`Database schrijffout (${r.status})`);
  return r.json();
}

// Meerdere plekken in één keer (atomair) bijwerken, paden relatief aan games/<code>.
// Na succes ook lokaal doorvoeren, zodat het scherm meteen klopt.
async function fbUpdate(updates) {
  if (!isLocal) await fbPatch(`games/${code}`, updates);
  applyLocal(updates);
}
function applyLocal(updates) {
  if (!game) return;
  for (const [path, val] of Object.entries(updates)) {
    const keys = path.split('/');
    let o = game;
    for (let i = 0; i < keys.length - 1; i++) {
      if (typeof o[keys[i]] !== 'object' || o[keys[i]] === null) o[keys[i]] = {};
      o = o[keys[i]];
    }
    const last = keys[keys.length - 1];
    if (val === null) delete o[last]; else o[last] = val;
  }
}
// Eigen spelergegevens schrijven (+ eventueel andere paden in dezelfde update)
async function writeMe(fields, extra = {}) {
  const updates = { ...extra };
  for (const [k, v] of Object.entries(fields)) updates[`players/${me.pid}/${k}`] = v;
  await fbUpdate(updates);
  const p = myPlayer();
  localMe = { capital: p?.capital, inv: p?.inv || {}, at: Date.now() };
}
// Alles wat mijn kas of koffer leest-en-schrijft loopt via deze wachtrij, één voor één.
// Zo overschrijven een aankoop, een binnenkomende zending en een gift elkaar nooit.
let meQueue = Promise.resolve();
function withMe(fn) {
  const run = meQueue.then(fn);
  meQueue = run.catch(() => {});
  return run;
}

// ══════════════════════════════════════════════════════════════════
//  Prijs-engine
// ══════════════════════════════════════════════════════════════════
function buildMarketsNode(markets) {
  const node = {};
  for (const m of markets) {
    const anchor = {}, prices = {}, prev = {};
    for (const g of GOODS) {
      const factor = 0.6 + Math.random() * 0.9;         // 0.6 – 1.5 (markt-eigen)
      const a = Math.max(5, Math.round(g.base * factor));
      anchor[g.id] = a;
      const p = Math.max(1, Math.round(a * (0.85 + Math.random() * 0.3)));
      prices[g.id] = p; prev[g.id] = p;
    }
    node[m.id] = { name: m.name, lat: m.lat, lng: m.lng, anchor, prices, prev };
  }
  return node;
}

// Actieve marktschok op een markt (zie bluff.js), of null
function activeShock(m, now = Date.now()) {
  return m?.shock && m.shock.until > now ? m.shock : null;
}

function nextPrices(markets, now = Date.now()) {
  // mean-reverting random walk rond anchor (tijdens een schok rond anchor × multiplier)
  const out = {};
  for (const [id, m] of Object.entries(markets || {})) {
    const shock = activeShock(m, now);
    const prices = {}, prev = {};
    for (const g of GOODS) {
      const cur = m.prices?.[g.id] ?? m.anchor?.[g.id] ?? g.base;
      const mult = shock && shock.good === g.id ? shock.mult : 1;
      const anc = (m.anchor?.[g.id] ?? g.base) * mult;
      let np = cur + (anc - cur) * 0.14 + cur * (Math.random() - 0.5) * 0.18;
      if (Math.random() < 0.06) np *= (0.7 + Math.random() * 0.7);  // kleine schommeling
      np = clamp(np, Math.max(1, anc * 0.45), anc * 1.9);
      prev[g.id] = cur;
      prices[g.id] = Math.max(1, Math.round(np));
    }
    out[id] = { ...m, prices, prev, shock: shock || null };
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════
//  Game aanmaken / joinen
// ══════════════════════════════════════════════════════════════════
async function createLobby() {
  const capital  = parseInt($('opt-capital').value, 10);
  const duration = parseInt($('opt-duration').value, 10);
  const gpsCheck = $('opt-gps').checked;
  const allowManualLocation = $('opt-manual').checked;
  const teamSize = parseInt($('opt-teams').value, 10) || 0;

  const markets = setupMarkets.map((m, i) => ({ id: 'm' + i, name: m.name, lat: m.lat, lng: m.lng }));

  const host = { name: me.name, capital, inv: {}, isHost: true, joinedAt: Date.now() };
  if (teamSize) host.team = TEAMS[0].id;
  const newGame = {
    status: 'lobby',
    hostId: me.pid,
    createdAt: Date.now(),
    config: { startCapital: capital, durationSec: duration, gpsCheck, allowManualLocation, teamSize },
    markets: buildMarketsNode(markets),
    players: { [me.pid]: host },
  };

  if (isLocal) {
    code = 'LOKAAL';
  } else {
    let tries = 0;
    do {
      code = genCode();
      const existing = await fbGet(`games/${code}`);
      if (!existing) break;
    } while (++tries < 6);
    await fbPut(`games/${code}`, newGame);
  }
  game = newGame;
  me.isHost = true;
  enterLobby();
}

async function joinLobby(enteredCode) {
  if (isLocal) throw new Error('Meedoen met een code werkt alleen met Firebase (multiplayer). Maak zelf een lobby om lokaal te testen.');
  const g = await fbGet(`games/${enteredCode}`);
  if (!g) throw new Error('Geen lobby met die code gevonden.');
  if (g.status === 'ended') throw new Error('Dit potje is al afgelopen.');
  code = enteredCode;
  game = g;
  me.isHost = (g.hostId === me.pid);
  const startCap = g.config?.startCapital ?? 500;
  const mine = { name: me.name, capital: startCap, inv: {}, joinedAt: Date.now() };
  if (teamMode()) mine.team = smallestTeamId(g.players, Object.keys(g.players || {}).length + 1);
  await fbPatch(`games/${code}/players/${me.pid}`, mine);
  game.players = { ...(game.players || {}), [me.pid]: mine };
  if (g.status === 'playing') { startPolling(); enterGame(); return; }
  enterLobby();
}

// ══════════════════════════════════════════════════════════════════
//  Lobby
// ══════════════════════════════════════════════════════════════════
function enterLobby() {
  showScreen('screen-lobby');
  $('lobby-code').textContent = code;
  $('lobby-host-box').hidden = !me.isHost;
  $('lobby-wait').hidden = me.isHost;
  renderLobby();
  startPolling();
  saveSession();   // session.js: na herladen terug in deze lobby
}

// Eén rij in een spelerslijst (ook gebruikt door de teamlobby)
function rosterLi([pid, p]) {
  const name = p.name || '???';
  const isMe = pid === me.pid;
  return `<li class="${isMe ? 'is-me' : ''}">
      <span class="avatar" aria-hidden="true">${escapeHtml(name.trim().charAt(0).toUpperCase() || '?')}</span>
      <span>${escapeHtml(name)}${isMe ? ' <small>(jij)</small>' : ''}</span>
      ${p.isHost ? '<span class="tag">Host</span>' : ''}
    </li>`;
}

function renderLobby() {
  if (!game) return;
  const players = Object.entries(game.players || {});
  const teams = teamMode();
  $('lobby-count').textContent = players.length;
  $('lobby-label').textContent = teams ? `Teams van ${teamSize()}` : 'Handelaren';
  $('btn-shuffle').hidden = !(teams && me.isHost);
  setHtml('lobby-players', teams ? lobbyTeamsHtml() : `<ul class="roster">${players.map(rosterLi).join('')}</ul>`);
  const enough = players.length >= 2 || isLocal;
  const startBtn = $('btn-start-game');
  if (startBtn) startBtn.disabled = !enough;
  const hint = $('start-hint');
  if (hint) hint.textContent = !enough ? 'Wacht op minstens 2 handelaren om te starten.'
    : teams ? `${players.length} handelaren in ${teamCount(players.length)} teams. Iedereen er? Open de markt.`
    : `${players.length} handelaren binnen. Iedereen er? Open de markt.`;
}

async function startGame() {
  const btn = $('btn-start-game');
  btn.disabled = true;
  try {
    const now = Date.now();
    const endsAt = now + (game.config.durationSec * 1000);
    // In teamspel: gaten en te volle teams aanvullen, in dezelfde update als de start
    const teamFix = teamMode() ? assignTeams(false) : {};
    await fbUpdate({ status: 'playing', startedAt: now, endsAt, ...teamFix });
    hostStartBluff(now);
    enterGame();
  } catch (e) {
    toast(e.message || 'Starten mislukt', 'bad');
    btn.disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════════
//  Spel
// ══════════════════════════════════════════════════════════════════
function enterGame() {
  showScreen('screen-game');
  endedShown = false;
  tradeTab = 'trade';
  $('btn-team').hidden = !teamMode();
  initGameMap();
  initMates();
  primeBluff();
  startGeolocation();
  startClock();
  if (me.isHost) startHostLoop();
  renderGame();
  syncBluff();
  if (myPos) onMyPosChanged();   // plek die er al was (handmatig, of hersteld na herladen) meteen tonen
  saveSession();
}

function initGameMap() {
  if (gameMap) { gameMap.remove(); gameMap = null; }
  meMarker = null;
  gameMap = L.map('game-map', { zoomControl: false, attributionControl: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(gameMap);
  L.control.attribution({ prefix: false }).addAttribution('© OpenStreetMap').addTo(gameMap);
  marketLayer = L.layerGroup().addTo(gameMap);
  gameMap.on('click', onGameMapClick);   // location.js: handmatig plek kiezen

  const ms = Object.values(game.markets || {});
  if (ms.length) {
    const bounds = L.latLngBounds(ms.map(m => [m.lat, m.lng]));
    // ruimte laten voor HUD (boven) en koffer (onder)
    gameMap.fitBounds(bounds, { paddingTopLeft: [50, 110], paddingBottomRight: [50, 240], maxZoom: 17 });
  } else {
    gameMap.setView(NL_CENTER, 13);
  }
  setTimeout(() => gameMap && gameMap.invalidateSize(), 150);
  drawMarkets();
  updateMeMarker();
}

function drawMarkets() {
  if (!marketLayer || !game) return;
  marketLayer.clearLayers();
  for (const [id, m] of Object.entries(game.markets || {})) {
    const icon = marketIcon(marketNum(id), m.name, canTradeAt(id), activeShock(m)?.kind);
    const mk = L.marker([m.lat, m.lng], { icon, title: m.name }).addTo(marketLayer);
    mk.on('click', () => onMarketClick(id));
  }
}

function onMarketClick(id) {
  // Tijdens "plek kiezen" zet een tik op een markt je daar neer (location.js)
  if (pickingLoc) {
    const m = game.markets[id];
    setManualPos(m.lat, m.lng, m.name);
    stopPicking();
    return;
  }
  openTrade(id);
}

// Markt-marker: druppel-pin met nummer + naamlabel (+ schok-illustratie)
function marketIcon(num, name, near, shockKind) {
  const shock = shockKind ? ill(shockKind === 'raid' ? 'ill-inval' : 'ill-tekort', 'mk__shock') : '';
  return L.divIcon({
    className: 'mk-wrap',
    html: `<div class="mk ${near ? 'mk--near' : ''}">
             <div class="mk__pinwrap"><div class="mk__pin"><span class="mk__num">${num}</span></div>${shock}</div>
             <div class="mk__name">${escapeHtml(name)}</div>
           </div>`,
    iconSize: [150, 84],
    iconAnchor: [75, 52],
  });
}
function marketNum(id) { return (parseInt(String(id).replace(/\D/g, ''), 10) || 0) + 1; }

function canTradeAt(id) {
  const m = game?.markets?.[id];
  if (!m) return false;
  if (!game.config?.gpsCheck) return true;      // testmodus
  if (!myPos) return false;
  return haversine(myPos, { lat: m.lat, lng: m.lng }) <= TRADE_RADIUS;
}

// ── Klok / timer ──
function startClock() {
  clearInterval(clockTimer);
  clockTimer = setInterval(tickClock, 1000);
  tickClock();
}
function tickClock() {
  if (!game || game.status === 'ended') { return endGame(); }
  const remain = Math.max(0, (game.endsAt || 0) - Date.now());
  const s = Math.floor(remain / 1000);
  const el = $('hud-timer');
  el.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  el.classList.toggle('is-low', s <= 60);
  if (remain > 0) tickRisk();   // risk.js: zendingen lossen, aftellen
  if (remain <= 0) {
    if (me.isHost && !isLocal) fbPatch(`games/${code}`, { status: 'ended' }).catch(() => {});
    if (game) game.status = 'ended';
    endGame();
  }
}

// ── Host-loop: prijzen, marktschokken en tips (alleen host) ──
function startHostLoop() {
  clearInterval(tickTimer);
  tickTimer = setInterval(hostTick, PRICE_TICK_MS);
}
async function hostTick() {
  if (!game || game.status !== 'playing') return;
  const now = Date.now();
  game.markets = nextPrices(game.markets, now);
  const updates = { ...fireDueEvents(now), ...dealTipsIfDue(now) };   // bluff.js
  updates.markets = game.markets;
  try { await fbUpdate(updates); } catch (e) { /* stil: volgende tick opnieuw */ }
  if (isLocal) { drawMarkets(); renderGame(); if (activeMarketId) renderTrade(); syncBluff(); }
  saveSession();   // schokkenplan van de host overleeft zo een herlaadbeurt
}

// ══════════════════════════════════════════════════════════════════
//  Render spel (cash + koffer)
// ══════════════════════════════════════════════════════════════════
function myPlayer() { return game?.players?.[me.pid]; }

function renderGame() {
  const p = myPlayer();
  if (!p) return;
  $('hud-capital').textContent = euro(p.capital);
  renderInventory();
}

function renderInventory() {
  const inv = myPlayer()?.inv || {};
  const owned = GOODS.filter(g => (inv[g.id] || 0) > 0);
  const worth = owned.reduce((sum, g) => sum + inv[g.id] * avgPrice(g.id), 0);
  $('inv-worth').textContent = owned.length ? `≈ ${euro(worth)}` : 'leeg';
  const chips = owned.map(g => `<span class="item">${ill(g.ill, 'ill ill--sm')}${inv[g.id]}× ${g.short}</span>`).join('') + shipChipsHtml();
  setHtml('inv-list', chips || '<p class="koffer__empty">Tik op een markt om te handelen.</p>');
}

// ══════════════════════════════════════════════════════════════════
//  Handelspaneel (grootboek)
// ══════════════════════════════════════════════════════════════════
function openTrade(id) {
  activeMarketId = id;
  tradeTab = 'trade';
  openSheet('trade-modal');
  renderTrade();
}

// Prijs t.o.v. het gemiddelde van alle markten → deal-label
function dealInfo(gid, price) {
  const pct = Math.round((price / avgPrice(gid) - 1) * 100);
  if (pct <= -5) return { cls: 'low',  text: `<b>${pct}%</b> goedkoop` };
  if (pct >= 5)  return { cls: 'high', text: `<b>+${pct}%</b> duur` };
  return { cls: 'mid', text: 'gemiddeld' };
}

function renderTrade() {
  const id = activeMarketId;
  const m = game?.markets?.[id];
  if (!m) return;
  $('trade-market-name').textContent = m.name;
  $('trade-market-num').textContent = marketNum(id);

  const near = canTradeAt(id);
  const distEl = $('trade-distance');
  let far = false;
  if (!game.config?.gpsCheck) {
    distEl.textContent = 'Testmodus: overal handelen toegestaan';
  } else if (!myPos) {
    distEl.textContent = 'Nog geen locatie. Tik rechtsboven op het vizier.';
    far = true;
  } else {
    const d = Math.round(haversine(myPos, { lat: m.lat, lng: m.lng }));
    distEl.textContent = near ? `Je staat bij deze markt (${d} m)` : `Loop dichterbij: nog ${d} m`;
    far = !near;
  }
  distEl.className = 'sheet__sub' + (far ? ' is-far' : '');

  document.querySelectorAll('#trade-qty .seg__btn').forEach(b =>
    b.setAttribute('aria-pressed', String(Number(b.dataset.qty) === tradeQty)));
  document.querySelectorAll('#trade-tabs .seg__btn').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.tab === tradeTab)));
  if (tradeTab !== 'trade') { renderRisk(m, near); return; }   // risk.js
  $('trade-status').hidden = true;
  $('trade-foot').textContent = 'Het label vergelijkt de prijs met het gemiddelde van alle markten.';

  const p = myPlayer();
  const qty = tradeQty;
  const shock = activeShock(m);
  setHtml('trade-goods', GOODS.map(g => {
    const price = m.prices?.[g.id] ?? g.base;
    const prev = m.prev?.[g.id] ?? price;
    const trend = price > prev ? 'up' : (price < prev ? 'down' : '');
    const owned = p?.inv?.[g.id] || 0;
    const deal = dealInfo(g.id, price);
    const canBuy = near && (p?.capital || 0) >= price * qty;
    const canSell = near && owned >= qty;
    const stamp = shock && shock.good === g.id
      ? `<span class="stamp stamp--${shock.kind}">${shock.kind === 'raid' ? 'Inval' : 'Tekort'}</span>` : '';
    return `
      <div class="row">
        <div class="row__top">
          ${ill(g.ill, 'ill ill--lg')}
          <div>
            <div class="row__name">${g.name}${stamp}</div>
            <div class="row__meta">In koffer: <strong>${owned}</strong>${trend ? ` · <span class="trend-${trend}">${trend === 'up' ? '▲ stijgt' : '▼ daalt'}</span>` : ''}</div>
          </div>
          <div class="row__price">
            <div class="price">${euro(price)}</div>
            <span class="deal deal--${deal.cls}">${deal.text}</span>
            ${qty > 1 ? `<div class="row__total">×${qty} = ${euro(price * qty)}</div>` : ''}
          </div>
        </div>
        <div class="row__actions">
          <button class="btn btn--ink" data-act="buy" data-g="${g.id}" ${canBuy ? '' : 'disabled'}>Koop ${qty}</button>
          <button class="btn btn--gain" data-act="sell" data-g="${g.id}" ${canSell ? '' : 'disabled'}>Verkoop ${qty}</button>
        </div>
      </div>`;
  }).join(''));
}

async function doTrade(gid, kind) {
  const id = activeMarketId;
  if (!canTradeAt(id)) { toast('Je staat niet bij deze markt', 'bad'); return; }
  document.querySelectorAll('#trade-goods .btn').forEach(b => { b.disabled = true; });
  try {
    await withMe(async () => {
      const m = game.markets?.[id];
      const p = myPlayer();
      if (!m || !p) return;
      const price = m.prices?.[gid] ?? GOOD[gid].base;
      const qty = tradeQty;
      const total = price * qty;
      const have = p.inv?.[gid] || 0;
      if (kind === 'buy' && p.capital < total) { toast('Te weinig cash', 'bad'); return; }
      if (kind === 'sell' && have < qty) { toast('Zoveel heb je niet', 'bad'); return; }

      // Nieuwe stand eerst uitrekenen; writeMe voert hem pas lokaal door als opslaan gelukt is
      const inv = { ...(p.inv || {}) };
      const capital = kind === 'buy' ? p.capital - total : p.capital + total;
      inv[gid] = kind === 'buy' ? have + qty : have - qty;
      if (inv[gid] === 0) delete inv[gid];
      await writeMe({ capital, inv });
      toast(`${kind === 'buy' ? 'Gekocht' : 'Verkocht'}: ${qty}× ${GOOD[gid].short} voor ${euro(total)}`, 'good');
      renderGame();
    });
  } catch (e) {
    toast(e.message || 'Handelen mislukt, probeer opnieuw', 'bad');
  } finally {
    $('trade-goods')._html = null;   // forceer opnieuw opbouwen, ook als de inhoud gelijk bleef
    renderTrade();                   // zo staan uitgeschakelde knoppen nooit vast
  }
}

// ══════════════════════════════════════════════════════════════════
//  Stand / waarde
// ══════════════════════════════════════════════════════════════════
function avgPrice(gid) {
  const ms = Object.values(game?.markets || {});
  if (!ms.length) return GOOD[gid].base;
  const sum = ms.reduce((a, m) => a + (m.prices?.[gid] ?? GOOD[gid].base), 0);
  return sum / ms.length;
}
function netWorth(p) {
  let w = p.capital || 0;
  for (const g of GOODS) w += (p.inv?.[g.id] || 0) * avgPrice(g.id);
  // Nog niet bijgeschreven tipbetalingen tellen mee (de mijne die al verwerkt zijn niet dubbel)
  const isMe = p === myPlayer();
  for (const [id, pay] of Object.entries(p.payments || {})) {
    if (isMe && foldedPays.has(id)) continue;
    w += pay.amount || 0;
    if (pay.good && pay.qty) w += pay.qty * avgPrice(pay.good);
  }
  return w;
}
function standings() {
  return Object.entries(game?.players || {})
    .map(([pid, p]) => ({ pid, name: p.name || '???', worth: netWorth(p), manual: !!p.manualLoc, team: p.team || null }))
    .sort((a, b) => b.worth - a.worth);
}
function renderLeaderboardInto(elId) {
  if (teamMode()) { setHtml(elId, teamStandingsHtml()); return; }   // teams.js
  setHtml(elId, standings().map((s, i) => {
    const isMe = s.pid === me.pid;
    return `<li class="${isMe ? 'is-me' : ''}">
      <span class="rank">${i === 0 ? ill('ill-kroon', 'ill ill--md') : i + 1}</span>
      <span>${escapeHtml(s.name)}${isMe ? ' <small>(jij)</small>' : ''}${s.manual ? '<span class="tag tag--soft">handmatig</span>' : ''}</span>
      <span class="worth">${euro(s.worth)}</span>
    </li>`;
  }).join(''));
}
function openLeaderboard() { renderLeaderboardInto('lb-list'); openSheet('lb-modal'); }

// ══════════════════════════════════════════════════════════════════
//  Einde
// ══════════════════════════════════════════════════════════════════
function endGame() {
  if (endedShown) return;
  endedShown = true;
  stopTimers();
  stopPicking();
  closeAllSheets();
  showScreen('screen-end');
  clearSharedPos();   // teams.js: gedeelde plek wissen
  const winner = standings()[0];
  const topTeam = teamMode() ? teamStandings()[0] : null;
  if (topTeam && winner) {
    $('end-winner').innerHTML = `${ill('ill-kroon', 'ill ill--xl')}
      <span class="winner__label">Rijkste team</span>
      <span class="winner__name">${topTeam.name}</span>
      <span class="winner__worth">${euro(topTeam.worth)}</span>
      <span class="winner__sub">${topTeam.members.map(m => escapeHtml(m.name)).join(' + ')}</span>
      <span class="winner__sub">Beste smokkelaar: ${escapeHtml(winner.name)} (${euro(winner.worth)})</span>`;
  } else if (winner) {
    $('end-winner').innerHTML = `${ill('ill-kroon', 'ill ill--xl')}
      <span class="winner__label">Rijkste smokkelaar</span>
      <span class="winner__name">${escapeHtml(winner.name)}</span>
      <span class="winner__worth">${euro(winner.worth)}</span>`;
  }
  renderLeaderboardInto('end-list');
}

function stopTimers() {
  clearInterval(pollTimer); pollTimer = null;
  clearInterval(tickTimer); tickTimer = null;
  clearInterval(clockTimer); clockTimer = null;
  if (geoWatch != null) { navigator.geolocation.clearWatch(geoWatch); geoWatch = null; }
}

// ══════════════════════════════════════════════════════════════════
//  Polling (multiplayer-sync)
// ══════════════════════════════════════════════════════════════════
function startPolling() {
  if (isLocal) return;
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const g = await fbGet(`games/${code}`);
      if (!g) return;
      mergeRemote(g);
    } catch (e) { /* netwerkhik: volgende poll */ }
  }, POLL_MS);
}

function mergeRemote(g) {
  const wasStatus = game?.status;
  // Een poll die vlak na mijn eigen schrijfactie binnenkomt kan nog oud zijn:
  // houd mijn kas/koffer dan even lokaal vast (ik ben de enige die ze schrijft).
  const mine = g.players?.[me.pid];
  if (mine && localMe && Date.now() - localMe.at < ME_HOLD_MS) {
    mine.capital = localMe.capital;
    mine.inv = localMe.inv;
  }
  game = g;
  if (game.status === 'lobby') renderLobby();
  if (game.status === 'playing') {
    if (wasStatus !== 'playing') { enterGame(); return; }
    drawMarkets();
    renderGame();
    if (activeMarketId) renderTrade();
    if (!$('lb-modal').hidden) renderLeaderboardInto('lb-list');
    if (!$('team-modal').hidden) renderTeam();
    drawMates();
    syncBluff();
  }
  if (game.status === 'ended') endGame();
}

// ══════════════════════════════════════════════════════════════════
//  Speelveld opzetten
// ══════════════════════════════════════════════════════════════════
function enterSetup() {
  showScreen('screen-setup');
  setupMarkets = [];
  renderSetupMarkets();
  initSetupMap();
}

function initSetupMap() {
  if (setupMap) { setupMap.remove(); setupMap = null; }
  setupMap = L.map('setup-map', { zoomControl: true, attributionControl: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(setupMap);
  L.control.attribution({ prefix: false }).addAttribution('© OpenStreetMap').addTo(setupMap);
  setupMarkerLayer.layer = L.layerGroup().addTo(setupMap);
  setupMap.setView(NL_CENTER, 7);

  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
      pos => setupMap && setupMap.setView([pos.coords.latitude, pos.coords.longitude], 16),
      () => {}, { enableHighAccuracy: true, timeout: 8000 }
    );
  }
  setupMap.on('click', e => addSetupMarket(e.latlng.lat, e.latlng.lng));
  setTimeout(() => setupMap && setupMap.invalidateSize(), 200);
}

function addSetupMarket(lat, lng) {
  if (setupMarkets.length >= MAX_MARKETS) { toast(`Maximaal ${MAX_MARKETS} markten`, 'bad'); return; }
  const used = new Set(setupMarkets.map(m => m.name));
  const name = MARKET_NAMES.find(n => !used.has(n)) || ('Markt ' + (setupMarkets.length + 1));
  setupMarkets.push({ name, lat, lng });
  renderSetupMarkets();
  drawSetupMarkers();
}
function removeSetupMarket(i) { setupMarkets.splice(i, 1); renderSetupMarkets(); drawSetupMarkers(); }

function drawSetupMarkers() {
  const lay = setupMarkerLayer.layer;
  if (!lay) return;
  lay.clearLayers();
  setupMarkets.forEach((m, i) => {
    L.marker([m.lat, m.lng], { icon: marketIcon(i + 1, m.name, false) }).addTo(lay);
  });
}
function renderSetupMarkets() {
  $('setup-market-list').innerHTML = setupMarkets.length
    ? setupMarkets.map((m, i) => `
        <span class="chip">
          <span class="chip__num">${i + 1}</span>${escapeHtml(m.name)}
          <button class="chip__x" data-i="${i}" aria-label="Verwijder ${escapeHtml(m.name)}"><svg class="ico" aria-hidden="true"><use href="#ico-x"/></svg></button>
        </span>`).join('')
    : '<p class="chips__empty">Nog geen markten. Tik op de kaart.</p>';
  const btn = $('btn-setup-next');
  if (btn) {
    const missing = MIN_MARKETS - setupMarkets.length;
    btn.disabled = missing > 0;
    btn.textContent = missing > 0
      ? `Plaats nog ${missing} ${missing === 1 ? 'markt' : 'markten'}`
      : 'Verder: de regels →';
  }
}

async function onSetupSearch(e) {
  e.preventDefault();
  const q = $('setup-search').value.trim();
  if (q.length < 2) return;
  const btn = e.submitter || $('setup-search-form').querySelector('button');
  btn.disabled = true;
  try {
    const r = await geocode(q);   // location.js
    setupMap.setView([r.lat, r.lng], 16);
    $('setup-search').blur();
  } catch (err) {
    toast(err.message || 'Zoeken lukte niet', 'bad');
  } finally {
    btn.disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════════
//  Verlaten / reset
// ══════════════════════════════════════════════════════════════════
function leaveToHome() {
  if (game) forgetSession();   // bewust weggaan: niet meer aanbieden om verder te spelen
  stopTimers();
  stopPicking();
  closeAllSheets();
  if (gameMap) { gameMap.remove(); gameMap = null; }
  if (setupMap) { setupMap.remove(); setupMap = null; }
  meMarker = null;
  game = null; code = ''; me.isHost = false; activeMarketId = null; myPos = null; localMe = null;
  me.pid = genId();
  resetLocation();
  resetBluff();
  resetTeams();
  resetRisk();
  showScreen('screen-home');
  renderResumeOffer();
}

// ══════════════════════════════════════════════════════════════════
//  Event wiring
// ══════════════════════════════════════════════════════════════════
let pendingAction = null;  // 'create' | 'join'

function bind() {
  // HOME
  $('btn-create').addEventListener('click', () => { pendingAction = 'create'; goName(); });
  $('btn-join').addEventListener('click', () => {
    const c = $('input-code').value.trim().toUpperCase();
    if (c.length !== 6) { showHomeError('Vul een code van 6 tekens in.'); return; }
    if (isLocal) { showHomeError('Multiplayer (code) vereist Firebase. Maak zelf een lobby om lokaal te testen.'); return; }
    pendingAction = 'join'; code = c; goName();
  });
  $('input-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

  // NAAM
  $('btn-name-ok').addEventListener('click', onNameOk);
  $('btn-name-back').addEventListener('click', leaveToHome);
  $('input-name').addEventListener('keydown', e => { if (e.key === 'Enter') onNameOk(); });

  // SETUP
  $('setup-market-list').addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (b) removeSetupMarket(parseInt(b.dataset.i, 10));
  });
  $('btn-use-myloc').addEventListener('click', () => {
    if (!('geolocation' in navigator)) { toast('Geen GPS beschikbaar. Zoek je plek of tik op de kaart.', 'bad'); return; }
    const btn = $('btn-use-myloc'); btn.disabled = true;
    navigator.geolocation.getCurrentPosition(
      pos => { addSetupMarket(pos.coords.latitude, pos.coords.longitude); setupMap.setView([pos.coords.latitude, pos.coords.longitude], 17); btn.disabled = false; },
      () => { toast('GPS lukte niet. Zoek je plek of tik op de kaart.', 'bad'); btn.disabled = false; },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
  $('btn-clear-markets').addEventListener('click', () => { setupMarkets = []; renderSetupMarkets(); drawSetupMarkers(); });
  $('setup-search-form').addEventListener('submit', onSetupSearch);
  $('btn-create-lobby').addEventListener('click', onCreateLobby);
  $('btn-setup-back').addEventListener('click', leaveToHome);
  $('btn-setup-next').addEventListener('click', () => {
    if (setupMarkets.length < MIN_MARKETS) return;
    $('setup-error').hidden = true;
    $('btn-create-lobby').disabled = false;
    describeTeams();
    showScreen('screen-rules');
  });
  $('btn-rules-back').addEventListener('click', () => {
    showScreen('screen-setup');
    setTimeout(() => setupMap && setupMap.invalidateSize(), 100);
  });

  // LOBBY
  $('btn-start-game').addEventListener('click', startGame);
  $('btn-copy-code').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(code); toast('Code gekopieerd', 'good'); }
    catch (e) { toast(`Kopiëren lukte niet. De code is ${code}`, 'bad'); }
  });
  $('btn-share-code').addEventListener('click', async () => {
    const text = `Doe mee met Zwarte Markt! Lobbycode: ${code}`;
    const url = location.origin;
    if (navigator.share) {
      try { await navigator.share({ title: 'Zwarte Markt', text, url }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(`${text} ${url}`); toast('Uitnodiging gekopieerd, plak hem in de groepsapp', 'good'); }
    catch (e) { toast(`Delen lukte niet. De code is ${code}`, 'bad'); }
  });
  $('btn-leave-lobby').addEventListener('click', leaveToHome);

  // SPEL
  $('btn-leaderboard').addEventListener('click', openLeaderboard);
  $('trade-goods').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    if (b.dataset.act === 'buy') doTrade(b.dataset.g, 'buy');
    else if (b.dataset.act === 'sell') doTrade(b.dataset.g, 'sell');
    else if (b.dataset.act === 'ship') orderShipment(b.dataset.g);     // risk.js
    else if (b.dataset.act === 'smuggle') smuggle(b.dataset.g);        // risk.js
  });
  $('trade-tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tradeTab = b.dataset.tab;
    renderTrade();
  });
  $('trade-qty').addEventListener('click', e => {
    const b = e.target.closest('.seg__btn');
    if (!b) return;
    tradeQty = Number(b.dataset.qty) || 1;
    renderTrade();
  });

  // Alle sheets: sluiten via ✕ (data-close) of tik op de achtergrond
  document.querySelectorAll('.sheet').forEach(s => s.addEventListener('click', e => {
    if (e.target === s || e.target.closest('[data-close]')) closeSheet(s.id);
  }));
  // Escape sluit de bovenste open sheet
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const open = [...document.querySelectorAll('.sheet')].filter(s => !s.hidden);
    if (open.length) closeSheet(open[open.length - 1].id);
    else if (pickingLoc) stopPicking();
  });

  // EINDE
  $('btn-home').addEventListener('click', leaveToHome);

  bindLocation();   // location.js
  bindBluff();      // bluff.js
  bindTeams();      // teams.js
  bindSession();    // session.js
}

function showHomeError(msg) { const e = $('home-error'); e.textContent = msg; e.hidden = false; }

function goName() {
  showScreen('screen-name');
  $('name-error').hidden = true;
  setTimeout(() => $('input-name').focus(), 100);
}

async function onNameOk() {
  const name = $('input-name').value.trim();
  if (name.length < 2) { const e = $('name-error'); e.textContent = 'Kies een naam van minstens 2 tekens.'; e.hidden = false; return; }
  me.name = name;
  const btn = $('btn-name-ok'); btn.disabled = true;
  try {
    if (pendingAction === 'create') enterSetup();
    else await joinLobby(code);
  } catch (e) {
    const el = $('name-error'); el.textContent = e.message || 'Er ging iets mis.'; el.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

async function onCreateLobby() {
  if (setupMarkets.length < MIN_MARKETS) { const e = $('setup-error'); e.textContent = `Plaats minstens ${MIN_MARKETS} markten.`; e.hidden = false; return; }
  const btn = $('btn-create-lobby'); btn.disabled = true;
  $('setup-error').hidden = true;
  try {
    await createLobby();
  } catch (e) {
    const el = $('setup-error'); el.textContent = e.message || 'Lobby maken mislukt.'; el.hidden = false;
    btn.disabled = false;
  }
}

// ── Start ──
document.addEventListener('DOMContentLoaded', () => {
  bind();
  if (isLocal) {
    const c = $('credit');
    if (c) c.innerHTML += ' · <em>lokale testmodus</em>';
  }
  initSession();    // session.js: terug in je potje na herladen
});
