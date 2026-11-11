/**
 * AI Fill (Feature 2): scan fields, remember the user's selection, generate values
 * with ONE batched Groq request, fill, Undo / Regenerate, and multi-step fill.
 *
 * The current scan for each tab lives in chrome.storage.session under "ai:<tabId>":
 *   { url, fields: [{ key, frameId, ...fieldMeta }], selection: { key: bool } }
 * A field key is "<frameId>:<index>".
 */
import '../shared/url-utils.js';
import '../shared/templates.js';
import '../shared/generator.js';
import { getSettings, getSite, saveSite } from '../shared/store.js';
import { callAllFrames, callFrame } from './bridge.js';
import { chatJSON, GroqError } from './groq.js';
import { notify, sleep, getTab, waitForTabComplete, keepAlive } from './util.js';

const { Url, Gen } = globalThis.FPShared;
const LOCALE_NAMES = { IN: 'India', US: 'United States', UK: 'United Kingdom' };
const stopFlags = new Map();

/* ---------- prompt + generation (also used by the player) ---------- */

const SYSTEM_PROMPT = `You generate realistic test data for web forms. Developers use it to test business applications.
Return ONLY a JSON object mapping every field id to a value, like {"f1": "value", "f2": "value"}. No explanations.
Rules:
- Give a value for every field id you receive. Values are strings; for "checkbox_group" use an array of option values.
- Keep the data consistent, as if it were one real record: the email matches the person's name, city / state / postal code belong together, end dates come after start dates, quantities and totals make sense.
- Match the locale: names, phone numbers, addresses and postal codes must look real for that country.
- If a field has "options", the value MUST be exactly one of the given option values (checkbox_group: one or more of them).
- checkbox: "true" or "false".
- Respect required, min, max, maxlength and pattern (the regular expression must match the whole value).
- Formats: date YYYY-MM-DD, time HH:MM (24h), datetime-local YYYY-MM-DDTHH:MM, month YYYY-MM. Numbers: digits only, no units or thousands separators.
- Emails use the example.com domain. Use natural, specific text – never "lorem ipsum", "test", or "sample".
- Follow the user's description of the data when one is given.`;

/** Compact description of a field for the prompt (only non-empty properties). */
function promptField(id, f) {
  const out = { id, label: f.label || f.name || f.placeholder || '' };
  const type = f.kind === 'checkbox-group' ? 'checkbox_group' : f.kind === 'custom-select' ? 'dropdown' : f.kind;
  out.type = type;
  if (f.name && f.name !== out.label) out.name = f.name;
  if (f.placeholder) out.placeholder = f.placeholder;
  if (f.help) out.help = f.help;
  if (f.section) out.section = f.section;
  if (f.required) out.required = true;
  for (const k of ['min', 'max', 'maxlength', 'pattern']) if (f[k]) out[k] = f[k];
  const opts = Gen.realOptions(f);
  if (opts.length) {
    out.options = opts.slice(0, 40).map((o) => (String(o.value) === String(o.text) ? o.value : { value: o.value, label: o.text }));
  }
  return out;
}

/**
 * Ask Groq for values for a list of fields in ONE request.
 * fields: [{ key, ...meta }] → returns { [key]: value }.
 * Retries once on bad JSON, then throws GroqError('bad_json').
 */
export async function generateAIValues(fields, { context = '', alreadyFilled = null, settings } = {}) {
  settings = settings || (await getSettings());
  const ids = new Map();
  const promptFields = fields.map((f, i) => {
    const id = `f${i + 1}`;
    ids.set(id, f.key);
    return promptField(id, f);
  });
  const today = new Date();
  const lines = [
    `Locale: ${LOCALE_NAMES[settings.locale] || 'India'}.`,
    `Today: ${Gen.isoDate(today)}.`,
  ];
  if (context.trim()) lines.push(`Description of the data: ${context.trim()}`);
  if (alreadyFilled && Object.keys(alreadyFilled).length) lines.push(`Already filled on this form (stay consistent): ${JSON.stringify(alreadyFilled)}`);
  lines.push(`Fields:\n${JSON.stringify(promptFields)}`);

  const call = () => chatJSON({
    key: settings.groqKey,
    baseUrl: settings.groqBaseUrl,
    model: settings.model,
    system: SYSTEM_PROMPT,
    user: lines.join('\n'),
    temperature: 0.4,
  });
  let data;
  try {
    data = await call();
  } catch (e) {
    if (e.code !== 'bad_json') throw e;
    data = await call(); // retry once
  }
  const out = {};
  for (const [id, key] of ids) if (id in data) out[key] = data[id];
  return out;
}

/* ---------- scan + selection ---------- */

const sessionKey = (tabId) => `ai:${tabId}`;

async function getScan(tabId) {
  const k = sessionKey(tabId);
  return (await chrome.storage.session.get(k))[k] || null;
}
async function setScan(tabId, scan) {
  await chrome.storage.session.set({ [sessionKey(tabId)]: scan });
}

/** Saved selection for this page: { fingerprint: bool }. */
async function savedSelection(url) {
  const site = await getSite(Url.siteKey(url));
  return (site.aiSelections || {})[Url.pagePattern(url)] || {};
}

async function rememberSelection(url, fields, selection) {
  const siteKey = Url.siteKey(url);
  const site = await getSite(siteKey);
  const all = { ...(site.aiSelections || {}) };
  const page = { ...(all[Url.pagePattern(url)] || {}) };
  for (const f of fields) if (f.key in selection) page[f.fingerprint] = !!selection[f.key];
  all[Url.pagePattern(url)] = page;
  await saveSite(siteKey, { aiSelections: all });
}

/**
 * Scan every frame, apply the remembered selection (default: everything),
 * optionally show the badges. Returns { url, fields, selection }.
 */
export async function scan(tabId, { badges = true } = {}) {
  const tab = await getTab(tabId);
  if (!tab) throw new Error('The tab was closed.');
  const results = await callAllFrames(tabId, 'scanFields');
  const remembered = await savedSelection(tab.url);
  const fields = [];
  const selection = {};
  for (const r of results.sort((a, b) => a.frameId - b.frameId)) {
    if (!Array.isArray(r.value)) continue;
    for (const f of r.value) {
      const key = `${r.frameId}:${f.idx}`;
      fields.push({ ...f, key, frameId: r.frameId });
      selection[key] = f.unsupported ? false : f.fingerprint in remembered ? remembered[f.fingerprint] : true;
    }
  }
  const data = { url: tab.url, fields, selection };
  await setScan(tabId, data);
  if (badges) await showBadges(tabId, data);
  notify({ type: 'ui:ai-scan', tabId, data });
  return data;
}

async function showBadges(tabId, data) {
  const byFrame = groupByFrame(data.fields);
  await Promise.all(
    [...byFrame].map(([frameId, fields]) => {
      const sel = {};
      for (const f of fields) sel[f.idx] = !!data.selection[f.key];
      return callFrame(tabId, frameId, 'showBadges', sel).catch(() => null);
    })
  );
}

function groupByFrame(fields) {
  const m = new Map();
  for (const f of fields) {
    if (!m.has(f.frameId)) m.set(f.frameId, []);
    m.get(f.frameId).push(f);
  }
  return m;
}

/** Change the selection (from the side panel). changes: { key: bool } */
export async function setSelection(tabId, changes, { updateBadges = true } = {}) {
  const data = await getScan(tabId);
  if (!data) return null;
  Object.assign(data.selection, changes);
  await setScan(tabId, data);
  await rememberSelection(data.url, data.fields, data.selection);
  if (updateBadges) {
    const perFrame = new Map();
    for (const [key, val] of Object.entries(changes)) {
      const [frameId, idx] = key.split(':').map(Number);
      if (!perFrame.has(frameId)) perFrame.set(frameId, {});
      perFrame.get(frameId)[idx] = val;
    }
    await Promise.all([...perFrame].map(([fid, sel]) => callFrame(tabId, fid, 'setBadges', sel).catch(() => null)));
  }
  return data.selection;
}

/** A badge was clicked on the page. */
export async function onBadgeToggle(tabId, frameId, idx, selected) {
  const key = `${frameId}:${idx}`;
  await setSelection(tabId, { [key]: selected }, { updateBadges: false });
  notify({ type: 'ui:ai-selection', tabId, key, selected });
}

export async function hideBadges(tabId) {
  await callAllFrames(tabId, 'hideBadges').catch(() => null);
}

/* ---------- generate + fill ---------- */

/**
 * Generate values for the selected fields. Returns
 * { values: { key: value }, source: 'ai'|'random', notice?, errorCode? }.
 * Without a key, or when the AI fails, values is empty and the page uses random data.
 */
export async function generate(tabId, { context = '', data = null } = {}) {
  data = data || (await getScan(tabId));
  if (!data) throw new Error('Click "AI Fill" first to find the fields.');
  const settings = await getSettings();
  const selected = data.fields.filter((f) => data.selection[f.key] && !f.unsupported);
  if (!settings.groqKey) {
    return { values: {}, source: 'random', notice: 'No Groq API key yet, so random data was used. Add a key in Settings (⚙) for smarter AI data.', errorCode: 'no_key' };
  }
  if (!selected.length) return { values: {}, source: 'ai' };
  try {
    const values = await generateAIValues(selected, { context, settings });
    return { values, source: 'ai' };
  } catch (e) {
    const msg = e instanceof GroqError ? e.message : String(e.message || e);
    const suffix = e.code === 'bad_json' ? ' Used random values instead.' : ' Random values were used instead.';
    return { values: {}, source: 'random', notice: msg + (msg.includes('Random') ? '' : suffix), errorCode: e.code || 'error' };
  }
}

/**
 * Fill the selected fields of the current scan.
 * presetValues (from the preview) skip generation.
 */
export async function fill(tabId, { context = '', presetValues = null, keepUndo = false, rescan = false, allowSubmit = true } = {}) {
  let data = rescan ? await scan(tabId) : await getScan(tabId);
  if (!data) data = await scan(tabId);
  const settings = await getSettings();
  const gen = presetValues ? { values: presetValues, source: 'ai' } : await generate(tabId, { context, data });
  const persona = Gen.createPersona(settings.locale);
  const selected = data.fields.filter((f) => data.selection[f.key] && !f.unsupported);
  const results = [];
  for (const [frameId, fields] of groupByFrame(selected)) {
    const items = fields.map((f) => {
      const has = f.key in gen.values && gen.values[f.key] !== '' && gen.values[f.key] != null;
      return { idx: f.idx, fingerprint: f.fingerprint, value: has ? gen.values[f.key] : null, source: has ? (presetValues ? 'user' : 'ai') : 'random' };
    });
    try {
      const res = await callFrame(tabId, frameId, 'fillFields', items, { persona, locale: settings.locale, keepUndo });
      const warnings = {};
      for (const r of res) {
        const f = fields.find((x) => x.idx === r.idx);
        results.push({ key: `${frameId}:${r.idx}`, label: f?.label, ok: r.ok, value: r.value, warning: r.warning || (r.ok ? '' : r.error) });
        if (r.warning || !r.ok) warnings[r.idx] = r.warning || r.error;
      }
      if (Object.keys(warnings).length) await callFrame(tabId, frameId, 'markWarnings', warnings).catch(() => null);
    } catch (e) {
      for (const f of fields) results.push({ key: f.key, label: f.label, ok: false, warning: String(e.message || e) });
    }
  }
  // "Submit the form when done": click Submit / Save, but only on the last step of a form.
  let submitted = '';
  if (allowSubmit && settings.autoSubmit) submitted = await clickSubmit(tabId);

  return {
    filled: results.filter((r) => r.ok).length,
    total: selected.length,
    results,
    source: gen.source,
    notice: gen.notice,
    errorCode: gen.errorCode,
    submitted,
  };
}

/** Click the page's submit button. Returns its label, or '' if there is none (or a Next button instead). */
async function clickSubmit(tabId) {
  await sleep(400); // let validation and dependent fields settle
  try {
    const tab = await getTab(tabId);
    const site = await getSite(Url.siteKey(tab.url));
    const res = await callFrame(tabId, 0, 'clickSubmit', site.nextSelectors || null);
    return res?.ok ? res.label : '';
  } catch {
    return ''; // the click navigated away – that's fine
  }
}

export async function undo(tabId) {
  const res = await callAllFrames(tabId, 'undo');
  return res.reduce((n, r) => n + (r.value?.restored || 0), 0);
}

/* ---------- multi-step ---------- */

async function waitForStepChange(tabId, before, timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    await sleep(300);
    const tab = await getTab(tabId);
    if (!tab) return false;
    if (tab.status === 'loading') {
      await waitForTabComplete(tabId);
      await sleep(400);
      return true;
    }
    try {
      const now = await callFrame(tabId, 0, 'stepFingerprint');
      if (now !== before) return true;
    } catch {
      /* page is changing */
    }
  }
  return false;
}

export function stopMultiStep(tabId) {
  stopFlags.set(tabId, true);
}

/**
 * Fill the current step, click Next, wait for the next step, repeat.
 * Always stops before the final Submit.
 */
export async function fillAllSteps(tabId, { context = '' } = {}) {
  stopFlags.set(tabId, false);
  keepAlive(true);
  const settings = await getSettings();
  const all = [];
  let notice = '';
  let message = '';
  let steps = 0;
  try {
    for (let n = 1; n <= 25; n++) {
      steps = n;
      notify({ type: 'ui:ai-progress', tabId, text: `Step ${n}: filling…` });
      const res = await fill(tabId, { context, keepUndo: n > 1, rescan: true, allowSubmit: false });
      all.push(...res.results);
      if (res.notice) notice = res.notice;
      if (stopFlags.get(tabId)) { message = 'Stopped.'; break; }

      const tab = await getTab(tabId);
      const site = await getSite(Url.siteKey(tab.url));
      const next = await callFrame(tabId, 0, 'findNext', site.nextSelectors || null);
      if (next.kind !== 'next') {
        if (settings.autoSubmit) {
          const label = next.kind === 'submit' ? await clickSubmit(tabId) : '';
          message = label ? `All steps filled and "${label}" clicked.` : 'All steps filled. No submit button was found.';
        } else {
          message = next.kind === 'submit'
            ? `All steps filled. Click "${next.label}" when you're ready.`
            : 'All steps filled. Submit the form when you\'re ready.';
        }
        break;
      }
      notify({ type: 'ui:ai-progress', tabId, text: `Step ${n} done. Clicking "${next.label}"…` });
      const before = await callFrame(tabId, 0, 'stepFingerprint');
      await sleep(250);
      await callFrame(tabId, 0, 'clickNext', site.nextSelectors || null);
      const changed = await waitForStepChange(tabId, before, settings.timeoutMs || 10000);
      if (!changed) {
        message = `The form didn't move past step ${n}. Check the page for validation errors, or use "Pick Next button".`;
        break;
      }
      await sleep(300);
      if (stopFlags.get(tabId)) { message = 'Stopped.'; break; }
    }
  } finally {
    keepAlive(false);
    stopFlags.delete(tabId);
  }
  const tabNow = await getTab(tabId);
  if (tabNow) callFrame(tabId, 0, 'toast', message, message.startsWith('All') ? 'success' : 'info', 5000).catch(() => {});
  return { steps, filled: all.filter((r) => r.ok).length, results: all, notice, message };
}

/** Let the user click the Next button on the page; saved per site. */
export async function pickNextButton(tabId) {
  const tab = await getTab(tabId);
  const picked = await callFrame(tabId, 0, 'pickElement', 'Click the "Next" button of this form');
  if (!picked) return null;
  await saveSite(Url.siteKey(tab.url), { nextSelectors: picked.selectors, nextLabel: picked.label });
  return picked;
}

export { getScan };
