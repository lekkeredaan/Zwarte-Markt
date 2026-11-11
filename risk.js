/* ══════════════════════════════════════════════════════════════
   ZWARTE MARKT — v3 risico
   Twee extra tabbladen in het marktscherm:
   • Zending: bestel voor de halve prijs. Na 3 min in je koffer met 60% kans.
     Een inval op dat goed bij die markt tijdens de reis = zeker onderschept.
   • Douane: smokkel waar uit je koffer. 65% kans op 1,8× de gemiddelde prijs;
     gepakt = waar kwijt + bericht in het marktnieuws. Daarna 4 min wachten.
   Data: players/<pid>/shipments/<id>, players/<pid>/customsAt, news/<id> (kind 'bust').
   ══════════════════════════════════════════════════════════════ */

const SHIP_MS         = 3 * 60 * 1000;
const SHIP_DISCOUNT   = 0.5;
const SHIP_CHANCE     = 0.6;
const SHIP_MAX        = 2;       // tegelijk onderweg
const SHIP_GRACE_MS   = 3000;    // even wachten op laat marktnieuws (inval) voor we lossen
const CUSTOMS_CHANCE  = 0.65;
const CUSTOMS_MULT    = 1.8;
const CUSTOMS_WAIT_MS = 4 * 60 * 1000;

let resolvedShips = new Set();   // al afgehandeld (ook als een oude poll ze nog even terugbrengt)
let resolvingShips = new Set();
let lastCustomsAt = 0;
let riskLog = [];                // laatste uitkomsten, alleen op dit toestel

function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function myShipments() {
  return Object.entries(myPlayer()?.shipments || {})
    .filter(([id]) => !resolvedShips.has(id))
    .map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => a.arriveAt - b.arriveAt);
}
function customsWaitMs(now = Date.now()) {
  const at = Math.max(lastCustomsAt, myPlayer()?.customsAt || 0);
  return Math.max(0, at + CUSTOMS_WAIT_MS - now);
}
function shipUnit(price) { return Math.max(1, Math.round(price * SHIP_DISCOUNT)); }
function customsUnit(gid) { return Math.max(1, Math.round(avgPrice(gid) * CUSTOMS_MULT)); }
function logRisk(type, ok, text) { riskLog.unshift({ type, ok, text }); riskLog = riskLog.slice(0, 6); }

// ══════════════════════════════════════════════════════════════════
//  Elke seconde (vanuit de klok)
// ══════════════════════════════════════════════════════════════════
function tickRisk() {
  if (!game || game.status !== 'playing') return;
  resolveShipments();
  sharePos();                                   // teams.js: uitgestelde plek alsnog delen
  renderInventory();                            // aftellen in de koffer
  if (activeMarketId && tradeTab !== 'trade') renderTrade();
}

// ══════════════════════════════════════════════════════════════════
//  Zending
// ══════════════════════════════════════════════════════════════════
function shipBlock(m, near, cost) {
  const p = myPlayer();
  if (!near) return 'Niet bij de markt';
  if ((game.endsAt || 0) - Date.now() < SHIP_MS + SHIP_GRACE_MS + 2000) return 'Te laat: de markt sluit eerst';
  if (myShipments().length >= SHIP_MAX) return `Al ${SHIP_MAX} onderweg`;
  if ((p?.capital || 0) < cost) return 'Te weinig cash';
  return '';
}

async function orderShipment(gid) {
  const id = activeMarketId;
  document.querySelectorAll('#trade-goods .btn').forEach(b => { b.disabled = true; });
  try {
    await withMe(async () => {
      const m = game.markets?.[id];
      const p = myPlayer();
      if (!m || !p) return;
      const qty = tradeQty;
      const cost = shipUnit(m.prices?.[gid] ?? GOOD[gid].base) * qty;
      const block = shipBlock(m, canTradeAt(id), cost);
      if (block) { toast(block, 'bad'); return; }
      const now = Date.now();
      await writeMe({ capital: p.capital - cost }, {
        [`players/${me.pid}/shipments/${newId('z')}`]: {
          good: gid, qty, cost, market: id, at: now, arriveAt: now + SHIP_MS, roll: Math.random(),
        },
      });
      toast(`Besteld: ${qty}× ${GOOD[gid].short} voor ${euro(cost)}. Over 3 minuten weet je meer…`, 'good');
      renderGame();
    });
  } catch (e) {
    toast(e.message || 'Bestellen mislukt, probeer opnieuw', 'bad');
  } finally {
    $('trade-goods')._html = null;
    renderTrade();
  }
}

function resolveShipments() {
  const now = Date.now();
  for (const s of myShipments()) {
    if (now < s.arriveAt + SHIP_GRACE_MS || resolvingShips.has(s.id)) continue;
    resolvingShips.add(s.id);
    withMe(async () => {
      const p = myPlayer();
      if (!p) return;
      const raided = Object.values(game.news || {}).some(n =>
        n.kind === 'raid' && n.market === s.market && n.good === s.good && n.at >= s.at && n.at <= s.arriveAt);
      const ok = !raided && s.roll < SHIP_CHANCE;
      const fields = ok ? { inv: { ...(p.inv || {}), [s.good]: (p.inv?.[s.good] || 0) + s.qty } } : {};
      await writeMe(fields, { [`players/${me.pid}/shipments/${s.id}`]: null });
      resolvedShips.add(s.id);
      const what = `${s.qty}× ${GOOD[s.good]?.short || 'waren'}`;
      if (ok) {
        logRisk('ship', true, `${what} binnen`);
        toast(`Zending binnen: ${what} in je koffer`, 'good');
      } else {
        logRisk('ship', false, raided ? `${what} weg bij de inval` : `${what} onderschept`);
        toast(raided ? `Zending weg: ${what} gepakt bij de inval` : `Zending onderschept: ${what} kwijt`, 'bad');
      }
      renderGame();
      if (activeMarketId) renderTrade();
    }).catch(() => { /* volgende seconde opnieuw */ }).finally(() => resolvingShips.delete(s.id));
  }
}

// Chips in de koffer
function shipChipsHtml() {
  const now = Date.now();
  return myShipments().map(s =>
    `<span class="item item--ship">${ill('ill-zending', 'ill ill--sm')}${s.qty}× ${GOOD[s.good]?.short || '?'} · ${now >= s.arriveAt ? 'lossen…' : clock(s.arriveAt - now)}</span>`).join('');
}

// ══════════════════════════════════════════════════════════════════
//  Douane
// ══════════════════════════════════════════════════════════════════
function customsBlock(near, have, qty) {
  if (!near) return 'Niet bij de markt';
  if (customsWaitMs() > 0) return 'De douane let nog op je';
  if (have < qty) return `Je hebt er maar ${have}`;
  return '';
}

async function smuggle(gid) {
  const id = activeMarketId;
  document.querySelectorAll('#trade-goods .btn').forEach(b => { b.disabled = true; });
  try {
    await withMe(async () => {
      const p = myPlayer();
      if (!p) return;
      const qty = tradeQty;
      const have = p.inv?.[gid] || 0;
      const block = customsBlock(canTradeAt(id), have, qty);
      if (block) { toast(block, 'bad'); return; }
      const now = Date.now();
      const ok = Math.random() < CUSTOMS_CHANCE;
      const payout = customsUnit(gid) * qty;
      const inv = { ...(p.inv || {}) };
      inv[gid] = have - qty;
      if (inv[gid] === 0) delete inv[gid];
      const what = `${qty}× ${GOOD[gid].short}`;
      const extra = ok ? {} : {
        [`news/${newId('d')}`]: { at: now, kind: 'bust', pid: me.pid, name: me.name, good: gid, qty },
      };
      await writeMe({ capital: p.capital + (ok ? payout : 0), inv, customsAt: now }, extra);
      lastCustomsAt = now;
      Object.keys(extra).forEach(k => seenNews.add(k.split('/')[1]));   // eigen bericht niet aan mezelf melden
      if (ok) {
        logRisk('customs', true, `${what} gesmokkeld voor ${euro(payout)}`);
        toast(`Gelukt! ${what} langs de douane voor ${euro(payout)}`, 'good');
      } else {
        logRisk('customs', false, `${what} in beslag genomen`);
        toast(`Gepakt! De douane neemt ${what} in beslag`, 'bad');
      }
      renderGame();
    });
  } catch (e) {
    toast(e.message || 'Smokkelen mislukt, probeer opnieuw', 'bad');
  } finally {
    $('trade-goods')._html = null;
    renderTrade();
  }
}

// ══════════════════════════════════════════════════════════════════
//  Weergave (tabbladen Zending en Douane in het marktscherm)
// ══════════════════════════════════════════════════════════════════
// Alleen de laatste uitkomst van dit tabblad, zodat de goederen in beeld blijven
function riskLogHtml(type) {
  return riskLog.filter(r => r.type === type).slice(0, 1).map(r => `
    <div class="ship ship--${r.ok ? 'ok' : 'fail'}">
      <span class="dot dot--${r.ok ? 'ok' : 'bad'}" aria-hidden="true"></span>
      <span class="ship__text">${escapeHtml(r.text)}</span>
    </div>`).join('');
}

function renderRisk(m, near) {
  const p = myPlayer();
  const qty = tradeQty;
  const now = Date.now();
  $('trade-status').hidden = false;

  if (tradeTab === 'ship') {
    const ships = myShipments();
    setHtml('trade-status', `
      <div class="explain">
        ${ill('ill-zending', 'ill ill--lg')}
        <p><strong>Halve prijs, grote gok.</strong> Na 3 minuten ligt je bestelling in je koffer, met 60% kans. Valt de politie hier binnen voor dat goed? Dan ben je alles kwijt.</p>
      </div>
      ${ships.length ? `<p class="subhead">Onderweg (${ships.length} van ${SHIP_MAX})</p>` : ''}
      ${ships.map(s => `
        <div class="ship">
          ${ill(GOOD[s.good]?.ill || 'ill-zending', 'ill ill--md')}
          <span class="ship__text">${s.qty}× ${GOOD[s.good]?.short || '?'}<small>via ${escapeHtml(game.markets?.[s.market]?.name || '?')}</small></span>
          <span class="ship__time">${now >= s.arriveAt ? 'lossen…' : clock(s.arriveAt - now)}</span>
        </div>`).join('')}
      ${riskLogHtml('ship')}`);
    $('trade-foot').textContent = 'Tip: een geheime tip over een inval of tekort is hier goud waard.';
    setHtml('trade-goods', GOODS.map(g => {
      const price = m.prices?.[g.id] ?? g.base;
      const unit = shipUnit(price);
      const block = shipBlock(m, near, unit * qty);
      return `
        <div class="row">
          <div class="row__top">
            ${ill(g.ill, 'ill ill--lg')}
            <div>
              <div class="row__name">${g.name}</div>
              <div class="row__meta">Marktprijs hier: ${euro(price)}</div>
            </div>
            <div class="row__price">
              <div class="price">${euro(unit)}</div>
              <span class="deal deal--low">halve prijs</span>
            </div>
          </div>
          <div class="row__actions row__actions--one">
            <button class="btn btn--ink" data-act="ship" data-g="${g.id}" ${block ? 'disabled' : ''}>${block || `Bestel ${qty} voor ${euro(unit * qty)}`}</button>
          </div>
        </div>`;
    }).join(''));
    return;
  }

  // Douane
  const wait = customsWaitMs(now);
  setHtml('trade-status', `
    <div class="explain">
      ${ill('ill-douane', 'ill ill--lg')}
      <p><strong>Langs de douane.</strong> 65% kans dat het lukt: dan krijg je 1,8× de gemiddelde prijs. Gepakt? Dan ben je je waar kwijt en hoort de hele stad het.</p>
    </div>
    <div class="loc-status">
      <span class="dot dot--${wait ? 'off' : 'ok'}" aria-hidden="true"></span>
      <span>${wait ? `De douane let op je: nog ${clock(wait)}` : 'De kust is veilig. Je kunt smokkelen.'}</span>
    </div>
    ${riskLogHtml('customs')}`);
  $('trade-foot').textContent = 'Na elke poging moet je 4 minuten wachten.';
  const owned = GOODS.filter(g => (p?.inv?.[g.id] || 0) > 0);
  setHtml('trade-goods', owned.length ? owned.map(g => {
    const have = p.inv[g.id];
    const unit = customsUnit(g.id);
    const block = customsBlock(near, have, qty);
    return `
      <div class="row">
        <div class="row__top">
          ${ill(g.ill, 'ill ill--lg')}
          <div>
            <div class="row__name">${g.name}</div>
            <div class="row__meta">In koffer: <strong>${have}</strong></div>
          </div>
          <div class="row__price">
            <div class="price">${euro(unit)}</div>
            <span class="deal deal--low"><b>1,8×</b> gemiddeld</span>
          </div>
        </div>
        <div class="row__actions row__actions--one">
          <button class="btn btn--ink" data-act="smuggle" data-g="${g.id}" ${block ? 'disabled' : ''}>${block || `Smokkel ${qty} voor ${euro(unit * qty)}`}</button>
        </div>
      </div>`;
  }).join('') : `<div class="empty">${ill('ill-douane', 'ill ill--xl')}<span>Je koffer is leeg. Koop eerst iets op het tabblad Handel, dan kun je het hier smokkelen.</span></div>`);
}

function resetRisk() {
  resolvedShips = new Set();
  resolvingShips = new Set();
  lastCustomsAt = 0;
  riskLog = [];
}
