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
Zwevende crème kaart onderaan de kaart: titel, geschatte waarde, knop Stand, en een horizontale rij `.item`-chips per goed.

### Markt-marker `.mk`
Druppelvormige pin met het **marktnummer** (Anton) en een inkt-naamlabel eronder. In de buurt: geel en wiebelend. Eigen positie `.me`: roze stip met crème ring.

### Overig
- `.ticket`: de lobbycode als smokkelticket (geel, roze schaduw, ponsgaten).
- `.roster` / `.standings`: pil-rijen met avatar-initiaal of rang; jezelf in geel.
- `.alert`: crème-roze melding met roze zijbalk.
- `.toast`: inkt-pil bovenin, groene of roze rand.
- `.sticker`: schuine roze label-sticker (zoals "ZES SPELLEN" op de hoofdsite).

## Do's en don'ts
| ✅ Doen | ❌ Niet doen |
|---|---|
| Inkt-tekst op groen, geel en roze | Witte tekst op groen |
| Gele of roze schaduw op de nacht | Zwarte schaduw of rand als enige afbakening op de nacht |
| Eén primaire knop per scherm | Meerdere gele knoppen naast elkaar |
| Disabled = gestippeld | Disabled = alleen doorzichtig |
| Nieuwe waarde? Eerst een token toevoegen | Losse hex of px in een component |
