/**
 * Content-script entry point. Exposes FP.api – the methods the service worker calls
 * via chrome.scripting.executeScript (see background/bridge.js) – and on page load
 * asks the worker whether a recording / playback is active for this tab.
 */
(function () {
  'use strict';
  const FP = (globalThis.__FP = globalThis.__FP || {});
  if (FP.api) return;
  const { Gen, Validator } = globalThis.FPShared;
  const D = FP.dom;
  const isTop = window === window.top;

  function send(msg) {
    try {
      return chrome.runtime.sendMessage(msg).catch(() => null);
    } catch {
      return Promise.resolve(null); // extension was reloaded; this script is orphaned
    }
  }

  /** Get a scanner target by index, re-scanning if the page re-rendered it. */
  function targetAt(idx, fingerprint) {
    let t = FP.scanner.targets[idx];
    const el = t && (t.el || t.group[0]);
    if (el && el.isConnected) return t;
    if (!fingerprint) return null;
    const fields = FP.scanner.scan();
    const f = fields.find((x) => x.fingerprint === fingerprint);
    return f ? FP.scanner.targets[f.idx] : null;
  }

  /**
   * Decide the final value for a target.
   *   source 'random' (or no value) → built-in generator using the live field
   *   source 'ai'                    → validate; invalid → random + warning
   *   source 'user'/'fixed'          → used as-is
   */
  async function resolveValue(target, value, source, ctx) {
    const el = target.el || target.group[0];
    let meta = FP.scanner.describe(target, -1);
    const needsOptions = target.kind === 'select';
    if (source === 'random' || value === null || value === undefined) {
      if (needsOptions) { await FP.filler.waitForOptions(el, ctx.optionTimeout ?? 4000); meta = FP.scanner.describe(target, -1); }
      return { value: Gen.valueFor(meta, ctx.persona), random: true };
    }
    if (source === 'ai') {
      let check = Validator.validate(value, meta, { locale: ctx.locale });
      if (check.ok && needsOptions && !Gen.realOptions(meta).length) {
        // Options still loading (dependent dropdown): wait, then check again.
        await FP.filler.waitForOptions(el, ctx.optionTimeout ?? 4000);
        meta = FP.scanner.describe(target, -1);
        check = Validator.validate(value, meta, { locale: ctx.locale });
      }
      if (!check.ok) {
        if (needsOptions) { await FP.filler.waitForOptions(el, 1500); meta = FP.scanner.describe(target, -1); }
        return { value: Gen.valueFor(meta, ctx.persona), random: true, warning: `AI value ${JSON.stringify(String(value).slice(0, 40))} ${check.reason} – used a random value` };
      }
      return { value: check.value };
    }
    return { value };
  }

  /** Fill a target and fall back to a random value once if the given value can't be used. */
  async function fillWithFallback(target, value, source, ctx) {
    const r = await resolveValue(target, value, source, ctx);
    let res = await FP.filler.fillTarget(target, r.value, { optionTimeout: ctx.optionTimeout ?? 4000, random: r.random, scroll: ctx.scroll });
    let warning = r.warning;
    if (!res.ok && !res.skipped && !r.random) {
      const again = await resolveValue(target, null, 'random', ctx);
      const res2 = await FP.filler.fillTarget(target, again.value, { optionTimeout: 1500, random: true, scroll: ctx.scroll });
      if (res2.ok) {
        warning = `${res.error} – used a random value`;
        res = res2;
      }
    }
    return { ...res, warning };
  }

  /* ---------- multi-step helpers ---------- */

  const NEXT_RE = /^(next|continue|proceed|forward|go to next|next step|save\s*(&|and)\s*(next|continue|proceed))\b|\b(next|continue)\s*[›»>→]*$/i;
  const BACK_RE = /\b(back|previous|prev|cancel|reset|clear|close|skip|draft)\b/i;
  /** Submit-like button text, best match first ("Submit" beats "Save"). Keep in sync with shared/steps.js. */
  const SUBMIT_PRIORITY = [
    /\bsubmit\b/i,
    /\b(place order|pay|confirm|finish|complete|register|sign up|book|apply|send)\b/i,
    /\b(create|save|update|done)\b/i,
  ];

  function findSubmit(all) {
    for (const re of SUBMIT_PRIORITY) {
      const el = all.find((b) => { const t = D.clickableText(b); return re.test(t) && !BACK_RE.test(t) && !NEXT_RE.test(t); });
      if (el) return el;
    }
    // A real submit button of a form, whatever its text.
    return all.find((b) => b.matches('button[type="submit"], input[type="submit"]') && !BACK_RE.test(D.clickableText(b)) && !NEXT_RE.test(D.clickableText(b))) || null;
  }

  function clickables() {
    return Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a, [role="button"]')).filter(
      (el) => !D.isOwnUI(el) && D.isVisible(el) && D.isEnabled(el)
    );
  }

  function findNextElement(saved) {
    if (saved && saved.length) {
      const el = D.findElement(saved);
      if (el) return { kind: 'next', el };
    }
    const all = clickables();
    const next = all.find((el) => { const t = D.clickableText(el); return NEXT_RE.test(t) && !BACK_RE.test(t); });
    if (next) return { kind: 'next', el: next };
    const submit = findSubmit(all);
    if (submit) return { kind: 'submit', el: submit };
    return { kind: 'none' };
  }

  /* ---------- floating bar ---------- */

  function showBar(state) {
    if (!isTop) return;
    if (!state) return FP.overlay.hideBar();
    FP.overlay.showBar(state, (action) => {
      if (action.startsWith('fill-')) disarm();
      send({ type: 'bg:bar-action', action });
    });
  }

  /* ---------- Fill shortcut: "Press Enter to fill" ---------- */

  let armed = null; // { total } while waiting for Enter

  function armedBar() {
    const n = FP.overlay.selectedCount();
    return {
      mode: 'fill',
      status: 'running',
      main: 'Press Enter to fill',
      sub: `${n} of ${armed.total} fields selected. Esc to cancel.`,
      buttons: [{ id: 'fill-cancel', label: 'Cancel' }, { id: 'fill-go', label: 'Fill', kind: 'primary' }],
    };
  }

  function finishArmed(action) {
    disarm();
    send({ type: 'bg:bar-action', action });
  }

  /** While armed, Enter fills and Esc cancels – and neither reaches the page (no accidental submit). */
  function onArmedKey(e) {
    if (!armed || e.isComposing) return;
    const plain = !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
    if (e.key === 'Enter' && plain) {
      e.preventDefault();
      e.stopImmediatePropagation();
      finishArmed('fill-go');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      finishArmed('fill-cancel');
    }
  }
  /** Keep Enter's keypress/keyup from the page too, so forms don't submit. */
  function swallowEnter(e) {
    if (armed && e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); }
  }

  function disarm() {
    if (!armed) return;
    armed = null;
    window.removeEventListener('keydown', onArmedKey, true);
    window.removeEventListener('keypress', swallowEnter, true);
    window.removeEventListener('keyup', swallowEnter, true);
    if (isTop) FP.overlay.hideBar();
  }

  /* ---------- the API ---------- */

  FP.api = {
    ping: () => ({ ok: true, top: isTop, url: location.href }),

    /* Scanning + badges (AI Fill) */
    scanFields() {
      return FP.scanner.scan();
    },
    showBadges(selection) {
      const targets = FP.scanner.targets;
      const items = targets.map((t, idx) => ({
        idx,
        target: t.group || t.el,
        selected: !!selection[idx],
        label: FP.scanner.describe(t, idx).label,
      })).filter((it) => targets[it.idx].kind !== 'file');
      FP.overlay.showBadges(items, (idx, selected) => {
        send({ type: 'bg:badge-toggle', idx, selected });
        if (armed && isTop) showBar(armedBar()); // keep "x of y selected" current
      });
      return items.length;
    },
    setBadges(selection) {
      for (const [idx, selected] of Object.entries(selection)) FP.overlay.setBadge(+idx, { selected });
    },
    markWarnings(warnings) {
      for (const [idx, warn] of Object.entries(warnings)) FP.overlay.setBadge(+idx, { warn });
    },
    hideBadges() {
      FP.overlay.hideBadges();
    },

    /** Wait for Enter (fill) or Esc (cancel). Every frame listens; the top frame shows the bar. */
    armFill({ total }) {
      disarm();
      armed = { total };
      window.addEventListener('keydown', onArmedKey, true);
      window.addEventListener('keypress', swallowEnter, true);
      window.addEventListener('keyup', swallowEnter, true);
      if (isTop) showBar(armedBar());
      return true;
    },
    disarmFill() {
      disarm();
      return true;
    },

    /**
     * Fill scanned fields. items: [{ idx, fingerprint, value, source }]
     * ctx: { persona, locale, keepUndo }
     * → [{ idx, ok, value, warning, error, skipped }]
     */
    async fillFields(items, ctx = {}) {
      if (!ctx.keepUndo) FP.filler.beginUndo();
      const results = [];
      for (const it of items) {
        const target = targetAt(it.idx, it.fingerprint);
        if (!target) { results.push({ idx: it.idx, ok: false, error: 'Field is no longer on the page' }); continue; }
        FP.filler.remember(target);
        try {
          const res = await fillWithFallback(target, it.value, it.source, ctx);
          results.push({ idx: it.idx, ...res, value: target.kind === 'password' ? '••••••' : res.value });
        } catch (e) {
          results.push({ idx: it.idx, ok: false, error: String(e.message || e) });
        }
      }
      return results;
    },
    undo: () => FP.filler.undo(),
    canUndo: () => FP.filler.canUndo(),

    /* Playback */
    async execStep(step, spec = {}, ctx = {}) {
      const timeout = ctx.timeout || 10000;
      if (step.unsupported) return { ok: true, skipped: true, warning: step.unsupported };
      const el = await D.waitForElement(step.selectors, { timeout });
      if (!el) {
        // Disabled but present? Give a more helpful error.
        const disabled = D.findElement(step.selectors, { enabled: false });
        return { ok: false, error: disabled ? `"${step.label}" is on the page but disabled` : `Couldn't find "${step.label}"` };
      }
      FP.overlay.clearHighlights();
      if (step.action === 'click') {
        try { el.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch { /* ignore */ }
        FP.overlay.highlight(el, { kind: 'pick', duration: 400 });
        FP.filler.clickLikeUser(el);
        return { ok: true };
      }
      let target = FP.scanner.targetFor(el);
      if (step.kind === 'checkbox') target = { el, kind: 'checkbox' };
      const source = spec.random ? 'random' : spec.ai ? 'ai' : 'fixed';
      const res = await fillWithFallback(target, spec.value, source, { ...ctx, optionTimeout: timeout, scroll: true });
      if (!res.ok && res.skipped) return { ok: true, skipped: true, warning: res.error };
      return res.ok ? { ok: true, warning: res.warning } : { ok: false, error: `${step.label}: ${res.error}` };
    },
    highlightMissing(step) {
      FP.overlay.clearHighlights();
      const label = String(step.label || '').toLowerCase();
      let guess = null;
      if (label) {
        guess = step.action === 'click'
          ? clickables().find((el) => D.clickableText(el).toLowerCase().includes(label))
          : D.allFields().find((el) => D.isFieldVisible(el) && D.getLabel(el).toLowerCase().includes(label));
      }
      if (guess) FP.overlay.highlight(guess, { kind: 'error', label: 'Looking for this? (it did not match exactly)' });
      return { found: !!guess };
    },
    clearHighlights: () => FP.overlay.clearHighlights(),

    /* Floating bar + recording */
    bar: (state) => showBar(state),
    setRecording(state) {
      if (state && state.active) FP.recorder.start({ paused: state.paused });
      else FP.recorder.stop();
      if (state && state.active) FP.recorder.setPaused(state.paused);
      return true;
    },

    /* Multi-step */
    findNext(saved) {
      const r = findNextElement(saved);
      return { kind: r.kind, label: r.el ? D.clickableText(r.el) : '' };
    },
    clickNext(saved) {
      const r = findNextElement(saved);
      if (r.kind !== 'next') return { ok: false, kind: r.kind };
      FP.filler.clickLikeUser(r.el);
      return { ok: true, label: D.clickableText(r.el) };
    },
    /** Click the form's submit / save button – only when this is the last step (no Next button). */
    clickSubmit(saved) {
      const r = findNextElement(saved);
      if (r.kind !== 'submit') return { ok: false, kind: r.kind };
      const label = D.clickableText(r.el);
      FP.filler.clickLikeUser(r.el);
      return { ok: true, label };
    },
    stepFingerprint: () => FP.scanner.stepFingerprint(),
    async pickElement(prompt) {
      const el = await FP.overlay.pickElement(prompt);
      if (!el) return null;
      FP.overlay.highlight(el, { kind: 'pick', duration: 1200 });
      return { selectors: D.buildSelectors(el), label: D.clickableText(el) || el.tagName.toLowerCase() };
    },

    /* Misc UI */
    confirmLive: (opts) => FP.overlay.confirmDialog(opts),
    toast: (text, kind, ms) => FP.overlay.toast(text, kind, ms),
  };

  /* ---------- lifecycle ---------- */
  FP.alive = () => {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch { return false; }
  };
  FP.teardown = () => {
    disarm();
    FP.recorder.stop();
    FP.overlay.hideBadges();
    FP.overlay.hideBar();
    FP.overlay.clearHighlights();
    document.getElementById(D.HOST_ID)?.remove();
  };

  /* ---------- page load handshake ---------- */
  send({ type: 'bg:page-hello', top: isTop }).then((res) => {
    const data = res && res.ok ? res.data : null;
    if (!data) return;
    if (data.recording) FP.api.setRecording(data.recording);
    if (data.bar) showBar(data.bar);
  });
})();
