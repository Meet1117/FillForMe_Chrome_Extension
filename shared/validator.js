/**
 * Validates (and normalizes) a value for a field before it is filled.
 * Used for AI values: anything invalid is replaced by the random generator and
 * flagged with ⚠ in the UI.
 *
 *   validate(value, field) → { ok: true, value } | { ok: false, reason }
 */
(function (root) {
  'use strict';
  const FP = (root.FPShared = root.FPShared || {});
  if (FP.Validator) return;
  const Gen = FP.Gen;
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

  /** Find the option matching a value by value or visible text (exact first, then partial). */
  function matchOption(options, value) {
    const v = norm(value);
    if (!v) return null;
    const list = options || [];
    return (
      list.find((o) => norm(o.value) === v) ||
      list.find((o) => norm(o.text) === v) ||
      list.filter((o) => !Gen.isPlaceholderOption(o)).find((o) => norm(o.text).startsWith(v) || v.startsWith(norm(o.text))) ||
      list.filter((o) => !Gen.isPlaceholderOption(o)).find((o) => norm(o.text).includes(v) || norm(o.value).includes(v)) ||
      null
    );
  }

  /** Accepts YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY (if unambiguous), "12 Mar 2025", ISO datetimes. */
  function parseDateLoose(value, locale) {
    const s = String(value ?? '').trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
    if (m) {
      let [a, b] = [+m[1], +m[2]];
      // Day-first unless the locale is US or the first number can't be a day-of-month order.
      let day = a, month = b;
      if ((locale === 'US' && b <= 31 && a <= 12) || b > 12) { day = b; month = a; }
      return new Date(+m[3], month - 1, day);
    }
    const t = Date.parse(s);
    return isNaN(t) ? null : new Date(t);
  }

  const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function validate(raw, field, opts = {}) {
    const kind = field.kind;
    if (raw === null || raw === undefined) return { ok: false, reason: 'no value' };
    let value = Array.isArray(raw) ? raw.join(',') : typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
    value = value.trim();

    switch (kind) {
      case 'select':
      case 'radio': {
        const real = (field.options || []).filter((o) => !Gen.isPlaceholderOption(o));
        if (!real.length) return { ok: true, value }; // options may still be loading; the filler waits
        const opt = matchOption(field.options, value);
        if (!opt || Gen.isPlaceholderOption(opt)) return { ok: false, reason: `"${value}" is not one of the options` };
        return { ok: true, value: opt.value };
      }
      case 'custom-select':
        return value ? { ok: true, value } : { ok: false, reason: 'empty' };
      case 'checkbox': {
        const v = norm(value);
        if (['true', 'yes', 'y', '1', 'checked', 'on'].includes(v)) return { ok: true, value: 'true' };
        if (['false', 'no', 'n', '0', 'unchecked', 'off', ''].includes(v)) return { ok: true, value: 'false' };
        return { ok: false, reason: 'not true/false' };
      }
      case 'checkbox-group': {
        const parts = value.split(/\s*[,;|]\s*/).filter(Boolean);
        const matched = parts.map((p) => matchOption(field.options, p)).filter(Boolean);
        if (!matched.length) return { ok: false, reason: 'no matching options' };
        return { ok: true, value: [...new Set(matched.map((o) => o.value))].join(',') };
      }
      case 'number':
      case 'range': {
        const n = Number(value.replace(/[, ]/g, ''));
        if (!isFinite(n) || value === '') return { ok: false, reason: 'not a number' };
        if (field.min !== '' && field.min != null && n < +field.min) return { ok: false, reason: `below min ${field.min}` };
        if (field.max !== '' && field.max != null && n > +field.max) return { ok: false, reason: `above max ${field.max}` };
        return { ok: true, value: String(n) };
      }
      case 'date': {
        const d = parseDateLoose(value, opts.locale);
        if (!d || isNaN(d)) return { ok: false, reason: 'not a date' };
        const v = isoDate(d);
        if (field.min && v < field.min) return { ok: false, reason: `before ${field.min}` };
        if (field.max && v > field.max) return { ok: false, reason: `after ${field.max}` };
        return { ok: true, value: v };
      }
      case 'datetime-local': {
        const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})/.exec(value);
        if (!m) return { ok: false, reason: 'not a date-time' };
        return { ok: true, value: `${m[1]}T${pad(m[2])}:${m[3]}` };
      }
      case 'time': {
        const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i.exec(value);
        if (!m) return { ok: false, reason: 'not a time' };
        let h = +m[1];
        if (m[3]) h = (h % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0);
        if (h > 23 || +m[2] > 59) return { ok: false, reason: 'not a time' };
        return { ok: true, value: `${pad(h)}:${m[2]}` };
      }
      case 'month':
        return /^\d{4}-\d{2}$/.test(value) ? { ok: true, value } : { ok: false, reason: 'not YYYY-MM' };
      case 'week':
        return /^\d{4}-W\d{2}$/.test(value) ? { ok: true, value } : { ok: false, reason: 'not YYYY-Www' };
      case 'color':
        return /^#[0-9a-f]{6}$/i.test(value) ? { ok: true, value: value.toLowerCase() } : { ok: false, reason: 'not #rrggbb' };
      case 'file':
        return { ok: false, reason: 'file uploads are not supported yet' };
      default:
        break;
    }

    // Text-like fields.
    if (field.required && !value) return { ok: false, reason: 'empty' };
    if (kind === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { ok: false, reason: 'not an email' };
    if (kind === 'url' && value) {
      try { new URL(value); } catch { return { ok: false, reason: 'not a URL' }; }
    }
    const maxLen = parseInt(field.maxlength, 10);
    if (maxLen > 0 && value.length > maxLen) return { ok: false, reason: `longer than ${maxLen} characters` };
    const minLen = parseInt(field.minlength, 10);
    if (minLen > 0 && value.length < minLen) return { ok: false, reason: `shorter than ${minLen} characters` };
    if (field.pattern && value && !Gen.matchesPattern(value, field.pattern)) return { ok: false, reason: 'does not match the required format' };
    return { ok: true, value };
  }

  FP.Validator = { validate, matchOption, parseDateLoose };
})(globalThis);
