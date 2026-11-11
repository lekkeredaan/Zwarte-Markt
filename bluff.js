/* ══════════════════════════════════════════════════════════════
   ZWARTE MARKT — v2 bluf-laag
   • Marktschokken: de host plant invallen (prijs stort in) en tekorten (prijs explodeert).
   • Geheime tips: de host fluistert spelers tips in; ongeveer de helft is echt.
   • Tips verkopen: bied een tip aan een medespeler aan (die ziet pas na betalen wat erin staat).
   • Zelf verzinnen: maak een nep-tip en verkoop hem als echt.
   Of een tip klopte, volgt uit het (openbare) marktnieuws.
   Data: games/<code>/news, games/<code>/offers, players/<pid>/tips, players/<pid>/payments.
   Het schokkenplan staat alleen in het geheugen van de host, niet in de database.
   ══════════════════════════════════════════════════════════════ */

const SHOCK = {
  raid:     { mult: 0.35, dir: 'down', title: 'Inval',  ill: 'ill-inval',  line: g => `${g} zijn bijna niks meer waard.` },
  shortage: { mult: 2.2,  dir: 'up',   title: 'Tekort', ill: 'ill-tekort', line: g => `${g} zijn ineens peperduur.` },
};
const SHOCK_MS        = 4 * 60 * 1000;   // zo lang duurt een schok
const TIP_EVERY_MS    = 75 * 1000;       // zo vaak deelt de host tips uit
const TIP_CHANCE      = 0.6;             // kans per speler per ronde
const TIP_REAL_CHANCE = 0.55;            // kans dat een tip echt is
const SELF_TIP_MS     = 5 * 60 * 1000;   // looptijd van een verzonnen tip
const FLASH_MS        = 8000;

// Host-geheugen
let hostPlan = [];
let lastTipRound = 0;
// Client-geheugen
let seenNews = new Set();       // nieuwsflitsen al getoond
let readTips = new Set();       // tips gelezen (badge)
let notifiedTips = new Set();   // tips al gemeld (toast)
let seenResults = new Set();    // uitkomst van eigen aanbiedingen al gemeld
let foldedPays = new Set();     // tipbetalingen al bijgeschreven
let tipsTab = 'tips';
let sellTipId = null, sellDraft = null, craftDraft = null, offerId = null;
let flashTimer = null;

// ── Kleine helpers ──
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function minutesAgo(ts) {
  if (!ts) return '';
  const min = Math.floor((Date.now() - ts) / 60000);
  return min < 1 ? 'zojuist' : `${min} min geleden`;
}
function marketChip(id) {
  const m = game?.markets?.[id];
  return m ? `<span class="mchip">${marketNum(id)}</span>${escapeHtml(m.name)}` : 'een onbekende markt';
}
function dirPill(dir) { return `<span class="dir dir--${dir}">${dir === 'up' ? 'omhoog' : 'omlaag'}</span>`; }
function newId(prefix) { return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`; }

// ══════════════════════════════════════════════════════════════════
//  HOST: schokkenplan, schokken afvuren, tips uitdelen
// ══════════════════════════════════════════════════════════════════
function hostStartBluff(startedAt) {
  hostPlan = buildPlan(startedAt, game.config.durationSec);
  lastTipRound = startedAt;
}

function buildPlan(startedAt, durationSec) {
  const ids = Object.keys(game.markets || {});
  if (!ids.length) return [];
  const n = Math.max(2, Math.round(durationSec / 300));          // ± één schok per 5 minuten
  const first = 3 * 60 * 1000;                                    // niet in de eerste 3 minuten
  const last = Math.max(first + 60000, durationSec * 1000 - 2 * 60 * 1000);
  const slot = (last - first) / n;
  return Array.from({ length: n }, (_, i) => ({
    id: newId('e'),
    at: Math.round(startedAt + first + slot * (i + 0.5) + (Math.random() - 0.5) * slot * 0.6),
    market: pick(ids),
    good: pick(GOODS).id,
    kind: Math.random() < 0.5 ? 'raid' : 'shortage',
    fired: false,
  }));
}

// Muteert game.markets; geeft nieuws-paden terug voor de database
function fireDueEvents(now) {
  const updates = {};
  for (const ev of hostPlan) {
    if (ev.fired || ev.at > now) continue;
    ev.fired = true;
    const m = game.markets?.[ev.market];
    if (!m) continue;
    const s = SHOCK[ev.kind];
    const cur = m.prices?.[ev.good] ?? GOOD[ev.good].base;
    m.shock = { good: ev.good, kind: ev.kind, mult: s.mult, until: now + SHOCK_MS };
    m.prev = { ...m.prev, [ev.good]: cur };
    m.prices = { ...m.prices, [ev.good]: Math.max(1, Math.round(cur * s.mult)) };
    updates[`news/${ev.id}`] = { at: now, kind: ev.kind, market: ev.market, good: ev.good };
  }
  return updates;
}

function dealTipsIfDue(now) {
  if (now - lastTipRound < TIP_EVERY_MS) return {};
  lastTipRound = now;
  const updates = {};
  const upcoming = hostPlan.filter(e => !e.fired && e.at - now > 45000 && e.at - now < 6 * 60000);
  Object.keys(game.players || {}).forEach((pid, i) => {
    if (Math.random() > TIP_CHANCE) return;
    let tip;
    if (upcoming.length && Math.random() < TIP_REAL_CHANCE) {
      const ev = pick(upcoming);
      tip = { good: ev.good, market: ev.market, dir: SHOCK[ev.kind].dir, expiresAt: ev.at + 90000 };
    } else {
      tip = fakeTip(now);
    }
    updates[`players/${pid}/tips/t${now.toString(36)}${i}`] = { ...tip, issuedAt: now, source: 'app' };
  });
  return updates;
}

function fakeTip(now) {
  const ids = Object.keys(game.markets || {});
  let t;
  for (let i = 0; i < 12; i++) {
    t = {
      good: pick(GOODS).id, market: pick(ids), dir: Math.random() < 0.5 ? 'up' : 'down',
      expiresAt: now + Math.round((2 + Math.random() * 4) * 60000),
    };
    if (!hostPlan.some(e => !e.fired && e.good === t.good && e.market === t.market)) break;
  }
  return t;
}

// ══════════════════════════════════════════════════════════════════
//  CLIENT: afgeleide gegevens
// ══════════════════════════════════════════════════════════════════
// 'yes' = uitgekomen, 'no' = verlopen zonder schok, 'open' = loopt nog
function tipOutcome(tip, now = Date.now()) {
  const hit = Object.values(game?.news || {}).some(n =>
    n.market === tip.market && n.good === tip.good && SHOCK[n.kind]?.dir === tip.dir &&
    n.at >= (tip.issuedAt || 0) - 1000 && n.at <= (tip.expiresAt || 0));
  if (hit) return 'yes';
  return now > (tip.expiresAt || 0) ? 'no' : 'open';
}
function myTips() {
  return Object.entries(myPlayer()?.tips || {})
    .map(([id, t]) => ({ id, ...t }))
    .sort((a, b) => (b.receivedAt || b.issuedAt || 0) - (a.receivedAt || a.issuedAt || 0));
}
function openOffers() {
  return Object.entries(game?.offers || {}).map(([id, o]) => ({ id, ...o })).filter(o => o.status === 'open');
}
function incomingOffers() { return openOffers().filter(o => o.to === me.pid); }
function outgoingOffers() { return openOffers().filter(o => o.from === me.pid); }

// ══════════════════════════════════════════════════════════════════
//  CLIENT: reageren op nieuwe data (na elke poll)
// ══════════════════════════════════════════════════════════════════
function primeBluff() {
  // Wat er al was bij binnenkomst niet opnieuw melden
  Object.keys(game?.news || {}).forEach(id => seenNews.add(id));
  myTips().forEach(t => notifiedTips.add(t.id));
  Object.entries(game?.offers || {}).forEach(([id, o]) => { if (o.status !== 'open') seenResults.add(id); });
}

function syncBluff() {
  if (!game || game.status !== 'playing') return;

  for (const [id, n] of Object.entries(game.news || {})) {
    if (seenNews.has(id)) continue;
    seenNews.add(id);
    if (SHOCK[n.kind]) showFlash(n);
    else if (n.kind === 'bust' && n.pid !== me.pid) toast(`${n.name || 'Iemand'} is gepakt door de douane!`, 'bad');
  }

  const fresh = myTips().filter(t => !notifiedTips.has(t.id));
  fresh.forEach(t => notifiedTips.add(t.id));
  if ($('tips-modal').hidden) {
    const shared = fresh.find(t => t.source === 'team');
    if (shared) toast(`${shared.fromName || 'Een teamgenoot'} deelde een tip met het team`, 'good');
    else if (fresh.some(t => t.source === 'app')) toast('Psst… er zit een nieuwe geheime tip in je tipsmap', 'good');
  }

  for (const [id, o] of Object.entries(game.offers || {})) {
    if (o.from !== me.pid || o.status === 'open' || seenResults.has(id)) continue;
    seenResults.add(id);
    if (o.status === 'declined') toast(`${o.toName || 'De koper'} weigerde je tip`, 'bad');
  }

  foldPayments();
  renderBluffChrome();
  if (!$('tips-modal').hidden) renderTips();
  if (!$('offer-modal').hidden) renderOffer();
}

// Binnengekomen betalingen (verkochte tips) en giften van teamgenoten bijschrijven.
// Alleen ik schrijf mijn eigen kas en koffer; anderen leggen iets klaar in players/<pid>/payments.
function foldPayments() {
  const fresh = Object.entries(myPlayer()?.payments || {}).filter(([id]) => !foldedPays.has(id));
  if (!fresh.length) return;
  fresh.forEach(([id]) => foldedPays.add(id));
  withMe(async () => {
    const p = myPlayer();
    if (!p) throw new Error('geen speler');
    let capital = p.capital || 0;
    const inv = { ...(p.inv || {}) };
    const extra = {};
    for (const [id, x] of fresh) {
      capital += x.amount || 0;
      if (x.good && x.qty) inv[x.good] = (inv[x.good] || 0) + x.qty;
      extra[`players/${me.pid}/payments/${id}`] = null;
    }
    await writeMe({ capital, inv }, extra);
    if (fresh.length === 1) {
      const x = fresh[0][1];
      const who = x.fromName || 'Iemand';
      if (x.kind === 'gift') toast(`${who} gaf je ${x.good ? `${x.qty}× ${GOOD[x.good]?.short || 'waren'}` : euro(x.amount)}`, 'good');
      else toast(`${who} kocht je tip voor ${euro(x.amount)}`, 'good');
    } else {
      toast(`Er kwamen ${fresh.length} betalingen of giften binnen`, 'good');
    }
    renderGame();
    if (activeMarketId) renderTrade();
  }).catch(() => { fresh.forEach(([id]) => foldedPays.delete(id)); });   // volgende poll opnieuw
}

function showFlash(n) {
  const s = SHOCK[n.kind];
  if (!s) return;
  const el = $('newsflash');
  el.innerHTML = `${ill(s.ill, 'ill ill--lg')}
    <span class="flash__text">
      <span class="flash__kicker">Marktschok · tik voor nieuws</span>
      <span class="flash__title">${s.title} bij ${escapeHtml(game.markets?.[n.market]?.name || '?')}</span>
      <span class="flash__line">${s.line(GOOD[n.good]?.short || 'Waren')}</span>
    </span>`;
  el.hidden = false;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.hidden = true; }, FLASH_MS);
  // Trillen mag pas na een eerste tik van de speler
  if (navigator.vibrate && navigator.userActivation?.hasBeenActive !== false) {
    try { navigator.vibrate([80, 60, 80]); } catch (e) { /* niet erg */ }
  }
}

function renderBluffChrome() {
  const unread = myTips().filter(t => !readTips.has(t.id)).length + incomingOffers().length;
  const badge = $('tips-badge');
  badge.textContent = unread;
  badge.hidden = unread === 0;

  const inc = incomingOffers()[0];
  const bar = $('offer-banner');
  if (inc && $('offer-modal').hidden) {
    bar.innerHTML = `${ill('ill-tip', 'ill ill--md')}
      <span><strong>${escapeHtml(inc.fromName || '?')}</strong> biedt je een geheime tip aan</span>
      <span class="offerbar__cta">Bekijk →</span>`;
    bar.dataset.id = inc.id;
    bar.hidden = false;
  } else {
    bar.hidden = true;
  }
}

// ══════════════════════════════════════════════════════════════════
//  Tipsmap
// ══════════════════════════════════════════════════════════════════
function openTips(tab = 'tips') {
  tipsTab = tab;
  openSheet('tips-modal');
  renderTips();
}

function renderTips() {
  const tabs = document.querySelectorAll('#tips-tabs .seg__btn');
  const counts = { tips: myTips().length, news: Object.keys(game?.news || {}).length };
  tabs.forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.tab === tipsTab));
    b.textContent = `${b.dataset.tab === 'tips' ? 'Tips' : 'Marktnieuws'} (${counts[b.dataset.tab]})`;
  });
  setHtml('tips-body', tipsTab === 'tips' ? tipsHtml() : newsHtml());
  if (tipsTab === 'tips') {
    myTips().forEach(t => readTips.add(t.id));
    renderBluffChrome();
  }
}

function tipsHtml() {
  const parts = [];
  const inc = incomingOffers();
  if (inc.length) {
    parts.push('<p class="subhead">Aangeboden aan jou</p>');
    inc.forEach(o => parts.push(`
      <button class="tip tip--button" data-offer="${o.id}">
        ${ill('ill-tip', 'ill ill--lg')}
        <span>
          <span class="tip__text"><strong>${escapeHtml(o.fromName || '?')}</strong> biedt een tip aan over <strong>${o.showGood ? GOOD[o.tip.good]?.short : '???'}</strong></span>
          <span class="tip__meta">voor ${euro(o.price)} · tik om te bekijken</span>
        </span>
      </button>`));
  }
  const out = outgoingOffers();
  if (out.length) {
    parts.push('<p class="subhead">Jouw lopende aanbiedingen</p>');
    out.forEach(o => parts.push(`
      <div class="tip">
        ${ill(GOOD[o.tip.good]?.ill || 'ill-tip', 'ill ill--lg')}
        <div>
          <p class="tip__text">Aangeboden aan <strong>${escapeHtml(o.toName || '?')}</strong> voor <strong>${euro(o.price)}</strong></p>
          <p class="tip__meta">Wacht op antwoord · ${minutesAgo(o.at)}</p>
        </div>
        <div class="tip__foot"><span class="status status--wait">Openstaand</span><button class="btn btn--line btn--sm" data-cancel="${o.id}">Intrekken</button></div>
      </div>`));
  }

  const tips = myTips();
  parts.push('<p class="subhead">Je tips</p>');
  if (!tips.length) {
    parts.push(`<div class="empty">${ill('ill-tip', 'ill ill--xl')}<span>Nog geen tips. De markt fluistert je af en toe iets in. Of verzin er zelf een en verkoop hem…</span></div>`);
  }
  tips.forEach(t => parts.push(tipCard(t)));
  parts.push(`<button id="btn-craft" class="btn btn--line btn--block">${ill('ico-pen', 'ico')} Verzin een tip om te verkopen</button>`);
  return parts.join('');
}

function tipCard(t) {
  const g = GOOD[t.good];
  const out = tipOutcome(t);
  const [cls, label] = { open: ['open', 'Loopt nog'], yes: ['yes', 'Uitgekomen'], no: ['no', 'Niet uitgekomen'] }[out];
  const src = t.source === 'self' ? 'Zelf verzonnen (alleen jij ziet dit)'
    : t.source === 'bought' ? `Gekocht van ${escapeHtml(t.fromName || '?')}`
    : t.source === 'team' ? `Gedeeld door ${escapeHtml(t.fromName || 'je team')}`
    : 'Gefluisterd door de markt';
  const canShare = out === 'open' && t.source !== 'self' && t.source !== 'team' && teammates().length > 0;
  const share = !canShare ? ''
    : t.shared ? '<span class="status status--yes">Gedeeld</span>'
    : `<button class="btn btn--line btn--sm" data-share="${t.id}">${ill('ico-team', 'ico')} Deel</button>`;
  return `
    <article class="tip">
      ${ill(g?.ill || 'ill-tip', 'ill ill--lg')}
      <div>
        <p class="tip__text">Prijs van <strong>${g?.short || '?'}</strong> bij ${marketChip(t.market)} gaat ${dirPill(t.dir)}</p>
        <p class="tip__meta">${src} · ${minutesAgo(t.receivedAt || t.issuedAt)}</p>
      </div>
      <div class="tip__foot">
        <span class="status status--${cls}">${label}</span>
        <span class="tip__actions">
          ${share}
          ${out === 'open' ? `<button class="btn btn--ink btn--sm" data-sell="${t.id}">Verkoop</button>` : ''}
        </span>
      </div>
    </article>`;
}

function newsHtml() {
  const items = Object.entries(game?.news || {}).map(([id, n]) => ({ id, ...n })).sort((a, b) => b.at - a.at);
  if (!items.length) {
    return `<div class="empty">${ill('ill-inval', 'ill ill--xl')}<span>Nog geen marktnieuws. Invallen en tekorten komen onverwacht. Wie de juiste tip had, casht.</span></div>`;
  }
  return items.map(n => {
    const s = SHOCK[n.kind];
    const what = GOOD[n.good]?.short || 'Waren';
    if (n.kind === 'bust') {
      return `
      <article class="news">
        ${ill('ill-douane', 'ill ill--lg')}
        <div>
          <p class="news__title">Gepakt bij de douane</p>
          <p class="news__text">${escapeHtml(n.name || 'Iemand')} verloor ${n.qty || '?'}× ${what} · ${minutesAgo(n.at)}</p>
        </div>
      </article>`;
    }
    if (!s) return '';
    return `
      <article class="news">
        ${ill(s.ill, 'ill ill--lg')}
        <div>
          <p class="news__title">${s.title} bij ${marketChip(n.market)}</p>
          <p class="news__text">${s.line(what)} · ${minutesAgo(n.at)}</p>
        </div>
      </article>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════════
//  Tip verkopen
// ══════════════════════════════════════════════════════════════════
// Mogelijke kopers: iedereen behalve jijzelf en (in teamspel) je teamgenoten
function buyers() {
  return Object.entries(game?.players || {}).filter(([pid]) => pid !== me.pid && !isTeammate(pid));
}

function openSell(tipId) {
  sellTipId = tipId;
  const others = buyers().map(([pid]) => pid);
  sellDraft = { to: others.length === 1 ? others[0] : null, price: 40, showGood: true };
  openSheet('sell-modal');
  renderSell();
}

function renderSell() {
  const t = myPlayer()?.tips?.[sellTipId];
  if (!t) { closeSheet('sell-modal'); return; }
  const g = GOOD[t.good];
  const others = buyers();
  $('sell-body').innerHTML = `
    <div class="teaser">
      ${ill(g.ill, 'ill ill--lg')}
      <div>
        <div class="teaser__title">${g.short} gaan ${t.dir === 'up' ? 'omhoog' : 'omlaag'}</div>
        <div class="teaser__sub">bij ${escapeHtml(game.markets?.[t.market]?.name || '?')}. De koper ziet dit pas na betalen.</div>
      </div>
    </div>
    <div>
      <span class="form__label">Aan wie?</span>
      ${others.length ? `<div class="picks">${others.map(([pid, p]) => `
        <button class="pick" data-to="${pid}" aria-pressed="${sellDraft.to === pid}">
          <span class="avatar" aria-hidden="true">${escapeHtml((p.name || '?').charAt(0).toUpperCase())}</span>${escapeHtml(p.name || '?')}
        </button>`).join('')}</div>` : '<p class="note">Er zijn nog geen tegenstanders om aan te verkopen.</p>'}
    </div>
    <div>
      <span class="form__label">Vraagprijs</span>
      <div class="stepper">
        <button data-step="-10" aria-label="10 euro minder">−</button>
        <span class="stepper__val">${euro(sellDraft.price)}</span>
        <button data-step="10" aria-label="10 euro meer">+</button>
      </div>
    </div>
    <label class="toggle toggle--light">
      <input type="checkbox" id="sell-show" ${sellDraft.showGood ? 'checked' : ''} />
      <span class="toggle__text">
        <strong>Verklap welk goed het is</strong>
        <small>Anders ziet de koper alleen "tip over ???". Spannender, maar lastiger te verkopen.</small>
      </span>
    </label>
    <button id="btn-sell-send" class="btn btn--primary btn--lg btn--block" ${sellDraft.to ? '' : 'disabled'}>
      ${sellDraft.to ? `Bied aan voor ${euro(sellDraft.price)}` : 'Kies eerst een koper'}
    </button>
    <p class="note">Onderhandel eerst in het echt. Of de tip klopt? Dat weet niemand zeker…</p>`;
}

async function sendOffer() {
  const t = myPlayer()?.tips?.[sellTipId];
  if (!t || !sellDraft?.to) return;
  const buyer = game.players?.[sellDraft.to];
  const btn = $('btn-sell-send');
  btn.disabled = true;
  try {
    await fbUpdate({
      [`offers/${newId('o')}`]: {
        from: me.pid, fromName: me.name, to: sellDraft.to, toName: buyer?.name || '?',
        tip: { good: t.good, market: t.market, dir: t.dir, issuedAt: t.issuedAt || Date.now(), expiresAt: t.expiresAt || Date.now() },
        showGood: !!sellDraft.showGood, price: sellDraft.price, status: 'open', at: Date.now(),
      },
    });
    toast(`Aanbod verstuurd naar ${buyer?.name || 'de koper'}`, 'good');
    closeSheet('sell-modal');
    if (!$('tips-modal').hidden) renderTips();
  } catch (e) {
    toast(e.message || 'Versturen mislukt, probeer opnieuw', 'bad');
    btn.disabled = false;
  }
}

async function shareTip(id, btn) {
  const t = myPlayer()?.tips?.[id];
  const mates = teammates();
  if (!t || !mates.length) return;
  btn.disabled = true;
  const now = Date.now();
  const updates = { [`players/${me.pid}/tips/${id}/shared`]: true };
  mates.forEach(([pid], i) => {
    updates[`players/${pid}/tips/${newId('g')}${i}`] = {
      good: t.good, market: t.market, dir: t.dir, issuedAt: t.issuedAt || now, expiresAt: t.expiresAt || now,
      source: 'team', fromName: me.name, receivedAt: now,
    };
  });
  try {
    await fbUpdate(updates);
    toast('Tip gedeeld met je team', 'good');
    renderTips();
  } catch (e) {
    toast(e.message || 'Delen mislukt, probeer opnieuw', 'bad');
    btn.disabled = false;
  }
}

async function cancelOffer(id, btn) {
  btn.disabled = true;
  try {
    await fbUpdate({ [`offers/${id}/status`]: 'cancelled' });
    toast('Aanbod ingetrokken', 'good');
    renderTips();
  } catch (e) {
    toast(e.message || 'Intrekken mislukt', 'bad');
    btn.disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════════
//  Aanbod bekijken (koper)
// ══════════════════════════════════════════════════════════════════
function openOffer(id) {
  if (!id) return;
  offerId = id;
  openSheet('offer-modal');
  renderOffer();
  renderBluffChrome();
}

function renderOffer() {
  const o = game?.offers?.[offerId];
  if (!o) { closeSheet('offer-modal'); return; }
  if (o.status !== 'open') {
    const why = { cancelled: 'ingetrokken door de verkoper', accepted: 'al gekocht', declined: 'geweigerd' }[o.status] || 'verlopen';
    setHtml('offer-body', `<p class="note">Dit aanbod is niet meer geldig (${why}).</p>`);
    return;
  }
  const g = o.showGood ? GOOD[o.tip.good] : null;
  const enough = (myPlayer()?.capital || 0) >= o.price;
  setHtml('offer-body', `
    <div class="teaser">
      ${ill(g ? g.ill : 'ill-tip', 'ill ill--lg')}
      <div>
        <div class="teaser__title">Tip over ${g ? g.short : '???'}</div>
        <div class="teaser__sub">van ${escapeHtml(o.fromName || '?')}. Markt en richting zie je na betalen.</div>
      </div>
    </div>
    <div class="offer-price">
      <span class="form__label">Vraagprijs</span>
      <span class="bigprice">${euro(o.price)}</span>
    </div>
    <p class="note">Echt of nep? Dat weet alleen de markt. Te duur? Vraag ${escapeHtml(o.fromName || 'de verkoper')} om een nieuw bod.</p>
    <div class="btnrow">
      <button id="btn-offer-decline" class="btn btn--line">Weiger</button>
      <button id="btn-offer-accept" class="btn btn--ink" ${enough ? '' : 'disabled'}>${enough ? `Koop voor ${euro(o.price)}` : 'Te weinig cash'}</button>
    </div>`);
}

async function acceptOffer() {
  const id = offerId;
  const o = game?.offers?.[id];
  const p = myPlayer();
  if (!o || o.status !== 'open') { toast('Dit aanbod is niet meer geldig', 'bad'); renderOffer(); return; }
  if ((p?.capital || 0) < o.price) { toast('Te weinig cash', 'bad'); return; }
  const btn = $('btn-offer-accept');
  btn.disabled = true;
  const now = Date.now();
  const tipId = newId('b');
  try {
    // Eén atomaire update: status, mijn kas, mijn nieuwe tip, betaling aan de verkoper
    await withMe(async () => {
      const cash = myPlayer()?.capital || 0;
      if (cash < o.price) throw new Error('Te weinig cash');
      await writeMe({ capital: cash - o.price }, {
        [`offers/${id}/status`]: 'accepted',
        [`offers/${id}/decidedAt`]: now,
        [`players/${me.pid}/tips/${tipId}`]: { ...o.tip, source: 'bought', fromName: o.fromName || '?', receivedAt: now },
        [`players/${o.from}/payments/${id}`]: { kind: 'tip', amount: o.price, fromName: me.name, at: now },
      });
    });
    notifiedTips.add(tipId);
    closeSheet('offer-modal');
    renderGame();
    toast('Tip gekocht. Kijk snel wat erin staat…', 'good');
    openTips('tips');
  } catch (e) {
    toast(e.message || 'Kopen mislukt, probeer opnieuw', 'bad');
    btn.disabled = false;
  }
}

async function declineOffer() {
  const btn = $('btn-offer-decline');
  btn.disabled = true;
  try {
    await fbUpdate({ [`offers/${offerId}/status`]: 'declined', [`offers/${offerId}/decidedAt`]: Date.now() });
    closeSheet('offer-modal');
    toast('Aanbod geweigerd', 'good');
    renderBluffChrome();
  } catch (e) {
    toast(e.message || 'Weigeren mislukt', 'bad');
    btn.disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════════
//  Tip verzinnen
// ══════════════════════════════════════════════════════════════════
function openCraft() {
  craftDraft = { good: GOODS[0].id, market: Object.keys(game.markets || {})[0], dir: 'up' };
  openSheet('craft-modal');
  renderCraft();
}

function renderCraft() {
  $('craft-body').innerHTML = `
    <p class="note">Verzin een tip en verkoop hem als echte. De koper ziet niet dat hij van jou komt.</p>
    <div>
      <span class="form__label">Welk goed?</span>
      <div class="picks">${GOODS.map(g => `
        <button class="pick pick--good" data-good="${g.id}" aria-pressed="${craftDraft.good === g.id}">${ill(g.ill, 'ill ill--md')}${g.short}</button>`).join('')}
      </div>
    </div>
    <div>
      <span class="form__label">Bij welke markt?</span>
      <div class="picks">${Object.entries(game.markets || {}).map(([id, m]) => `
        <button class="pick" data-market="${id}" aria-pressed="${craftDraft.market === id}">
          <span class="avatar" aria-hidden="true">${marketNum(id)}</span>${escapeHtml(m.name)}
        </button>`).join('')}
      </div>
    </div>
    <div>
      <span class="form__label">Welke kant op?</span>
      <div class="seg seg--plain">
        <button class="seg__btn seg__btn--grow" data-dir="up" aria-pressed="${craftDraft.dir === 'up'}">▲ Omhoog</button>
        <button class="seg__btn seg__btn--grow" data-dir="down" aria-pressed="${craftDraft.dir === 'down'}">▼ Omlaag</button>
      </div>
    </div>
    <button id="btn-craft-save" class="btn btn--primary btn--lg btn--block">Leg in je tipsmap en verkoop</button>`;
}

async function saveCraft() {
  const btn = $('btn-craft-save');
  btn.disabled = true;
  const now = Date.now();
  const id = newId('s');
  try {
    await fbUpdate({
      [`players/${me.pid}/tips/${id}`]: { ...craftDraft, source: 'self', issuedAt: now, receivedAt: now, expiresAt: now + SELF_TIP_MS },
    });
    notifiedTips.add(id);
    readTips.add(id);
    closeSheet('craft-modal');
    if (!$('tips-modal').hidden) renderTips();
    openSell(id);
  } catch (e) {
    toast(e.message || 'Opslaan mislukt', 'bad');
    btn.disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════════
//  Reset + events
// ══════════════════════════════════════════════════════════════════
function resetBluff() {
  hostPlan = []; lastTipRound = 0;
  seenNews = new Set(); readTips = new Set(); notifiedTips = new Set();
  seenResults = new Set(); foldedPays = new Set();
  tipsTab = 'tips'; sellTipId = null; sellDraft = null; craftDraft = null; offerId = null;
  clearTimeout(flashTimer);
  $('newsflash').hidden = true;
  $('offer-banner').hidden = true;
  $('tips-badge').hidden = true;
}

function bindBluff() {
  $('btn-tips').addEventListener('click', () => openTips('tips'));
  $('newsflash').addEventListener('click', () => { $('newsflash').hidden = true; openTips('news'); });
  $('offer-banner').addEventListener('click', e => openOffer(e.currentTarget.dataset.id));
  $('tips-tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tipsTab = b.dataset.tab;
    renderTips();
  });
  $('tips-body').addEventListener('click', e => {
    const sell = e.target.closest('[data-sell]');
    if (sell) return openSell(sell.dataset.sell);
    const share = e.target.closest('[data-share]');
    if (share) return shareTip(share.dataset.share, share);
    const off = e.target.closest('[data-offer]');
    if (off) return openOffer(off.dataset.offer);
    const cancel = e.target.closest('[data-cancel]');
    if (cancel) return cancelOffer(cancel.dataset.cancel, cancel);
    if (e.target.closest('#btn-craft')) openCraft();
  });
  $('sell-body').addEventListener('click', e => {
    const to = e.target.closest('[data-to]');
    if (to) { sellDraft.to = to.dataset.to; renderSell(); return; }
    const step = e.target.closest('[data-step]');
    if (step) { sellDraft.price = clamp(sellDraft.price + Number(step.dataset.step), 10, 500); renderSell(); return; }
    if (e.target.closest('#btn-sell-send')) sendOffer();
  });
  $('sell-body').addEventListener('change', e => {
    if (e.target.id === 'sell-show') sellDraft.showGood = e.target.checked;
  });
  $('craft-body').addEventListener('click', e => {
    const g = e.target.closest('[data-good]');
    if (g) { craftDraft.good = g.dataset.good; renderCraft(); return; }
    const m = e.target.closest('[data-market]');
    if (m) { craftDraft.market = m.dataset.market; renderCraft(); return; }
    const d = e.target.closest('[data-dir]');
    if (d) { craftDraft.dir = d.dataset.dir; renderCraft(); return; }
    if (e.target.closest('#btn-craft-save')) saveCraft();
  });
  $('offer-body').addEventListener('click', e => {
    if (e.target.closest('#btn-offer-accept')) acceptOffer();
    if (e.target.closest('#btn-offer-decline')) declineOffer();
  });
}
