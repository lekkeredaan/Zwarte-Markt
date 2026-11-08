/* ══════════════════════════════════════════════════════════════
   ZWARTE MARKT — clientlogica
   Realtime via Firebase RTDB (REST + polling). Zonder DB_URL = lokale testmodus.
   ══════════════════════════════════════════════════════════════ */

// ── Firebase config ───────────────────────────────────────────────
// 👇 Vul hier de Realtime Database-URL in (van de Firebase-console).
//    Laat leeg ('') om lokaal te testen zonder Firebase.
const DB_URL = '';

const isLocal = !DB_URL;

// ── Constanten ────────────────────────────────────────────────────
const GOODS = [
  { id: 'horloges', name: 'Namaakhorloges',  emoji: '⌚', base: 60  },
  { id: 'kruiden',  name: 'Exotische kruiden', emoji: '🌿', base: 25  },
  { id: 'munten',   name: 'Zeldzame munten',   emoji: '🪙', base: 120 },
  { id: 'sigaren',  name: 'Smokkelsigaren',    emoji: '🚬', base: 40  },
];
const GOOD = Object.fromEntries(GOODS.map(g => [g.id, g]));

const MARKET_NAMES = ['De Haven', 'Het Pakhuis', 'Steeg 7', 'De Loods', 'Achterom', 'Het Souterrain', "'t Rangeerterrein", 'De Kade', 'Blok C', 'De Werf'];

const POLL_MS       = 2000;   // hoe vaak we de database uitlezen
const PRICE_TICK_MS = 9000;   // hoe vaak de host de prijzen beweegt
const TRADE_RADIUS  = 60;     // meter — binnen deze afstand mag je handelen
const MAX_MARKETS   = 6;
const MIN_MARKETS   = 2;
const NL_CENTER     = [52.1, 5.1];

// ── State ─────────────────────────────────────────────────────────
let me = { pid: genId(), name: '', isHost: false };
let code = '';
let game = null;              // volledige game-state (lokaal spiegelbeeld)
let setupMarkets = [];        // tijdens bord-opzetten
let setupMap = null, gameMap = null;
let marketLayer = null, meMarker = null;
let myPos = null;             // {lat,lng}
let pollTimer = null, tickTimer = null, clockTimer = null, geoWatch = null;
let activeMarketId = null;    // open handelspaneel
let tradeQty = {};            // per good id gekozen aantal in paneel
let endedShown = false;
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
  t.className = 'toast' + (kind ? ' ' + kind : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('screen--active'));
  $(id).classList.add('screen--active');
}

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

// ══════════════════════════════════════════════════════════════════
//  Prijs-engine
// ══════════════════════════════════════════════════════════════════
function buildMarketsNode(markets) {
  // markets: [{id,name,lat,lng}]  → node met anchor + prijzen per good
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

function nextPrices(markets) {
  // mean-reverting random walk rond anchor
  const out = {};
  for (const [id, m] of Object.entries(markets || {})) {
    const prices = {}, prev = {};
    for (const g of GOODS) {
      const cur = m.prices?.[g.id] ?? m.anchor?.[g.id] ?? g.base;
      const anc = m.anchor?.[g.id] ?? g.base;
      let np = cur + (anc - cur) * 0.14 + cur * (Math.random() - 0.5) * 0.18;
      if (Math.random() < 0.06) np *= (0.7 + Math.random() * 0.7);  // schok
      np = clamp(np, Math.max(1, anc * 0.45), anc * 1.9);
      prev[g.id] = cur;
      prices[g.id] = Math.max(1, Math.round(np));
    }
    out[id] = { ...m, prices, prev };
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

  const markets = setupMarkets.map((m, i) => ({
    id: 'm' + i, name: m.name, lat: m.lat, lng: m.lng,
  }));

  const newGame = {
    status: 'lobby',
    hostId: me.pid,
    createdAt: Date.now(),
    config: { startCapital: capital, durationSec: duration, gpsCheck },
    markets: buildMarketsNode(markets),
    players: {
      [me.pid]: { name: me.name, capital, inv: {}, isHost: true, joinedAt: Date.now() },
    },
  };

  if (isLocal) {
    code = 'LOKAAL';
    game = newGame;
  } else {
    // unieke code vinden
    let tries = 0;
    do {
      code = genCode();
      const existing = await fbGet(`games/${code}`);
      if (!existing) break;
    } while (++tries < 6);
    await fbPut(`games/${code}`, newGame);
    game = newGame;
  }
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
  await fbPatch(`games/${code}/players/${me.pid}`, {
    name: me.name, capital: startCap, inv: {}, joinedAt: Date.now(),
  });
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
}

function renderLobby() {
  if (!game) return;
  const players = Object.entries(game.players || {});
  $('lobby-count').textContent = players.length;
  const ul = $('lobby-players');
  ul.innerHTML = '';
  for (const [pid, p] of players) {
    const li = document.createElement('li');
    li.innerHTML = `<span>🕵️ ${escapeHtml(p.name || '???')}</span>` +
      (p.isHost ? `<span class="host-badge">HOST</span>` : '');
    ul.appendChild(li);
  }
  const startBtn = $('btn-start-game');
  if (startBtn) startBtn.disabled = players.length < 2 && !isLocal ? true : false;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function startGame() {
  const btn = $('btn-start-game');
  btn.disabled = true;
  try {
    const now = Date.now();
    const endsAt = now + (game.config.durationSec * 1000);
    game.status = 'playing';
    game.startedAt = now;
    game.endsAt = endsAt;
    if (!isLocal) {
      await fbPatch(`games/${code}`, { status: 'playing', startedAt: now, endsAt });
    }
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
  initGameMap();
  startGeolocation();
  startClock();
  if (me.isHost) startPriceTick();
  renderGame();
}

function initGameMap() {
  if (gameMap) { gameMap.remove(); gameMap = null; }
  gameMap = L.map('game-map', { zoomControl: false, attributionControl: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(gameMap);
  L.control.attribution({ prefix: false }).addAttribution('© OpenStreetMap').addTo(gameMap);
  marketLayer = L.layerGroup().addTo(gameMap);

  const ms = Object.values(game.markets || {});
  if (ms.length) {
    const bounds = L.latLngBounds(ms.map(m => [m.lat, m.lng]));
    gameMap.fitBounds(bounds, { padding: [60, 60], maxZoom: 17 });
  } else {
    gameMap.setView(NL_CENTER, 13);
  }
  setTimeout(() => gameMap && gameMap.invalidateSize(), 150);
  drawMarkets();
}

function drawMarkets() {
  if (!marketLayer) return;
  marketLayer.clearLayers();
  for (const [id, m] of Object.entries(game.markets || {})) {
    const near = canTradeAt(id);
    const icon = L.divIcon({
      className: '', html: `<div class="mk ${near ? 'mk--near' : ''}">🏷️</div>`,
      iconSize: [44, 44], iconAnchor: [22, 44],
    });
    const mk = L.marker([m.lat, m.lng], { icon }).addTo(marketLayer);
    mk.on('click', () => openTrade(id));
    L.tooltip({ permanent: true, direction: 'top', offset: [0, -42], className: 'mk-label' })
      .setContent(m.name).setLatLng([m.lat, m.lng]).addTo(marketLayer);
  }
}

function canTradeAt(id) {
  const m = game.markets?.[id];
  if (!m) return false;
  if (!game.config?.gpsCheck) return true;      // testmodus
  if (!myPos) return false;
  return haversine(myPos, { lat: m.lat, lng: m.lng }) <= TRADE_RADIUS;
}

// ── Geolocatie ──
function startGeolocation() {
  if (!('geolocation' in navigator)) { $('gps-warning').hidden = false; return; }
  if (geoWatch != null) return;
  geoWatch = navigator.geolocation.watchPosition(
    pos => {
      myPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      $('gps-warning').hidden = true;
      updateMeMarker();
      drawMarkets();
      if (activeMarketId) renderTrade();
    },
    err => {
      if (game.config?.gpsCheck) $('gps-warning').hidden = false;
    },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
  );
}

function updateMeMarker() {
  if (!gameMap || !myPos) return;
  const icon = L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [20, 20], iconAnchor: [10, 10] });
  if (!meMarker) meMarker = L.marker([myPos.lat, myPos.lng], { icon, zIndexOffset: 1000 }).addTo(gameMap);
  else meMarker.setLatLng([myPos.lat, myPos.lng]);
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
  el.classList.toggle('low', s <= 60);
  if (remain <= 0) {
    if (me.isHost && !isLocal) fbPatch(`games/${code}`, { status: 'ended' }).catch(() => {});
    if (game) game.status = 'ended';
    endGame();
  }
}

// ── Prijs-tick (alleen host) ──
function startPriceTick() {
  clearInterval(tickTimer);
  tickTimer = setInterval(async () => {
    if (!game || game.status !== 'playing') return;
    game.markets = nextPrices(game.markets);
    if (!isLocal) {
      try { await fbPut(`games/${code}/markets`, game.markets); } catch (e) { /* stil, volgende tick */ }
    } else {
      drawMarkets();
      if (activeMarketId) renderTrade();
    }
  }, PRICE_TICK_MS);
}

// ══════════════════════════════════════════════════════════════════
//  Render spel (cash + inventaris)
// ══════════════════════════════════════════════════════════════════
function myPlayer() { return game?.players?.[me.pid]; }

function renderGame() {
  const p = myPlayer();
  if (!p) return;
  $('hud-capital').textContent = euro(p.capital);
  renderInventory();
}

function renderInventory() {
  const p = myPlayer();
  const list = $('inv-list');
  list.innerHTML = '';
  const inv = p?.inv || {};
  const owned = GOODS.filter(g => (inv[g.id] || 0) > 0);
  if (!owned.length) {
    list.innerHTML = '<div class="inv-empty">Lege koffer — koop iets op een markt!</div>';
    return;
  }
  for (const g of owned) {
    const row = document.createElement('div');
    row.className = 'inv-row';
    row.innerHTML = `<span class="emoji">${g.emoji}</span><span>${g.name}</span><span class="qty">${inv[g.id]}×</span>`;
    list.appendChild(row);
  }
}

// ══════════════════════════════════════════════════════════════════
//  Handelspaneel
// ══════════════════════════════════════════════════════════════════
function openTrade(id) {
  activeMarketId = id;
  tradeQty = {};
  $('trade-modal').hidden = false;
  renderTrade();
}
function closeTrade() { activeMarketId = null; $('trade-modal').hidden = true; }

function renderTrade() {
  const id = activeMarketId;
  const m = game.markets?.[id];
  if (!m) return;
  $('trade-market-name').textContent = m.name;

  const near = canTradeAt(id);
  const distEl = $('trade-distance');
  if (!game.config?.gpsCheck) {
    distEl.textContent = '🧪 Testmodus — handelen overal toegestaan';
    distEl.className = 'trade-distance';
  } else if (!myPos) {
    distEl.textContent = '📡 Wachten op GPS…';
    distEl.className = 'trade-distance far';
  } else {
    const d = Math.round(haversine(myPos, { lat: m.lat, lng: m.lng }));
    distEl.textContent = near ? `✅ Je staat bij deze markt (${d} m)` : `🚶 Loop dichterbij — nog ${d} m`;
    distEl.className = 'trade-distance' + (near ? '' : ' far');
  }

  const p = myPlayer();
  const cont = $('trade-goods');
  cont.innerHTML = '';
  for (const g of GOODS) {
    const price = m.prices?.[g.id] ?? g.base;
    const prev = m.prev?.[g.id] ?? price;
    const trend = price > prev ? 'up' : (price < prev ? 'down' : '');
    const owned = p?.inv?.[g.id] || 0;
    const qty = tradeQty[g.id] || 1;

    const el = document.createElement('div');
    el.className = 'good';
    el.innerHTML = `
      <div class="good__head">
        <span class="good__emoji">${g.emoji}</span>
        <div>
          <div class="good__name">${g.name}</div>
          <div class="good__owned">In koffer: ${owned}×</div>
        </div>
        <div class="good__price">
          <div class="amt">${euro(price)}</div>
          <div class="good__trend ${trend}">${trend === 'up' ? '▲ stijgt' : trend === 'down' ? '▼ daalt' : '– stabiel'}</div>
        </div>
      </div>
      <div class="qtybar">
        <button data-act="minus" data-g="${g.id}">−</button>
        <span class="q" id="q-${g.id}">${qty}</span>
        <button data-act="plus" data-g="${g.id}">+</button>
        <span style="margin-left:auto;font-weight:900">${euro(price * qty)}</span>
      </div>
      <div class="good__btns">
        <button class="btn btn--emerald" data-act="buy" data-g="${g.id}" ${near ? '' : 'disabled'}>Koop ${qty}×</button>
        <button class="btn btn--gold" data-act="sell" data-g="${g.id}" ${near && owned > 0 ? '' : 'disabled'}>Verkoop ${qty}×</button>
      </div>`;
    cont.appendChild(el);
  }
}

function changeQty(gid, delta) {
  const cur = tradeQty[gid] || 1;
  tradeQty[gid] = clamp(cur + delta, 1, 99);
  const q = $('q-' + gid);
  if (q) q.textContent = tradeQty[gid];
  renderTrade();
}

async function doTrade(gid, kind) {
  const id = activeMarketId;
  if (!canTradeAt(id)) { toast('Je staat niet bij deze markt', 'bad'); return; }
  const m = game.markets?.[id];
  const p = myPlayer();
  if (!m || !p) return;
  const price = m.prices?.[gid] ?? GOOD[gid].base;
  const qty = tradeQty[gid] || 1;

  // knop-herstel via try/finally
  const btns = document.querySelectorAll(`#trade-goods .btn[data-g="${gid}"]`);
  btns.forEach(b => b.disabled = true);
  try {
    const inv = { ...(p.inv || {}) };
    if (kind === 'buy') {
      const cost = price * qty;
      if (p.capital < cost) { toast('Te weinig cash', 'bad'); return; }
      p.capital -= cost;
      inv[gid] = (inv[gid] || 0) + qty;
      toast(`Gekocht: ${qty}× ${GOOD[gid].emoji} voor ${euro(cost)}`, 'good');
    } else {
      const have = p.inv?.[gid] || 0;
      if (have < qty) { toast('Zoveel heb je niet', 'bad'); return; }
      const gain = price * qty;
      p.capital += gain;
      inv[gid] = have - qty;
      if (inv[gid] === 0) delete inv[gid];
      toast(`Verkocht: ${qty}× ${GOOD[gid].emoji} voor ${euro(gain)}`, 'good');
    }
    p.inv = inv;
    if (!isLocal) {
      await fbPatch(`games/${code}/players/${me.pid}`, { capital: p.capital, inv: inv });
    }
    renderGame();
    renderTrade();
  } catch (e) {
    toast(e.message || 'Handelen mislukt', 'bad');
  } finally {
    btns.forEach(b => b.disabled = false);
    renderTrade();   // herstelt knopstatus correct
  }
}

// ══════════════════════════════════════════════════════════════════
//  Leaderboard / net worth
// ══════════════════════════════════════════════════════════════════
function avgPrice(gid) {
  const ms = Object.values(game.markets || {});
  if (!ms.length) return GOOD[gid].base;
  const sum = ms.reduce((a, m) => a + (m.prices?.[gid] ?? GOOD[gid].base), 0);
  return sum / ms.length;
}
function netWorth(p) {
  let w = p.capital || 0;
  for (const g of GOODS) w += (p.inv?.[g.id] || 0) * avgPrice(g.id);
  return w;
}
function standings() {
  return Object.entries(game.players || {})
    .map(([pid, p]) => ({ pid, name: p.name || '???', worth: netWorth(p) }))
    .sort((a, b) => b.worth - a.worth);
}
function renderLeaderboardInto(elId) {
  const ol = $(elId);
  ol.innerHTML = '';
  for (const s of standings()) {
    const li = document.createElement('li');
    if (s.pid === me.pid) li.className = 'me';
    li.innerHTML = `<span>${escapeHtml(s.name)}</span><span class="lb-worth">${euro(s.worth)}</span>`;
    ol.appendChild(li);
  }
}
function openLeaderboard() { renderLeaderboardInto('lb-list'); $('lb-modal').hidden = false; }

// ══════════════════════════════════════════════════════════════════
//  Einde
// ══════════════════════════════════════════════════════════════════
function endGame() {
  if (endedShown) return;
  endedShown = true;
  stopTimers();
  showScreen('screen-end');
  const st = standings();
  const winner = st[0];
  const box = $('end-winner');
  if (winner) {
    box.innerHTML = `<span class="ew-name">🏆 ${escapeHtml(winner.name)}</span>
      <span class="ew-worth">rijkste smokkelaar — ${euro(winner.worth)}</span>`;
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
    } catch (e) { /* netwerkhik — volgende poll */ }
  }, POLL_MS);
}

function mergeRemote(g) {
  const wasStatus = game?.status;
  // bewaar mijn eigen (nieuwere) speler-state niet overschrijven tijdens snelle trades:
  const myLocal = game?.players?.[me.pid];
  game = g;
  // host is bron voor prijzen/markten; andere spelers nemen remote over.
  // Voor de speler zelf: gebruik remote (we schrijven elke trade meteen weg).
  if (game.status === 'lobby') renderLobby();
  if (game.status === 'playing') {
    if (wasStatus !== 'playing') { enterGame(); return; }
    drawMarkets();
    renderGame();
    if (activeMarketId) renderTrade();
  }
  if (game.status === 'ended') endGame();
}

// ══════════════════════════════════════════════════════════════════
//  SETUP-kaart (bord opzetten)
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

  // centreer op speler
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
  if (setupMarkets.length >= MAX_MARKETS) { toast(`Max ${MAX_MARKETS} markten`, 'bad'); return; }
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
  setupMarkets.forEach(m => {
    const icon = L.divIcon({ className: '', html: '<div class="mk">🏷️</div>', iconSize: [44, 44], iconAnchor: [22, 44] });
    L.marker([m.lat, m.lng], { icon }).addTo(lay);
  });
}
function renderSetupMarkets() {
  const box = $('setup-market-list');
  box.innerHTML = '';
  setupMarkets.forEach((m, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `🏷️ ${escapeHtml(m.name)} <button data-i="${i}" aria-label="verwijderen">✕</button>`;
    box.appendChild(chip);
  });
  const btn = $('btn-create-lobby');
  if (btn) btn.disabled = setupMarkets.length < MIN_MARKETS;
}

// ══════════════════════════════════════════════════════════════════
//  Leave / reset
// ══════════════════════════════════════════════════════════════════
function leaveToHome() {
  stopTimers();
  if (gameMap) { gameMap.remove(); gameMap = null; }
  if (setupMap) { setupMap.remove(); setupMap = null; }
  meMarker = null;
  game = null; code = ''; me.isHost = false; activeMarketId = null; myPos = null;
  me.pid = genId();
  $('trade-modal').hidden = true; $('lb-modal').hidden = true;
  showScreen('screen-home');
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
  $('input-name').addEventListener('keydown', e => { if (e.key === 'Enter') onNameOk(); });

  // SETUP
  $('setup-market-list').addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (b) removeSetupMarket(parseInt(b.dataset.i, 10));
  });
  $('btn-use-myloc').addEventListener('click', () => {
    if (!('geolocation' in navigator)) { toast('Geen GPS beschikbaar', 'bad'); return; }
    const btn = $('btn-use-myloc'); btn.disabled = true;
    navigator.geolocation.getCurrentPosition(
      pos => { addSetupMarket(pos.coords.latitude, pos.coords.longitude); setupMap.setView([pos.coords.latitude, pos.coords.longitude], 17); btn.disabled = false; },
      () => { toast('Locatie niet gelukt', 'bad'); btn.disabled = false; },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
  $('btn-clear-markets').addEventListener('click', () => { setupMarkets = []; renderSetupMarkets(); drawSetupMarkers(); });
  $('btn-create-lobby').addEventListener('click', onCreateLobby);

  // LOBBY
  $('btn-start-game').addEventListener('click', startGame);
  $('btn-copy-code').addEventListener('click', () => {
    navigator.clipboard?.writeText(code).then(() => toast('Code gekopieerd', 'good'), () => {});
  });
  $('btn-leave-lobby').addEventListener('click', leaveToHome);

  // GAME
  $('btn-recenter').addEventListener('click', () => { if (gameMap && myPos) gameMap.setView([myPos.lat, myPos.lng], 17); });
  $('btn-leaderboard').addEventListener('click', openLeaderboard);
  $('trade-close').addEventListener('click', closeTrade);
  $('lb-close').addEventListener('click', () => $('lb-modal').hidden = true);
  $('trade-modal').addEventListener('click', e => { if (e.target.id === 'trade-modal') closeTrade(); });
  $('lb-modal').addEventListener('click', e => { if (e.target.id === 'lb-modal') $('lb-modal').hidden = true; });
  $('trade-goods').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const gid = b.dataset.g, act = b.dataset.act;
    if (act === 'plus') changeQty(gid, 1);
    else if (act === 'minus') changeQty(gid, -1);
    else if (act === 'buy') doTrade(gid, 'buy');
    else if (act === 'sell') doTrade(gid, 'sell');
  });

  // EINDE
  $('btn-home').addEventListener('click', leaveToHome);

  // tray toggle (tik op handle)
  const tray = $('inv-tray');
  tray.querySelector('.tray__handle').addEventListener('click', () => tray.classList.toggle('open'));
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
    if (pendingAction === 'create') {
      enterSetup();
    } else {
      await joinLobby(code);
    }
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
    if (c) c.innerHTML += ' · <em style="color:#f5c518">lokale testmodus</em>';
  }
});
