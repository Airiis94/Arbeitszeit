// Minimale DOM-Hilfen ohne Framework. Nutzertexte werden immer als Text gesetzt (kein innerHTML).

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'selected' || k === 'disabled') el[k] = !!v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// ---------- Toasts ----------

export function toast(message, { type = 'info', action = null, timeout = 4500 } = {}) {
  const root = document.getElementById('toasts');
  const el = h('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' },
    h('span', null, message),
    action && h('button', { class: 'toast-action', type: 'button', onclick: () => { remove(); action.run(); } }, action.label),
    h('button', { class: 'toast-close', type: 'button', 'aria-label': 'Schließen', onclick: () => remove() }, '×'));
  let timer = null;
  function remove() {
    clearTimeout(timer);
    el.remove();
  }
  while (root.children.length >= 2) root.firstElementChild.remove();
  root.appendChild(el);
  if (timeout) timer = setTimeout(remove, type === 'error' ? Math.max(timeout, 9000) : timeout);
  return remove;
}

export function showError(err) {
  const msg = err?.messages ? err.messages.join('\n') : err?.message || String(err);
  toast(msg, { type: 'error' });
}

// ---------- Dialoge ----------

/**
 * Öffnet einen modalen Dialog mit Formular.
 * @param build (form) => Inhalt (Elemente)
 * @param onSubmit async (form) => true|void; wirft → Fehlermeldung im Dialog, Dialog bleibt offen
 * @returns Promise<any> Ergebnis von onSubmit oder null bei Abbruch
 */
export function formDialog({ title, build, submitText = 'Speichern', danger = false, onSubmit, extraButtons = [] }) {
  return new Promise((resolve) => {
    const errorBox = h('div', { class: 'dialog-error', role: 'alert', hidden: true });
    const form = h('form', { class: 'dialog-form', method: 'dialog', novalidate: true });
    const submitBtn = h('button', { type: 'submit', class: danger ? 'btn btn-danger' : 'btn btn-primary' }, submitText);
    const cancelBtn = h('button', { type: 'button', class: 'btn', onclick: () => close(null) }, 'Abbrechen');
    const dlg = h('dialog', { class: 'dialog', 'aria-label': title },
      h('h2', { class: 'dialog-title' }, title),
      form);
    let done = false;
    function close(val) {
      if (done) return;
      done = true;
      dlg.close();
      dlg.remove();
      resolve(val);
      window.dispatchEvent(new Event('dialogclosed'));
    }
    const body = build(form, { close });
    form.append(
      h('div', { class: 'dialog-body' }, body),
      errorBox,
      h('div', { class: 'dialog-actions' }, ...extraButtons.map((b) => h('button', {
        type: 'button', class: `btn ${b.class || ''}`, onclick: async () => {
          const r = await b.run(form);
          if (r !== undefined) close(r);
        },
      }, b.label)), cancelBtn, submitBtn),
    );
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      errorBox.hidden = true;
      submitBtn.disabled = true;
      try {
        const r = await onSubmit(form);
        close(r === undefined ? true : r);
      } catch (err) {
        errorBox.textContent = err?.messages ? err.messages.join('\n') : err?.message || String(err);
        errorBox.hidden = false;
        submitBtn.disabled = false;
      }
    });
    dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); close(null); });
    document.body.appendChild(dlg);
    dlg.showModal();
    const first = form.querySelector('input:not([type=hidden]):not([type=checkbox]), select, textarea');
    if (first && !first.hasAttribute('data-nofocus')) first.focus();
  });
}

export function confirmDialog({ title, message, confirmText = 'OK', danger = false }) {
  return formDialog({
    title,
    submitText: confirmText,
    danger,
    build: () => (Array.isArray(message) ? message : [message]).map((m) => (m instanceof Node ? m : h('p', null, m))),
    onSubmit: () => true,
  }).then((r) => r === true);
}

/** Beschriftetes Formularfeld. */
export function field(label, input, hint) {
  const id = input.id || `f-${Math.random().toString(36).slice(2, 9)}`;
  input.id = id;
  return h('div', { class: 'field' },
    h('label', { for: id }, label),
    input,
    hint && h('div', { class: 'field-hint' }, hint));
}

export function downloadFile(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, hidden: true });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('Datei konnte nicht gelesen werden.'));
    r.readAsText(file);
  });
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, hidden: true });
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    input.addEventListener('cancel', () => { resolve(null); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}
