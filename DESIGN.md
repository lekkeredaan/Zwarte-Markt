# Zwarte Markt: design-systeem

Ravotters-huisstijl met een eigen **nachtmarkt**-twist. Alles staat als token in `:root` van [`style.css`](style.css). Gebruik altijd tokens, nooit losse hex-waarden of pixelmaten.

## Principes
1. **Familie van Ravotters**: Anton-koppen in hoofdletters, Archivo 900 op knoppen, dikke inktranden, harde offset-schaduwen, pil-knoppen.
2. **Eigen accent = de nacht**: donkere inkt-achtergrond met vage zonnestralen (de hoofdsite heeft ze op geel). Op de nacht zijn inktranden onzichtbaar, dus elementen krijgen een **gele of roze schaduw** in plaats van een zwarte.
3. **Licht oppervlak voor beslissingen**: alles waar je leest en kiest (handel, stand, koffer) staat op crème. Dat blijft buiten in de zon goed leesbaar.
4. **Prijs eerst**: in het handelspaneel is de prijs en of die gunstig is het grootste element, niet de knoppen.
5. **Duim-vriendelijk**: alle tikdoelen ≥ 44px, primaire acties ≥ 48px, belangrijke acties onderin het scherm.

## Tokens

### Kleur
| Token | Waarde | Gebruik |
|---|---|---|
| `--ink` | `#141414` | Randen, tekst op licht |
| `--cream` | `#FBF1DC` | Kaarten, sheets, tekst op nacht |
| `--cream-2` | `#F2E5C6` | Rustige vlakken op crème |
| `--paper` | `#FFFAEE` | Rijen binnen een sheet |
| `--yellow` | `#FFD400` | Merkgeel: primaire knop, schaduw op nacht |
| `--pink` | `#FF2E63` | Merkroze: schaduw primaire knop, "duur", alarm |
| `--night` / `--night-2` | `#16130E` / `#211C14` | Achtergrond + zonnestralen |
| `--on-night` / `--on-night-muted` | `#FBF1DC` / `#C9BE9F` | Tekst op nacht |
| `--gain` | `#2BD67B` | Winst, verkopen, "goedkoop" (altijd met inkt-tekst) |
| `--muted` | `#5C5240` | Secundaire tekst op crème (7:1) |
| `--up` / `--down` | `#0B7A3E` / `#B0123F` | Trend-tekst op crème |
| `--disabled` | `#8A7F66` | Uitgeschakelde knoppen (gestippeld) |
| `--team-1 … --team-6` | geel, roze, groen, blauw `#5BB8FF`, oranje `#FF9A3D`, lila `#C9A2FF` | Teamkleur, via `style="--tc: var(--team-N)"`. Altijd met inkt-tekst |

Contrast: tekst op groen, geel en roze is altijd **inkt** (≥ 5:1). Nooit wit op groen.

### Typografie
| Token | Waarde | Gebruik |
|---|---|---|
| `--font-display` | Anton | Koppen, prijzen, codes, cijfers. Altijd uppercase |
| `--font-body` | Archivo 400–900 | Tekst; 900 voor knoppen, 800 voor labels |
| `--fs-xs … --fs-hero` | 12 / 14 / 16 / 18 / 24 / 32 / 44 / 76 px | Minimum 12px, en alleen voor labels in hoofdletters |

### Ruimte, vorm, schaduw, beweging
- Ruimte: `--s1 … --s8` = 4 / 8 / 12 / 16 / 20 / 24 / 32 px.
- Rand: `--bw` = 3px (2px voor rijen en chips binnen een kaart).
- Hoeken: `--r-sm` 10, `--r-md` 16, `--r-lg` 24, `--r-pill` 999.
- Schaduw: op licht `--sh-ink` / `--sh-ink-sm`; op nacht `--sh-yellow` (secundair) en `--sh-pink` (primair).
- Beweging: `--t-fast` 80ms (indrukken), `--t` 200ms (sheets), `--ease`. `prefers-reduced-motion` zet alles uit.

## Componenten

### Knop `.btn`
| Variant | Waar | Uiterlijk |
|---|---|---|
| `--primary` | Hoofdactie per scherm (max 1) | Geel, inkt-tekst, roze schaduw |
| `--secondary` | Ondersteunend op nacht | Crème, gele schaduw |
| `--ghost` | Terug / verlaten / hulpacties | Transparant, crème rand |
| `--ink` | Koop, tussenstand (op crème) | Inkt, gele tekst |
| `--gain` | Verkoop (op crème) | Groen, inkt-tekst |

Maten: standaard 48px, `--lg` 60px, `--sm` 44px. States: indrukken = 3px verschuiven en schaduw weg; **disabled = transparant met gestippelde rand, geen schaduw** (nooit alleen doorzichtig). Focus: gestippelde gele outline.

### Invoer `.field`, `.select`, `.toggle`
Crème pil, inktrand, gele schaduw op nacht. `.field--code` gebruikt Anton met letterspatiëring. De GPS-optie is een `.toggle` (schakelaar), geen los vinkje.

### Sheet `.sheet` + `.sheet__card`
Onderlade op crème met gele bovenrand. Kop: nummer-badge, titel (Anton), subregel, sluitknop van 44px rechts. Sluit via ✕ en via tik op de achtergrond. `[hidden]` verbergt hem altijd (globale regel `[hidden]{display:none!important}`).

### Grootboekrij `.row` (handel)
Eén rij per goed: icoon, naam + "in koffer" + trend, rechts de **prijs (Anton, 30px)** met een **deal-label** t.o.v. het gemiddelde van alle markten:
- `deal--low` groen "−18% · goedkoop" (≤ −5%)
- `deal--mid` crème "≈ gemiddeld"
- `deal--high` roze "+22% · duur" (≥ +5%)

Daaronder Koop (`--ink`) en Verkoop (`--gain`). Het aantal kies je één keer bovenin de sheet met de segmentknop `.seg` (×1 / ×5 / ×10).

### HUD `.hud`
Pillen bovenop de kaart: cash (geel, Anton), timer (crème; roze en knipperend in de laatste minuut), centreerknop (rond). Inktschaduw, want de kaart is licht.

### Koffer `.koffer`
Zwevende crème kaart onderaan de kaart, drie rijen: titel + geschatte waarde, een horizontale rij `.item`-chips per goed (met illustratie; een zending onderweg is een gestippelde `.item--ship` met aftelklok), en onderaan een rij even brede knoppen: **Tips** (met roze teller `.count-badge`), **Team** (alleen in teamspel) en **Stand**.

### Markt-marker `.mk`
Druppelvormige pin met het **marktnummer** (Anton) en een inkt-naamlabel eronder. In de buurt: geel en wiebelend. Tijdens een schok wiebelt de schok-illustratie (`.mk__shock`) rechtsboven de pin. Eigen positie `.me`: roze stip met crème ring; handmatig (`.me--manual`): gele stip.

### Meldingen onder de HUD `.alerts`
Eén stapel onder de HUD, in deze volgorde:
- `.banner`: roze (geen GPS, met knop "Zet handmatig") of `.banner--light` crème (tik je plek op de kaart).
- `.flash`: nieuwsflits bij een marktschok. Inkt met roze rand, illustratie, kicker, Anton-titel in geel. Tik = marktnieuws.
- `.offerbar`: gele pil "X biedt je een geheime tip aan". Tik = aanbod bekijken.

### Bluf-componenten (in sheets)
- `.tip` / `.news`: crème-witte kaart met illustratie links, tekst, en `.tip__foot` met `.status` (open / uitgekomen / niet uitgekomen / openstaand) en een actie.
- `.mchip`: rond marktnummer in de lopende tekst. `.dir--up/down`: groen of roze label "omhoog/omlaag".
- `.stamp--raid/--shortage`: schuin stempel naast een goed in het grootboek tijdens een schok.
- `.teaser`: inktblok met illustratie bovenaan verkoop- en aanbodschermen.
- `.pick`: keuzepil (koper, goed, markt); gekozen = inkt met gele tekst.
- `.stepper`: −/+ met een grote Anton-waarde (vraagprijs).
- `.loc-status` + `.dot--ok/manual/off`: locatiestatus.

### Teams
- `.team`: teamblok in de lobby. Balk links in de teamkleur, kop met `.team__dot`, naam (Anton), bezetting "2/2" en rechts een actie: `.tag--team` "Jouw team", `.tag--night` "Vol" of een knop "Wissel". Avatars krijgen de teamkleur.
- `.standings__team`: teamrij in de stand: teamnaam met stip, daaronder de leden met hun waarde, rechts het teamtotaal.
- `.member`: rij in het teamscherm met avatar, naam, waarde en knop "Geef". Het teamscherm begint met een `.teaser` (teamnaam, plek, totaal).
- `.mate`: teamgenoot op de kaart: rondje in de teamkleur met de eerste letter.
- Geven: `.seg` Cash/Goederen, `.stepper` met de knop "Alles" (`.pick--plain`), één primaire knop.

### Risico (tabbladen in het marktscherm)
- Tabbladen `#trade-tabs`: Handel · Zending · Douane (zelfde `.seg` als elders). Het aantal per klik geldt voor alle drie.
- `.explain`: uitlegblok met illustratie bovenaan een tabblad. Eén zin met de kansen in gewone taal.
- `.ship`: gestippelde pil voor een zending onderweg (illustratie, wat, aftelklok in Anton). `.ship--ok` / `.ship--fail`: laatste uitkomst, groen of roze.
- `.row__actions--one`: één brede actieknop per goed. Kan het niet, dan staat de reden op de (gestippelde) knop: "Te weinig cash", "De douane let nog op je".
- Alles wat elke seconde verandert (aftellen) staat in `#trade-status`, los van de knoppen in `#trade-goods`. Zo vallen tikken niet weg.

### De Oplichter
- **Rol bekijken:** rond maskerknopje in de HUD (`#btn-role`, `.icon-btn`) en bij de start eenmalig een crème `.banner--light` in `.alerts` ("Je hebt een geheime rol") met knop "Bekijk". De rol springt nooit vanzelf open: de speler kiest zelf het moment.
- **Rolscherm:** sheet met een `.teaser` (masker, rolnaam in Anton) en daaronder `.rolelist`: drie witte kaartjes met een kop in Anton en één of twee zinnen. Onderaan een `.loc-status` met buit of verlies.
- **Tabblad Rollen:** vierde tab in het marktscherm, alleen voor de Oplichter. Met vier tabs krijgt `#trade-tabs` de klasse `.seg--four` (kleinere letter, minder ruimte). Inhoud: `.explain`, een `.loc-status` met de wachttijd, en per aanwezige speler een `.member`-rij met knop "Rol".
- **Stemscherm `#screen-vote`:** nachtachtergrond, kop met geel gemarkeerd woord, aftelklok als `.pill.timer`, en per speler een brede crème pil `.vote` (gekozen = geel met roze schaduw). Onderaan één primaire knop "Stem op …". Na het stemmen staat er `.waiting` met de voortgang.
- **Onthulling:** `.winner`-kaart boven de winnaar: groen (`.winner--caught`) bij ontmaskerd, roze (`.winner--escaped`) bij ontsnapt, licht de andere kant op gedraaid. Het masker staat op een crème rondje.
- **Tips met voorkennis:** `.stamp` "Echt" (groen) of "Nep" (roze) achter de tiptekst, alleen bij de Oplichter.

### Toegangscode `.access` (naamscherm)
Alleen bij "Lobby maken": label "Toegangscode", een `.field.field--code.field--access` (kleinere letterafstand, past ABCD-EFGH) en een korte uitleg met een gele onderstreepte link naar de webshop. De laatst gebruikte code staat al ingevuld. Tijdens het controleren staat er "Code controleren…" op de knop Verder; een fout komt in de bestaande `.alert` onder de knop.

### Verder spelen `.resume` (startscherm)
Crème kaart boven "Lobby maken", alleen zichtbaar als dit toestel nog een potje kent: kop in Anton ("Je zat nog in een potje"), daaronder lobbycode en bijnaam op één regel, rechts een ronde sluitknop (`.close`, "Vergeet dit potje") en eronder één brede groene knop **Verder spelen**. Tijdens het ophalen staat er "Bezig…" en zijn beide knoppen uit.

### Overig
- `.ticket`: de lobbycode als smokkelticket (geel, roze schaduw, ponsgaten).
- `.roster` / `.standings`: pil-rijen met avatar-initiaal of rang; jezelf in geel. `.tag--soft` "handmatig" achter een naam.
- `.alert`: crème-roze melding met roze zijbalk.
- `.toast`: inkt-pil onderin (boven de koffer), groene of roze rand. Is er een paneel open, dan bovenin (`.toast--top`).
- `.sticker`: schuine roze label-sticker (zoals "ZES SPELLEN" op de hoofdsite).
- `.btn--line`: omlijnde knop voor secundaire acties op crème.

## Illustraties en iconen
Geen emoji: alles staat als SVG-`<symbol>` bovenin [`index.html`](index.html) en wordt gebruikt via `ill('id', 'ill ill--lg')` in JS of `<svg><use href="#id"/></svg>` in HTML.

| Soort | Rooster | Stijl | Voorbeelden |
|---|---|---|---|
| Illustratie `ill-*` | 48×48 | Inktlijn 3, vlakke merkkleuren (hex van de tokens), harde inktschaduw 2–3px rechtsonder | `ill-horloges`, `ill-kruiden`, `ill-munten`, `ill-sigaren`, `ill-inval`, `ill-tekort`, `ill-tip`, `ill-kroon`, `ill-zending`, `ill-douane`, `ill-masker` |
| Icoon `ico-*` | 24×24 | Lijn 2,5, ronde uiteinden, `currentColor` | `ico-pin`, `ico-share`, `ico-copy`, `ico-trophy`, `ico-tip`, `ico-news`, `ico-target`, `ico-search`, `ico-pen`, `ico-gps-off`, `ico-x`, `ico-team`, `ico-gift`, `ico-shuffle`, `ico-mask` |

Maten: `.ill--sm` 22, `.ill--md` 30, `.ill--lg` 40, `.ill--xl` 72; `.ico` 20. Nieuw goed of nieuwe schok? Eerst een illustratie in dezelfde stijl tekenen. Enige extra kleur buiten de tokens: bruin `#A8652F` (sigaar) en `#D9A066` (krat).

## Do's en don'ts
| ✅ Doen | ❌ Niet doen |
|---|---|
| Inkt-tekst op groen, geel en roze | Witte tekst op groen |
| Gele of roze schaduw op de nacht | Zwarte schaduw of rand als enige afbakening op de nacht |
| Eén primaire knop per scherm | Meerdere gele knoppen naast elkaar |
| Disabled = gestippeld | Disabled = alleen doorzichtig |
| Nieuwe waarde? Eerst een token toevoegen | Losse hex of px in een component |
| Illustratie of icoon uit de sprite | Emoji |
| Lijsten die pollen via `setHtml()` (alleen bij wijziging) | Elke 2 seconden `innerHTML` herschrijven (tikken vallen weg) |
| Meldingen in `.alerts`, niet-blokkerend | Een sheet die vanzelf openspringt |
