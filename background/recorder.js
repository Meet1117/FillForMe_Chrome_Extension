/**
 * Recording session (service-worker side).
 *
 * Content scripts in every frame send captured steps here; navigations are captured
 * from chrome.tabs.onUpdated (covers full loads and SPA route changes). The session
 * lives in chrome.storage.session so it survives page loads and worker restarts.
 */
import '../shared/url-utils.js';
import { saveRecording, saveSite, uid } from '../shared/store.js';
import { callAllFrames, tryTop } from './bridge.js';
import { notify, getTab, createLock } from './util.js';
import { describeStep, shortUrl } from '../shared/steps.js';

export { describeStep };

const { Url } = globalThis.FPShared;
const KEY = 'recording';
const lock = createLock();

export async function getSession() {
  return (await chrome.storage.session.get(KEY))[KEY] || null;
}
async function setSession(s) {
  if (s) await chrome.storage.session.set({ [KEY]: s });
  else await chrome.storage.session.remove(KEY);
}

/** Floating bar state for the recording tab. */
export function barState(s) {
  const paused = s.status === 'paused';
  return {
    mode: 'record',
    status: paused ? 'paused' : 'recording',
    main: paused ? 'Recording paused' : 'Recording',
    sub: `${s.steps.length} step${s.steps.length === 1 ? '' : 's'} · ${s.steps.length ? describeStep(s.steps[s.steps.length - 1]) : 'Fill the form as usual'}`,
    buttons: [
      { id: paused ? 'rec-resume' : 'rec-pause', label: paused ? 'Resume' : 'Pause' },
      { id: 'rec-stop', label: 'Stop', kind: 'danger' },
    ],
  };
}

async function refreshBar(s) {
  await tryTop(s.tabId, 'bar', barState(s));
}

export function start(tabId) {
  return lock(() => startNow(tabId));
}
async function startNow(tabId) {
  const tab = await getTab(tabId);
  if (!tab) throw new Error('No active tab.');
  const s = {
    tabId,
    status: 'recording',
    startUrl: tab.url,
    lastUrl: tab.url,
    title: tab.title || Url.siteLabel(tab.url),
    site: Url.siteKey(tab.url),
    steps: [],
    startedAt: Date.now(),
  };
  await setSession(s);
  await callAllFrames(tabId, 'setRecording', { active: true, paused: false });
  await refreshBar(s);
  notify({ type: 'ui:recording', session: s });
  return s;
}

export function setPaused(paused) {
  return lock(() => setPausedNow(paused));
}
async function setPausedNow(paused) {
  const s = await getSession();
  if (!s) return null;
  s.status = paused ? 'paused' : 'recording';
  await setSession(s);
  await callAllFrames(s.tabId, 'setRecording', { active: true, paused }).catch(() => null);
  await refreshBar(s);
  notify({ type: 'ui:recording', session: s });
  return s;
}

/** Merge a new step into the list (latest value wins for repeated edits of a field). */
function mergeStep(steps, step) {
  const last = steps[steps.length - 1];
  const sameField = (a, b) =>
    a && b && a.action === 'fill' && b.action === 'fill' && a.kind !== 'checkbox' &&
    (JSON.stringify(a.selectors[0]) === JSON.stringify(b.selectors[0]) ||
      (a.kind === 'radio' && b.kind === 'radio' && a.field?.name && a.field.name === b.field?.name));
  if (sameField(last, step)) {
    steps[steps.length - 1] = { ...last, value: step.value, field: step.field, ts: step.ts };
    return;
  }
  // Keep chronological order even if messages arrive slightly out of order.
  let i = steps.length;
  while (i > 0 && steps[i - 1].ts > step.ts) i--;
  steps.splice(i, 0, step);
}

function newStep(step) {
  return {
    id: uid('s'),
    mode: 'fixed',
    waitAfter: 0,
    ...step,
  };
}

/** A content script captured a step. */
export function addStep(step, sender) {
  return lock(() => addStepNow(step, sender));
}
async function addStepNow(step, sender) {
  const s = await getSession();
  if (!s || s.status !== 'recording' || sender.tab?.id !== s.tabId) return false;
  mergeStep(s.steps, newStep(step));
  await setSession(s);
  await refreshBar(s);
  notify({ type: 'ui:recording', session: s });
  return true;
}

/** Tab URL changed (full navigation or SPA route change). */
export function onTabUrl(tabId, url) {
  return lock(() => onTabUrlNow(tabId, url));
}
async function onTabUrlNow(tabId, url) {
  const s = await getSession();
  if (!s || s.tabId !== tabId || s.status !== 'recording' || url === s.lastUrl) return;
  s.lastUrl = url;
  const last = s.steps[s.steps.length - 1];
  const step = newStep({ action: 'navigate', url, label: shortUrl(url), ts: Date.now(), selectors: [] });
  if (last && last.action === 'navigate' && step.ts - last.ts < 1500) s.steps[s.steps.length - 1] = { ...step, id: last.id };
  else s.steps.push(step);
  await setSession(s);
  notify({ type: 'ui:recording', session: s });
}

/** Stop and save. Returns the saved recording (or null if nothing was captured). */
export function stop() {
  return lock(() => stopNow());
}
async function stopNow() {
  const s = await getSession();
  if (!s) return null;
  await setSession(null);
  await callAllFrames(s.tabId, 'setRecording', { active: false }).catch(() => null);
  await tryTop(s.tabId, 'bar', null);
  // Trailing navigations add nothing to replay.
  const steps = s.steps.slice();
  while (steps.length && steps[steps.length - 1].action === 'navigate') steps.pop();
  notify({ type: 'ui:recording', session: null });
  if (!steps.filter((st) => st.action !== 'navigate').length) {
    await tryTop(s.tabId, 'toast', 'Nothing was recorded.', 'info');
    return null;
  }
  const rec = await saveRecording({
    id: uid('rec'),
    name: s.title,
    site: s.site,
    startUrl: s.startUrl,
    steps,
    createdAt: Date.now(),
    playOptions: { speed: 'normal', noReload: false },
    nextN: 1,
  });
  await saveSite(s.site, { lastRecordingId: rec.id });
  await tryTop(s.tabId, 'toast', `Saved "${rec.name}" (${steps.length} steps)`, 'success');
  notify({ type: 'ui:recording-saved', id: rec.id });
  return rec;
}

/** Content script loaded in the recording tab: tell it to keep recording. */
export async function pageState(tabId) {
  const s = await getSession();
  if (!s || s.tabId !== tabId) return null;
  return { recording: { active: true, paused: s.status === 'paused' }, bar: barState(s) };
}
