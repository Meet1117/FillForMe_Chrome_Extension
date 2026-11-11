/**
 * DOM helpers shared by the scanner, filler and recorder:
 * visibility, label / help / section detection, stable selectors, and waitForElement.
 */
(function () {
  'use strict';
  // After the extension is reloaded/updated, scripts from the old version may still be
  // on the page with a dead runtime. Tear them down so this fresh copy can start.
  const prev = globalThis.__FP;
  if (prev && typeof prev.alive === 'function' && !prev.alive()) {
    try { prev.teardown && prev.teardown(); } catch { /* ignore */ }
    globalThis.__FP = {};
  }
  const FP = (globalThis.__FP = globalThis.__FP || {});
  if (FP.dom) return;

  const HOST_ID = 'formpilot-overlay-host';
  const FIELD_SELECTOR = [
    'input', 'select', 'textarea',
    '[contenteditable=""]', '[contenteditable="true"]', '[contenteditable="plaintext-only"]',
    '[role="combobox"]:not(input)',
  ].join(',');
  const NON_FIELD_INPUTS = ['hidden', 'submit', 'button', 'reset', 'image'];
  const CLICKABLE_SELECTOR = [
    'button', 'a[href]', 'input[type="submit"]', 'input[type="button"]', 'input[type="reset"]',
    'input[type="image"]', '[role="button"]', '[role="tab"]', '[role="link"]', '[role="menuitem"]',
    '[role="option"]', '[role="switch"]', '[role="combobox"]:not(input)', 'summary', '[onclick]',
  ].join(',');

  /** Collapse whitespace and cap the length. */
  function cleanText(s, max = 120) {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  }

  /** Is this element part of FillForMe's own overlay? */
  function isOwnUI(el) {
    return !!el && (el.id === HOST_ID || !!(el.closest && el.closest('#' + HOST_ID)));
  }

  /** Is an element rendered and visible to the user? */
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return true;
    return false;
  }

  /**
   * Fields count as visible if they are visible, or – for custom-styled checkboxes /
   * radios that hide the real input – if their label is visible.
   */
  function isFieldVisible(el) {
    if (isVisible(el)) return true;
    if (el.type === 'checkbox' || el.type === 'radio') {
      const label = (el.labels && el.labels[0]) || el.closest('label');
      return !!label && isVisible(label);
    }
    return false;
  }

  function isEnabled(el) {
    if (el.disabled) return false;
    if (el.closest && el.closest('fieldset[disabled]')) return false;
    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return false;
    return true;
  }

  function isEditable(el) {
    return isEnabled(el) && !el.readOnly;
  }

  /** Visible text of an element without the text of nested form controls. */
  function textWithoutControls(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('input,select,textarea,button,script,style,[aria-hidden="true"]').forEach((n) => n.remove());
    return cleanText(clone.textContent);
  }

  function textOfIds(ids) {
    return cleanText(
      String(ids || '')
        .split(/\s+/)
        .map((id) => {
          const n = id && document.getElementById(id);
          return n ? n.textContent : '';
        })
        .join(' ')
    );
  }

  /** A control that would "own" a piece of text if they're in the same group. */
  function isControl(n) {
    return n.matches && n.matches('input:not([type=hidden]),select,textarea,[contenteditable="true"],[role=combobox]');
  }

  /**
   * Nearest preceding text in the same form group: walk previous siblings
   * (and then up a few ancestors) until we find text that isn't another control.
   */
  function precedingText(el) {
    const CONTROLS = 'input:not([type=hidden]),select,textarea,[contenteditable="true"],[role=combobox]';
    let node = el;
    for (let depth = 0; depth < 4 && node && node !== document.body; depth++) {
      for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
        if (isOwnUI(sib)) continue;
        // Another field group before us: its text belongs to that field, so stop.
        if (isControl(sib) || sib.querySelector(CONTROLS)) return '';
        const t = textWithoutControls(sib);
        if (t) return t.length <= 80 ? t : '';
      }
      const parent = node.parentElement;
      if (!parent || parent.querySelectorAll(CONTROLS).length > 1) return '';
      node = parent;
    }
    return '';
  }

  /** Label text for a field, tried in the documented order. */
  function getLabel(el) {
    if (!el) return '';
    // 1. label[for]
    if (el.id) {
      try {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l) { const t = textWithoutControls(l); if (t) return t; }
      } catch { /* ignore */ }
    }
    // 2. wrapping <label>
    const wrap = el.closest && el.closest('label');
    if (wrap) { const t = textWithoutControls(wrap); if (t) return t; }
    // 3. aria-labelledby
    const lb = el.getAttribute && el.getAttribute('aria-labelledby');
    if (lb) { const t = textOfIds(lb); if (t) return t; }
    // 4. aria-label
    const al = el.getAttribute && el.getAttribute('aria-label');
    if (al) return cleanText(al);
    // 5. nearest preceding text / heading in the same group
    const pre = precedingText(el);
    if (pre) return pre;
    // Fallbacks that still help humans.
    return cleanText(el.getAttribute('placeholder') || el.getAttribute('title') || el.name || el.id || '');
  }

  /** Label for a radio / checkbox group: legend, role=radiogroup label, or text before the group. */
  function getGroupLabel(elements) {
    const first = elements[0];
    const fs = first.closest('fieldset');
    if (fs) {
      const legend = fs.querySelector('legend');
      if (legend) return cleanText(legend.textContent);
    }
    const group = first.closest('[role="radiogroup"],[role="group"]');
    if (group) {
      const t = group.getAttribute('aria-label') || textOfIds(group.getAttribute('aria-labelledby'));
      if (t) return cleanText(t);
    }
    // Lowest common ancestor of the group, then the text right before it.
    let lca = first.parentElement;
    while (lca && !elements.every((e) => lca.contains(e))) lca = lca.parentElement;
    if (lca) {
      const t = precedingText(lca);
      if (t) return t;
    }
    return cleanText(first.name || '');
  }

  /** Helper / hint text near a field. */
  function getHelpText(el) {
    const ids = el.getAttribute && el.getAttribute('aria-describedby');
    if (ids) { const t = textOfIds(ids); if (t) return t; }
    let sib = el.nextElementSibling;
    for (let i = 0; i < 3 && sib; i++, sib = sib.nextElementSibling) {
      if (sib.matches('small,.help,.hint,.form-text,.helper-text,[class*="help"],[class*="hint"],[class*="description"]')) {
        return cleanText(sib.textContent);
      }
    }
    const group = el.parentElement;
    const hint = group && group.querySelector(':scope > small, :scope > .help, :scope > .hint, :scope > .form-text, :scope > [class*="helper"]');
    return hint ? cleanText(hint.textContent) : '';
  }

  /** The heading of the section / step containing a field. */
  function getSectionHeading(el) {
    let best = null;
    for (const h of document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')) {
      if (isOwnUI(h) || !isVisible(h)) continue;
      if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) best = h;
    }
    if (best) return cleanText(best.textContent, 80);
    const legend = el.closest('fieldset')?.querySelector(':scope > legend');
    return legend ? cleanText(legend.textContent, 80) : '';
  }

  /* ---------- selectors ---------- */

  /** IDs that look auto-generated (":r1:", "input-1234", "mui-42", uuid-ish) are unreliable. */
  function isDynamicId(id) {
    return /:|^\d|\d{3,}|[a-f0-9]{8,}|^(mui|react|ember|ext|rc|headlessui|radix)[-_]/i.test(id);
  }

  function attrSelector(attr, value, tag = '') {
    return `${tag}[${attr}="${CSS.escape(value)}"]`;
  }

  /** Short CSS path (last resort). */
  function cssPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      if (node.id && !isDynamicId(node.id)) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      const parent = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  }

  /** Visible text for a clickable element (button text, aria-label, value, title). */
  function clickableText(el) {
    return cleanText(
      el.getAttribute('aria-label') ||
        (el.tagName === 'INPUT' ? el.value : '') ||
        el.innerText ||
        el.textContent ||
        el.getAttribute('title') ||
        '',
      60
    );
  }

  /**
   * Several ways to find this element again, best first.
   * Priority: id → name → data-testid → aria-label → label/text → css path.
   */
  function buildSelectors(el, { label } = {}) {
    const out = [];
    const tag = el.tagName.toLowerCase();
    const id = el.id;
    const dynamic = id && isDynamicId(id);
    if (id && !dynamic) out.push({ type: 'id', value: id });
    const name = el.getAttribute('name');
    if (name) {
      const sel = attrSelector('name', name, tag);
      const all = document.querySelectorAll(sel);
      if (el.type === 'radio' || el.type === 'checkbox') {
        out.push({ type: 'css', value: `${sel}[value="${CSS.escape(el.value)}"]` });
        if (el.type === 'radio') out.push({ type: 'name', value: name, tag });
      } else out.push({ type: 'name', value: name, tag, index: all.length > 1 ? Array.from(all).indexOf(el) : 0 });
    }
    for (const attr of ['data-testid', 'data-test', 'data-cy', 'data-qa']) {
      const v = el.getAttribute(attr);
      if (v) { out.push({ type: 'css', value: attrSelector(attr, v) }); break; }
    }
    const aria = el.getAttribute('aria-label');
    if (aria) out.push({ type: 'css', value: attrSelector('aria-label', aria, tag) });
    if (el.matches(FIELD_SELECTOR)) {
      const l = label || getLabel(el);
      if (l) out.push({ type: 'label', value: l });
    } else {
      const t = clickableText(el);
      if (t) out.push({ type: 'text', value: t, tag });
    }
    if (dynamic) out.push({ type: 'id', value: id });
    out.push({ type: 'css', value: cssPath(el) });
    return out;
  }

  /** All candidate fields in the document (visible or not). */
  function allFields() {
    return Array.from(document.querySelectorAll(FIELD_SELECTOR)).filter(
      (el) => !isOwnUI(el) && !(el.tagName === 'INPUT' && NON_FIELD_INPUTS.includes(el.type))
    );
  }

  /** Resolve one selector to the matching elements. */
  function resolveOne(sel) {
    try {
      switch (sel.type) {
        case 'id': {
          const el = document.getElementById(sel.value);
          return el ? [el] : [];
        }
        case 'name': {
          const list = Array.from(document.querySelectorAll(attrSelector('name', sel.value, sel.tag || '')));
          if (sel.index && list[sel.index]) return [list[sel.index], ...list.filter((_, i) => i !== sel.index)];
          return list;
        }
        case 'css':
          return Array.from(document.querySelectorAll(sel.value));
        case 'label': {
          const want = sel.value.toLowerCase();
          return allFields().filter((el) => getLabel(el).toLowerCase() === want);
        }
        case 'text': {
          const want = sel.value.toLowerCase();
          const cands = Array.from(document.querySelectorAll(sel.tag ? `${sel.tag},${CLICKABLE_SELECTOR}` : CLICKABLE_SELECTOR));
          const exact = cands.filter((el) => !isOwnUI(el) && clickableText(el).toLowerCase() === want);
          return exact.length ? exact : cands.filter((el) => !isOwnUI(el) && clickableText(el).toLowerCase().startsWith(want));
        }
        default:
          return [];
      }
    } catch {
      return [];
    }
  }

  /**
   * Find the first element matching any selector (in priority order) that passes
   * the checks (visible / enabled). Returns null if nothing matches right now.
   */
  function findElement(selectors, { visible = true, enabled = true } = {}) {
    for (const sel of selectors || []) {
      const els = resolveOne(sel);
      for (const el of els) {
        if (isOwnUI(el)) continue;
        if (visible && !isFieldVisible(el)) continue;
        if (enabled && !isEnabled(el)) continue;
        return el;
      }
    }
    return null;
  }

  /**
   * Wait until an element matching the selectors appears (MutationObserver + polling).
   * Resolves with the element, or null after `timeout` ms.
   */
  function waitForElement(selectors, { timeout = 10000, visible = true, enabled = true, signal } = {}) {
    return new Promise((resolve) => {
      const check = () => findElement(selectors, { visible, enabled });
      const found = check();
      if (found) return resolve(found);
      let done = false;
      const finish = (el) => {
        if (done) return;
        done = true;
        observer.disconnect();
        clearInterval(poll);
        clearTimeout(timer);
        resolve(el);
      };
      const observer = new MutationObserver(() => {
        const el = check();
        if (el) finish(el);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      const poll = setInterval(() => {
        if (signal && signal.aborted) return finish(null);
        const el = check();
        if (el) finish(el);
      }, 250);
      const timer = setTimeout(() => finish(null), timeout);
    });
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  FP.dom = {
    HOST_ID, FIELD_SELECTOR, NON_FIELD_INPUTS, CLICKABLE_SELECTOR,
    cleanText, isOwnUI, isVisible, isFieldVisible, isEnabled, isEditable,
    getLabel, getGroupLabel, getHelpText, getSectionHeading, clickableText,
    buildSelectors, cssPath, isDynamicId, allFields, resolveOne, findElement, waitForElement, sleep,
  };
})();
