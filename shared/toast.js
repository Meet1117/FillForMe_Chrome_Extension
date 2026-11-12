/**
 * Toast notifications shared by the on-page overlay and the side panel.
 *
 * Bottom-centre stack: the newest toast is in front, older ones peek out behind it,
 * and hovering (or focusing) the stack fans it out. Each toast shows a variant icon,
 * a title, an optional description, a close button on hover and a progress bar
 * that counts down the time left. Hovering pauses every countdown.
 *
 * Written as a classic script that attaches to `globalThis.FPShared`, so it works
 * both as a content script and via `import '../shared/toast.js'` in modules.
 *
 *   const toaster = FPShared.Toast.create(parentNodeOrFn);
 *   toaster.show('Saved', 'success');                         // 5 s
 *   toaster.show({ title: 'Saved', description: '3 steps' }, 'info', 8000);
 *   toaster.show('Working…', 'info', 0);                      // stays until dismissed
 */
(function (root) {
  'use strict';
  const FP = (root.FPShared = root.FPShared || {});
  if (FP.Toast) return;

  const DURATION = 5000; // ms before a toast closes itself
  const VISIBLE = 3;     // toasts shown in the stack at once
  const MAX = 10;        // older toasts beyond this are dismissed
  const GAP = 10;        // px between toasts when the stack is fanned out
  const PEEK = 14;       // px each toast behind the front one moves up
  const SCALE_STEP = 0.05;
  const EXIT_MS = 250;

  /** Kind names used across the extension → visual variant. */
  const VARIANTS = {
    default: 'default', neutral: 'default',
    info: 'accent', accent: 'accent',
    success: 'success',
    warning: 'warning', warn: 'warning',
    error: 'danger', danger: 'danger',
  };

  const CIRCLE = 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z';
  const ICONS = {
    default: [CIRCLE, 'M12 16v-4', 'M12 8h.01'],
    accent: [CIRCLE, 'M12 16v-4', 'M12 8h.01'],
    success: [CIRCLE, 'm8.5 12 2.5 2.5 4.5-5'],
    warning: ['M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', 'M12 9v4', 'M12 17h.01'],
    danger: [CIRCLE, 'm15 9-6 6', 'm9 9 6 6'],
  };
  const CLOSE = ['M18 6 6 18', 'm6 6 12 12'];

  const CSS = `
    .fft-region {
      --fft-bg: #ffffff; --fft-fg: #202124; --fft-muted: #5f6368; --fft-line: rgba(0, 0, 0, .08); --fft-hover: #f1f3f4;
      --fft-default: #5f6368; --fft-accent: #1a73e8; --fft-success: #188038; --fft-warning: #b06000; --fft-danger: #d93025;
      --fft-shadow: 0 4px 16px rgba(24, 24, 27, .08), 0 8px 24px rgba(24, 24, 27, .09);
      --fft-ease: cubic-bezier(.32, .72, 0, 1);
      --fft-radius: 14px;
      position: fixed; left: 50%; bottom: var(--fft-offset, 16px); transform: translateX(-50%);
      width: min(356px, calc(100vw - 32px)); height: 0; z-index: 2147483647;
      pointer-events: auto; transition: height .35s var(--fft-ease);
      font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--fft-fg);
      text-align: left; letter-spacing: normal; -webkit-font-smoothing: antialiased;
    }
    @media (prefers-color-scheme: dark) {
      .fft-region {
        --fft-bg: #292a2d; --fft-fg: #e8eaed; --fft-muted: #9aa0a6; --fft-line: #3c4043; --fft-hover: #35363a;
        --fft-default: #9aa0a6; --fft-accent: #8ab4f8; --fft-success: #81c995; --fft-warning: #fdd663; --fft-danger: #f28b82;
        --fft-shadow: 0 4px 16px rgba(0, 0, 0, .32), 0 8px 24px rgba(0, 0, 0, .28);
      }
    }
    .fft-region, .fft-region * { box-sizing: border-box; }

    .fft-toast {
      --fft-y: 0px; --fft-scale: 1; --fft-enter: 0%; --fft-tone: var(--fft-default);
      position: absolute; left: 0; right: 0; bottom: 0;
      display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: 8px; align-items: start;
      padding: 12px 16px 14px 12px;
      background: var(--fft-bg); border: 1px solid var(--fft-line); border-radius: var(--fft-radius);
      box-shadow: var(--fft-shadow);
      transform-origin: bottom center;
      transform: translateY(calc(var(--fft-y) + var(--fft-enter))) scale(var(--fft-scale));
      transition: transform .35s var(--fft-ease), opacity .15s ease, height .35s var(--fft-ease);
    }
    .fft-toast > * { transition: opacity .2s ease; }
    .fft-toast[data-mounted="false"] { --fft-enter: 100%; opacity: 0; }
    .fft-toast[data-removed="true"] { opacity: 0; pointer-events: none; transition: transform .25s var(--fft-ease), opacity .2s ease, height .25s var(--fft-ease); }
    .fft-toast[data-hidden="true"] { opacity: 0; pointer-events: none; }
    .fft-region[data-expanded="false"] .fft-toast[data-front="false"] { overflow: hidden; }
    .fft-region[data-expanded="false"] .fft-toast[data-front="false"] > * { opacity: 0; }

    .fft--accent { --fft-tone: var(--fft-accent); }
    .fft--success { --fft-tone: var(--fft-success); }
    .fft--warning { --fft-tone: var(--fft-warning); }
    .fft--danger { --fft-tone: var(--fft-danger); }

    .fft-icon { display: grid; place-items: center; width: 24px; height: 24px; padding: 4px; color: var(--fft-tone); animation: fft-icon .25s var(--fft-ease); }
    .fft-icon svg, .fft-close svg { display: block; width: 100%; height: 100%; }
    @keyframes fft-icon { from { opacity: 0; transform: scale(.92); } }
    .fft-content { min-width: 0; padding-top: 2px; }
    .fft-title { font-size: 14px; line-height: 20px; font-weight: 500; color: var(--fft-fg); overflow-wrap: anywhere; }
    .fft-toast:not(.fft--default) .fft-title { color: var(--fft-tone); }
    .fft-desc { margin-top: 2px; font-size: 13px; line-height: 18px; color: var(--fft-muted); overflow-wrap: anywhere; }

    .fft-close {
      all: unset; box-sizing: border-box; position: absolute; top: -6px; right: -6px;
      width: 20px; height: 20px; padding: 4px; border-radius: 50%; cursor: pointer;
      background: var(--fft-bg); color: var(--fft-muted); border: 1px solid var(--fft-line);
      box-shadow: 0 1px 3px rgba(0, 0, 0, .12);
      opacity: 0; pointer-events: none; transition: opacity .15s ease, background-color .15s ease, color .15s ease;
    }
    .fft-close:hover { background: var(--fft-hover); color: var(--fft-fg); }
    .fft-toast:hover .fft-close, .fft-close:focus-visible { opacity: 1; pointer-events: auto; }
    .fft-close:focus-visible { outline: 2px solid var(--fft-accent); outline-offset: 1px; }

    .fft-progress {
      position: absolute; left: 0; right: 0; bottom: 0; height: 3px; overflow: hidden;
      border-radius: 0 0 var(--fft-radius) var(--fft-radius);
      background: color-mix(in srgb, var(--fft-tone) 14%, transparent);
    }
    .fft-bar { height: 100%; background: var(--fft-tone); transform-origin: left center; animation: fft-countdown linear forwards; }
    @keyframes fft-countdown { from { transform: scaleX(1); } to { transform: scaleX(0); } }
    .fft-region[data-expanded="true"] .fft-bar, .fft-region[data-paused="true"] .fft-bar { animation-play-state: paused; }

    @media (prefers-reduced-motion: reduce) {
      .fft-region, .fft-toast { transition: opacity .15s ease; }
      .fft-icon { animation: none; }
    }
  `;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function svg(doc, paths) {
    const s = doc.createElementNS(SVG_NS, 'svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) s.setAttribute(k, v);
    for (const d of paths) {
      const p = doc.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      s.append(p);
    }
    return s;
  }

  /**
   * Create a toaster. `parent` is the node the toast region goes in (a document body or
   * an element inside a shadow root), or a function returning it (called on every show,
   * so a re-created overlay host is picked up).
   */
  function create(parent, { offset = 16 } = {}) {
    const getParent = typeof parent === 'function' ? parent : () => parent;
    const items = []; // newest first: { node, height, removing }
    let region = null;
    let expanded = false;

    function el(tag, cls, text) {
      const n = region.ownerDocument.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    }

    function ensureRegion() {
      const host = getParent();
      if (region && region.isConnected && region.parentNode === host) return;
      const doc = host.ownerDocument || document;
      items.length = 0;
      expanded = false;
      region = doc.createElement('section');
      region.className = 'fft-region';
      region.setAttribute('aria-label', 'Notifications');
      region.dataset.expanded = 'false';
      region.style.setProperty('--fft-offset', offset + 'px');
      const style = doc.createElement('style');
      style.textContent = CSS;
      region.append(style);
      region.addEventListener('mouseenter', () => setExpanded(true));
      region.addEventListener('mouseleave', () => setExpanded(false));
      region.addEventListener('focusin', () => setExpanded(true));
      region.addEventListener('focusout', (e) => { if (!region.contains(e.relatedTarget)) setExpanded(false); });
      const onVisibility = () => {
        if (!region.isConnected) return doc.removeEventListener('visibilitychange', onVisibility);
        region.dataset.paused = String(doc.hidden);
      };
      doc.addEventListener('visibilitychange', onVisibility);
      host.append(region);
    }

    function setExpanded(v) {
      if (expanded === v) return;
      expanded = v;
      layout();
    }

    /** Place every toast: a collapsed pile, or fanned out upwards while hovered. */
    function layout() {
      const live = items.filter((it) => !it.removing);
      if (!live.length) expanded = false;
      region.dataset.expanded = String(expanded);
      const frontHeight = live.length ? live[0].height : 0;
      let y = 0;
      let lastY = 0;
      live.forEach((it, i) => {
        const n = it.node;
        const visible = i < VISIBLE;
        n.dataset.front = String(i === 0);
        n.dataset.hidden = String(!visible);
        n.style.zIndex = String(100 - i);
        let ty, scale, height;
        if (expanded) {
          ty = visible ? y : lastY;
          scale = 1;
          height = it.height;
        } else {
          const k = Math.min(i, VISIBLE - 1);
          ty = k * PEEK;
          scale = 1 - k * SCALE_STEP;
          height = i === 0 ? it.height : frontHeight;
        }
        n.style.setProperty('--fft-y', -ty + 'px');
        n.style.setProperty('--fft-scale', String(scale));
        n.style.height = height + 'px';
        if (visible) { lastY = y; y += it.height + GAP; }
      });
      const shown = Math.min(live.length, VISIBLE);
      region.style.height = !live.length ? '0px' : expanded ? y - GAP + 'px' : frontHeight + (shown - 1) * PEEK + 'px';
    }

    function dismiss(item) {
      if (item.removing) return;
      const wasFront = items.find((it) => !it.removing) === item;
      item.removing = true;
      const n = item.node;
      n.dataset.removed = 'true';
      if (wasFront) n.style.setProperty('--fft-enter', '100%');
      else n.style.setProperty('--fft-scale', String((parseFloat(n.style.getPropertyValue('--fft-scale')) || 1) * 0.96));
      layout();
      setTimeout(() => {
        n.remove();
        const i = items.indexOf(item);
        if (i >= 0) items.splice(i, 1);
      }, EXIT_MS);
    }

    /**
     * Show a toast. message: string, or { title, description }.
     * kind: default | info | success | warning | error (see VARIANTS).
     * ms: time before it closes (default 5 s); 0 keeps it until closed.
     * Returns { dismiss }.
     */
    function show(message, kind = 'default', ms = DURATION) {
      ensureRegion();
      const variant = VARIANTS[kind] || 'default';
      const { title, description } = message && typeof message === 'object' ? message : { title: String(message ?? '') };
      const doc = region.ownerDocument;

      const node = el('div', `fft-toast fft--${variant}`);
      node.setAttribute('role', variant === 'danger' || variant === 'warning' ? 'alert' : 'status');
      node.setAttribute('aria-atomic', 'true');
      node.dataset.mounted = 'false';

      const icon = el('div', 'fft-icon');
      icon.append(svg(doc, ICONS[variant]));
      const content = el('div', 'fft-content');
      content.append(el('div', 'fft-title', title));
      if (description) content.append(el('div', 'fft-desc', description));
      const close = el('button', 'fft-close');
      close.type = 'button';
      close.setAttribute('aria-label', 'Close notification');
      close.append(svg(doc, CLOSE));
      node.append(icon, content, close);

      const item = { node, height: 0, removing: false };
      close.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); dismiss(item); });

      const duration = Number(ms ?? DURATION);
      if (Number.isFinite(duration) && duration > 0) {
        const track = el('div', 'fft-progress');
        const bar = el('div', 'fft-bar');
        bar.style.animationDuration = duration + 'ms';
        // The bar's countdown is the timer, so pausing it (hover, hidden tab) pauses the close too.
        bar.addEventListener('animationend', () => dismiss(item));
        track.append(bar);
        node.append(track);
      }

      region.append(node);
      item.height = node.offsetHeight; // natural height; also flushes the "before" state for the enter transition
      items.unshift(item);
      items.filter((it) => !it.removing).slice(MAX).forEach(dismiss);
      layout();
      void node.offsetHeight;
      node.dataset.mounted = 'true';
      return { dismiss: () => dismiss(item) };
    }

    function clear() {
      items.slice().forEach(dismiss);
    }

    return { show, clear };
  }

  FP.Toast = { create, DURATION };
})(globalThis);
