// Hilfe & Installation: kurze Anleitung für die Einrichtung auf Android (Inhalt wie INSTALLATION.md).

import { h } from './dom.js';
import { exportBackup } from './backup.js';

function step(n, title, ...body) {
  return h('li', { class: 'help-step' }, h('h3', null, `${n}. ${title}`), ...body);
}

export async function renderHelp(app) {
  const appUrl = new URL('./', location.href).href;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const offlineReady = !!navigator.serviceWorker?.controller;

  let installBox;
  if (standalone) {
    installBox = h('div', { class: 'notice notice-ok', 'data-testid': 'install-state' }, '✓ Die App ist installiert und läuft als eigene App.');
  } else if (app.installPrompt) {
    installBox = h('div', { class: 'notice notice-info', 'data-testid': 'install-state' },
      h('p', null, 'Diese App kann direkt installiert werden:'),
      h('button', {
        type: 'button', class: 'btn btn-primary btn-block', 'data-testid': 'install-btn', onclick: async () => {
          const ev = app.installPrompt;
          app.installPrompt = null;
          ev.prompt();
          await ev.userChoice.catch(() => null);
          app.rerender();
        },
      }, '📲 App installieren'));
  } else {
    installBox = h('div', { class: 'notice notice-info', 'data-testid': 'install-state' },
      'Zum Installieren in Chrome oben rechts auf ⋮ tippen und „App installieren“ oder „Zum Startbildschirm hinzufügen“ wählen.');
  }

  return h('section', { class: 'view view-help' },
    h('h1', null, 'Hilfe & Installation'),
    installBox,
    h('div', { class: `notice ${offlineReady ? 'notice-ok' : 'notice-warn'}`, 'data-testid': 'offline-state' },
      offlineReady ? '✓ Offline-Betrieb ist eingerichtet: Die App startet auch ohne Internet.'
        : 'Offline-Betrieb ist noch nicht eingerichtet. Die App einmal mit Internet vollständig laden und danach neu öffnen.'),

    h('ol', { class: 'help-steps card' },
      step(1, 'App öffnen',
        h('p', null, 'Diese Adresse in Google Chrome auf dem Android-Handy öffnen:'),
        h('p', null, h('a', { href: appUrl, class: 'help-url' }, appUrl))),
      step(2, 'App installieren',
        h('p', null, 'In Chrome oben rechts auf ⋮ (drei Punkte) tippen und „App installieren“ oder „Zum Startbildschirm hinzufügen“ wählen. Die Bezeichnung kann je nach Chrome-Version abweichen.')),
      step(3, 'App starten',
        h('p', null, 'Das neue Symbol „Arbeitszeit“ auf dem Startbildschirm antippen. Die App öffnet sich wie eine normale App.')),
      step(4, 'Ersteinrichtung',
        h('ul', null,
          h('li', null, 'Unter ', h('a', { href: '#/einstellungen' }, 'Einstellungen'), ' bei „Zeitkonto“ bei Bedarf Kontobeginn und Anfangssaldo eintragen und „Regeln speichern“ tippen.'),
          h('li', null, 'Für den Ausbildungsnachweis Name und Ausbildungsbeginn eintragen und „Angaben speichern“ tippen.'),
          h('li', null, 'Bei Bedarf Kontobeginn und Anfangssaldo eintragen und „Regeln speichern“ tippen.'),
          h('li', null, '„Dauerhaften Speicher anfordern“ tippen.'),
          h('li', null, 'Eine erste Sicherung erstellen (siehe Schritt 7).'))),
      step(5, 'Viertelstunden und Zeitkonto',
        h('p', null, 'Gestempelt wird minutengenau, gebucht auf die nächstgelegene volle Viertelstunde. Die Differenz kommt ins Zeitkonto: Kommen 08:50 → gebucht 08:45 = −0:05, Gehen 17:49 → gebucht 17:45 = +0:04. Ein Tipp auf eine Zeit in der Buchungsliste bucht die andere Viertelstunde (z. B. 09:00 = +0:10). Auf „Heute“ steht, wann du zum Ausgleichen gehen kannst. Eine Sollzeit gibt es nicht.')),
      step(6, 'Ohne Internet nutzen',
        h('p', null, 'Die App muss einmal mit Internet vollständig geladen werden. Danach funktioniert sie auch ohne Internet – Stempeln, Kalender, Tätigkeiten und Sicherung. Ohne Internet erscheint oben „offline“.')),
      step(7, 'Daten sichern',
        h('p', null, 'Die Daten liegen nur auf diesem Handy. Werden die Browserdaten von Chrome gelöscht oder geht das Handy verloren, sind sie weg – außer du hast eine Sicherung.'),
        h('ul', null,
          h('li', null, 'Sichern: Einstellungen → „Sicherung herunterladen (JSON)“. Die Datei landet im Ordner „Downloads“. Am besten zusätzlich mit „Sicherung teilen“ in Google Drive o. Ä. ablegen (die geteilte Datei endet auf .txt, der Inhalt ist derselbe).'),
          h('li', null, 'Wiederherstellen: Einstellungen → „Sicherung importieren …“ und die Datei auswählen.'),
          h('li', null, 'Regelmäßig sichern, z. B. einmal pro Woche. Die App erinnert daran.'),
          h('li', null, 'Ausbildungsnachweis als Excel: Kalender → Woche → „Ausbildungsnachweis dieser Woche (Excel)“ oder Einstellungen → „Ausbildungsnachweis (Excel)“.')),
        h('button', { type: 'button', class: 'btn btn-block', onclick: () => exportBackup(app).catch(app.error) }, '⬇ Jetzt Sicherung herunterladen')),
      step(8, 'Wenn etwas nicht klappt',
        h('ul', null,
          h('li', null, h('b', null, 'Keine Installationsoption: '), 'Die Adresse wirklich in Google Chrome öffnen (nicht in einer anderen App), Seite einmal neu laden und kurz warten. Steht dort „Öffnen“ statt „Installieren“, ist die App schon installiert.'),
          h('li', null, h('b', null, 'Startet offline nicht: '), 'Die App einmal mit Internet öffnen, alle Seiten laden lassen, schließen und neu öffnen.'),
          h('li', null, h('b', null, 'Daten fehlen: '), 'Die App immer über dasselbe Symbol bzw. dieselbe Adresse öffnen – Daten gehören zu genau dieser Adresse. Wurden die Chrome-Daten gelöscht, die letzte Sicherung importieren.'),
          h('li', null, h('b', null, 'Neue Version: '), 'Erscheint oben „Neue Version verfügbar“, auf „Aktualisieren“ tippen. Deine Daten bleiben erhalten.')))),
    h('p', { class: 'muted small center' }, 'Keine Werbung, kein Konto, kein Server: Alle Arbeitszeitdaten bleiben auf diesem Gerät.'));
}
