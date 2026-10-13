# Zeitkonto- und Verrechnungsregeln

Alle Werte werden bei jeder Anzeige **aus den gespeicherten Zeitstempeln neu berechnet**
(`app/js/core/calc.js`). Gespeichert werden nur Rohdaten (Zeitstempel, Dauern, Tagesangaben,
Korrekturen, Einstellungen). Dadurch kann es keine widersprüchlichen Zwischenstände geben, und
jede Korrektur wirkt sofort konsistent auf alle Folgetage.

## Die fünf Größen – strikt getrennt

| Größe | Bedeutung | Wird verändert durch |
|---|---|---|
| **Nettoarbeitszeit** | Anwesenheit − erfasste Pausen − ggf. automatische Pause, minutengenau | nur durch die Zeitstempel |
| **Angerechnete Zeit** | Für die Abrechnung angerechneter Anteil (z. B. volle Viertelstunden) | Verrechnungsregel |
| **Tagesdifferenz** | Angerechnete Zeit − Soll | Soll, Verrechnung |
| **Rest (Übertrag)** | Noch nicht angerechnete Minuten, die erhalten bleiben | Verrechnungsregel |
| **Saldo** | Anfangssaldo + Σ Tagesdifferenzen + Σ Korrekturen + Σ Monatsend-Gutschriften | alles oben + Korrekturen |

Die Nettoarbeitszeit wird **nie** durch eine Rundung überschrieben – sie bleibt immer sichtbar.

## Arbeitszeitplan und Verrechnungskonto (minutengenau)

Je Wochentag gibt es einen **Arbeitszeitplan**: Soll-Beginn, Soll-Ende und eine **feste Pause**
(Standard Mo–Fr 08:45–17:15, Pause 12:00–12:30). Das Soll des Tages ist Ende − Beginn − Pause.
Pläne haben – wie früher die Sollzeiten – ein „gültig ab“-Datum (`app/js/core/schedule.js`).

Zu jedem Zeitpunkt *t* wird verglichen:

```
Plan bis t    = geplante Arbeitszeit von Soll-Beginn bis t (ohne die feste Planpause)
Abweichung(t) = Netto bis t − Plan bis t
```

| Situation (Plan 08:45–17:15, Pause 12:00–12:30) | Abweichung |
|---|---|
| 08:50, noch nicht eingestempelt | −0:05 |
| um 08:47 eingestempelt | −0:02 (bleibt so, solange im Plan gearbeitet wird) |
| Pause 12:10–12:40 statt 12:00–12:30 | 12:20: +0:10 · 12:35: +0:05 · 12:40: ±0 |
| Feierabend 17:17 nach Ankunft 08:47 | ±0:00 |

Am Tagesende gilt immer **Abweichung = Netto − Soll**. Die Tagesansicht schlüsselt sie auf:
Beginn gegen Plan + Ende gegen Plan + (Planpause − tatsächliche Pausen und Lücken).

Das **Verrechnungskonto (minutengenau)** = Anfangssaldo + Σ (Netto − Soll) + Σ Korrekturen,
auf „Heute“ zusätzlich inklusive der Live-Abweichung des laufenden Tages. „Für ±0 gehen um“
zeigt, wann man gehen kann, um heute bzw. inklusive Konto auszugleichen (Annahme: die restliche
Planpause wird wie geplant genommen).

Daneben bleibt das **Zeitkonto in vollen Viertelstunden** (siehe unten). Es gilt stets
`Verrechnungskonto = Saldo + Rest` (bei den Restregeln „übertragen“ und „gutschreiben“).
Beispiel: 3 Tage je 2 Minuten zu spät → Verrechnungskonto −0:06 = Saldo −0:15 + Rest 0:09.

Tage ohne Plan (Wochenende, Abwesenheit, individuelle Sollzeit) haben keine Live-Abweichung;
dort zeigt „Heute“ nur, wie viel bis zum Soll noch fehlt.

## Verrechnungsarten

### 1. „Volle Intervalle anrechnen, Rest übertragen“ (Standard, Intervall 15 min)

Für jeden **gezählten** Tag in chronologischer Reihenfolge:

```
verfügbar   = Netto + Rest_Vortag
angerechnet = floor(verfügbar / Intervall) × Intervall
Rest_neu    = verfügbar − angerechnet          (0 ≤ Rest < Intervall)
Differenz   = angerechnet − Soll
```

Ein angesammelter Rest wird also genau in dem Moment zu einer vollen Viertelstunde, in dem
Rest + Tageszeit eine weitere volle Viertelstunde ergeben – und zwar am nächsten gezählten Tag.

**Beispiel (Soll 7:30, drei Tage mit je 7:40 netto):**

| Tag | Netto | Rest vorher | verfügbar | angerechnet | Rest danach | Differenz |
|---|---|---|---|---|---|---|
| 1 | 7:40 | 0:00 | 7:40 | 7:30 | 0:10 | ±0:00 |
| 2 | 7:40 | 0:10 | 7:50 | 7:45 | 0:05 | +0:15 |
| 3 | 7:40 | 0:05 | 7:45 | 7:45 | 0:00 | +0:15 |

Summe netto 23:00 = Summe angerechnet 23:00 + Rest 0:00 → **keine Minute verloren, keine doppelt**.

Invariante (automatisch geprüft, auch mit Zufallsdaten):
`Σ angerechnet + Rest = Σ netto` und `netto + Rest_vorher = angerechnet + Rest_nachher + verfallen`.

**Restregel am Monatsende** (einstellbar):

- *Rest unbegrenzt übertragen* (Standard) – der Rest wandert in den nächsten Monat.
- *Rest am Monatsende minutengenau gutschreiben* – der Rest wird am letzten Tag des Monats
  zum Saldo addiert (sichtbar als „Monatsabschluss-Gutschrift“).
- *Rest am Monatsende verfallen lassen* – nur auf ausdrücklichen Wunsch; die verfallenen
  Minuten werden in Tagesansicht und Zeitkonto als „verfallen“ ausgewiesen.

Der Monatsabschluss erfolgt erst, wenn der Monat vollständig vergangen ist.

### 2. „Minutengenau“

Angerechnet = Netto. Kein Rest.

### 3. „Abrunden, Reste verfallen“

Angerechnet = auf das Intervall abgerundetes Netto; der Rest verfällt **sichtbar**
(Spalte „Verfallen“, Summe im Zeitkonto). Nur verwenden, wenn der Arbeitgeber so abrechnet.

Weitere Regeln lassen sich in `app/js/core/rounding.js` als Strategie ergänzen. Jede Strategie
muss die Invariante `netto + Rest_vorher = angerechnet + Rest_nachher + verfallen` erfüllen –
das wird zur Laufzeit geprüft.

## Welche Tage zählen?

Der Verlauf beginnt am **Kontobeginn** (Einstellungen) und läuft bis heute.

| Tagesstatus | Zählt? |
|---|---|
| Vollständig (alle Phasen beendet, keine Fehler) | ja – auch heute, sobald Feierabend gebucht ist |
| Vergangen, ohne Buchung | ja, mit Netto 0 (= −Soll), sofern „Tage ohne Buchung zählen“ aktiv ist |
| Heute ohne Buchung | nein (erst nach Tagesende) |
| Läuft (offene Phase, jünger als 24 h) | nein – wird als **vorläufige Vorschau** angezeigt |
| Unvollständig (offene Phase älter als 24 h, „Feierabend vergessen“) | nein – wird gemeldet |
| Fehlerhaft (Überschneidungen, Pause außerhalb der Arbeitszeit, …) | nein – wird gemeldet |
| Zukunft / vor Kontobeginn | nein |

Unvollständige und fehlerhafte Tage erscheinen als Warnung auf „Heute“ und im Zeitkonto,
damit sie nicht unbemerkt fehlen. Nach der Korrektur werden sie automatisch eingerechnet;
der Rest-Übertrag aller Folgetage wird dabei neu berechnet.

## Sollzeit

Reihenfolge: individuelle Sollzeit des Tages → Tagesart (Urlaub, Krank, Feiertag, Frei = 0) →
gültige Wochentagsregel. Sollzeit-Regeln haben ein **„gültig ab“**-Datum; eine Änderung wirkt
nur auf Tage ab diesem Datum. „Freizeitausgleich“ behält das Soll (der freie Tag wird vom
Konto abgezogen).

## Tageswechsel, Mitternacht, Sommerzeit

- Eine Arbeitsphase gehört zu dem **Kalendertag, an dem sie begonnen hat** (Nachtschicht-Regel).
  Pausen gehören zum Tag ihrer Arbeitsphase.
- Dauern werden aus absoluten Zeitstempeln (UTC-Millisekunden) berechnet. Eine Nachtschicht
  22:00–06:00 dauert beim Wechsel auf Sommerzeit 7 h, beim Wechsel auf Winterzeit 9 h – also
  die tatsächlich gearbeitete Zeit.
- Der Kalendertag wird beim Stempeln in der Zeitzone des Geräts bestimmt und gespeichert.
- Kalenderarithmetik (nächster Tag, Monatsende) erfolgt zeitzonenunabhängig.
- Stempelzeiten werden auf die Minute abgeschnitten (so, wie die Uhr sie anzeigt).
- Bei manueller Eingabe einer in der Sommerzeit-Umstellung nicht existierenden Uhrzeit
  (z. B. 02:30 am Umstellungstag) verschiebt der Browser sie auf die nächste gültige Zeit.

## Automatische Pause

Standardmäßig **aus**. Wenn aktiviert: Bei mehr als 6 h Arbeit werden fehlende Minuten bis
30 min, bei mehr als 9 h bis 45 min abgezogen – höchstens so viel, dass die Arbeitszeit nicht
unter die Schwelle fällt (6:10 ohne Pause → 0:10 Abzug). Der Abzug wird nicht gespeichert,
sondern berechnet und überall separat als „automatisch“ ausgewiesen.

## Korrekturen

- **Zeitstempel** können jederzeit bearbeitet, ergänzt oder gelöscht werden. Jede manuelle
  Änderung wird mit Vorher/Nachher und optionaler Begründung im Änderungsprotokoll des Tages
  gespeichert. Ungültige Änderungen (Überschneidungen, Ende vor Beginn, Pause außerhalb der
  Arbeitszeit, zweite offene Phase) werden abgelehnt.
- **Kontokorrekturen** (z. B. ausgezahlte Überstunden) haben Datum, Minuten (±) und eine
  Pflicht-Begründung. Sie wirken direkt und ohne Rundung auf den Saldo.
- Änderungen an den Verrechnungsregeln wirken auf den gesamten Verlauf (weil alles abgeleitet
  wird); die App weist vor dem Speichern darauf hin. Sollzeiten sind dagegen datumsbezogen.
