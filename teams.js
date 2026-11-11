/* ══════════════════════════════════════════════════════════════
   ZWARTE MARKT — teams
   Spelvorm via config.teamSize (0 = ieder voor zich, anders 2, 3 of 4).
   • Ieder houdt een eigen kas en koffer; de teamwaarde is de som.
   • Indeling: bij binnenkomst naar het kleinste team; zelf wisselen in de lobby;
     de host kan hussellen. Bij de start vult de host gaten en te volle teams aan.
   • Geven aan een teamgenoot loopt via players/<pid>/payments (de ontvanger schrijft zelf bij).
   • Teamgenoten zie je op de kaart (players/<pid>/pos, alleen in teamspel, gewist bij het einde).
   ══════════════════════════════════════════════════════════════ */

const TEAMS = [
  { id: 't0', name: 'De Kraaien' },
  { id: 't1', name: 'De Vossen' },
  { id: 't2', name: 'De Ratten' },
  { id: 't3', name: 'De Eksters' },
  { id: 't4', name: 'De Marters' },
  { id: 't5', name: 'De Uilen' },
];
const TEAM = Object.fromEntries(TEAMS.map((t, i) => [t.id, { ...t, n: i + 1 }]));
const POS_SHARE_MS = 10000;      // hooguit elke 10 s je plek delen
const POS_STALE_MS = 5 * 60000;  // oudere plekken niet meer tonen

let mateLayer = null;
let lastShare = { at: 0, pos: null };
let giveDraft = null;

// ── Basis ──
function teamSize() { return game?.config?.teamSize || 0; }
function teamMode() { return teamSize() > 0; }
function teamCount(nPlayers) { return clamp(Math.ceil(nPlayers / teamSize()), 2, TEAMS.length); }
function teamOf(pid) { return game?.players?.[pid]?.team || null; }
function teamStyle(tid) { return TEAM[tid] ? `style="--tc: var(--team-${TEAM[tid].n})"` : ''; }
function teamMembers(tid) { return Object.entries(game?.players || {}).filter(([, p]) => p.team === tid); }
function teammates() {
  const mine = teamOf(me.pid);
  return mine ? teamMembers(mine).filter(([pid]) => pid !== me.pid) : [];
}
function isTeammate(pid) { return teamMode() && pid !== me.pid && !!teamOf(me.pid) && teamOf(pid) === teamOf(me.pid); }
function initial(name) { return escapeHtml((name || '?').trim().charAt(0).toUpperCase() || '?'); }

// Kleinste team voor een nieuwkomer (n = aantal spelers inclusief de nieuwkomer)
function smallestTeamId(players, n) {
  const sizes = TEAMS.slice(0, teamCount(n)).map(t => ({
    id: t.id, n: Object.values(players || {}).filter(p => p.team === t.id).length,
  }));
  sizes.sort((a, b) => a.n - b.n);
  return sizes[0].id;
}

// Paden voor een (her)indeling. shuffle = iedereen opnieuw; anders alleen gaten en te volle teams.
function assignTeams(shuffle) {
  const pids = Object.keys(game.players || {});
  const size = teamSize();
  const tally = {};
  TEAMS.slice(0, teamCount(pids.length)).forEach(t => { tally[t.id] = 0; });
  const order = shuffle ? pids.map(p => [Math.random(), p]).sort((a, b) => a[0] - b[0]).map(x => x[1]) : pids;
  const pending = [];
  for (const pid of order) {
    const cur = game.players[pid].team;
    if (!shuffle && cur in tally && tally[cur] < size) { tally[cur]++; continue; }
    pending.push(pid);
  }
  const updates = {};
  for (const pid of pending) {
    const tid = Object.keys(tally).sort((a, b) => tally[a] - tally[b])[0];
    tally[tid]++;
    if (game.players[pid].team !== tid) updates[`players/${pid}/team`] = tid;
  }
  return updates;
}

// ══════════════════════════════════════════════════════════════════
//  Lobby
// ══════════════════════════════════════════════════════════════════
function lobbyTeamsHtml() {
  const players = Object.entries(game.players || {});
  const size = teamSize();
  const shown = TEAMS.slice(0, teamCount(players.length));
  const mine = teamOf(me.pid);
  const blocks = shown.map(t => {
    const members = players.filter(([, p]) => p.team === t.id);
    const action = t.id === mine ? '<span class="tag tag--team">Jouw team</span>'
      : members.length >= size ? '<span class="tag tag--night">Vol</span>'
      : `<button class="btn btn--ghost btn--sm" data-team="${t.id}">Wissel</button>`;
    return `
      <section class="team" ${teamStyle(t.id)}>
        <header class="team__head">
          <span class="team__dot" aria-hidden="true"></span>
          <h3 class="team__name">${t.name}</h3>
          <span class="team__count">${members.length}/${size}</span>
          ${action}
        </header>
        ${members.length ? `<ul class="roster">${members.map(rosterLi).join('')}</ul>` : '<p class="team__empty">Nog niemand. Wissel hierheen of wacht op meer spelers.</p>'}
      </section>`;
  });
  const loose = players.filter(([, p]) => !shown.some(t => t.id === p.team));
  if (loose.length) {
    blocks.push(`
      <section class="team">
        <header class="team__head"><h3 class="team__name">Nog niet ingedeeld</h3></header>
        <ul class="roster">${loose.map(rosterLi).join('')}</ul>
      </section>`);
  }
  return blocks.join('');
}

async function switchTeam(tid, btn) {
  if (!TEAM[tid] || game?.status !== 'lobby') return;
  if (teamMembers(tid).length >= teamSize()) { toast('Dat team zit al vol', 'bad'); return; }
  btn.disabled = true;
  try {
    await fbUpdate({ [`players/${me.pid}/team`]: tid });
    renderLobby();
  } catch (e) {
    toast(e.message || 'Wisselen mislukt, probeer opnieuw', 'bad');
    btn.disabled = false;
  }
}

async function shuffleTeams() {
  const btn = $('btn-shuffle');
  btn.disabled = true;
  try {
    await fbUpdate(assignTeams(true));
    renderLobby();
    toast('Teams gehusseld', 'good');
  } catch (e) {
    toast(e.message || 'Hussellen mislukt', 'bad');
  } finally {
    btn.disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════════
//  Stand
// ══════════════════════════════════════════════════════════════════
function teamStandings() {
  const byTeam = {};
  for (const s of standings()) {
    const key = s.team || 'none';
    if (!byTeam[key]) byTeam[key] = [];
    byTeam[key].push(s);
  }
  return Object.entries(byTeam)
    .map(([tid, members]) => ({
      tid, name: TEAM[tid]?.name || 'Zonder team', members,
      worth: members.reduce((a, s) => a + s.worth, 0),
    }))
    .sort((a, b) => b.worth - a.worth);
}

function teamStandingsHtml() {
  const mine = teamOf(me.pid);
  return teamStandings().map((t, i) => `
    <li class="standings__team ${t.tid === mine ? 'is-me' : ''}" ${teamStyle(t.tid)}>
      <span class="rank">${i === 0 ? ill('ill-kroon', 'ill ill--md') : i + 1}</span>
      <span>
        <strong class="teamname"><span class="team__dot" aria-hidden="true"></span>${t.name}${t.tid === mine ? ' <small>(jullie)</small>' : ''}</strong>
        <small class="members">${t.members.map(s => `${escapeHtml(s.name)} ${euro(s.worth)}${s.manual ? ' (handmatig)' : ''}`).join(' · ')}</small>
      </span>
      <span class="worth">${euro(t.worth)}</span>
    </li>`).join('');
}

// ══════════════════════════════════════════════════════════════════
//  Teamscherm + geven
// ══════════════════════════════════════════════════════════════════
function openTeam() {
  openSheet('team-modal');
  renderTeam();
}

function renderTeam() {
  const tid = teamOf(me.pid);
  const ranks = teamStandings();
  const pos = ranks.findIndex(t => t.tid === tid);
  const mineStanding = ranks[pos];
  if (!mineStanding) { setHtml('team-body', '<p class="note">Je zit nog niet in een team.</p>'); return; }
  const rows = mineStanding.members.map(s => `
    <li class="member">
      <span class="avatar" aria-hidden="true">${initial(s.name)}</span>
      <span class="member__name">${escapeHtml(s.name)}${s.pid === me.pid ? ' <small>(jij)</small>' : ''}<small class="member__worth">${euro(s.worth)}</small></span>
      ${s.pid === me.pid ? '' : `<button class="btn btn--ink btn--sm" data-give="${s.pid}">${ill('ico-gift', 'ico')} Geef</button>`}
    </li>`).join('');
  setHtml('team-body', `
    <div class="teaser" ${teamStyle(tid)}>
      <span class="team__dot team__dot--lg" aria-hidden="true"></span>
      <div>
        <div class="teaser__title">${mineStanding.name}</div>
        <div class="teaser__sub">Plek ${pos + 1} van ${ranks.length} · samen ${euro(mineStanding.worth)}</div>
      </div>
    </div>
    <ul class="members" ${teamStyle(tid)}>${rows}</ul>
    <p class="note">Geven kan overal, ook als jullie ver uit elkaar staan. Een geheime tip deel je via je tipsmap. Teamgenoten zie je als gekleurd rondje op de kaart.</p>`);
}

function openGive(pid) {
  if (!isTeammate(pid)) return;
  giveDraft = { to: pid, kind: 'cash', amount: 50, good: null, qty: 1 };
  openSheet('give-modal');
  renderGive();
}

function renderGive() {
  const p = myPlayer();
  const mate = game?.players?.[giveDraft?.to];
  if (!p || !mate) { closeSheet('give-modal'); return; }
  const d = giveDraft;
  const cash = Math.floor(p.capital || 0);
  const owned = GOODS.filter(g => (p.inv?.[g.id] || 0) > 0);
  if (!owned.some(g => g.id === d.good)) d.good = owned[0]?.id || null;
  const have = d.good ? (p.inv?.[d.good] || 0) : 0;
  d.amount = clamp(d.amount, Math.min(10, cash), cash);
  d.qty = clamp(d.qty, 1, Math.max(1, have));
  $('give-title').textContent = `Geef aan ${mate.name || '?'}`;

  let body, label, ok;
  if (d.kind === 'cash') {
    ok = d.amount > 0;
    label = ok ? `Geef ${euro(d.amount)}` : 'Je hebt geen cash';
    body = `
      <div>
        <span class="form__label">Hoeveel? Je hebt ${euro(cash)}</span>
        <div class="stepper">
          <button data-cash="-10" aria-label="10 euro minder">−</button>
          <span class="stepper__val">${euro(d.amount)}</span>
          <button data-cash="10" aria-label="10 euro meer">+</button>
          <button class="pick pick--plain" data-cash="all">Alles</button>
        </div>
      </div>`;
  } else if (!owned.length) {
    ok = false;
    label = 'Je koffer is leeg';
    body = '<p class="note">Je hebt geen goederen om te geven. Koop eerst iets op een markt.</p>';
  } else {
    ok = have >= d.qty;
    label = `Geef ${d.qty}× ${GOOD[d.good].short}`;
    body = `
      <div>
        <span class="form__label">Welk goed?</span>
        <div class="picks">${owned.map(g => `
          <button class="pick pick--good" data-good="${g.id}" aria-pressed="${d.good === g.id}">${ill(g.ill, 'ill ill--md')}${p.inv[g.id]}× ${g.short}</button>`).join('')}
        </div>
      </div>
      <div>
        <span class="form__label">Hoeveel?</span>
        <div class="stepper">
          <button data-qty="-1" aria-label="Eén minder">−</button>
          <span class="stepper__val">${d.qty}×</span>
          <button data-qty="1" aria-label="Eén meer">+</button>
          <button class="pick pick--plain" data-qty="all">Alles</button>
        </div>
      </div>`;
  }
  setHtml('give-body', `
    <div class="seg seg--plain" role="group" aria-label="Wat wil je geven?">
      <button class="seg__btn seg__btn--grow" data-kind="cash" aria-pressed="${d.kind === 'cash'}">Cash</button>
      <button class="seg__btn seg__btn--grow" data-kind="good" aria-pressed="${d.kind === 'good'}">Goederen</button>
    </div>
    ${body}
    <button id="btn-give-send" class="btn btn--primary btn--lg btn--block" ${ok ? '' : 'disabled'}>${label}</button>
    <p class="note">${escapeHtml(mate.name || 'Je teamgenoot')} krijgt het binnen een paar seconden.</p>`);
}

async function sendGift() {
  const btn = $('btn-give-send');
  btn.disabled = true;
  const d = { ...giveDraft };
  const mate = game?.players?.[d.to];
  try {
    await withMe(async () => {
      const p = myPlayer();
      if (!p || !isTeammate(d.to)) throw new Error('Dit is geen teamgenoot (meer)');
      const path = `players/${d.to}/payments/${newId('g')}`;
      const base = { kind: 'gift', fromName: me.name, at: Date.now() };
      if (d.kind === 'cash') {
        if (d.amount <= 0 || (p.capital || 0) < d.amount) throw new Error('Te weinig cash');
        await writeMe({ capital: p.capital - d.amount }, { [path]: { ...base, amount: d.amount } });
      } else {
        const have = p.inv?.[d.good] || 0;
        if (!d.good || have < d.qty) throw new Error('Zoveel heb je niet');
        const inv = { ...(p.inv || {}) };
        inv[d.good] = have - d.qty;
        if (inv[d.good] === 0) delete inv[d.good];
        await writeMe({ inv }, { [path]: { ...base, good: d.good, qty: d.qty } });
      }
    });
    toast(`Gegeven aan ${mate?.name || 'je teamgenoot'}: ${d.kind === 'cash' ? euro(d.amount) : `${d.qty}× ${GOOD[d.good].short}`}`, 'good');
    closeSheet('give-modal');
    renderGame();
    if (!$('team-modal').hidden) renderTeam();
  } catch (e) {
    toast(e.message || 'Geven mislukt, probeer opnieuw', 'bad');
    btn.disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════════
//  Teamgenoten op de kaart
// ══════════════════════════════════════════════════════════════════
function initMates() {
  mateLayer = gameMap ? L.layerGroup().addTo(gameMap) : null;
  drawMates();
}

function drawMates() {
  if (!mateLayer) return;
  mateLayer.clearLayers();
  if (!teamMode()) return;
  const now = Date.now();
  for (const [, p] of teammates()) {
    if (!p.pos || now - (p.pos.at || 0) > POS_STALE_MS) continue;
    const icon = L.divIcon({
      className: 'mk-wrap',
      html: `<div class="mate" ${teamStyle(p.team)} title="${escapeHtml(p.name || '')}">${initial(p.name)}</div>`,
      iconSize: [30, 30], iconAnchor: [15, 15],
    });
    L.marker([p.pos.lat, p.pos.lng], { icon, interactive: false, zIndexOffset: 500 }).addTo(mateLayer);
  }
}

// Eigen plek delen met het team (alleen in teamspel, met mate)
function sharePos() {
  if (!teamMode() || !myPos || game?.status !== 'playing') return;
  const now = Date.now();
  if (now - lastShare.at < POS_SHARE_MS) return;
  if (lastShare.pos && haversine(lastShare.pos, myPos) < 10 && now - lastShare.at < 60000) return;
  lastShare = { at: now, pos: { ...myPos } };
  const pos = { lat: Number(myPos.lat.toFixed(5)), lng: Number(myPos.lng.toFixed(5)), at: now };
  fbUpdate({ [`players/${me.pid}/pos`]: pos }).catch(() => { lastShare.at = 0; });
}
// Na afloop de gedeelde plek weer wissen (geen locaties bewaren)
function clearSharedPos() {
  if (!teamMode() || !lastShare.pos) return;
  fbUpdate({ [`players/${me.pid}/pos`]: null }).catch(() => {});
}

// ══════════════════════════════════════════════════════════════════
//  Reset + events
// ══════════════════════════════════════════════════════════════════
function resetTeams() {
  mateLayer = null;
  lastShare = { at: 0, pos: null };
  giveDraft = null;
}

function describeTeams() {
  const size = Number($('opt-teams').value) || 0;
  $('teams-hint').textContent = size
    ? `Teams van ${size}. Ieder houdt een eigen kas en koffer, maar teamgenoten kunnen elkaar geld, goederen en tips geven. Het rijkste team wint.`
    : 'Iedereen speelt voor zichzelf. De rijkste smokkelaar wint.';
}

function bindTeams() {
  $('opt-teams').addEventListener('change', describeTeams);
  $('btn-shuffle').addEventListener('click', shuffleTeams);
  $('lobby-players').addEventListener('click', e => {
    const b = e.target.closest('[data-team]');
    if (b) switchTeam(b.dataset.team, b);
  });
  $('btn-team').addEventListener('click', openTeam);
  $('team-body').addEventListener('click', e => {
    const b = e.target.closest('[data-give]');
    if (b) openGive(b.dataset.give);
  });
  $('give-body').addEventListener('click', e => {
    const p = myPlayer();
    const d = giveDraft;
    if (!p || !d) return;
    const kind = e.target.closest('[data-kind]');
    if (kind) { d.kind = kind.dataset.kind; renderGive(); return; }
    const cash = e.target.closest('[data-cash]');
    if (cash) { d.amount = cash.dataset.cash === 'all' ? Math.floor(p.capital || 0) : d.amount + Number(cash.dataset.cash); renderGive(); return; }
    const good = e.target.closest('[data-good]');
    if (good) { d.good = good.dataset.good; d.qty = 1; renderGive(); return; }
    const qty = e.target.closest('[data-qty]');
    if (qty) { d.qty = qty.dataset.qty === 'all' ? (p.inv?.[d.good] || 1) : d.qty + Number(qty.dataset.qty); renderGive(); return; }
    if (e.target.closest('#btn-give-send')) sendGift();
  });
}
