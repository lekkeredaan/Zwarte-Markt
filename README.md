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
7. Timer loopt af, bezit wordt verzilverd, de **rijkste wint**.

## Techniek
- Front-end: HTML + vanilla JS + CSS (mobile-first, Ravotters-huisstijl). Tokens, componenten en illustraties staan in [`DESIGN.md`](DESIGN.md).
  - [`script.js`](script.js): kern (lobby, kaart, handel, prijzen, host-loop, sync)
  - [`location.js`](location.js): GPS en handmatige locatie (kaart / adres via OpenStreetMap Nominatim)
  - [`bluff.js`](bluff.js): tips, tips verkopen/verzinnen, marktschokken, nieuws
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
- ⬜ v3: risico (risicovolle zendingen, douane-ronde).
- ⬜ v4: verborgen rol (de Oplichter + eind-onthulling/stemming).

## Beveiliging en privacy
- Firebase-regels staan per lobby dicht: lobby's zijn niet op te sommen, alleen te benaderen met een exacte 6-teken-code.
- Het schokkenplan staat alleen in het geheugen van de host, dus niet in de database. Tips en aanbiedingen staan wel in de lobby-data: een speler met ontwikkelaarstools zou kunnen spieken. Voor een feestspel onder vrienden is dat acceptabel; echte afscherming vraagt een server (latere versie).
- Geen persoonsdata behalve een zelfgekozen bijnaam. Een adres dat je intypt om je plek te zoeken gaat naar OpenStreetMap (Nominatim) en wordt niet door ons opgeslagen; alleen de coördinaten blijven op je telefoon.
