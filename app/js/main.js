// App-Start: Datenbank öffnen, Router, Service Worker, Synchronisierung zwischen Tabs.

import { Repo } from './db/repo.js';
import { h, clear, toast, showError } from './ui/dom.js';
import { renderToday } from './ui/today.js';
import { renderCalendar } from './ui/calendar.js';
import { renderDay } from './ui/day.js';
import { renderActivities } from './ui/activities.js';
import { renderAccount } from './ui/account.js';
import { renderSettings } from './ui/settings.js';
import { renderHelp } from './ui/help.js';

const ROUTES = {
  heute: { render: renderToday, nav: 'heute', title: 'Heute', live: true },
  kalender: { render: renderCalendar, nav: 'kalender', title: 'Kalender' },
  tag: { render: renderDay, nav: 'kalender', title: 'Tagesansicht', live: true },
  taetigkeiten: { render: renderActivities, nav: 'taetigkeiten', title: 'Tätigkeiten' },
  konto: { render: renderAccount, nav: 'konto', title: 'Zeitkonto' },
  einstellungen: { render: renderSettings, nav: 'einstellungen', title: 'Einstellungen' },
  hilfe: { render: renderHelp, nav: 'hilfe', title: 'Hilfe & Installation' },
};

const view = document.getElementById('view');
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('arbeitszeit') : null;
let renderSeq = 0;
let pendingRender = false;
let liveTimer = null;

const app = {
  repo: null,
  busy: false,
  /** Von Chrome angebotene Installationsaufforderung (beforeinstallprompt), falls verfügbar. */
  installPrompt: null,
  async load() {
    const data = await this.repo.loadAll();
    applyTheme(data.settings.theme);
    return data;
  },
  error(e) {
    console.error(e);
    showError(e);
  },
  navigate(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  },
  rerender() {
    render({ keepScroll: true });
  },
  /** Nach der ersten echten Buchung einmalig dauerhaften Speicher anfragen (Chrome fragt nicht nach). */
  async afterFirstWrite() {
    try {
      if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
    } catch { /* ignorieren */ }
  },
};

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [name, ...params] = raw.split('/').filter(Boolean);
  return { name: ROUTES[name] ? name : 'heute', params };
}

async function render({ keepScroll = false } = {}) {
  const seq = ++renderSeq;
  const { name, params } = parseHash();
  const route = ROUTES[name];
  document.querySelectorAll('.bottom-nav a, .topbar a[data-nav]').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === route.nav);
    if (a.dataset.nav === route.nav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.title = `${route.title} · Arbeitszeit`;
  const titleEl = document.getElementById('topbar-title');
  if (titleEl) titleEl.textContent = route.title;
  const scroll = window.scrollY;
  try {
    const el = await route.render(app, params);
    if (seq !== renderSeq) return; // inzwischen neu navigiert
    // Offene Dialoge nicht durch Live-Aktualisierung zerstören
    clear(view).appendChild(el);
    window.scrollTo(0, keepScroll ? scroll : 0);
  } catch (e) {
    if (seq !== renderSeq) return;
    clear(view).appendChild(h('div', { class: 'notice notice-error' }, `Fehler beim Anzeigen: ${e.message || e}`));
    console.error(e);
  }
  clearInterval(liveTimer);
  if (route.live) {
    // Nur die Anzeige wird periodisch neu berechnet – alle Werte stammen aus gespeicherten Zeitstempeln.
    liveTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && !document.querySelector('dialog[open]') && !isTyping()) app.rerender();
    }, 20000);
  }
}

/** Wird gerade in ein Feld der Ansicht getippt? Dann nicht neu zeichnen (Eingabe und Fokus bleiben). */
function isTyping() {
  const el = document.activeElement;
  return !!el && view.contains(el) && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

/** Neu zeichnen – bei offenem Dialog erst nach dessen Schließen (Eingaben gehen nicht verloren). */
function requestRender() {
  if (document.querySelector('dialog[open]')) pendingRender = true;
  else app.rerender();
}

function onDataChanged() {
  channel?.postMessage({ type: 'changed' });
  requestRender();
}

// ---------- Service Worker / Aktualisierung ----------

let updateRequested = false;

function showUpdateBanner(reg) {
  if (document.getElementById('update-banner')) return;
  const banner = h('div', { id: 'update-banner', class: 'update-banner', role: 'status' },
    h('span', null, 'Eine neue Version der App ist verfügbar.'),
    h('button', {
      type: 'button', class: 'btn btn-small btn-primary', onclick: () => {
        updateRequested = true;
        reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
      },
    }, 'Aktualisieren'));
  document.body.appendChild(banner);
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!window.isSecureContext) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg);
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(reg);
      });
    });
    // Nur neu laden, wenn der Nutzer die Aktualisierung bestätigt hat – nicht bei der
    // Erstinstallation (clients.claim), damit keine laufende Eingabe unterbrochen wird.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!updateRequested) return;
      updateRequested = false;
      location.reload();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  } catch (e) {
    console.warn('Service Worker konnte nicht registriert werden', e);
  }
}

function updateOnlineState() {
  document.body.classList.toggle('offline', !navigator.onLine);
}

async function start() {
  window.addEventListener('unhandledrejection', (ev) => app.error(ev.reason));
  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();
    app.installPrompt = ev;
    if (parseHash().name === 'hilfe') app.rerender();
  });
  window.addEventListener('appinstalled', () => {
    app.installPrompt = null;
    toast('App wurde installiert. Du findest sie jetzt auf dem Startbildschirm.', { type: 'success', timeout: 8000 });
  });
  try {
    app.repo = await Repo.open({
      onChange: onDataChanged,
      onVersionChange: () => {
        clear(view).appendChild(h('div', { class: 'notice notice-warn' }, 'Die App wurde in einem anderen Tab aktualisiert. Bitte diese Seite neu laden.'));
      },
    });
  } catch (e) {
    clear(view).appendChild(h('div', { class: 'notice notice-error' },
      h('b', null, 'Die lokale Datenbank konnte nicht geöffnet werden.'), h('br'),
      e.message || String(e), h('br'),
      'Hinweis: In privaten Fenstern oder bei blockierten Website-Daten kann der Browser keine Daten speichern.'));
    return;
  }
  channel?.addEventListener('message', (ev) => {
    if (ev.data?.type === 'changed') requestRender();
  });
  window.addEventListener('dialogclosed', () => {
    if (pendingRender && !document.querySelector('dialog[open]')) {
      pendingRender = false;
      app.rerender();
    }
  });
  window.addEventListener('hashchange', () => {
    // Beim Wechsel der Ansicht (z. B. Zurück-Taste) offene Dialoge ohne Speichern schließen
    document.querySelectorAll('dialog[open]').forEach((d) => d.dispatchEvent(new Event('cancel')));
    pendingRender = false;
    render();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !document.querySelector('dialog[open]')) app.rerender();
  });
  window.addEventListener('online', updateOnlineState);
  window.addEventListener('offline', updateOnlineState);
  updateOnlineState();
  await render();
  registerServiceWorker();
  if (!window.isSecureContext) {
    toast('Hinweis: Die Seite ist nicht über HTTPS geöffnet – Installation und Offline-Betrieb sind deshalb nicht verfügbar.', { type: 'info', timeout: 10000 });
  }
}

window.__app = app; // für automatisierte Tests
start();
