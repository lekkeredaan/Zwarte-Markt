/* ══════════════════════════════════════════════════════════════
   ZWARTE MARKT — de Oplichter (v4)
   Bij de start (vanaf 3 spelers) wordt één speler stiekem de Oplichter.
   - Zakkenrollen: bij een markt waar een andere speler net was, pakt de
     Oplichter een deel van diens cash. Het slachtoffer merkt het en het
     komt in het marktnieuws (waar, niet door wie).
   - Voorkennis: bij de eigen markt-tips staat of ze echt of nep zijn.
   - Na de tijd stemt iedereen wie het was; daarna de onthulling.

   Data (alles onder games/<code>):
     swindler                    pid van de Oplichter (host kiest bij de start)
     players/<pid>/at            {m, t}: bij welke markt je net was
     players/<pid>/thefts/<id>   {at, market, by}: klaargelegd door de Oplichter
     players/<pid>/robbed        totaal kwijtgeraakt (schrijft het slachtoffer zelf)
     players/<pid>/loot          totale buit (schrijft de Oplichter zelf)
     players/<pid>/robAt         laatste poging (wachttijd)
     votes/<pid>                 op wie deze speler stemde
   Net als bij tips geldt: het staat in de lobby-data, dus wie met
   ontwikkelaarstools gaat graven kan spieken. Feestspel onder vrienden.
   ══════════════════════════════════════════════════════════════ */

const SW_MIN_PLAYERS    = 3;
const ROB_PCT           = 0.15;            // deel van de cash
const ROB_MAX           = 150;
const ROB_MIN           = 10;              // minder dan dit: niks te halen
const ROB_WAIT_MS       = 3 * 60 * 1000;
const PRESENCE_MS       = 2 * 60 * 1000;   // zo lang "was je er net"
const PRESENCE_EVERY_MS = 45 * 1000;
const VOTE_MS           = 60 * 1000;
const CATCH_REWARD      = 100;             // voor elke speler die goed stemt
const ESCAPE_BONUS      = 250;             // voor de Oplichter die ontsnapt

let foldedThefts = new Set();
let lastRobAt = 0;
let lastPresence = { m: null, t: 0 };
let roleSeen = false;
let voteShown = false;
let votePick = null;
let voteBusy = false;

function swindlerOn() { return !!game?.swindler && !!game.players?.[game.swindler]; }
function isSwindler() { return swindlerOn() && game.swindler === me.pid; }
function playerName(pid) { return game?.players?.[pid]?.name || '???'; }

// ── HOST: bij de start iemand aanwijzen ──
function pickSwindler() {
  const pids = Object.keys(game?.players || {});
  if (game?.config?.swindler !== true || pids.length < SW_MIN_PLAYERS) return {};
  return { swindler: pids[Math.floor(Math.random() * pids.length)] };
}

// ══════════════════════════════════════════════════════════════════
//  Aanwezigheid: bij welke markt was je net?
// ══════════════════════════════════════════════════════════════════
function marketHere() {
  if (!myPos) return null;
  for (const [id, m] of Object.entries(game?.markets || {})) {
    if (haversine(myPos, { lat: m.lat, lng: m.lng }) <= TRADE_RADIUS) return id;
  }
  return null;
}
// marketId meegeven = "ik handelde hier net" (ook zonder GPS)
function sharePresence(marketId) {
  if (!swindlerOn() || game.status !== 'playing' || Date.now() >= (game.endsAt || 0)) return;
  const m = marketId || marketHere();
  if (!m) return;
  const now = Date.now();
  if (lastPresence.m === m && now - lastPresence.t < PRESENCE_EVERY_MS) return;
  lastPresence = { m, t: now };
  fbUpdate({ [`players/${me.pid}/at`]: { m, t: now } }).catch(() => { lastPresence.t = 0; });
}
function clearPresence() {
  if (!myPlayer()?.at) return;
  fbUpdate({ [`players/${me.pid}/at`]: null }).catch(() => {});
}
function presentAt(marketId, now = Date.now()) {
  return Object.entries(game?.players || {})
    .filter(([pid, p]) => pid !== me.pid && !isTeammate(pid) && p.at?.m === marketId && now - (p.at.t || 0) < PRESENCE_MS)
    .map(([pid, p]) => ({ pid, name: p.name || '???' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ══════════════════════════════════════════════════════════════════
//  OPLICHTER: zakkenrollen (tabblad in het marktscherm)
// ══════════════════════════════════════════════════════════════════
function robWaitMs(now = Date.now()) {
  return Math.max(0, Math.max(lastRobAt, myPlayer()?.robAt || 0) + ROB_WAIT_MS - now);
}

function renderRob(m, near) {
  const wait = robWaitMs();
  $('trade-status').hidden = false;
  setHtml('trade-status', `
    <div class="explain">
      ${ill('ill-masker', 'ill ill--lg')}
      <p><strong>Zakkenrollen.</strong> Je pakt 15% van iemands cash, hooguit ${euro(ROB_MAX)}. Het slachtoffer merkt het en de stad hoort wáár het gebeurde, niet wie het deed.</p>
    </div>
    <div class="loc-status">
      <span class="dot dot--${wait ? 'off' : 'ok'}" aria-hidden="true"></span>
      <span>${wait ? `Even niet opvallen: nog ${clock(wait)}` : `Klaar om te rollen · buit ${euro(myPlayer()?.loot || 0)}`}</span>
    </div>`);
  $('trade-foot').textContent = 'Je kunt alleen spelers rollen die hier in de laatste 2 minuten waren. Na elke poging 3 minuten wachten.';

  const here = presentAt(activeMarketId);
  const block = !near ? 'Niet bij de markt' : wait ? 'Even wachten' : '';
  setHtml('trade-goods', here.length ? here.map(v => `
      <div class="member">
        <span class="avatar" aria-hidden="true">${escapeHtml(v.name.trim().charAt(0).toUpperCase() || '?')}</span>
        <span class="member__name">${escapeHtml(v.name)}<small class="member__sub">was hier net</small></span>
        <button class="btn btn--ink btn--sm" data-act="rob" data-p="${v.pid}" ${block ? 'disabled' : ''}>${block || 'Rol'}</button>
      </div>`).join('')
    : `<div class="empty">${ill('ill-masker', 'ill ill--xl')}<span>Niemand in de buurt. Wacht tot er iemand bij deze markt komt handelen.</span></div>`);
}

async function rob(victimPid, btn) {
  if (!isSwindler() || robWaitMs() > 0 || !canTradeAt(activeMarketId)) return;
  if (!presentAt(activeMarketId).some(v => v.pid === victimPid)) { toast('Die is alweer weg', 'bad'); renderTrade(); return; }
  btn.disabled = true;
  const now = Date.now();
  try {
    await fbUpdate({
      [`players/${victimPid}/thefts/${newId('r')}`]: { at: now, market: activeMarketId, by: me.pid },
      [`players/${me.pid}/robAt`]: now,
    });
    lastRobAt = now;
    toast(`Je hand zit in de zak van ${playerName(victimPid)}…`, 'good');
  } catch (e) {
    toast(e.message || 'Rollen mislukt, probeer opnieuw', 'bad');
  } finally {
    $('trade-goods')._html = null;
    renderTrade();
  }
}

// ══════════════════════════════════════════════════════════════════
//  SLACHTOFFER: diefstal verwerken (alleen ik schrijf mijn eigen kas)
// ══════════════════════════════════════════════════════════════════
function foldThefts() {
  const fresh = Object.entries(myPlayer()?.thefts || {}).filter(([id]) => !foldedThefts.has(id));
  if (!fresh.length) return;
  fresh.forEach(([id]) => foldedThefts.add(id));
  withMe(async () => {
    const p = myPlayer();
    if (!p) throw new Error('geen speler');
    const now = Date.now();
    let capital = p.capital || 0, robbed = p.robbed || 0, lost = 0, where = null;
    const extra = {};
    for (const [id, t] of fresh) {
      let x = t.by === me.pid ? 0 : Math.min(ROB_MAX, Math.round(capital * ROB_PCT));
      if (x < ROB_MIN) x = 0;
      capital -= x; robbed += x; lost += x;
      extra[`players/${me.pid}/thefts/${id}`] = null;
      if (t.by && t.by !== me.pid && game.players?.[t.by]) {
        extra[`players/${t.by}/payments/${id}`] = { kind: 'loot', amount: x, fromName: me.name, at: now };
      }
      if (x > 0) {
        where = t.market;
        extra[`news/${id}`] = { at: now, kind: 'theft', market: t.market || null, name: me.name, pid: me.pid };
        seenNews.add(id);
      }
    }
    await writeMe({ capital, robbed }, extra);
    if (lost > 0) {
      const at = game.markets?.[where]?.name;
      toast(`Je bent gerold${at ? ` bij ${at}` : ''}! ${euro(lost)} kwijt`, 'bad');
      if (navigator.vibrate && navigator.userActivation?.hasBeenActive !== false) {
        try { navigator.vibrate([120, 60, 120]); } catch (e) { /* niet erg */ }
      }
    }
    renderGame();
    if (activeMarketId) renderTrade();
    if (!$('role-modal').hidden) renderRole();
  }).catch(() => { fresh.forEach(([id]) => foldedThefts.delete(id)); });   // volgende poll opnieuw
}

// Na elke poll
function syncSwindle() {
  if (!swindlerOn()) return;
  foldThefts();
  renderRoleChrome();
  if (!$('role-modal').hidden) renderRole();
}

// ══════════════════════════════════════════════════════════════════
//  Je rol bekijken
// ══════════════════════════════════════════════════════════════════
function renderRoleChrome() {
  const on = swindlerOn();
  $('btn-role').hidden = !on;
  $('role-banner').hidden = !(on && !roleSeen);
}

function openRole() {
  roleSeen = true;
  renderRoleChrome();
  openSheet('role-modal');
  renderRole();
  saveSession();
}

function renderRole() {
  const p = myPlayer();
  if (isSwindler()) {
    setHtml('role-body', `
      <div class="teaser">
        ${ill('ill-masker', 'ill ill--xl')}
        <div>
          <div class="teaser__title">Jij bent de Oplichter</div>
          <div class="teaser__sub">Niemand weet het. Houd dat zo.</div>
        </div>
      </div>
      <ul class="rolelist">
        <li><strong>Zakkenrollen.</strong> Open een markt waar je staat en kies het tabblad <em>Rollen</em>. Je pakt 15% van iemands cash, hooguit ${euro(ROB_MAX)}. Daarna 3 minuten wachten.</li>
        <li><strong>Voorkennis.</strong> Bij de tips die de markt jou influistert staat of ze echt of nep zijn.</li>
        <li><strong>De stemming.</strong> Na afloop stemt iedereen wie de Oplichter is. Ontsnap je, dan krijg je ${euro(ESCAPE_BONUS)} extra. Word je ontmaskerd, dan gaat je buit terug naar de slachtoffers.</li>
      </ul>
      <div class="loc-status"><span class="dot dot--ok" aria-hidden="true"></span><span>Buit tot nu toe: <strong>${euro(p?.loot || 0)}</strong></span></div>`);
  } else {
    const robbed = p?.robbed || 0;
    setHtml('role-body', `
      <div class="teaser">
        ${ill('ill-masker', 'ill ill--xl')}
        <div>
          <div class="teaser__title">Eerlijke smokkelaar</div>
          <div class="teaser__sub">Maar één van jullie is de Oplichter.</div>
        </div>
      </div>
      <ul class="rolelist">
        <li><strong>Pas op je cash.</strong> De Oplichter rolt zakken bij de markten: 15% van je cash, hooguit ${euro(ROB_MAX)}. Wat in je koffer zit is veilig.</li>
        <li><strong>Let op wie er rondloopt.</strong> Word je gerold, dan krijg je een melding en staat het in het marktnieuws. Wie stond er toen bij die markt?</li>
        <li><strong>De stemming.</strong> Na afloop stemmen jullie wie het was. Goed gestemd levert ${euro(CATCH_REWARD)} op. Wordt de Oplichter ontmaskerd, dan krijgen slachtoffers hun geld terug.</li>
      </ul>
      <div class="loc-status"><span class="dot dot--${robbed ? 'bad' : 'ok'}" aria-hidden="true"></span><span>${robbed ? `Je bent gerold: <strong>${euro(robbed)}</strong> kwijt` : 'Je bent nog niet gerold.'}</span></div>`);
  }
}

// ══════════════════════════════════════════════════════════════════
//  Stemming (na de speeltijd)
// ══════════════════════════════════════════════════════════════════
function voteEndsAt() { return (game?.endsAt || 0) + VOTE_MS; }
function voteCount() {
  const v = game?.votes || {};
  const pids = Object.keys(game?.players || {});
  return { done: pids.filter(pid => v[pid]).length, total: pids.length };
}
function votingOpen(now = Date.now()) {
  if (!swindlerOn() || game.status === 'ended') return false;
  const c = voteCount();
  return now >= (game.endsAt || 0) && now < voteEndsAt() && c.done < c.total;
}

function showVoting() {
  if (!voteShown) {
    voteShown = true;
    votePick = null;
    stopPicking();
    closeAllSheets();
    showScreen('screen-vote');
  }
  renderVoting();
}

function renderVoting() {
  if (!game) return;
  const mine = game.votes?.[me.pid] || null;
  const c = voteCount();
  $('vote-timer').textContent = clock(voteEndsAt() - Date.now());
  $('vote-lead').textContent = mine
    ? 'Je stem is binnen. Zodra iedereen gestemd heeft, volgt de onthulling.'
    : `Eén van jullie rolde zakken. Goed gestemd levert ${euro(CATCH_REWARD)} op.`;
  const chosen = mine || votePick;
  setHtml('vote-list', Object.entries(game.players || {}).filter(([pid]) => pid !== me.pid)
    .sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''))
    .map(([pid, p]) => `
      <button class="vote" data-vote="${pid}" aria-pressed="${pid === chosen}" ${mine ? 'disabled' : ''}>
        <span class="avatar" aria-hidden="true">${escapeHtml((p.name || '?').trim().charAt(0).toUpperCase() || '?')}</span>
        <span class="vote__name">${escapeHtml(p.name || '???')}</span>
        ${pid === mine ? '<span class="tag">Jouw stem</span>' : ''}
      </button>`).join(''));
  const btn = $('btn-vote');
  btn.hidden = !!mine;
  btn.disabled = !votePick || voteBusy;
  btn.textContent = votePick ? `Stem op ${playerName(votePick)}` : 'Kies een naam';
  $('vote-wait').hidden = !mine;
  $('vote-progress').textContent = `${c.done} van ${c.total} stemmen binnen`;
}

async function castVote() {
  if (!votePick || voteBusy || game?.votes?.[me.pid]) return;
  voteBusy = true;
  renderVoting();
  try {
    await fbUpdate({ [`votes/${me.pid}`]: votePick });
  } catch (e) {
    toast(e.message || 'Stemmen mislukt, probeer opnieuw', 'bad');
  } finally {
    voteBusy = false;
    if (voteShown && game?.status !== 'ended') renderVoting();
  }
}

// ══════════════════════════════════════════════════════════════════
//  Uitslag en onthulling (afgeleid uit de data, niemand hoeft iets te schrijven)
// ══════════════════════════════════════════════════════════════════
// Ontmaskerd = de Oplichter kreeg meer stemmen dan wie dan ook
function verdict() {
  if (!swindlerOn()) return null;
  const s = game.swindler;
  const votes = Object.entries(game.votes || {}).filter(([voter, target]) => game.players[voter] && game.players[target] && voter !== target);
  const tally = {};
  votes.forEach(([, target]) => { tally[target] = (tally[target] || 0) + 1; });
  const forSwindler = tally[s] || 0;
  const maxOther = Math.max(0, ...Object.entries(tally).filter(([pid]) => pid !== s).map(([, n]) => n));
  return {
    swindler: s,
    caught: forSwindler > 0 && forSwindler > maxOther,
    forSwindler,
    total: votes.length,
    correct: votes.filter(([, target]) => target === s).map(([voter]) => voter),
    loot: game.players[s]?.loot || 0,
  };
}
// Wat er na de stemming bij of af gaat
function finalAdjust(pid, v = verdict()) {
  if (!v) return 0;
  let adj = v.correct.includes(pid) ? CATCH_REWARD : 0;
  if (pid === v.swindler) adj += v.caught ? -v.loot : ESCAPE_BONUS;
  else if (v.caught) adj += game.players[pid]?.robbed || 0;
  return adj;
}

function renderReveal() {
  const el = $('end-reveal');
  const v = verdict();
  el.hidden = !v;
  if (!v) return;
  const name = escapeHtml(playerName(v.swindler));
  const right = v.correct.map(pid => escapeHtml(playerName(pid)));
  el.className = `winner winner--${v.caught ? 'caught' : 'escaped'}`;
  setHtml(el, `${ill('ill-masker', 'ill ill--xl')}
    <span class="winner__label">De Oplichter was</span>
    <span class="winner__name">${name}</span>
    <span class="winner__worth">${v.caught ? 'Ontmaskerd!' : 'Ontsnapt!'}</span>
    <span class="winner__sub">${v.forSwindler} van ${v.total} ${v.total === 1 ? 'stem' : 'stemmen'} voor ${name}</span>
    <span class="winner__sub">${v.caught
      ? (v.loot ? `De buit van ${euro(v.loot)} gaat terug naar de slachtoffers` : 'Er was nog niets buitgemaakt')
      : `${v.loot ? `${euro(v.loot)} buit gehouden` : 'Geen buit'}, plus ${euro(ESCAPE_BONUS)} ontsnappingsbonus`}</span>
    <span class="winner__sub">${right.length ? `Goed gestemd (+${euro(CATCH_REWARD)}): ${right.join(', ')}` : 'Niemand stemde goed'}</span>`);
}

// ══════════════════════════════════════════════════════════════════
//  Reset + events
// ══════════════════════════════════════════════════════════════════
function resetSwindle() {
  foldedThefts = new Set();
  lastRobAt = 0;
  lastPresence = { m: null, t: 0 };
  roleSeen = false; voteShown = false; votePick = null; voteBusy = false;
  $('btn-role').hidden = true;
  $('role-banner').hidden = true;
  $('end-reveal').hidden = true;
}

function bindSwindle() {
  $('btn-role').addEventListener('click', openRole);
  $('btn-role-view').addEventListener('click', openRole);
  $('vote-list').addEventListener('click', e => {
    const b = e.target.closest('[data-vote]');
    if (!b || game?.votes?.[me.pid]) return;
    votePick = b.dataset.vote;
    renderVoting();
  });
  $('btn-vote').addEventListener('click', castVote);
}
