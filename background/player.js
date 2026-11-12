/**
 * Playback engine (Feature 1 replay).
 *
 * The worker drives playback step by step, calling into the right frame. The state is
 * saved to chrome.storage.session after every step, so playback survives page
 * navigations and service-worker restarts (resume() is called on worker start-up).
 *
 * Value modes per step: fixed | random | counter | ai
 * AI values for one "page" (the steps up to the next navigation) are generated in a
 * single Groq call when the first AI step of that page is reached.
 */
import '../shared/url-utils.js';
import '../shared/templates.js';
import '../shared/generator.js';
import { getRecording, saveRecording, getSettings, saveSite } from '../shared/store.js';
import { callFrame, listFrames, tryTop } from './bridge.js';
import { generateAIValues } from './ai-fill.js';
import { describeStep } from './recorder.js';
import { isSubmitStep } from '../shared/steps.js';
import { notify, sleep, getTab, waitForTabComplete, waitForSettle, keepAlive, createLock } from './util.js';

const { Url, Gen, Templates } = globalThis.FPShared;
const KEY = 'playback';
export const SPEEDS = { fast: 80, normal: 400, slow: 1200 };
let looping = false;
const lock = createLock();

export async function getState() {
  return (await chrome.storage.session.get(KEY))[KEY] || null;
}
async function setState(st) {
  if (st) await chrome.storage.session.set({ [KEY]: st });
  else await chrome.storage.session.remove(KEY);
}
/** Read-modify-write so concurrent Pause/Stop clicks are never lost. */
function update(fn) {
  return lock(async () => {
    const st = await getState();
    if (!st) return null;
    const next = fn(st) || st;
    await setState(next);
    return next;
  });
}

/* ---------- floating bar ---------- */

export function barState(st, total) {
  const progress = `Run ${st.run} of ${st.totalRuns} · Step ${Math.min(st.stepIndex + 1, total)} of ${total}`;
  if (st.status === 'error') {
    return {
      mode: 'play', status: 'error', main: 'Step failed – what now?', sub: st.error?.message || '',
      buttons: [{ id: 'play-retry', label: 'Retry', kind: 'primary' }, { id: 'play-skip', label: 'Skip' }, { id: 'play-stop', label: 'Stop', kind: 'danger' }],
    };
  }
  if (st.status === 'paused') {
    return { mode: 'play', status: 'paused', main: 'Paused', sub: progress, buttons: [{ id: 'play-resume', label: 'Resume', kind: 'primary' }, { id: 'play-stop', label: 'Stop', kind: 'danger' }] };
  }
  if (st.status === 'running') {
    return { mode: 'play', status: 'running', main: `Playing "${st.name}"`, sub: progress, buttons: [{ id: 'play-pause', label: 'Pause' }, { id: 'play-stop', label: 'Stop', kind: 'danger' }] };
  }
  return null;
}

async function refresh(st) {
  const rec = st && (await getRecording(st.recordingId));
  if (st) await tryTop(st.tabId, 'bar', barState(st, rec?.steps.length || 0));
  notify({ type: 'ui:playback', state: st });
}

/** Content script loaded in the playback tab (after a navigation). */
export async function pageState(tabId) {
  const st = await getState();
  if (!st || st.tabId !== tabId) return null;
  const rec = await getRecording(st.recordingId);
  return { bar: barState(st, rec?.steps.length || 0) };
}

/* ---------- control ---------- */

export async function start(tabId, recordingId, { runs = 1, speed, noReload } = {}) {
  const current = await getState();
  if (current && ['running', 'paused', 'error'].includes(current.status)) {
    throw new Error('A playback is already running. Stop it first.');
  }
  const rec = await getRecording(recordingId);
  if (!rec) throw new Error('Recording not found.');
  const opts = rec.playOptions || {};
  const settings = await getSettings();
  // Without auto-submit, playback stops before the submit click, so only one run makes sense.
  const holdSubmit = !settings.autoSubmit && rec.steps.some(isSubmitStep);
  const st = {
    tabId,
    recordingId,
    name: rec.name,
    totalRuns: holdSubmit ? 1 : Math.max(1, Math.min(1000, parseInt(runs, 10) || 1)),
    autoSubmit: !!settings.autoSubmit,
    run: 1,
    stepIndex: 0,
    runPrepared: false,
    status: 'running',
    speed: speed || opts.speed || 'normal',
    noReload: noReload ?? !!opts.noReload,
    stats: { completed: 0, skipped: 0, errors: [], warnings: [] },
    ai: {},
    startedAt: Date.now(),
  };
  await setState(st);
  await saveSite(rec.site, { lastRecordingId: rec.id });
  await refresh(st);
  loop();
  return st;
}

export async function pause() {
  const st = await update((s) => { if (s.status === 'running') s.status = 'paused'; });
  await refresh(st);
}

export async function resume() {
  const st = await update((s) => { if (s.status === 'paused') s.status = 'running'; });
  await refresh(st);
  loop();
}

export async function retry() {
  const st = await update((s) => { if (s.status === 'error') { s.status = 'running'; s.error = null; } });
  await tryTop(st.tabId, 'clearHighlights');
  await refresh(st);
  loop();
}

export async function skip() {
  const st = await update((s) => {
    if (s.status === 'error') { s.status = 'running'; s.error = null; s.stepIndex++; s.stats.skipped++; }
  });
  await tryTop(st.tabId, 'clearHighlights');
  await refresh(st);
  loop();
}

export async function stop() {
  const st = await update((s) => { if (['running', 'paused', 'error'].includes(s.status)) s.status = 'stopped'; s.finishedAt = Date.now(); });
  if (st) {
    await tryTop(st.tabId, 'clearHighlights');
    await tryTop(st.tabId, 'bar', null);
    await refresh(st);
  }
}

/** Clear a finished playback (the summary was dismissed). */
export async function dismiss() {
  const st = await getState();
  if (st && ['done', 'stopped'].includes(st.status)) await setState(null);
  notify({ type: 'ui:playback', state: null });
}

/** Resume an interrupted playback after a worker restart. */
export async function resumeIfNeeded() {
  const st = await getState();
  if (st && st.status === 'running') {
    if (st.inFlight != null) await update((s) => { s.resumed = true; });
    loop();
  }
}

/* ---------- the loop ---------- */

async function loop() {
  if (looping) return;
  looping = true;
  keepAlive(true);
  try {
    for (;;) {
      let st = await getState();
      if (!st || st.status !== 'running') break;
      const tab = await getTab(st.tabId);
      if (!tab) { await update((s) => { s.status = 'stopped'; s.stats.errors.push('The tab was closed.'); }); break; }
      const rec = await getRecording(st.recordingId);
      if (!rec) { await update((s) => { s.status = 'stopped'; s.stats.errors.push('The recording was deleted.'); }); break; }

      // Start of a run: counter, persona, fresh page.
      if (!st.runPrepared) {
        await prepareRun(st, rec);
        continue;
      }

      // End of a run.
      if (st.stepIndex >= rec.steps.length) {
        st = await update((s) => {
          s.stats.completed++;
          if (s.run < s.totalRuns) {
            s.run++; s.stepIndex = 0; s.runPrepared = false; s.ai = {};
          } else {
            s.status = 'done'; s.finishedAt = Date.now();
          }
        });
        if (st.status === 'done') {
          await tryTop(st.tabId, 'bar', null);
          await tryTop(st.tabId, 'toast', `Playback finished: ${st.stats.completed} run${st.stats.completed === 1 ? '' : 's'}`, 'success');
          notify({ type: 'ui:playback', state: st });
          break;
        }
        await refresh(st);
        continue;
      }

      const step = rec.steps[st.stepIndex];

      // Auto-submit is off: everything is filled, leave the submit click to the user.
      if (!st.autoSubmit && isSubmitStep(step)) {
        st = await update((s) => {
          s.stats.completed++;
          s.status = 'done';
          s.heldSubmit = step.label || 'Submit';
          s.finishedAt = Date.now();
        });
        await tryTop(st.tabId, 'bar', null);
        await tryTop(st.tabId, 'toast', `Form filled. Click "${st.heldSubmit}" when you're ready.`, 'success');
        notify({ type: 'ui:playback', state: st });
        break;
      }

      await update((s) => { s.inFlight = s.stepIndex; });
      const res = await runStep(st, rec, step);
      st = await getState();
      if (!st || st.status === 'stopped') break;

      if (!res.ok) {
        st = await update((s) => {
          s.status = 'error';
          s.inFlight = null;
          s.error = { stepIndex: s.stepIndex, message: res.error, label: describeStep(step) };
          s.stats.errors.push(`Run ${s.run}, step ${s.stepIndex + 1}: ${res.error}`);
        });
        await tryTop(st.tabId, 'highlightMissing', step);
        await refresh(st);
        break;
      }
      st = await update((s) => {
        s.inFlight = null;
        s.resumed = false;
        s.stepIndex++;
        if (res.warning) s.stats.warnings.push(`Run ${s.run}, step ${s.stepIndex}: ${res.warning}`);
        if (res.skipped) s.stats.skipped++;
      });
      await refresh(st);
      await sleep((SPEEDS[st.speed] ?? SPEEDS.normal) + (parseInt(step.waitAfter, 10) || 0));
    }
  } catch (e) {
    console.error('[FillForMe] playback error', e);
    const st = await update((s) => { s.status = 'error'; s.error = { stepIndex: s.stepIndex, message: String(e.message || e) }; });
    if (st) await refresh(st);
  } finally {
    looping = false;
    keepAlive(false);
  }
}

async function prepareRun(st, rec) {
  // Counter {{n}} keeps counting across sessions so values stay unique.
  const n = rec.nextN || 1;
  await saveRecording({ ...rec, nextN: n + 1, lastRunAt: Date.now() });
  const settings = await getSettings();
  const persona = Gen.createPersona(settings.locale);

  if (!st.noReload) {
    const tab = await getTab(st.tabId);
    if (Url.stripHash(tab.url) === Url.stripHash(rec.startUrl)) {
      // Same document: a hash-only update would not reload, so reload explicitly.
      await chrome.tabs.update(st.tabId, { url: rec.startUrl });
      await chrome.tabs.reload(st.tabId);
    } else {
      await chrome.tabs.update(st.tabId, { url: rec.startUrl });
    }
    await sleep(300);
    await waitForTabComplete(st.tabId);
    await sleep(300);
  }
  const next = await update((s) => { s.runPrepared = true; s.n = n; s.persona = persona; s.ai = {}; });
  await refresh(next);
}

/** Find the frame a step was recorded in. */
async function frameFor(tabId, step) {
  if (!step.frame || step.frame.top) return 0;
  try {
    const frames = await listFrames(tabId);
    const match = frames.find((f) => !f.top && f.url === step.frame.url);
    return match ? match.frameId : 0;
  } catch {
    return 0;
  }
}

/** Generate AI values for every AI step on the current page in one Groq call. */
async function ensureAIValues(st, rec) {
  const ids = [];
  for (let i = st.stepIndex; i < rec.steps.length; i++) {
    const s = rec.steps[i];
    if (s.action === 'navigate') break;
    if (s.action === 'fill' && s.mode === 'ai' && !(s.id in st.ai)) ids.push(s);
  }
  if (!ids.length) return;
  const settings = await getSettings();
  const ai = {};
  let warning = '';
  if (!settings.groqKey) {
    warning = 'No Groq key – AI steps used random values';
  } else {
    try {
      const fields = ids.map((s) => ({ ...(s.field || {}), kind: s.kind, label: s.label, key: s.id }));
      Object.assign(ai, await generateAIValues(fields, { context: rec.aiContext || '', settings }));
    } catch (e) {
      warning = `AI unavailable (${e.message}) – used random values`;
    }
  }
  for (const s of ids) if (!(s.id in ai)) ai[s.id] = null; // null → random in the page
  await update((x) => {
    Object.assign(x.ai, ai);
    if (warning) x.stats.warnings.push(warning);
  });
  Object.assign(st.ai, ai);
}

/** What the page should put into a field for this run. */
function valueSpec(st, step) {
  switch (step.mode) {
    case 'random': return { random: true };
    case 'counter': return { value: Templates.expand(step.template || Templates.suggest(step.value), { n: st.n }) };
    case 'ai': {
      const v = st.ai[step.id];
      return v === null || v === undefined ? { random: true } : { ai: true, value: v };
    }
    default: return { value: step.value };
  }
}

async function runStep(st, rec, step) {
  const settings = await getSettings();
  const timeout = settings.timeoutMs || 10000;

  if (step.action === 'navigate') {
    // Navigations are caused by the previous click; just wait for the page to match.
    const end = Date.now() + Math.min(timeout, 8000);
    while (Date.now() < end) {
      const tab = await getTab(st.tabId);
      if (tab && tab.status === 'complete' && Url.sameRoute(tab.url, step.url)) return { ok: true };
      await sleep(250);
    }
    await waitForTabComplete(st.tabId, 5000);
    return { ok: true }; // URLs with dynamic ids may never match exactly; continue anyway
  }

  // Resumed after a worker restart in the middle of a click: don't click twice.
  if (st.inFlight === st.stepIndex && step.action === 'click' && st.resumed) return { ok: true };

  if (step.action === 'fill' && step.mode === 'ai') await ensureAIValues(st, rec);
  const frameId = await frameFor(st.tabId, step);
  try {
    const res = await callFrame(st.tabId, frameId, 'execStep', step, valueSpec(st, step), {
      timeout, persona: st.persona, locale: settings.locale,
    });
    if (step.action === 'click' && res.ok) await waitForSettle(st.tabId);
    return res;
  } catch (e) {
    const msg = String(e.message || e);
    // A click that navigates can tear down the frame before it answers.
    if (step.action === 'click' && /frame|navigat|closed|removed|context/i.test(msg)) {
      await waitForSettle(st.tabId, 400);
      return { ok: true };
    }
    // The page may still be loading; wait once and retry.
    if (/not active|Cannot access|No frame/i.test(msg)) {
      await waitForTabComplete(st.tabId);
      await sleep(500);
      try {
        return await callFrame(st.tabId, frameId, 'execStep', step, valueSpec(st, step), { timeout, persona: st.persona, locale: settings.locale });
      } catch (e2) {
        return { ok: false, error: String(e2.message || e2) };
      }
    }
    return { ok: false, error: msg };
  }
}
