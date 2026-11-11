/**
 * Field Scanner: finds all visible, enabled fields in the current step and describes
 * them (label, constraints, options, selectors…). Radios become one field per group;
 * checkboxes sharing a name become a "checkbox-group".
 *
 * The last scan's targets are kept in FP.scanner.targets so later calls (fill, badges)
 * can refer to fields by index.
 */
(function () {
  'use strict';
  const FP = (globalThis.__FP = globalThis.__FP || {});
  if (FP.scanner) return;
  const D = FP.dom;

  const INPUT_KINDS = ['text', 'email', 'tel', 'url', 'password', 'search', 'number', 'range', 'date', 'time',
    'datetime-local', 'month', 'week', 'color', 'checkbox', 'radio', 'file'];

  /** Field kind used everywhere else (generator, validator, filler). */
  function kindOf(el) {
    const tag = el.tagName;
    if (tag === 'SELECT') return 'select';
    if (tag === 'TEXTAREA') return 'textarea';
    if (tag === 'INPUT') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (el.getAttribute('role') === 'combobox' && el.getAttribute('aria-autocomplete') && !el.list) return 'custom-select';
      return INPUT_KINDS.includes(t) ? t : 'text';
    }
    if (el.getAttribute('role') === 'combobox') return 'custom-select';
    if (el.isContentEditable) return 'contenteditable';
    return 'text';
  }

  function elementsOf(target) {
    return target.group || [target.el];
  }

  /** Current value of a target as a string (checkbox → "true"/"false"). */
  function currentValue(target) {
    const kind = target.kind;
    const el = elementsOf(target)[0];
    switch (kind) {
      case 'checkbox': return String(!!el.checked);
      case 'radio': {
        const c = target.group.find((r) => r.checked);
        return c ? c.value : '';
      }
      case 'checkbox-group': return target.group.filter((c) => c.checked).map((c) => c.value).join(',');
      case 'contenteditable': return el.innerText.trim();
      case 'custom-select': return el.tagName === 'INPUT' ? el.value : D.cleanText(el.textContent);
      case 'select': return el.value;
      default: return el.value ?? '';
    }
  }

  function isEmptyValue(target, value) {
    if (target.kind === 'checkbox') return value !== 'true';
    if (target.kind === 'select') {
      const opt = target.el.selectedOptions && target.el.selectedOptions[0];
      return !opt || FPShared.Gen.isPlaceholderOption({ value: opt.value, text: opt.text, disabled: false });
    }
    return !value;
  }

  function optionsOf(target) {
    const el = elementsOf(target)[0];
    if (target.kind === 'select') {
      return Array.from(el.options).map((o) => ({ value: o.value, text: D.cleanText(o.text, 80), disabled: o.disabled || undefined }));
    }
    if (target.kind === 'radio' || target.kind === 'checkbox-group') {
      return target.group.map((r) => ({ value: r.value, text: D.getLabel(r) || r.value }));
    }
    return undefined;
  }

  /** Full description of a target, ready to be sent to the AI or the side panel. */
  function describe(target, idx) {
    const els = elementsOf(target);
    const el = els[0];
    const isGroup = target.kind === 'radio' || target.kind === 'checkbox-group';
    const label = isGroup ? D.getGroupLabel(els) : D.getLabel(el);
    const attr = (n) => (el.getAttribute(n) ?? '');
    const value = currentValue(target);
    const meta = {
      idx,
      kind: target.kind,
      tag: el.tagName.toLowerCase(),
      type: el.type || '',
      name: attr('name'),
      id: el.id || '',
      testid: attr('data-testid'),
      ariaLabel: attr('aria-label'),
      label,
      placeholder: attr('placeholder'),
      help: D.getHelpText(el),
      section: D.getSectionHeading(el),
      autocomplete: attr('autocomplete'),
      required: els.some((e) => e.required || e.getAttribute('aria-required') === 'true'),
      min: attr('min'),
      max: attr('max'),
      maxlength: el.maxLength > 0 ? String(el.maxLength) : attr('maxlength'),
      minlength: el.minLength > 0 ? String(el.minLength) : '',
      pattern: attr('pattern'),
      step: attr('step'),
      options: optionsOf(target),
      value: target.kind === 'password' ? '' : value,
      empty: isEmptyValue(target, value),
      selectors: D.buildSelectors(el, { label: isGroup ? undefined : label }),
    };
    if (target.kind === 'file') meta.unsupported = 'File uploads are not supported yet';
    meta.fingerprint = `${meta.kind}:${meta.name || meta.id || label}`;
    return meta;
  }

  /** Build a target ({ el, kind } or { group, kind }) for one element. */
  function targetFor(el) {
    const kind = kindOf(el);
    if ((kind === 'radio' || kind === 'checkbox') && el.name) {
      const scope = el.form || document;
      const group = Array.from(scope.querySelectorAll(`input[type="${kind}"][name="${CSS.escape(el.name)}"]`)).filter(
        (r) => !el.form ? !r.form : true
      );
      if (kind === 'radio') return { group, kind: 'radio' };
      if (group.length > 1) return { group, kind: 'checkbox-group' };
    }
    if (kind === 'radio') return { group: [el], kind: 'radio' };
    return { el, kind };
  }

  /** Scan the page. Returns field descriptions; keeps the targets for later calls. */
  function scan() {
    const targets = [];
    const seen = new Set();
    for (const el of D.allFields()) {
      if (seen.has(el)) continue;
      if (el.isContentEditable && el.parentElement && el.parentElement.isContentEditable) continue;
      if (!D.isFieldVisible(el) || !D.isEditable(el)) continue;
      const t = targetFor(el);
      elementsOf(t).forEach((e) => seen.add(e));
      targets.push(t);
    }
    FP.scanner.targets = targets;
    return targets.map((t, i) => describe(t, i));
  }

  /** Describe a single element (used by the recorder). */
  function describeElement(el) {
    return describe(targetFor(el), -1);
  }

  /** Fingerprint of the visible fields: changes when a multi-step form moves to a new step. */
  function stepFingerprint() {
    return D.allFields()
      .filter((el) => D.isFieldVisible(el))
      .map((el) => `${el.tagName}:${el.name || el.id || D.getLabel(el)}`)
      .join('|');
  }

  FP.scanner = { scan, describe, describeElement, targetFor, kindOf, currentValue, stepFingerprint, targets: [] };
})();
