/* ══════════════════════════════════════════════════════════════
   ZWARTE MARKT — locatie
   GPS (standaard) of handmatig: tik je plek op de kaart of zoek een adres.
   De host kan handmatig uitzetten (config.allowManualLocation).
   Wie handmatig speelt, staat zo gemarkeerd in de stand (players/<pid>/manualLoc).
   ══════════════════════════════════════════════════════════════ */

let locMode = 'gps';      // 'gps' | 'manual'
let lastGps = null;       // laatste GPS-meting {lat, lng, acc}
let gpsFailed = false;
let pickingLoc = false;   // wacht op een tik op de kaart

function manualAllowed() { return game?.config?.allowManualLocation !== false; }

// ── GPS volgen ──
function startGeolocation() {
  renderLocationChrome();
  if (geoWatch != null) return;
  if (!('geolocation' in navigator)) { gpsFailed = true; renderLocationChrome(); return; }
  geoWatch = navigator.geolocation.watchPosition(
    pos => {
      lastGps = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: Math.round(pos.coords.accuracy || 0) };
      gpsFailed = false;
      if (locMode === 'gps') { myPos = { lat: lastGps.lat, lng: lastGps.lng }; onMyPosChanged(); }
      renderLocationChrome();
    },
    () => { gpsFailed = true; renderLocationChrome(); },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
  );
}

function onMyPosChanged() {
  updateMeMarker();
  drawMarkets();
  if (activeMarketId) renderTrade();
  sharePos();   // teams.js: in teamspel je plek met je team delen
}

function updateMeMarker() {
  if (!gameMap) return;
  if (!myPos) {
    if (meMarker) { meMarker.remove(); meMarker = null; }
    return;
  }
  const icon = L.divIcon({
    className: 'mk-wrap',
    html: `<div class="me ${locMode === 'manual' ? 'me--manual' : ''}"></div>`,
    iconSize: [22, 22], iconAnchor: [11, 11],
  });
  if (!meMarker) meMarker = L.marker([myPos.lat, myPos.lng], { icon, zIndexOffset: 1000, interactive: false }).addTo(gameMap);
  else { meMarker.setLatLng([myPos.lat, myPos.lng]); meMarker.setIcon(icon); }
}

// ── Handmatig ──
async function setManualPos(lat, lng, label) {
  locMode = 'manual';
  myPos = { lat, lng };
  onMyPosChanged();
  renderLocationChrome();
  toast(label ? `Je staat nu bij: ${label}` : 'Je locatie staat nu handmatig', 'good');
  if (!myPlayer()?.manualLoc) {
    try { await fbUpdate({ [`players/${me.pid}/manualLoc`]: true }); } catch (e) { /* volgende keer opnieuw */ }
  }
  saveSession();
}

async function useGps() {
  locMode = 'gps';
  myPos = lastGps ? { lat: lastGps.lat, lng: lastGps.lng } : null;
  onMyPosChanged();
  renderLocationChrome();
  toast(myPos ? 'Je locatie volgt weer je GPS' : 'Terug naar GPS. Wachten op signaal…', 'good');
  try { await fbUpdate({ [`players/${me.pid}/manualLoc`]: null }); } catch (e) { /* niet erg */ }
  saveSession();
}

function startPicking() {
  if (!manualAllowed()) return;
  pickingLoc = true;
  closeSheet('loc-modal');
  $('pick-banner').hidden = false;
  $('game-map').classList.add('is-picking');
  renderLocationChrome();
}
function stopPicking() {
  pickingLoc = false;
  const b = $('pick-banner');
  if (b) b.hidden = true;
  $('game-map')?.classList.remove('is-picking');
}
function onGameMapClick(e) {
  if (!pickingLoc) return;
  setManualPos(e.latlng.lat, e.latlng.lng);
  stopPicking();
}

// ── Adres zoeken (OpenStreetMap Nominatim) ──
// Zoekt alleen op verzoek (geen autocomplete), zoals de gebruiksregels van Nominatim vragen.
async function geocode(q) {
  const params = new URLSearchParams({ format: 'jsonv2', limit: '1', 'accept-language': 'nl', q });
  // Voorkeur voor het speelgebied als dat bekend is
  const ms = Object.values(game?.markets || {});
  if (ms.length) {
    const lats = ms.map(m => m.lat), lngs = ms.map(m => m.lng);
    const pad = 0.05;
    params.set('viewbox', [Math.min(...lngs) - pad, Math.max(...lats) + pad, Math.max(...lngs) + pad, Math.min(...lats) - pad].join(','));
  }
  const r = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('Zoeken lukte niet, probeer het zo nog eens');
  const list = await r.json();
  if (!list.length) throw new Error('Niets gevonden. Probeer straat + plaats.');
  const hit = list[0];
  return { lat: Number(hit.lat), lng: Number(hit.lon), label: (hit.display_name || q).split(',').slice(0, 2).join(',') };
}

async function onLocSearch(e) {
  e.preventDefault();
  const q = $('loc-search').value.trim();
  if (q.length < 2) return;
  const btn = $('loc-search-form').querySelector('button');
  btn.disabled = true;
  try {
    const r = await geocode(q);
    await setManualPos(r.lat, r.lng, r.label);
    if (gameMap) gameMap.setView([r.lat, r.lng], 17);
    closeSheet('loc-modal');
  } catch (err) {
    toast(err.message || 'Zoeken lukte niet', 'bad');
  } finally {
    btn.disabled = false;
  }
}

// ── Weergave: GPS-melding, vizierknop, locatie-sheet ──
function renderLocationChrome() {
  const gpsCheck = !!game?.config?.gpsCheck;
  // Melding alleen als locatie ertoe doet en we niets hebben
  $('gps-warning').hidden = !(gpsCheck && locMode === 'gps' && !myPos && gpsFailed && !pickingLoc);
  $('btn-gps-manual').hidden = !manualAllowed();
  $('btn-location').classList.toggle('is-manual', locMode === 'manual');
  if (!$('loc-modal').hidden) renderLocation();
}

function renderLocation() {
  let dot = 'off', text = 'Zoeken naar GPS…';
  if (locMode === 'manual') { dot = 'manual'; text = 'Handmatig ingesteld'; }
  else if (lastGps && myPos) { dot = 'ok'; text = `GPS actief · tot ${lastGps.acc} m nauwkeurig`; }
  else if (gpsFailed) { dot = 'off'; text = 'Geen GPS-signaal of geen toestemming'; }
  setHtml('loc-status', `<span class="dot dot--${dot}" aria-hidden="true"></span><span>${text}</span>`);

  const actions = [];
  if (myPos) actions.push('<button id="btn-loc-center" class="btn btn--line btn--block">Centreer de kaart op mij</button>');
  if (locMode === 'manual') actions.push(`<button id="btn-loc-gps" class="btn btn--ink btn--block">${ill('ico-target', 'ico')} Gebruik weer GPS</button>`);
  setHtml('loc-actions', actions.join(''));
  $('loc-actions').hidden = !actions.length;

  $('loc-manual').hidden = !manualAllowed();
  $('loc-manual-off').hidden = manualAllowed();
}

function openLocation() {
  openSheet('loc-modal');
  renderLocation();
}

function resetLocation() {
  locMode = 'gps'; lastGps = null; gpsFailed = false; pickingLoc = false;
}

function bindLocation() {
  $('btn-location').addEventListener('click', openLocation);
  $('btn-pick-on-map').addEventListener('click', startPicking);
  $('btn-pick-cancel').addEventListener('click', () => { stopPicking(); renderLocationChrome(); });
  $('btn-gps-manual').addEventListener('click', openLocation);
  $('loc-search-form').addEventListener('submit', onLocSearch);
  $('loc-actions').addEventListener('click', e => {
    if (e.target.closest('#btn-loc-center') && gameMap && myPos) { gameMap.setView([myPos.lat, myPos.lng], 17); closeSheet('loc-modal'); }
    if (e.target.closest('#btn-loc-gps')) useGps();
  });
}
