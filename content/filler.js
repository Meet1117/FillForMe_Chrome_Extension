/**
 * Filler: puts values into fields in a way React / Angular / Vue notice.
 *
 * - Text-like inputs use the *native* value setter (bypassing React's value tracker)
 *   and dispatch focus → input → change → blur, all bubbling.
 * - Selects match by value or visible text and wait for options that load late.
 * - Checkboxes / radios are clicked when their state must change.
 * - Custom (div-based) dropdowns: open, wait, click the matching option.
 * - Every fill can be recorded for one-click Undo.
 */
(function () {
  'use strict';
  const FP = (globalThis.__FP = globalThis.__FP || {});
  if (FP.filler) return;
  const D = FP.dom;
  const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

  /* ---------- low-level helpers ---------- */

  function nativeSetter(el, prop = 'value') {
    const proto =
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    return Object.getOwnPropertyDescriptor(proto, prop).set;
  }

  /** Set .value through the prototype setter so frameworks see the change. */
  function setNativeValue(el, value) {
    nativeSetter(el).call(el, value);
  }

  function fire(el, type) {
    let ev;
    if (type === 'focus' || type === 'blur' || type === 'focusin' || type === 'focusout') {
      ev = new FocusEvent(type, { bubbles: true, composed: true });
    } else if (type === 'input') {
      ev = new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText' });
    } else {
      ev = new Event(type, { bubbles: true, composed: true });
    }
    el.dispatchEvent(ev);
  }

  function mouse(el, type) {
    const r = el.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    const Ctor = type.startsWith('pointer') && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
    el.dispatchEvent(new Ctor(type, init));
  }

  /** Click like a user: pointer/mouse down + up, then a real click (keeps default actions). */
  function clickLikeUser(el) {
    FP.filling = (FP.filling || 0) + 1;
    setTimeout(() => { FP.filling--; }, 50);
    mouse(el, 'pointerdown');
    mouse(el, 'mousedown');
    mouse(el, 'pointerup');
    mouse(el, 'mouseup');
    el.click();
  }

  /* ---------- per-kind fillers ---------- */

  function setText(el, value) {
    fire(el, 'focus');
    fire(el, 'focusin');
    setNativeValue(el, value);
    fire(el, 'input');
    fire(el, 'change');
    fire(el, 'blur');
    fire(el, 'focusout');
  }

  function setChecked(el, want) {
    if (el.checked === want) return;
    el.click(); // fires click → input → change like a user
    if (el.checked !== want) {
      // The page prevented the click; set it directly.
      nativeSetter(el, 'checked').call(el, want);
      fire(el, 'input');
      fire(el, 'change');
    }
  }

  function optionList(select) {
    return Array.from(select.options).map((o) => ({ value: o.value, text: o.text, disabled: o.disabled }));
  }

  /** Wait until a select has real (non-placeholder) options, e.g. after an API call. */
  async function waitForOptions(select, timeout = 4000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (!select.disabled && FPShared.Gen.realOptions({ options: optionList(select) }).length) return true;
      await D.sleep(150);
    }
    return false;
  }

  async function fillSelect(el, value, { optionTimeout = 4000 } = {}) {
    const end = Date.now() + optionTimeout;
    let opt = null;
    for (;;) {
      if (!el.disabled) opt = FPShared.Validator.matchOption(optionList(el), value);
      if (opt || Date.now() > end) break;
      await D.sleep(150);
    }
    if (!opt) return { ok: false, error: `Option "${value}" not found` };
    fire(el, 'focus');
    setNativeValue(el, opt.value);
    fire(el, 'input');
    fire(el, 'change');
    fire(el, 'blur');
    return { ok: true, value: opt.value };
  }

  function fillRadio(group, value) {
    const want = norm(value);
    const radio =
      group.find((r) => norm(r.value) === want) ||
      group.find((r) => norm(D.getLabel(r)) === want) ||
      group.find((r) => norm(D.getLabel(r)).includes(want));
    if (!radio) return { ok: false, error: `Option "${value}" not found` };
    if (!radio.checked) setChecked(radio, true);
    return { ok: true, value: radio.value };
  }

  function fillCheckboxGroup(group, value) {
    const wanted = new Set(String(value).split(/\s*[,;|]\s*/).filter(Boolean).map(norm));
    for (const c of group) setChecked(c, wanted.has(norm(c.value)) || wanted.has(norm(D.getLabel(c))));
    return { ok: true, value };
  }

  function fillEditable(el, value) {
    el.focus({ preventScroll: true });
    const sel = window.getSelection();
    sel.selectAllChildren(el);
    let ok = false;
    try { ok = document.execCommand('insertText', false, value); } catch { ok = false; }
    if (!ok || norm(el.innerText) !== norm(value)) {
      el.textContent = value;
      fire(el, 'input');
    }
    fire(el, 'change');
    el.blur();
    return { ok: true, value };
  }

  const OPTION_SELECTOR = '[role="option"], [role="listbox"] li, [class*="__option"], [class*="-option"]:not([class*="options"])';

  function visibleOptions() {
    return Array.from(document.querySelectorAll(OPTION_SELECTOR)).filter(
      (o) => D.isVisible(o) && !D.isOwnUI(o) && o.getAttribute('aria-disabled') !== 'true'
    );
  }

  /** Best effort for div-based dropdowns (react-select, MUI, headless UI…). */
  async function fillCustomSelect(el, value, { random = false } = {}) {
    if (el.tagName === 'INPUT') {
      el.focus({ preventScroll: true });
      mouse(el, 'mousedown');
      if (value && !random) {
        setNativeValue(el, value);
        fire(el, 'input');
      }
    } else {
      mouse(el, 'pointerdown');
      mouse(el, 'mousedown');
      mouse(el, 'mouseup');
      await D.sleep(120);
      if (!visibleOptions().length) el.click();
    }
    let opts = [];
    for (let t = 0; t < 3000 && !opts.length; t += 150) {
      await D.sleep(150);
      opts = visibleOptions();
    }
    if (!opts.length) return { ok: false, error: 'The dropdown options did not appear' };
    const want = norm(value);
    let target = null;
    if (want && !random) {
      target = opts.find((o) => norm(o.textContent) === want) || opts.find((o) => norm(o.textContent).includes(want));
    }
    if (!target && (random || !want)) target = FPShared.Gen._helpers.pick(opts);
    if (!target) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return { ok: false, error: `Option "${value}" not found in the dropdown` };
    }
    const text = D.cleanText(target.textContent);
    clickLikeUser(target);
    return { ok: true, value: text };
  }

  /**
   * Fill one scanner target with a final value.
   * Returns { ok, value?, error?, skipped? }.
   */
  async function fillTarget(target, value, opts = {}) {
    FP.filling = (FP.filling || 0) + 1; // the recorder ignores changes made by FillForMe
    try {
      return await fillTargetNow(target, value, opts);
    } finally {
      // Events from a fill can be dispatched a tick later (e.g. after a click); keep the flag briefly.
      setTimeout(() => { FP.filling--; }, 50);
    }
  }

  async function fillTargetNow(target, value, opts = {}) {
    const el = target.el || target.group[0];
    if (opts.scroll) {
      try { el.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch { /* ignore */ }
    }
    switch (target.kind) {
      case 'file':
        return { ok: false, skipped: true, error: 'File uploads are not supported yet' };
      case 'select':
        return fillSelect(el, value, opts);
      case 'checkbox':
        setChecked(el, String(value) === 'true');
        return { ok: true, value: String(el.checked) };
      case 'radio':
        return fillRadio(target.group, value);
      case 'checkbox-group':
        return fillCheckboxGroup(target.group, value);
      case 'contenteditable':
        return fillEditable(el, value);
      case 'custom-select':
        return fillCustomSelect(el, value, opts);
      default:
        setText(el, String(value ?? ''));
        return { ok: true, value };
    }
  }

  /* ---------- undo ---------- */

  let undoStack = [];

  /** Start a new undo group (the next Undo restores values from before this point). */
  function beginUndo() {
    undoStack = [];
  }

  /** Remember a target's value before it is changed (first value wins). */
  function remember(target) {
    if (undoStack.some((s) => s.target === target || (s.target.el && s.target.el === target.el))) return;
    undoStack.push({ target, value: FP.scanner.currentValue(target) });
  }

  async function undo() {
    let restored = 0;
    for (const { target, value } of undoStack.slice().reverse()) {
      const el = target.el || target.group[0];
      if (!el.isConnected || target.kind === 'custom-select' || target.kind === 'file') continue;
      if (target.kind === 'radio' && !value) {
        target.group.forEach((r) => {
          if (r.checked) { nativeSetter(r, 'checked').call(r, false); fire(r, 'change'); }
        });
      } else {
        await fillTarget(target, value, { optionTimeout: 0 });
      }
      restored++;
    }
    undoStack = [];
    return { restored };
  }

  function canUndo() {
    return undoStack.length > 0;
  }

  FP.filler = { setNativeValue, setText, setChecked, clickLikeUser, fillTarget, waitForOptions, beginUndo, remember, undo, canUndo };
})();
