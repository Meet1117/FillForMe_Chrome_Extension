/**
 * Counter templates for the "Counter" value mode.
 *   {{n}}         run number (keeps counting across sessions per recording)
 *   {{date}}      today as YYYY-MM-DD
 *   {{time}}      current time as HHmmss (safe inside emails / ids)
 *   {{random:4}}  4 random digits ({{random}} = 4 digits)
 */
(function (root) {
  'use strict';
  const FP = (root.FPShared = root.FPShared || {});
  if (FP.Templates) return;

  const pad = (n, w = 2) => String(n).padStart(w, '0');

  function expand(template, ctx = {}) {
    const now = ctx.now ? new Date(ctx.now) : new Date();
    return String(template ?? '').replace(/\{\{\s*([a-z]+)(?::(\d+))?\s*\}\}/gi, (match, name, arg) => {
      switch (name.toLowerCase()) {
        case 'n':
          return String(ctx.n ?? 1);
        case 'date':
          return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        case 'time':
          return `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        case 'random': {
          const len = Math.min(Math.max(parseInt(arg || '4', 10), 1), 12);
          let s = '';
          for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10);
          return s;
        }
        default:
          return match; // unknown placeholder stays visible so the user notices
      }
    });
  }

  /** Does the text contain at least one placeholder? */
  function hasPlaceholder(text) {
    return /\{\{\s*(n|date|time|random)(:\d+)?\s*\}\}/i.test(String(text || ''));
  }

  /** Turn a recorded value into a sensible starting template, e.g. "test@mail.com" → "test{{n}}@mail.com". */
  function suggest(value) {
    const v = String(value || '');
    if (!v) return 'Sample-{{n}}';
    if (hasPlaceholder(v)) return v;
    const at = v.indexOf('@');
    if (at > 0) return v.slice(0, at) + '{{n}}' + v.slice(at);
    if (/\d+$/.test(v)) return v.replace(/\d+$/, '{{n}}');
    return v + '-{{n}}';
  }

  FP.Templates = { expand, hasPlaceholder, suggest };
})(globalThis);
