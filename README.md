# Zwarte Markt

Een locatie-gebaseerd **handels- en blufspel** voor de stad, onderdeel van [Ravotters](https://ravotters.nl). Live op [zwartemarkt.ravotters.nl](https://zwartemarkt.ravotters.nl).

Jullie zijn smokkelaars. Reis fysiek door de stad langs **markten** (echte plekken op de kaart), koop goederen goedkoop in en verkoop ze duur door. Prijzen schommelen live, de markt fluistert je geheime tips in (echt of nep) en invallen of tekorten zetten alles op zijn kop. Wie na de tijd de rijkste smokkelaar is, wint.

Geen app, geen account, geen activatiecode: join op je telefoon met een **lobbycode van 6 tekens**.

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
8. **De Oplichter** (vanaf 3 spelers, uit te zetten bij de regels): één speler is stiekem de Oplichter. Zie hieronder.
9. Timer loopt af, bezit wordt verzilverd, de **rijkste wint**.

### De Oplichter
- Bij de start wijst het spel willekeurig één speler aan. Iedereen bekijkt zijn rol via het maskerknopje bovenin.
- **Zakkenrollen:** de Oplichter kan bij een markt een speler rollen die daar in de laatste 2 minuten was: 15% van diens cash, hooguit €150. Goederen in de koffer zijn veilig. Daarna 3 minuten wachten.
- **Voorkennis:** bij de tips die de markt de Oplichter influistert staat of ze echt of nep zijn.
- Wie gerold is, krijgt een melding. In het marktnieuws staat wie er gerold is en bij welke markt, niet door wie. Wie stond daar toen nog meer?
- **Stemming:** na de speeltijd stemt iedereen één minuut wie de Oplichter was. Goed gestemd levert €100 op.
- **Onthulling:** kreeg de Oplichter meer stemmen dan wie dan ook, dan is hij ontmaskerd en gaat de buit terug naar de slachtoffers. Anders ontsnapt hij en krijgt hij €250 extra. Bij gelijke stand ontsnapt hij.

### Teams
De host kiest bij de regels: ieder voor zich, of teams van 2, 3 of 4.
- Wie binnenkomt, gaat naar het kleinste team. In de lobby kun je zelf wisselen; de host kan hussellen.
- Ieder houdt een eigen kas en koffer. De teamwaarde is de som; het rijkste team wint.
- Teamgenoten kunnen elkaar overal geld en goederen geven, en een geheime tip gratis delen.
- Teamgenoten zie je als gekleurd rondje op de kaart.

### Herladen en terugkomen
Pagina ververst, of je telefoon heeft het tabblad herladen? Je komt vanzelf terug in je potje, met dezelfde kas, koffer, tips en zendingen. Was het tabblad dicht, dan staat er op het startscherm een knop **Verder spelen**. Dat werkt tot een dag na het potje, op hetzelfde toestel en in dezelfde browser.

### In je eentje testen
Open het spel in twee vensters: één gewoon en één privé/incognito (of telefoon + laptop). Maak in het ene een lobby en doe in het andere mee met de code. Zet bij de regels *Handmatige locatie* aan en kies een korte speeltijd; dan spring je met een tik op de kaart van markt naar markt. Gebruik niet "tabblad dupliceren": dan krijgen beide tabbladen dezelfde speler.

## Techniek
- Front-end: HTML + vanilla JS + CSS (mobile-first, Ravotters-huisstijl). Tokens, componenten en illustraties staan in [`DESIGN.md`](DESIGN.md).
  - [`script.js`](script.js): kern (lobby, kaart, handel, prijzen, host-loop, sync)
  - [`location.js`](location.js): GPS en handmatige locatie (kaart / adres via OpenStreetMap Nominatim)
  - [`bluff.js`](bluff.js): tips, tips verkopen/verzinnen/delen, marktschokken, nieuws
  - [`teams.js`](teams.js): teamindeling, teamstand, geven, teamgenoten op de kaart
  - [`risk.js`](risk.js): zendingen en de douane
  - [`swindle.js`](swindle.js): de Oplichter (rol, zakkenrollen, stemming, onthulling)
  - [`session.js`](session.js): terugkomen in je potje na herladen (opslag op het eigen toestel)
- Server: één Vercel-functie, [`api/cleanup.js`](api/cleanup.js), die dagelijks oude lobby's opruimt.
- Kaart: **Leaflet** + OpenStreetMap.
- Realtime multiplayer: **Firebase Realtime Database** via REST + polling. De host-telefoon rekent prijzen, schokken en tips uit.
- Hosting: **Vercel**, auto-deploy vanaf `master`.

### Firebase instellen
1. Firebase-project + Realtime Database (regio `europe-west1`).
2. Regels uit [`database.rules.json`](database.rules.json) deployen: `firebase deploy --only database`.
3. Database-URL staat bovenaan [`script.js`](script.js) bij `const DB_URL`. Leeg (`''`) = lokale testmodus (solo, zonder Firebase).

### Opruimtaak instellen (eenmalig)
[`api/cleanup.js`](api/cleanup.js) draait elke nacht om 04:00 UTC (cron in [`vercel.json`](vercel.json)) en verwijdert:
- een gespeeld potje, 24 uur na de eindtijd;
- een lobby die nooit gestart is, 24 uur na het aanmaken.

Daarvoor staan twee geheimen in Vercel (Project → Settings → Environment Variables, alleen Production), nooit in de code:
- `FIREBASE_SERVICE_ACCOUNT`: de sleutel uit de Firebase-console (Projectinstellingen → Serviceaccounts → *Nieuwe privésleutel genereren*). Plak de hele inhoud van het JSON-bestand. Daarna opnieuw deployen.
- `CRON_SECRET`: willekeurige tekst. Vercel stuurt die zelf mee met de cron; zonder het juiste geheim weigert de functie (401).

Proefdraaien zonder iets weg te gooien: `/api/cleanup?dry=1` (met de header `Authorization: Bearer <CRON_SECRET>`).

## Status
- ✅ **v1**: lobby, markten met live prijzen, kopen/verkopen, koffer + kapitaal, timer, winnaar.
- ✅ **v2**: geheime tips (echt/nep), tips verkopen, tips verzinnen, marktschokken (inval/tekort) met nieuws, handmatige locatie, eigen illustraties.
- ✅ **v3**: risico (zendingen, douane) en teams (2, 3 of 4).
- ✅ Sessieherstel na herladen en automatisch opruimen van oude lobby's.
- ✅ **v4**: de Oplichter (verborgen rol, zakkenrollen, voorkennis, stemming en onthulling).

## Beveiliging en privacy
- Firebase-regels staan per lobby dicht: lobby's zijn niet op te sommen, alleen te benaderen met een exacte 6-teken-code.
- Het schokkenplan staat alleen in het geheugen van de host, dus niet in de database. Tips, aanbiedingen en wie de Oplichter is staan wel in de lobby-data: een speler met ontwikkelaarstools zou kunnen spieken. Voor een feestspel onder vrienden is dat acceptabel; echte afscherming vraagt een server (latere versie).
- In teamspel deelt je telefoon je plek met de lobby, zodat teamgenoten je op de kaart zien. Dat gebeurt alleen tijdens het spel en wordt bij het einde gewist.
- Met de Oplichter aan deelt je telefoon bij welke markt je net was (alleen de markt, geen coördinaten). Ook dat wordt bij het einde gewist.
- Bewaartermijn: lobby's worden een dag na het potje automatisch verwijderd (zie *Opruimtaak instellen*). Er staat niets in behalve bijnamen, spelstanden en, tijdens een teamspel, plekken.
- Om na herladen terug te kunnen komen, onthoudt je eigen browser de lobbycode, je bijnaam en een spelersnummer (op het toestel van de host ook het schokkenplan). Dat blijft op je toestel en verdwijnt als je het potje verlaat.
- Geen persoonsdata behalve een zelfgekozen bijnaam. Een adres dat je intypt om je plek te zoeken gaat naar OpenStreetMap (Nominatim) en wordt niet door ons opgeslagen; alleen de coördinaten blijven op je telefoon.
