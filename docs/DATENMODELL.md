# Datenmodell und Speicherung

## Speicherort

Alle Daten liegen in der **IndexedDB-Datenbank `arbeitszeit`** des Browsers auf dem Gerät –
gebunden an die Adresse (Origin), unter der die App geöffnet wurde. Es gibt keinen Server.
`localStorage` wird nicht verwendet. Der Service Worker speichert nur die App-Dateien, keine Daten.

## Object Stores (Schema-Version 1)

Alle Datensätze außer `kv` haben gemeinsame Felder für spätere Synchronisierung:

| Feld | Bedeutung |
|---|---|
| `id` | eindeutige ID (UUID v4; bei Tagesangaben `day:YYYY-MM-DD`) |
| `rev` | Revision, steigt bei jeder Änderung um 1 |
| `createdAt`, `updatedAt` | Epoch-ms; `updatedAt` steigt streng monoton |
| `deleted` | Löschkennzeichen (Tombstone) – gelöschte Einträge bleiben zur Synchronisierung erhalten |

### `intervals` – Arbeitsphasen und Pausen (Index: `day`)

| Feld | Typ | Bedeutung |
|---|---|---|
| `kind` | `"work"` \| `"break"` | Arbeitsphase oder Pause |
| `day` | `YYYY-MM-DD` | Kalendertag, zu dem der Eintrag gehört (Tag des Beginns) |
| `start` | Epoch-ms \| `null` | Beginn (bei Pause „nur Dauer“: `null`) |
| `end` | Epoch-ms \| `null` | Ende; `null` = läuft noch |
| `durationMin` | Integer \| `null` | nur für Pausen ohne Uhrzeit |
| `source` | `"clock"` \| `"manual"` | gestempelt oder manuell eingetragen |
| `note` | Text | optional |
| `startRound`, `endRound` | `"down"` \| `"up"` \| `null` | gewählte Viertelstunde je Stempel; `null` = nächstgelegene |

Der aktuelle Stempelzustand (nicht eingestempelt / Arbeit / Pause) wird **nicht gespeichert**,
sondern aus offenen Intervallen abgeleitet (`core/state.js`). Es darf höchstens eine offene
Arbeitsphase geben; das wird innerhalb der Schreibtransaktion geprüft.

### `dayInfos` – Angaben je Tag

`day`, `dayType` (`arbeit`, `urlaub`, `krank`, `feiertag`, `frei`, `ausgleich`),
`targetOverrideMin` (aus Version 1.0, nicht mehr verwendet), `note`.

### `activities` – Tätigkeitsprotokoll (Index: `day`)

`day`, `title`, `description`, `minutes` (Integer), `intensity` (`niedrig`/`mittel`/`hoch`/`null`),
`category` (Text oder `null`).

### `corrections` – Kontokorrekturen

`day`, `minutes` (Integer, ±), `reason` (Pflicht).

### `audit` – Änderungsprotokoll (Index: `day`)

`at`, `entity`, `entityId`, `day`, `action` (`create`/`update`/`delete`/`undo`), `reason`,
`before`, `after` (vollständige Datensätze).

### `kv` – Einstellungen und Metadaten

- `settings`: `accountStart`, `startBalanceMin`, `rounding.interval` (Buchungsraster in Minuten),
  `autoBreak`, `theme`, `backupReminderDays`, `report` (`name`, `trainingStart` für den
  Ausbildungsnachweis). Felder früherer Versionen (`targetRules`, `countEmptyDays`,
  `rounding.mode`, `rounding.carryRule`) werden beim Laden entfernt.
- `meta`: `deviceId`, `createdAt`, `lastChangeAt`, `lastExportAt`, `lastExportName`,
  `lastImportAt` (Backup-/Synchronisationsstatus).

## Abgeleitete Werte (nicht gespeichert)

Gestempelte und gebuchte Arbeitszeit, Pausensummen, Differenzminuten, Zeitkonto, Tagesstatus – siehe
[ZEITKONTO.md](ZEITKONTO.md).

## Einheiten

Zeitpunkte: Epoch-Millisekunden (Integer). Dauern: ganze Minuten (Integer). Keine Gleitkommawerte.

## Transaktionen und Fehlersicherheit

- Jede Änderung (inkl. Prüfung, Änderungsprotokoll und `lastChangeAt`) läuft in **einer**
  IndexedDB-Transaktion mit `durability: "strict"`. Erst nach `oncomplete` meldet die App Erfolg.
- Schlägt etwas fehl (Prüfung, Speicher voll, Absturz), wird die Transaktion abgebrochen –
  es wird nichts halb geschrieben. Die App zeigt „Änderung wurde NICHT gespeichert“.
- Import „Ersetzen“ läuft in einer einzigen Transaktion über alle Stores: entweder alles oder nichts.

## Migrationen

- **Datenbank**: `DB_VERSION` in `app/js/db/db.js`. Für eine neue Version eine Funktion
  `MIGRATIONS[n](db, tx)` ergänzen. Sie läuft in der `versionchange`-Transaktion; bricht sie
  ab, bleibt die alte Datenbank unverändert. Andere offene Tabs werden zum Neuladen aufgefordert.
- **Sicherungsdateien**: `schemaVersion` im Backup; `MIGRATIONS` in `core/backup-format.js` hebt
  ältere Sicherungen beim Import auf das aktuelle Format. Sicherungen einer *neueren* Version
  werden abgelehnt.

## Backup-Format

```json
{
  "format": "arbeitszeit-backup",
  "schemaVersion": 1,
  "appVersion": "1.0.0",
  "exportedAt": "2026-10-13T15:30:00.000Z",
  "deviceId": "…",
  "data": { "settings": {}, "intervals": [], "dayInfos": [], "activities": [], "corrections": [], "audit": [] },
  "checksum": "sha256:…"
}
```

Die Prüfsumme (SHA-256 über `data`) erkennt nachträglich veränderte Dateien. Beim Import werden
Struktur, Typen, Datumsangaben, IDs (inkl. Duplikaten) und Einstellungen geprüft; bei einem
einzigen Fehler wird **nichts** importiert.

**Zusammenführen** (statt Ersetzen) vergleicht je Datensatz-ID: neue werden übernommen,
identische ignoriert, bei Abweichung gewinnt die Version mit dem jüngeren `updatedAt`; lokal
neuere Einträge bleiben erhalten. Die Vorschau zeigt vor dem Import, wie viele Einträge
jeweils betroffen sind. Löschungen werden über Tombstones übertragen. Entstehen dadurch
Überschneidungen (z. B. derselbe Tag auf zwei Geräten gestempelt), wird der Tag als
„fehlerhaft“ markiert und **nicht doppelt gezählt**, bis er korrigiert ist.
