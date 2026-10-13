# ⏱ Arbeitszeit – private, offlinefähige Zeiterfassung

Eine kleine, robuste Arbeitszeiterfassung als **Progressive Web App (PWA)** für Android
(und jeden anderen modernen Browser). Ohne Konto, ohne Server, ohne Werbung, ohne Tracking.
Alle Daten bleiben auf dem Gerät; Sicherung und Wiederherstellung erfolgen über eine
JSON-Datei, die du selbst verwahrst.

- **Heute**: Arbeitsbeginn, Pause, Pause beenden, Feierabend – je ein Tipp. Live-Anzeige von
  Netto, Pausen, Soll-Ist und Zeitkonto. Pausen per Schnellwahl (15/30/45/60/individuell) nachtragen.
- **Kalender**: Monats- und Wochenansicht mit Statusfarben, Tagesansicht mit allen Buchungen,
  Bearbeitung und Schritt-für-Schritt-Berechnung.
- **Tätigkeiten**: einfaches Protokoll je Tag mit Dauer, Intensität, Kategorie und Summe.
- **Zeitkonto**: Saldo mit Herleitung, Viertelstundenverrechnung mit Restübertrag, Korrekturen
  mit Begründung, Tagesverlauf.
- **Einstellungen & Sicherung**: Sollzeiten je Wochentag (mit „gültig ab“), Verrechnungsregeln,
  JSON-Export/-Import, CSV-Export, Speicherstatus.

---

## 1. Auf dem Android-Smartphone nutzen

**App öffnen:** **[https://airiis94.github.io/Arbeitszeit/](https://airiis94.github.io/Arbeitszeit/)**

Kurzanleitung für Einsteiger: **[INSTALLATION.md](INSTALLATION.md)** – dieselbe Anleitung
steht in der App oben rechts unter **„Hilfe“** (mit Knopf „App installieren“, wenn Chrome ihn anbietet).

Voraussetzung: Die App ist einmalig unter einer **HTTPS-Adresse** bereitgestellt (siehe Abschnitt 2).
Danach:

1. Adresse in **Chrome** öffnen (bei GitHub Pages: `https://<github-name>.github.io/<repository>/`).
2. Chrome-Menü **⋮ → „App installieren“** bzw. **„Zum Startbildschirm hinzufügen“** → bestätigen.
3. Die App über das neue Symbol auf dem Startbildschirm starten. Sie läuft im Vollbild wie eine
   normale App und funktioniert ab jetzt **auch ohne Internet**.
4. Einmalig: **Einstellungen → Sollarbeitszeit** prüfen (Standard 8:00 Mo–Fr) und
   **Einstellungen → Zeitkonto** (Kontobeginn, Anfangssaldo).
5. Empfohlen: **Einstellungen → „Dauerhaften Speicher anfordern“** und gleich eine erste
   Sicherung herunterladen.

Updates: Ist eine neue Version bereitgestellt, erscheint beim nächsten Öffnen (mit Internet)
oben ein Hinweis „Neue Version verfügbar – Aktualisieren“. Die Daten bleiben dabei erhalten.

## 2. Einmalige Bereitstellung (ohne Entwicklungsumgebung auf dem Handy)

Eine PWA braucht eine **sichere Webadresse (HTTPS)** – nur dann erlaubt der Browser Installation,
Service Worker (Offline-Betrieb) und dauerhaften Speicher. Eine lokal geöffnete HTML-Datei
(`file://…`) reicht dafür **nicht**: ES-Module, Service Worker und Installation funktionieren dort nicht.

Die App besteht nur aus statischen Dateien im Ordner `app/` – es gibt keinen Build-Schritt und
keine Abhängigkeiten. Jeder statische Webspace mit HTTPS genügt.

### Variante A (empfohlen): GitHub Pages – automatisch über dieses Repository

Die Pipeline `.github/workflows/pages.yml` testet die App bei jedem Push und veröffentlicht
`app/` automatisch vom **Standard-Branch** des Repositories (egal wie er heißt).
Die Service-Worker-Version wird dabei aus dem Inhalt der App berechnet, sodass installierte
Apps jede neue Version erkennen und den Hinweis „Neue Version verfügbar“ zeigen.

1. Einmalig auf github.com im Repository: **Settings → Pages → Build and deployment →
   Source: „GitHub Actions“**.
2. Unter **Actions** den Lauf „Tests und Bereitstellung“ starten (oder einen Commit pushen) und
   warten, bis er grün ist. Die Adresse steht unter Settings → Pages
   (typisch `https://<name>.github.io/<repository>/`).

Hinweis: GitHub Pages ist für **öffentliche** Repositories kostenlos; für private Repositories
ist ein kostenpflichtiger GitHub-Plan nötig. Öffentlich einsehbar ist dabei nur der
**Programmcode** – deine Arbeitszeitdaten verlassen nie das Gerät. Trotzdem gilt: **Keine
Passwörter, Zugangsdaten, Schlüssel oder eigene Arbeitszeit-Sicherungen ins Repository legen.**
Die App selbst baut keine Verbindungen zu fremden Servern auf (per Test geprüft).

### Variante B: Netlify / Cloudflare Pages / eigener Webspace

Den **Inhalt des Ordners `app/`** hochladen (bei Netlify z. B. per Drag & Drop unter
„Deploy manually“). Wichtig ist nur HTTPS. Die App funktioniert in jedem Unterverzeichnis.

### Wichtig: Die Daten gehören zur Adresse

Der Browser speichert die Daten getrennt je Adresse. Wechselst du später die Adresse
(anderer Anbieter, andere Domain), sind die Daten dort **nicht** automatisch vorhanden:
vorher **Sicherung exportieren**, unter der neuen Adresse **importieren**.

## 3. Datensicherung und Wiederherstellung

**Wo liegen die Daten?** In der IndexedDB-Datenbank des Browsers (Chrome) auf dem Handy, nur
für diese App-Adresse. Sie überstehen Neustarts, Schließen der App und Offline-Phasen.
Sie gehen **verloren**, wenn du in Chrome „Website-Daten löschen“ ausführst, Chrome
deinstallierst/zurücksetzt oder (ohne dauerhaften Speicher) der Browser bei Speichermangel
aufräumt. Deshalb:

**Sichern** – *Einstellungen → „Sicherung herunterladen (JSON)“*
- Die Datei `arbeitszeit-sicherung-JJJJ-MM-TT-HHMM.json` landet im Ordner **Downloads**.
- Mit *„Sicherung teilen“* kannst du sie direkt über das Android-Teilen-Menü an **Google Drive**,
  E-Mail, Nextcloud o. Ä. übergeben.
- Die App zeigt an, wann zuletzt gesichert wurde und ob seitdem Daten geändert wurden, und
  erinnert nach einstellbar vielen Tagen.
- Die Sicherung enthält alles: Buchungen, Pausen, Tätigkeiten, Korrekturen, Änderungsprotokoll,
  Einstellungen – plus Prüfsumme.

**Wiederherstellen** – *Einstellungen → „Sicherung importieren …“* → Datei auswählen.
- Die Datei wird vollständig geprüft (Format, Version, jeder Datensatz). Bei Fehlern wird
  **nichts** importiert und die Fehler werden angezeigt.
- Vorschau: Erstellungsdatum, Anzahl Buchungen/Tage/Tätigkeiten, Prüfsummen-Warnung.
- **Zusammenführen** (Standard): neue Einträge übernehmen, je Eintrag gewinnt die neuere Version,
  lokal neuere bleiben erhalten. **Ersetzen**: alle aktuellen Daten werden ersetzt.
- Standardmäßig wird **vorher automatisch eine Sicherung der aktuellen Daten** heruntergeladen.

**Neues Handy**: App unter derselben Adresse öffnen, installieren, Sicherung importieren.

**CSV-Export** (für Excel/LibreOffice): Arbeitstage mit allen Berechnungsspalten bzw.
Tätigkeiten – je Monat oder gesamt. CSV ist eine Auswertung, keine vollständige Sicherung.

## 4. Bewertung der Synchronisierungs-Optionen

| Option | Bewertung | Status |
|---|---|---|
| **4. Dateibasierte Sicherung** ohne Konto | Am sichersten und einfachsten; keine Zugangsdaten, kein Anbieter, volle Kontrolle. Nachteil: manuell. | **umgesetzt** |
| **1. Manuell in Google Drive o. Ä.** | Über das Android-Teilen-Menü direkt aus der App; nutzt die vorhandene Drive-App, keine Berechtigungen für die Web-App nötig. | **umgesetzt** (Teilen) |
| **2. Google-Drive-API mit OAuth 2.0** | Möglich (PKCE-Flow, `drive.appdata`-Scope), braucht aber ein Google-Cloud-Projekt mit OAuth-Zustimmungsbildschirm, Token-Verwaltung im Browser und Konfliktlogik. Hintergrund-Sync ist in einer PWA nicht zuverlässig. Mehr Angriffsfläche als Nutzen für v1. | nicht umgesetzt |
| **3. Selbst gehosteter Dienst** (z. B. CouchDB, WebDAV/Nextcloud) | Gute Datenhoheit, erfordert aber einen eigenen Server, HTTPS, CORS und Zugangsdaten. | nicht umgesetzt |

Die Architektur ist für eine spätere echte Synchronisierung vorbereitet: Jeder Datensatz hat
UUID, Revision, Änderungszeitstempel und Löschkennzeichen (Tombstone); das Zusammenführen nach
„neuere Version gewinnt, lokal neuere bleibt“ ist bereits implementiert und getestet
(`planMerge` in `app/js/core/backup-format.js`). Eine Sync-Anbindung müsste nur Datensätze
übertragen und dieselbe Logik nutzen. Die App behauptet **nicht**, im Hintergrund zu synchronisieren.

## 5. Architektur und Technologien

- **Vanilla JavaScript (ES-Module), HTML, CSS** – kein Framework, kein Build, **keine Abhängigkeiten**
  zur Laufzeit. Lange wartbar, kleine Angriffsfläche, strenge Content-Security-Policy.
- **IndexedDB** für alle Daten (transaktional, `durability: "strict"`), versionierte Migrationen.
- **Service Worker** (Cache-first) für den Offline-Betrieb der App-Dateien; **Web App Manifest**.
- Rechenkern als **reine Funktionen** (`app/js/core/`) – im Browser und in Node.js testbar.
- Tests mit dem in Node.js eingebauten Testrunner; Browser-Tests mit **Playwright/Chromium**.

```
app/                    ← wird veröffentlicht
  index.html, manifest.webmanifest, sw.js, css/, icons/
  js/main.js            Start, Router, Service-Worker-Registrierung
  js/core/              reine Logik: time, model, calc (Tag/Zeitkonto), rounding (Verrechnung),
                        state (Stempel-Zustandsautomat), validate, backup-format, csv
  js/db/                db.js (IndexedDB, Migrationen), repo.js (transaktionale Operationen)
  js/ui/                Ansichten: today, calendar, day, activities, account, settings, help, backup, editors
docs/                   ZEITKONTO.md (Rechenregeln), DATENMODELL.md (Schema, Migrationen, Backup)
tests/unit/             Node-Tests des Rechenkerns
tests/e2e/              Browser-Tests (echte IndexedDB, Service Worker, Import/Export)
scripts/serve.js        lokaler Webserver ohne Abhängigkeiten
```

Die Zeitmessung beruht ausschließlich auf **gespeicherten Zeitstempeln**. Der Zustand
(nicht eingestempelt / Arbeit / Pause) wird bei jedem Öffnen aus den Daten abgeleitet; der
20-Sekunden-Timer aktualisiert nur die Anzeige. Schließen, Neuladen, Neustart des Handys oder
Offline-Phasen ändern nichts an den erfassten Zeiten.

Rechenregeln (Viertelstunden, Rest, Mitternacht, Sommerzeit, unvollständige Tage):
**[docs/ZEITKONTO.md](docs/ZEITKONTO.md)**. Datenmodell: **[docs/DATENMODELL.md](docs/DATENMODELL.md)**.

## 6. Entwicklung und Tests

```bash
npm start              # http://localhost:8080/ (localhost gilt als sicherer Kontext)
node scripts/serve.js 8080 /Arbeitszeit/   # wie GitHub Pages im Unterpfad
npm test               # Unit-Tests (Node ≥ 20, keine Installation nötig)
npm install --no-save playwright && npx playwright install chromium
npm run test:e2e       # Browser-Tests
```

Abgedeckt u. a.: normaler Tag mit einer Pause, mehrere Pausen, vergessener Feierabend und
Korrektur, Arbeit über Mitternacht, Sommerzeit-Beginn und -Ende, negative/positive
Tagesdifferenz, Restübertrag, Verrechnung mehrerer Reste, Invariante „keine Minute verloren“
(Zufallsdaten), Monatsabschluss-Regeln, Verhinderung doppelter Buchungen (Doppelklick, zweiter
Tab), Neuladen während laufender Pause, Rückgängig, Export → Löschen → Import, fehlerhafte und
abgeschnittene Importdateien, Zusammenführen ohne Überschreiben neuerer Daten, Offline-Start.
Für die Veröffentlichung laufen alle Browser-Tests im GitHub-Pages-Unterpfad `/Arbeitszeit/`;
zusätzlich geprüft: Chromes Installierbarkeitsprüfung ohne Fehler, Manifest/Icons/Scope,
App-Update mit Hinweis statt ungefragtem Neuladen und ohne Datenverlust, Daten nach Schließen
und erneutem Öffnen, keine Anfragen an fremde Server, kein horizontaler Überlauf bei 360 px,
Hilfe-Seite.
„Unterbrochene Synchronisierung“ entfällt, da keine Cloud-Synchronisierung implementiert ist;
stattdessen ist getestet, dass ein fehlgeschlagener Import nichts verändert.

**Neue Version veröffentlichen**: Dateien ändern (neue Dateien in `PRECACHE` in `app/sw.js`
eintragen – ein Test prüft das) und auf den Standard-Branch pushen. Die Cache-Version setzt
der Workflow automatisch.

## 7. Bekannte Einschränkungen

- Daten liegen nur auf einem Gerät/Browser; Übertragung nur per Sicherungsdatei.
- Keine automatische Hintergrundsicherung und keine Erinnerungs-Benachrichtigungen
  (in PWAs nicht zuverlässig möglich). Die Sicherung erinnert beim Öffnen der App.
- Ob eine per „Teilen“ übergebene Sicherung im Ziel (z. B. Drive) wirklich gespeichert wurde,
  kann der Browser nicht prüfen.
- Stempelzeiten sind minutengenau (Sekunden werden abgeschnitten).
- Änderungen an Verrechnungsart/Intervall/Restregel gelten rückwirkend für den gesamten Verlauf
  (Sollzeiten dagegen datumsbezogen).
- Kein Startbildschirm-Widget (bräuchte eine native Android-App); App-Verknüpfungen
  „Heute“/„Kalender“ über langes Drücken auf das App-Symbol sind vorhanden.
- Feiertage werden nicht automatisch erkannt, sondern je Tag als „Feiertag“ markiert.

## 8. Noch nicht implementiert (mögliche Erweiterungen)

- Echte Cloud-Synchronisierung (Google-Drive-API oder selbst gehostet), siehe Abschnitt 4.
- Feiertagskalender je Bundesland, Urlaubskonto.
- Natives Android-Widget (z. B. per Trusted Web Activity + Widget-Modul).
- PDF-Monatsbericht.

## Lizenz

MIT
