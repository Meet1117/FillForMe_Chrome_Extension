/**
 * Tiny UI toolkit for the side panel: DOM builder, icons, toasts, modals,
 * messaging to the service worker, and a few helpers.
 */
import '../shared/toast.js';

/**
 * Create an element. props: { class, text, html?, on: { event: fn }, attrs, style, ...domProps }
 * Children can be nodes, strings, numbers, arrays, or null/false (skipped).
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'attrs') for (const [a, av] of Object.entries(v)) { if (av !== false && av != null) el.setAttribute(a, av === true ? '' : av); }
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el[k] = v;
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/* ---------- icons (inline SVG, stroke style) ---------- */

const ICONS = {
  record: '<circle cx="12" cy="12" r="7" fill="currentColor" stroke="none"/>',
  play: '<polygon points="7 4 20 12 7 20 7 4" fill="currentColor"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  more: '<circle cx="12" cy="5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.7 1.8L21.5 18l-1.8.7L19 20.5l-.7-1.8L16.5 18l1.8-.7z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  grip: '<circle cx="9" cy="6" r="1.3" fill="currentColor"/><circle cx="15" cy="6" r="1.3" fill="currentColor"/><circle cx="9" cy="12" r="1.3" fill="currentColor"/><circle cx="15" cy="12" r="1.3" fill="currentColor"/><circle cx="9" cy="18" r="1.3" fill="currentColor"/><circle cx="15" cy="18" r="1.3" fill="currentColor"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M1 1l22 22"/>',
  alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  back: '<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  x: '<path d="M18 6L6 18"/><path d="M6 6l12 12"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 1v4"/><path d="M12 19v4"/><path d="M1 12h4"/><path d="M19 12h4"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  wand: '<path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8L19 13"/><path d="M17.8 6.2L19 5"/><path d="M3 21l9-9"/><path d="M12.2 6.2L11 5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  arrow: '<path d="M5 12h14"/><path d="M12 5l7 7-7 7"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2"/><path d="M16 7l3 3"/><path d="M19 4l2 2"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
};

export function icon(name, size = 16) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return span;
}

/* ---------- messaging ---------- */

/** Send a message to the service worker; resolves data or throws an Error. */
export async function send(type, payload = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...payload });
  if (!res) throw new Error('No response from FillForMe. Try reopening the panel.');
  if (!res.ok) {
    const err = new Error(res.error || 'Something went wrong.');
    err.code = res.code;
    throw err;
  }
  return res.data;
}

/* ---------- toasts ---------- */

/** Bottom-centre toast (see shared/toast.js). kind: info | success | warning | error. */
let toaster = null;
export function toast(message, kind = 'info', ms) {
  if (!toaster) toaster = globalThis.FPShared.Toast.create(document.body);
  return toaster.show(message, kind, ms);
}

/* ---------- modals ---------- */

/**
 * Show a modal. actions: [{ label, kind, onClick }] – onClick may return false to keep it open.
 * Returns a close() function.
 */
export function modal({ title, body, actions = [], tone = '' }) {
  const root = document.getElementById('modal-root');
  const close = () => wrap.remove();
  const box = h('div', { class: `modal ${tone}`, attrs: { role: 'dialog', 'aria-modal': 'true' } },
    title ? h('h3', { text: title }) : null,
    body,
    h('div', { class: 'modal-actions' },
      actions.map((a) => h('button', {
        class: `btn ${a.kind || ''}`,
        text: a.label,
        on: { click: async () => { if ((await a.onClick?.()) !== false) close(); } },
      }))
    )
  );
  const wrap = h('div', { class: 'modal-back', on: { mousedown: (e) => { if (e.target === wrap) close(); } } }, box);
  root.append(wrap);
  const firstInput = box.querySelector('input, textarea');
  (firstInput || box.querySelector('.btn.primary'))?.focus();
  if (firstInput?.select) firstInput.select();
  return close;
}

/** Ask for a text value. Resolves the string, or null if cancelled. */
export function promptText({ title, label, value = '', okText = 'Save', placeholder = '' }) {
  return new Promise((resolve) => {
    let done = false;
    const input = h('input', { class: 'input', value, placeholder, on: { keydown: (e) => { if (e.key === 'Enter') ok(); } } });
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const close = modal({
      title,
      body: h('label', { class: 'field' }, h('span', { class: 'label', text: label }), input),
      actions: [
        { label: 'Cancel', onClick: () => finish(null) },
        { label: okText, kind: 'primary', onClick: () => finish(input.value.trim() || value) },
      ],
    });
    function ok() { finish(input.value.trim() || value); close(); }
  });
}

/** Yes / no question. */
export function confirmBox({ title, message, okText = 'OK', danger = false, tone = '', extra = null }) {
  return new Promise((resolve) => {
    modal({
      title,
      tone,
      body: h('div', {}, h('p', { class: 'modal-text', text: message }), extra),
      actions: [
        { label: 'Cancel', onClick: () => resolve(false) },
        { label: okText, kind: danger ? 'danger' : 'primary', onClick: () => resolve(true) },
      ],
    });
  });
}

/* ---------- helpers ---------- */

export function debounce(fn, ms = 400) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Read a JSON file the user picks. */
export function pickJSONFile() {
  return new Promise((resolve, reject) => {
    const input = h('input', { type: 'file', accept: '.json,application/json' });
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      try { resolve(JSON.parse(await f.text())); } catch { reject(new Error('That file is not valid JSON.')); }
    });
    input.click();
  });
}

export function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr} h ago`;
  const d = Math.round(hr / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** Small "menu" popover anchored to a button. items: [{ label, icon, danger, onClick }] */
export function popMenu(anchor, items) {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const r = anchor.getBoundingClientRect();
  const menu = h('div', { class: 'menu', attrs: { role: 'menu' } },
    items.map((it) => h('button', {
      class: `menu-item ${it.danger ? 'danger' : ''}`,
      attrs: { role: 'menuitem' },
      on: { click: () => { menu.remove(); it.onClick(); } },
    }, icon(it.icon, 15), it.label)));
  document.body.append(menu);
  const top = Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 8);
  menu.style.top = `${top}px`;
  menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  setTimeout(() => {
    const off = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', off); } };
    document.addEventListener('mousedown', off);
  });
}
