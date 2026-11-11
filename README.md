# Zwarte Markt

Een locatie-gebaseerd **handels- en blufspel** voor de stad, onderdeel van [Ravotters](https://ravotters.nl). Live op [zwartemarkt.ravotters.nl](https://zwartemarkt.ravotters.nl).

Jullie zijn smokkelaars. Reis fysiek door de stad langs **markten** (echte plekken op de kaart), koop goederen goedkoop in en verkoop ze duur door. Prijzen schommelen live, de markt fluistert je geheime tips in (echt of nep) en invallen of tekorten zetten alles op zijn kop. Wie na de tijd de rijkste smokkelaar is, wint.

Geen app, geen account: join op je telefoon met een **lobbycode van 6 tekens**.

## Spelen
1. Eén speler maakt een lobby en zet 2–6 **markten** op de kaart (zoeken op adres kan ook).
2. Anderen joinen met de code. Iedereen start met gelijk startkapitaal.
3. Loop naar een markt (GPS-check), koop en verkoop. Arbitrage tussen markten = winst.
4. Geen GPS? Zet je plek handmatig (op de kaart tikken of adres zoeken), als de host dat toestaat. De anderen zien dat in de stand.
5. **Bluffen:** je krijgt af en toe een geheime tip ("prijs van munten bij De Loods gaat omhoog"). Ongeveer de helft is echt. Verkoop tips aan medespelers, of verzin er zelf een en verkoop hem als echt.
6. **Marktschokken:** een *inval* laat een goed op één markt instorten, een *tekort* laat de prijs exploderen. Wie de juiste tip had, casht.
7. **Risico** (tabbladen in het marktscherm):
   - *Zending:* bestel voor de halve prijs. Na 3 minuten in je koffer, met 60% kans. Een inval op dat goed bij die markt terwijl de zending onderweg is? Zeker weg.
   - *Douane:* smokkel waar uit je koffer. 65% kans op 1,8× de gemiddelde prijs; gepakt = waar kwijt en de hele stad hoort het. Daarna 4 minuten wachten.
8. Timer loopt af, bezit wordt verzilverd, de **rijkste wint**.

### Teams
De host kiest bij de regels: ieder voor zich, of teams van 2, 3 of 4.
- Wie binnenkomt, gaat naar het kleinste team. In de lobby kun je zelf wisselen; de host kan hussellen.
- Ieder houdt een eigen kas en koffer. De teamwaarde is de som; het rijkste team wint.
- Teamgenoten kunnen elkaar overal geld en goederen geven, en een geheime tip gratis delen.
- Teamgenoten zie je als gekleurd rondje op de kaart.

## Techniek
- Front-end: HTML + vanilla JS + CSS (mobile-first, Ravotters-huisstijl). Tokens, componenten en illustraties staan in [`DESIGN.md`](DESIGN.md).
  - [`script.js`](script.js): kern (lobby, kaart, handel, prijzen, host-loop, sync)
  - [`location.js`](location.js): GPS en handmatige locatie (kaart / adres via OpenStreetMap Nominatim)
  - [`bluff.js`](bluff.js): tips, tips verkopen/verzinnen/delen, marktschokken, nieuws
  - [`teams.js`](teams.js): teamindeling, teamstand, geven, teamgenoten op de kaart
  - [`risk.js`](risk.js): zendingen en de douane
- Kaart: **Leaflet** + OpenStreetMap.
- Realtime multiplayer: **Firebase Realtime Database** via REST + polling. De host-telefoon rekent prijzen, schokken en tips uit.
- Hosting: **Vercel**, auto-deploy vanaf `master`.

### Firebase instellen
1. Firebase-project + Realtime Database (regio `europe-west1`).
2. Regels uit [`database.rules.json`](database.rules.json) deployen: `firebase deploy --only database`.
3. Database-URL staat bovenaan [`script.js`](script.js) bij `const DB_URL`. Leeg (`''`) = lokale testmodus (solo, zonder Firebase).

## Status
- ✅ **v1**: lobby, markten met live prijzen, kopen/verkopen, koffer + kapitaal, timer, winnaar.
- ✅ **v2**: geheime tips (echt/nep), tips verkopen, tips verzinnen, marktschokken (inval/tekort) met nieuws, handmatige locatie, eigen illustraties.
- ✅ **v3**: risico (zendingen, douane) en teams (2, 3 of 4).
- ⬜ v4: verborgen rol (de Oplichter + eind-onthulling/stemming).

## Beveiliging en privacy
- Firebase-regels staan per lobby dicht: lobby's zijn niet op te sommen, alleen te benaderen met een exacte 6-teken-code.
- Het schokkenplan staat alleen in het geheugen van de host, dus niet in de database. Tips en aanbiedingen staan wel in de lobby-data: een speler met ontwikkelaarstools zou kunnen spieken. Voor een feestspel onder vrienden is dat acceptabel; echte afscherming vraagt een server (latere versie).
- In teamspel deelt je telefoon je plek met de lobby, zodat teamgenoten je op de kaart zien. Dat gebeurt alleen tijdens het spel en wordt bij het einde gewist.
- Lobby's worden nog niet automatisch opgeruimd uit de database (vraagt een server-taak met een Firebase-sleutel). Er staat niets in behalve bijnamen en spelstanden.
- Wie de pagina herlaadt, is zijn plek in het potje kwijt (nog geen sessieherstel).
- Geen persoonsdata behalve een zelfgekozen bijnaam. Een adres dat je intypt om je plek te zoeken gaat naar OpenStreetMap (Nominatim) en wordt niet door ons opgeslagen; alleen de coördinaten blijven op je telefoon.
