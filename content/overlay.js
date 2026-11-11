/**
 * On-page UI inside a closed Shadow DOM, so page CSS can't break it and it can't
 * break the page: floating control bar, field checkbox badges, highlights, toasts,
 * a confirm dialog and an element picker (for "Pick Next button").
 */
(function () {
  'use strict';
  const FP = (globalThis.__FP = globalThis.__FP || {});
  if (FP.overlay) return;
  const D = FP.dom;

  const CSS_TEXT = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .layer { position: fixed; inset: 0; pointer-events: none; }
    .ring { position: fixed; border: 2px solid #7c5cff; border-radius: 6px; background: rgba(124,92,255,.06); pointer-events: none; transition: all .08s; }
    .ring.off { border-color: rgba(120,120,140,.45); border-style: dashed; background: transparent; }
    .ring.error { border-color: #ef4444; background: rgba(239,68,68,.08); animation: pulse 1s infinite; }
    .ring.pick { border-color: #f59e0b; background: rgba(245,158,11,.12); }
    .ring .tag { position: absolute; left: -2px; top: -22px; background: #ef4444; color: #fff; font-size: 11px; padding: 2px 6px; border-radius: 4px; white-space: nowrap; }
    .ring.pick .tag { background: #f59e0b; }
    @keyframes pulse { 50% { box-shadow: 0 0 0 6px rgba(239,68,68,.25); } }
    .badge { position: fixed; width: 22px; height: 22px; border-radius: 50%; pointer-events: auto; cursor: pointer;
      display: grid; place-items: center; font-size: 13px; font-weight: 700; line-height: 1; border: 2px solid #fff;
      box-shadow: 0 1px 4px rgba(0,0,0,.35); background: #fff; color: transparent; user-select: none; transition: transform .1s; }
    .badge:hover { transform: scale(1.15); }
    .badge.on { background: #7c5cff; color: #fff; }
    .badge.off { background: #fff; border-color: #9ca3af; }
    .badge.warn { box-shadow: 0 0 0 3px #f59e0b; }
    .bar { position: fixed; right: 16px; bottom: 16px; pointer-events: auto; cursor: grab; user-select: none; display: flex; align-items: center; gap: 10px;
      background: #1f1d2b; color: #f4f4f8; border-radius: 999px; padding: 8px 8px 8px 14px; font-size: 13px;
      box-shadow: 0 6px 24px rgba(0,0,0,.35); max-width: calc(100vw - 32px); }
    .bar.error { background: #3b1219; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: #7c5cff; flex: none; }
    .dot.rec { background: #ef4444; animation: blink 1.2s infinite; }
    .dot.paused { background: #f59e0b; animation: none; }
    @keyframes blink { 50% { opacity: .35; } }
    .bar .txt { display: flex; flex-direction: column; min-width: 0; }
    .bar .main { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bar .sub { font-size: 11px; opacity: .75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 320px; }
    .bar button { all: unset; cursor: pointer; padding: 6px 12px; border-radius: 999px; background: rgba(255,255,255,.12); font-size: 12px; font-weight: 600; }
    .bar button:hover { background: rgba(255,255,255,.22); }
    .bar button.danger { background: #ef4444; }
    .bar button.primary { background: #7c5cff; }
    .toasts { position: fixed; top: 16px; right: 16px; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
    .toast { background: #1f1d2b; color: #fff; padding: 10px 14px; border-radius: 10px; font-size: 13px; box-shadow: 0 6px 20px rgba(0,0,0,.3); max-width: 340px; animation: in .15s ease-out; }
    .toast.success { border-left: 4px solid #22c55e; } .toast.error { border-left: 4px solid #ef4444; } .toast.info { border-left: 4px solid #7c5cff; }
    @keyframes in { from { opacity: 0; transform: translateY(-6px); } }
    .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.35); pointer-events: auto; display: grid; place-items: center; }
    .dialog { background: #fffbeb; color: #422006; border: 1px solid #fcd34d; border-radius: 12px; padding: 18px; width: min(380px, calc(100vw - 32px)); box-shadow: 0 12px 40px rgba(0,0,0,.3); font-size: 14px; }
    .dialog h3 { margin: 0 0 6px; font-size: 15px; } .dialog p { margin: 0 0 12px; line-height: 1.4; }
    .dialog label { display: flex; gap: 6px; align-items: center; font-size: 12px; margin-bottom: 14px; }
    .dialog .row { display: flex; gap: 8px; justify-content: flex-end; }
    .dialog button { all: unset; cursor: pointer; padding: 7px 14px; border-radius: 8px; font-weight: 600; font-size: 13px; background: #fde68a; }
    .dialog button.go { background: #d97706; color: #fff; }
    .pickhint { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); background: #f59e0b; color: #1f1d2b; padding: 8px 14px; border-radius: 999px; font-size: 13px; font-weight: 600; box-shadow: 0 4px 16px rgba(0,0,0,.3); }
    @media (prefers-color-scheme: dark) {
      .dialog { background: #2a2312; color: #fde68a; border-color: #92400e; }
      .dialog button { background: #78350f; color: #fde68a; }
    }
  `;

  let host = null;
  let shadow = null;
  let layer = null;

  /** Create (or re-attach) the overlay host. */
  function ensureHost() {
    if (host && host.isConnected) return shadow;
    host = document.createElement('div');
    host.id = D.HOST_ID;
    host.style.cssText = 'position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;display:block!important;';
    shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS_TEXT;
    layer = document.createElement('div');
    layer.className = 'layer';
    shadow.append(style, layer);
    document.documentElement.appendChild(host);
    return shadow;
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /** Bounding rect of an element, or of a group (using labels for hidden inputs). */
  function rectOf(target) {
    const els = Array.isArray(target) ? target : [target];
    let r = null;
    const add = (box) => {
      if (!box.width && !box.height) return;
      if (!r) r = { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
      else {
        r.left = Math.min(r.left, box.left); r.top = Math.min(r.top, box.top);
        r.right = Math.max(r.right, box.right); r.bottom = Math.max(r.bottom, box.bottom);
      }
    };
    for (const e of els) {
      if (!e || !e.isConnected) continue;
      add(e.getBoundingClientRect());
      // Checkboxes / radios: include their label text (and cover custom-styled hidden inputs).
      if ((e.type === 'checkbox' || e.type === 'radio') && e.labels && e.labels[0]) add(e.labels[0].getBoundingClientRect());
    }
    return r;
  }

  /* ---------- positioning loop for badges & highlights ---------- */

  const tracked = new Set(); // { node, target, place(rect) }
  let rafPending = false;
  let interval = null;

  function reposition() {
    rafPending = false;
    for (const t of tracked) {
      const r = rectOf(t.target);
      if (!r) { t.node.style.display = 'none'; continue; }
      t.node.style.display = '';
      t.place(t.node, r);
    }
  }
  function schedule() {
    if (!rafPending) { rafPending = true; requestAnimationFrame(reposition); }
  }
  function track(entry) {
    tracked.add(entry);
    if (!interval) {
      window.addEventListener('scroll', schedule, true);
      window.addEventListener('resize', schedule);
      interval = setInterval(schedule, 400);
    }
    schedule();
  }
  function untrack(entry) {
    tracked.delete(entry);
    entry.node.remove();
    if (!tracked.size && interval) {
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      clearInterval(interval);
      interval = null;
    }
  }
  const placeRing = (node, r) => {
    Object.assign(node.style, { left: r.left - 3 + 'px', top: r.top - 3 + 'px', width: r.right - r.left + 6 + 'px', height: r.bottom - r.top + 6 + 'px' });
  };
  const placeBadge = (node, r) => {
    Object.assign(node.style, { left: Math.max(2, r.right - 13) + 'px', top: Math.max(2, r.top - 11) + 'px' });
  };

  /* ---------- badges ---------- */

  const badges = new Map(); // idx → { ring, badge, selected }

  /**
   * Show a checkbox badge on each field. items: [{ idx, target(el|el[]), selected, label }]
   * onToggle(idx, selected) is called when the user clicks a badge.
   */
  function showBadges(items, onToggle) {
    hideBadges();
    ensureHost();
    for (const it of items) {
      const ring = el('div', 'ring');
      const badge = el('div', 'badge', '✓');
      badge.title = `${it.label || 'Field'} – click to include/exclude`;
      const entryRing = { node: ring, target: it.target, place: placeRing };
      const entryBadge = { node: badge, target: it.target, place: placeBadge };
      layer.append(ring, badge);
      const state = { ring, badge, entryRing, entryBadge, selected: !!it.selected };
      badges.set(it.idx, state);
      paintBadge(state);
      badge.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        state.selected = !state.selected;
        paintBadge(state);
        onToggle && onToggle(it.idx, state.selected);
      });
      track(entryRing);
      track(entryBadge);
    }
  }

  function paintBadge(s) {
    s.badge.className = `badge ${s.selected ? 'on' : 'off'}${s.warn ? ' warn' : ''}`;
    s.ring.className = `ring ${s.selected ? '' : 'off'}`;
    if (s.warn) s.badge.title = '⚠ ' + s.warn;
  }

  function setBadge(idx, { selected, warn } = {}) {
    const s = badges.get(idx);
    if (!s) return;
    if (selected !== undefined) s.selected = selected;
    if (warn !== undefined) s.warn = warn;
    paintBadge(s);
  }

  function selectedCount() {
    let n = 0;
    for (const b of badges.values()) if (b.selected) n++;
    return n;
  }

  function hideBadges() {
    for (const s of badges.values()) { untrack(s.entryRing); untrack(s.entryBadge); }
    badges.clear();
  }

  /* ---------- highlights ---------- */

  const highlights = new Set();
  function highlight(target, { kind = 'error', label = '', duration = 0 } = {}) {
    ensureHost();
    const ring = el('div', `ring ${kind}`);
    if (label) ring.append(el('span', 'tag', label));
    layer.append(ring);
    const entry = { node: ring, target, place: placeRing };
    highlights.add(entry);
    track(entry);
    if (duration) setTimeout(() => { highlights.delete(entry); untrack(entry); }, duration);
    return entry;
  }
  function clearHighlights() {
    for (const h of highlights) untrack(h);
    highlights.clear();
  }

  /* ---------- floating bar ---------- */

  let bar = null;
  let barPos = null; // set when the user drags the bar somewhere else

  /** Drag the bar by any non-button area, so it never hides page buttons for long. */
  function makeDraggable(node) {
    node.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      e.preventDefault();
      const r = node.getBoundingClientRect();
      const dx = e.clientX - r.left;
      const dy = e.clientY - r.top;
      const move = (ev) => {
        barPos = {
          x: Math.min(Math.max(0, ev.clientX - dx), window.innerWidth - r.width),
          y: Math.min(Math.max(0, ev.clientY - dy), window.innerHeight - r.height),
        };
        placeBar();
      };
      const up = () => { window.removeEventListener('mousemove', move, true); window.removeEventListener('mouseup', up, true); };
      window.addEventListener('mousemove', move, true);
      window.addEventListener('mouseup', up, true);
    });
  }
  function placeBar() {
    if (!bar || !barPos) return;
    Object.assign(bar.style, { left: barPos.x + 'px', top: barPos.y + 'px', right: 'auto', bottom: 'auto' });
  }
  /**
   * Show the bar. state: { mode: 'record'|'play', status, main, sub, buttons: [{ id, label, kind }] }
   * onAction(id) is called when a button is clicked.
   */
  function showBar(state, onAction) {
    ensureHost();
    if (!bar) {
      bar = el('div', 'bar');
      bar.title = 'Drag to move';
      makeDraggable(bar);
      layer.append(bar);
      placeBar();
    }
    bar.className = `bar${state.status === 'error' ? ' error' : ''}`;
    bar.textContent = '';
    const dot = el('div', `dot${state.mode === 'record' ? ' rec' : ''}${state.status === 'paused' ? ' paused' : ''}`);
    const txt = el('div', 'txt');
    txt.append(el('div', 'main', state.main || ''));
    if (state.sub) txt.append(el('div', 'sub', state.sub));
    bar.append(dot, txt);
    for (const b of state.buttons || []) {
      const btn = el('button', b.kind || '', b.label);
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onAction && onAction(b.id);
      });
      bar.append(btn);
    }
  }
  function hideBar() {
    if (bar) { bar.remove(); bar = null; }
  }

  /* ---------- toast ---------- */

  let toastBox = null;
  function toast(text, kind = 'info', ms = 3500) {
    ensureHost();
    if (!toastBox || !toastBox.isConnected) {
      toastBox = el('div', 'toasts');
      layer.append(toastBox);
    }
    const t = el('div', `toast ${kind}`, text);
    toastBox.append(t);
    setTimeout(() => t.remove(), ms);
  }

  /* ---------- confirm dialog ---------- */

  /** Yellow "live site" style dialog. Resolves { ok, remember }. */
  function confirmDialog({ title = 'Are you sure?', message = '', okText = 'Continue', cancelText = 'Cancel', rememberText = '' } = {}) {
    ensureHost();
    return new Promise((resolve) => {
      const back = el('div', 'backdrop');
      const box = el('div', 'dialog');
      box.append(el('h3', '', title), el('p', '', message));
      let cb = null;
      if (rememberText) {
        const lab = el('label');
        cb = document.createElement('input');
        cb.type = 'checkbox';
        lab.append(cb, document.createTextNode(rememberText));
        box.append(lab);
      }
      const row = el('div', 'row');
      const cancel = el('button', '', cancelText);
      const ok = el('button', 'go', okText);
      row.append(cancel, ok);
      box.append(row);
      back.append(box);
      layer.append(back);
      const done = (v) => { back.remove(); resolve({ ok: v, remember: !!(cb && cb.checked) }); };
      cancel.addEventListener('click', () => done(false));
      ok.addEventListener('click', () => done(true));
      ok.focus();
    });
  }

  /* ---------- element picker ---------- */

  /** Let the user click an element on the page. Resolves the element, or null on Esc. */
  function pickElement(prompt = 'Click the element') {
    ensureHost();
    return new Promise((resolve) => {
      const hint = el('div', 'pickhint', `${prompt} · Esc to cancel`);
      const ring = el('div', 'ring pick');
      ring.style.display = 'none';
      layer.append(hint, ring);
      let current = null;
      const targetAt = (e) => {
        const n = e.composedPath ? e.composedPath()[0] : e.target;
        if (!n || D.isOwnUI(n) || n === host) return null;
        return (n.closest && n.closest(D.CLICKABLE_SELECTOR)) || n;
      };
      const move = (e) => {
        current = targetAt(e);
        if (!current) return;
        const r = current.getBoundingClientRect();
        ring.style.display = '';
        placeRing(ring, r);
      };
      const stop = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
      const click = (e) => {
        const t = targetAt(e);
        if (!t) return;
        stop(e);
        finish(t);
      };
      const key = (e) => { if (e.key === 'Escape') { stop(e); finish(null); } };
      const block = (e) => { if (targetAt(e)) stop(e); };
      function finish(v) {
        window.removeEventListener('mousemove', move, true);
        window.removeEventListener('click', click, true);
        window.removeEventListener('mousedown', block, true);
        window.removeEventListener('mouseup', block, true);
        window.removeEventListener('keydown', key, true);
        hint.remove();
        ring.remove();
        resolve(v);
      }
      window.addEventListener('mousemove', move, true);
      window.addEventListener('click', click, true);
      window.addEventListener('mousedown', block, true);
      window.addEventListener('mouseup', block, true);
      window.addEventListener('keydown', key, true);
    });
  }

  FP.overlay = { showBadges, setBadge, hideBadges, selectedCount, highlight, clearHighlights, showBar, hideBar, toast, confirmDialog, pickElement, isHost: (n) => n === host };
})();
