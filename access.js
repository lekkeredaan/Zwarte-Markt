/* ══════════════════════════════════════════════════════════════
   ZWARTE MARKT — toegangscode (net als de andere Ravotters-spellen)
   Wie een lobby maakt, vult een code in die via de webshop op ravotters.nl
   is gekocht. De webshop controleert hem: vanaf het eerste gebruik 72 uur
   geldig. De mastercode (ZM-<vast deel>, het vaste deel staat alleen als
   MASTER_SECRET in Vercel bij de webshop) werkt altijd. Meedoen met een lobbycode blijft gratis.
   Er staat geen code of geheim in deze bestanden.
   ══════════════════════════════════════════════════════════════ */

const ACCESS_API       = 'https://uitgespeeld.vercel.app/api/codes/verify';
const ACCESS_GAME_SLUG = 'zwarte-markt';
const ACCESS_SHOP_URL  = 'https://www.ravotters.nl/zwarte-markt';
const ACCESS_KEY       = 'zm.code';         // laatst gebruikte code, alleen op dit toestel
const ACCESS_TIMEOUT   = 8000;

let accessUntil = null;   // tot wanneer de gecontroleerde code geldig is

function cleanCode(v) { return String(v || '').toUpperCase().replace(/\s+/g, ''); }

async function verifyAccessCode(code) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ACCESS_TIMEOUT);
  try {
    const r = await fetch(ACCESS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, gameSlug: ACCESS_GAME_SLUG }),
      signal: controller.signal,
    });
    const data = await r.json().catch(() => null);
    if (data?.valid) return { ok: true, expiresAt: data.expiresAt ? new Date(data.expiresAt).getTime() : null };
    if (data?.reason === 'too_many_attempts') return { ok: false, msg: 'Te veel foute pogingen. Wacht tien minuten en probeer het dan opnieuw.' };
    if (data?.reason === 'expired') return { ok: false, msg: 'Deze code is verlopen: hij is 72 uur geldig vanaf het eerste gebruik.' };
    if (data && (data.reason === 'not_found' || data.valid === false)) return { ok: false, msg: 'Deze code klopt niet. Controleer de spelling (bijvoorbeeld ABCD-EFGH).' };
    return { ok: false, msg: `De code kon niet worden gecontroleerd (${r.status}). Probeer het zo nog eens.` };
  } catch (e) {
    return { ok: false, msg: e.name === 'AbortError'
      ? 'Controleren duurde te lang. Check je internet en probeer opnieuw.'
      : 'De code kon niet worden gecontroleerd. Check je internet en probeer opnieuw.' };
  } finally {
    clearTimeout(timer);
  }
}

// Naamscherm: codeveld alleen bij "Lobby maken"
function renderAccessField() {
  const show = pendingAction === 'create' && !isLocal;
  $('access-box').hidden = !show;
  if (!show) return;
  const input = $('input-access');
  if (!input.value) {
    try { input.value = localStorage.getItem(ACCESS_KEY) || ''; } catch (e) { /* geen opslag */ }
  }
}

// Geeft true als de host verder mag; toont anders zelf de fout
async function checkAccess(btn) {
  if (pendingAction !== 'create' || isLocal) return true;
  const code = cleanCode($('input-access').value);
  $('input-access').value = code;
  const err = $('name-error');
  if (!code) { err.textContent = 'Vul je toegangscode in. Die krijg je per mail na het kopen.'; err.hidden = false; return false; }
  const label = btn.textContent;
  btn.textContent = 'Code controleren…';
  try {
    const res = await verifyAccessCode(code);
    if (!res.ok) { err.textContent = res.msg; err.hidden = false; return false; }
    accessUntil = res.expiresAt;
    try { localStorage.setItem(ACCESS_KEY, code); } catch (e) { /* geen opslag */ }
    return true;
  } finally {
    btn.textContent = label;
  }
}

function bindAccess() {
  $('input-access').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/\s+/g, ''); });
  $('input-access').addEventListener('keydown', e => { if (e.key === 'Enter') onNameOk(); });
  $('access-shop').href = ACCESS_SHOP_URL;
}
