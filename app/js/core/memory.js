// Zwischenspeicher für Tätigkeiten: Vorlagen aus bereits gespeicherten Tätigkeiten.
// Es wird nichts zusätzlich gespeichert – die Liste ergibt sich aus dem Tätigkeitsprotokoll.
// Nur ausdrücklich entfernte Einträge werden in den Einstellungen vermerkt
// (settings.activityMemoryHidden = [{ key, at }]); wird die Tätigkeit danach erneut erfasst,
// erscheint sie wieder.

const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Schlüssel einer Vorlage: Bezeichnung, Beschreibung und Kategorie (ohne Groß-/Kleinschreibung). */
export function memoryKey(a) {
  return [norm(a.title), norm(a.description), norm(a.category)].join('\u0001');
}

/**
 * Vorlagen aus allen Tätigkeiten, zuletzt verwendete zuerst.
 * @returns [{ key, title, description, category, intensity, minutes, count, lastDay, lastUsed }]
 */
export function activityTemplates(activities, hidden = []) {
  const hiddenAt = new Map((Array.isArray(hidden) ? hidden : []).map((x) => [x.key, x.at]));
  const byKey = new Map();
  for (const a of activities) {
    if (a.deleted || !norm(a.title)) continue;
    const key = memoryKey(a);
    const used = Math.max(a.createdAt || 0, a.updatedAt || 0);
    const cur = byKey.get(key);
    const newer = !cur || a.day > cur.lastDay || (a.day === cur.lastDay && used >= cur.lastUsed);
    const t = newer
      ? { key, title: a.title.trim(), description: a.description || '', category: a.category || null,
        intensity: a.intensity || null, minutes: a.minutes, lastDay: a.day, lastUsed: Math.max(used, cur?.lastUsed || 0) }
      : { ...cur, lastUsed: Math.max(used, cur.lastUsed) };
    t.count = (cur?.count || 0) + 1;
    byKey.set(key, t);
  }
  return [...byKey.values()]
    .filter((t) => !(hiddenAt.has(t.key) && hiddenAt.get(t.key) >= t.lastUsed))
    .sort((a, b) => (b.lastDay > a.lastDay ? 1 : b.lastDay < a.lastDay ? -1 : b.count - a.count || b.lastUsed - a.lastUsed));
}

/** Vorlagen, deren Bezeichnung, Beschreibung oder Kategorie den Suchtext enthält. */
export function filterTemplates(templates, query, limit = 12) {
  const q = norm(query);
  const list = q ? templates.filter((t) => t.key.includes(q)) : templates;
  return list.slice(0, limit);
}

/** Dauer beim Übernehmen: zuletzt verwendete Dauer, höchstens der noch offene Rest des Tages. */
export function templateMinutes(template, openMin) {
  return openMin > 0 ? Math.min(template.minutes, openMin) : template.minutes;
}

/** Vorlage aus dem Zwischenspeicher entfernen (liefert die neue Liste für die Einstellungen). */
export function hideTemplate(hidden, key, now = Date.now()) {
  return [...(Array.isArray(hidden) ? hidden : []).filter((x) => x.key !== key), { key, at: now }];
}
