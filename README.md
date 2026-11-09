# 🕴️ Zwarte Markt

Een locatie-gebaseerd **handels- en blufspel** voor de stad — onderdeel van [Ravotters](https://ravotters.nl).

Jullie zijn smokkelaars. Reis fysiek door de stad langs **markten** (echte plekken op de kaart), koop goederen goedkoop in en verkoop ze duur door. Prijzen schommelen live. Wie na de tijd de rijkste smokkelaar is, wint.

Geen app, geen account — join op je telefoon met een **lobbycode van 6 tekens**.

## Spelen
1. Eén speler maakt een lobby en zet 2–6 **markten** op de kaart (speelgebied).
2. Anderen joinen met de code. Iedereen start met gelijk startkapitaal.
3. Loop naar een markt (GPS-check), koop & verkoop. Arbitrage tussen markten = winst.
4. Timer loopt af → bezit wordt verzilverd → **rijkste wint**.

## Techniek
- Front-end: HTML + vanilla JS + CSS (mobile-first, Ravotters-huisstijl). Tokens en componenten staan in [`DESIGN.md`](DESIGN.md).
- Kaart: **Leaflet** + OpenStreetMap + GPS.
- Realtime multiplayer: **Firebase Realtime Database** via REST + polling.
- Hosting: **Vercel** → later op `zwartemarkt.ravotters.nl`.

### Firebase instellen
1. Maak een Firebase-project + Realtime Database (regio `europe-west1`).
2. Zet de regels uit [`database.rules.json`](database.rules.json) (per-lobby toegang, geen wereldwijde lijst-leesrechten).
3. Vul de database-URL in bovenaan [`script.js`](script.js) bij `const DB_URL`.
4. Laat `DB_URL` leeg (`''`) voor **lokale testmodus** (solo, zonder Firebase).

## Status
- ✅ **MVP v1**: lobby, markten met live schommelende prijzen, kopen/verkopen, inventaris + kapitaal, timer, winnaar. End-to-end getest.
- ⬜ v2: bluf-laag (geheime tips echt/nep, doorverkopen, marktschokken/events).
- ⬜ v3: risico (risicovolle zendingen, douane-ronde).
- ⬜ v4: verborgen rol (de Oplichter + eind-onthulling/stemming).

## Beveiliging
- Firebase-regels staan per-lobby dicht; je kunt lobby's niet opsommen (geen root-leesrechten), alleen benaderen met een exacte 6-teken-code.
- Geen persoonsdata; geen uploads in v1.
