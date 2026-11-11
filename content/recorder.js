/**
 * Recorder (content side): captures field changes and meaningful clicks in this frame
 * and sends them to the service worker, which keeps the ordered step list.
 *
 * - Values are captured on `change` (and on blur for contenteditable), not per keystroke.
 * - Clicks on buttons / links / tabs / custom options are recorded; clicks that only
 *   focus or toggle a field are ignored (the resulting change is recorded instead).
 * - Changes made by FillForMe itself (FP.filling) and untrusted clicks are ignored.
 */
(function () {
  'use strict';
  const FP = (globalThis.__FP = globalThis.__FP || {});
  if (FP.recorder) return;
  const D = FP.dom;

  let active = false;
  let paused = false;
  let seq = 0;
  const editableStart = new WeakMap();

  const frameInfo = () => ({ top: window === window.top, url: location.origin + location.pathname });

  function send(step) {
    if (!active || paused) return;
    step.ts = Date.now() + (seq++ % 1000) / 1000;
    step.url = location.href;
    step.frame = frameInfo();
    try {
      chrome.runtime.sendMessage({ type: 'bg:rec-step', step }).catch(() => {});
    } catch {
      /* extension reloaded */
    }
  }

  function isField(el) {
    return !!el && el.matches && el.matches(D.FIELD_SELECTOR) && !(el.tagName === 'INPUT' && D.NON_FIELD_INPUTS.includes(el.type));
  }

  /** Build a "fill" step for a field element. */
  function fieldStep(el) {
    const meta = FP.scanner.describeElement(el);
    const kind = meta.kind;
    let value;
    let selectors;
    let label = meta.label;
    if (kind === 'radio') {
      value = el.value;
      selectors = D.buildSelectors(el, { label: D.getLabel(el) });
      meta.valueText = D.getLabel(el);
    } else if (kind === 'checkbox' || kind === 'checkbox-group') {
      // Each checkbox is its own step, even if it belongs to a group.
      const own = FP.scanner.describe({ el, kind: 'checkbox' }, -1);
      value = String(el.checked);
      selectors = own.selectors;
      label = own.label;
      Object.assign(meta, own);
    } else if (kind === 'contenteditable') {
      value = el.innerText.trim();
      selectors = meta.selectors;
    } else {
      value = el.value;
      selectors = meta.selectors;
    }
    delete meta.value;
    delete meta.selectors;
    delete meta.idx;
    return {
      action: 'fill',
      kind: meta.kind,
      selectors,
      label,
      value,
      field: meta,
      masked: el.type === 'password' || undefined,
      unsupported: kind === 'file' ? 'File uploads are not supported yet' : undefined,
    };
  }

  function onChange(e) {
    // Accept script-made changes too (date pickers, custom widgets) – but not our own fills.
    if (FP.filling) return;
    const el = e.composedPath ? e.composedPath()[0] : e.target;
    if (!isField(el) || D.isOwnUI(el)) return;
    if (el.isContentEditable) return; // handled on blur
    send(fieldStep(el));
  }

  function onFocusIn(e) {
    const el = e.target;
    if (el && el.isContentEditable && !D.isOwnUI(el)) editableStart.set(el, el.innerText);
  }

  function onFocusOut(e) {
    if (FP.filling) return;
    const el = e.target;
    if (!el || !el.isContentEditable || D.isOwnUI(el)) return;
    if (editableStart.get(el) !== el.innerText) send(fieldStep(el));
  }

  /** Find the clickable element for a click, or null if the click should be ignored. */
  function clickableFor(target) {
    if (!target || !target.closest) return null;
    // Clicks on fields or their labels only focus / toggle the field.
    if (isField(target) && !target.matches('[role="combobox"]:not(input)')) return null;
    if (target.closest('label') && !target.closest('button,a[href]')) return null;
    if (target.isContentEditable) return null;
    const c = target.closest(D.CLICKABLE_SELECTOR);
    if (c) {
      if (c.matches('input') && !['submit', 'button', 'reset', 'image'].includes(c.type)) return null;
      return c;
    }
    // Custom widgets without roles: something with a pointer cursor and short text.
    let n = target;
    for (let i = 0; i < 3 && n && n !== document.body; i++, n = n.parentElement) {
      const style = getComputedStyle(n);
      if (style.cursor === 'pointer') {
        const text = D.cleanText(n.innerText || '', 200);
        if (text && text.length <= 60) return n;
        return null;
      }
    }
    return null;
  }

  function onClick(e) {
    if (!e.isTrusted || e.button !== 0) return;
    const target = e.composedPath ? e.composedPath()[0] : e.target;
    if (D.isOwnUI(target) || (FP.overlay && FP.overlay.isHost(target))) return;
    const el = clickableFor(target);
    if (!el) return;
    const text = D.clickableText(el) || el.getAttribute('title') || el.tagName.toLowerCase();
    send({ action: 'click', selectors: D.buildSelectors(el), label: text });
  }

  function start(opts = {}) {
    paused = !!opts.paused;
    if (active) return;
    active = true;
    document.addEventListener('change', onChange, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
  }

  function stop() {
    active = false;
    paused = false;
    document.removeEventListener('change', onChange, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('focusout', onFocusOut, true);
  }

  function setPaused(p) {
    paused = !!p;
  }

  FP.recorder = { start, stop, setPaused, isActive: () => active };
})();
