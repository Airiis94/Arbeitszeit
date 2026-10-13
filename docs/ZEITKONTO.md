# Viertelstunden-Buchung und Zeitkonto

Alle Werte werden bei jeder Anzeige **aus den gespeicherten Stempelzeiten neu berechnet**
(`app/js/core/booking.js`, `app/js/core/calc.js`). Gespeichert werden nur Rohdaten: die minutengenau
gestempelten Zeiten, optional die gewählte Rundungsrichtung je Stempel, Tagesangaben, Korrekturen
und Einstellungen.

## Gestempelt und gebucht

- **Gestempelt** wird minutengenau (Sekunden werden abgeschnitten). Diese Zeiten werden nie verändert.
- **Gebucht** wird jede Stempelzeit auf die **nächstgelegene volle Viertelstunde** (Raster in den
  Einstellungen: 5, 10, 15, 20, 30 oder 60 Minuten; Standard 15). Bei 15 Minuten: bis :07 nach einer
  Viertelstunde wird abgerundet, ab :08 aufgerundet. Das gilt für Kommen, Gehen, Pausenbeginn und
  Pausenende; Pausen ohne Uhrzeit werden als Dauer gerundet (20 min → 15 min, 23 min → 30 min).
- In Zeiterfassung, Kalender, Wochenübersicht, CSV und **Ausbildungsnachweis** stehen die
  **gebuchten** Zeiten. Die gebuchte Arbeitszeit ist damit immer ein Viertelstundenwert.
- **Umschalten:** Ein Tipp auf eine Zeit in der Buchungsliste bucht die andere Viertelstunde
  (z. B. 08:50 → 09:00 statt 08:45). Gespeichert wird nur die Richtung (`startRound`/`endRound` =
  `down`/`up`); ein zweiter Tipp stellt wieder die nächstgelegene her.

## Zeitkonto

Das Zeitkonto enthält **ausschließlich die Differenzminuten** zwischen gestempelter und gebuchter Zeit:

| Stempel | gestempelt | gebucht | Konto | Begründung |
|---|---|---|---|---|
| Kommen | 08:50 | 08:45 | −0:05 | gebucht wird mehr Arbeit, als geleistet wurde |
| Kommen | 08:42 | 08:45 | +0:03 | geleistet, aber nicht gebucht |
| Gehen | 17:49 | 17:45 | +0:04 | geleistet, aber nicht gebucht |
| Gehen | 17:53 | 18:00 | −0:07 | gebucht, aber nicht geleistet |
| Pausenbeginn | 12:03 | 12:00 | +0:03 | Pause früher gebucht → weniger Arbeit gebucht |
| Pausenende | 12:31 | 12:30 | −0:01 | Pause früher beendet gebucht → mehr Arbeit gebucht |
| Kommen (umgeschaltet) | 08:50 | 09:00 | +0:10 | bewusst später gebucht |

```
Zeitkonto = Anfangssaldo + Σ Differenzminuten + Σ Korrekturen
```

Je Tag gilt (ohne automatische Pause): **gestempelte Arbeitszeit − gebuchte Arbeitszeit = Σ Differenzen**.
Das wird automatisch geprüft (auch mit Zufallsdaten).

- Es gibt **keine Sollzeit**. Ob ein Tag 4 oder 9 Stunden hat, verändert das Konto nicht.
- Stempel zählen sofort: Wer um 08:50 einstempelt, sieht direkt −0:05.
- Gezählt werden alle Tage ab dem **Kontobeginn** (Einstellungen) bis heute.
- **Korrekturen** (Datum, ±Minuten, Pflicht-Begründung) wirken direkt auf das Konto.
- Unvollständige oder fehlerhafte Tage (z. B. Feierabend vergessen) werden als Warnung gemeldet;
  ihre bereits vorhandenen Stempel zählen trotzdem.

## Ausgleichen

„**Ausgleichen: gehen um …**“ auf *Heute* schlägt die nächste Gehzeit vor, mit der das Konto
möglichst auf ±0 kommt. Beispiel: Konto −0:05 → um 16:20 gehen wird als 16:15 gebucht (+0:05).
Konto +0:03 → um 16:12 gehen wird als 16:15 gebucht (−0:03). Mit der nächstgelegenen Buchung
gleicht ein Stempel höchstens ±7 Minuten aus; mit Umschalten bis zu 14 Minuten.

## Tageswechsel, Mitternacht, Sommerzeit

- Eine Arbeitsphase gehört zu dem **Kalendertag, an dem sie begonnen hat** (Nachtschicht-Regel).
  Pausen gehören zum Tag ihrer Arbeitsphase.
- Dauern werden aus absoluten Zeitstempeln berechnet: Eine Nachtschicht 22:00–06:00 dauert beim
  Wechsel auf Sommerzeit 7 h, beim Wechsel auf Winterzeit 9 h.
- Das Viertelstundenraster folgt der lokalen Uhrzeit des Geräts.

## Automatische Pause

Standardmäßig **aus**. Wenn aktiviert: Bei mehr als 6 h Arbeit werden fehlende Minuten bis 30 min,
bei mehr als 9 h bis 45 min abgezogen – höchstens so viel, dass die Arbeitszeit nicht unter die
Schwelle fällt. Der Abzug wird separat ausgewiesen und verändert das Zeitkonto nicht.
