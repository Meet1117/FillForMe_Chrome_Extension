/**
 * FillForMe service worker: message router, keyboard shortcuts and lifecycle.
 * All listeners are registered synchronously at the top level (MV3 requirement).
 *
 * Message types:
 *   bg:*  – handled here (from the side panel or content scripts), answered with { ok, data | error }
 *   ui:*  – events for the side panel (sent by the worker or content scripts)
 */
import '../shared/url-utils.js';
import { getSettings, getSite, saveSite, getRecording, getRecordingsForSite } from '../shared/store.js';
import * as Sites from './sites.js';
import * as Rec from './recorder.js';
import * as Player from './player.js';
import * as AI from './ai-fill.js';
import { listModels, pickModel } from './groq.js';
import { tryTop, callFrame, callAllFrames } from './bridge.js';
import { notify, getTab, sleep } from './util.js';
import { getOS, formatShortcut, DEFAULT_SHORTCUTS } from '../shared/shortcuts.js';

const { Url } = globalThis.FPShared;

/* ---------- lifecycle ---------- */

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await Sites.migrateLegacySites().catch(() => {});
  Sites.syncContentScripts().catch((e) => console.warn('[FillForMe] sync failed', e));
  if (reason === 'install') checkShortcuts().catch(() => {});
});

/**
 * Chrome sets the manifest's default shortcuts on install, but skips any key that
 * Chrome or another extension already uses. If that happened, open the shortcuts
 * page so the user can pick other keys straight away.
 */
async function checkShortcuts() {
  const missing = (await chrome.commands.getAll()).filter((c) => DEFAULT_SHORTCUTS[c.name] && !c.shortcut);
  if (!missing.length) return;
  console.warn('[FillForMe] shortcuts not set (key already in use):', missing.map((c) => c.name).join(', '));
  await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
}
chrome.runtime.onStartup.addListener(() => {
  Sites.syncContentScripts().catch(() => {});
});

chrome.permissions.onAdded.addListener(() => {
  Sites.syncContentScripts().catch(() => {});
  notify({ type: 'ui:sites' });
});
chrome.permissions.onRemoved.addListener(() => {
  Sites.syncContentScripts().catch(() => {});
  notify({ type: 'ui:sites' });
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url) Rec.onTabUrl(tabId, info.url).catch(() => {});
  if (info.status === 'loading') {
    // The old scan no longer matches the page.
    chrome.storage.session.remove([`ai:${tabId}`, armedKey(tabId)]).catch(() => {});
    notify({ type: 'ui:ai-reset', tabId });
  }
  if (info.url || info.status === 'complete') notify({ type: 'ui:tab-updated', tabId });
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  chrome.storage.session.remove(`ai:${tabId}`).catch(() => {});
  const rec = await Rec.getSession();
  if (rec && rec.tabId === tabId) await Rec.stop();
  const play = await Player.getState();
  if (play && play.tabId === tabId && ['running', 'paused', 'error'].includes(play.status)) await Player.stop();
});

// Continue a playback that was interrupted by a worker restart.
Player.resumeIfNeeded().catch(() => {});

/* ---------- helpers ---------- */

/**
 * "Live site" confirmation shown on the page (used by keyboard shortcuts).
 * Asked once per site: Continue is remembered for good.
 */
async function confirmLiveOnPage(tab) {
  if (!Url.isLikelyProduction(tab.url)) return true;
  const site = await getSite(Url.siteKey(tab.url));
  if (site.liveOk) return true;
  const res = await callFrame(tab.id, 0, 'confirmLive', {
    title: 'This looks like a live site',
    message: `${Url.siteLabel(tab.url)} doesn't look like a dev, test or staging site. Fill it anyway? You won't be asked again for this site.`,
    okText: 'Continue',
    cancelText: 'Cancel',
  });
  if (res?.ok) await saveSite(Url.siteKey(tab.url), { liveOk: true });
  return !!res?.ok;
}

async function busyMessage() {
  if (await Rec.getSession()) return 'A recording is in progress. Stop it first.';
  const p = await Player.getState();
  if (p && ['running', 'paused', 'error'].includes(p.status)) return 'A playback is running. Stop it first.';
  return '';
}

/* ---------- Fill shortcut: show the fields first, fill on Enter ---------- */

const armedKey = (tabId) => `armed:${tabId}`;

async function isArmed(tabId) {
  const k = armedKey(tabId);
  return !!(await chrome.storage.session.get(k))[k];
}

/**
 * Step 1 of the Fill shortcut: find the fields, show the marks, and wait.
 * The page shows "Press Enter to fill"; Enter (or the shortcut again) runs runArmedFill,
 * Esc runs cancelArmedFill. The user can click marks to change the selection meanwhile.
 */
async function armFill(tabId) {
  const data = await AI.scan(tabId, { badges: true });
  const fillable = data.fields.filter((f) => !f.unsupported);
  if (!fillable.length) {
    await AI.hideBadges(tabId);
    return void (await tryTop(tabId, 'toast', 'No fields to fill on this page.', 'info'));
  }
  await chrome.storage.session.set({ [armedKey(tabId)]: true });
  // Every frame listens for Enter / Esc; the top frame also shows the bar.
  const frames = new Set([0, ...fillable.map((f) => f.frameId)]);
  await Promise.all([...frames].map((frameId) =>
    callFrame(tabId, frameId, 'armFill', { total: fillable.filter((f) => f.frameId === frameId).length, allFrames: fillable.length }).catch(() => null)));
}

async function disarm(tabId) {
  const k = armedKey(tabId);
  if (!(await chrome.storage.session.get(k))[k]) return false;
  await chrome.storage.session.remove(k);
  await callAllFrames(tabId, 'disarmFill').catch(() => null);
  return true;
}

/** Step 2: the user confirmed – fill the selected fields (or all steps). */
async function runArmedFill(tabId) {
  if (!(await disarm(tabId))) return;
  await sleep(200); // let a mark clicked just before Enter reach the saved selection
  const tab = await getTab(tabId);
  if (!tab) return;
  const settings = await getSettings();
  const site = await getSite(Url.siteKey(tab.url));
  await tryTop(tabId, 'toast', settings.groqKey ? 'Getting values from Groq…' : 'Filling…', 'info', 1500);
  let res;
  if (settings.fillAllSteps) {
    res = await AI.fillAllSteps(tabId, { context: site.context || '' });
  } else {
    res = await AI.fill(tabId, { context: site.context || '' });
    await tryTop(tabId, 'toast', `Filled ${res.filled} of ${res.total} fields${res.source === 'random' ? ' with random data' : ''}${res.submitted ? ` and clicked "${res.submitted}"` : ''}`, 'success');
  }
  await AI.hideBadges(tabId);
  if (res.notice) await tryTop(tabId, 'toast', res.notice, 'info');
  notify({ type: 'ui:ai-filled', tabId, result: res });
}

async function cancelArmedFill(tabId) {
  if (!(await disarm(tabId))) return;
  await AI.hideBadges(tabId);
  notify({ type: 'ui:ai-reset', tabId });
}

/** A command's current shortcut, written the way this device shows it. */
async function shortcutText(name) {
  const cmd = (await chrome.commands.getAll()).find((c) => c.name === name);
  return formatShortcut(cmd?.shortcut || DEFAULT_SHORTCUTS[name], await getOS());
}

/* ---------- "turn on for this site?" popup ---------- */

/**
 * Show the "turn on for this site?" popup on a page FillForMe isn't turned on for.
 * Returns false if the page can't be reached (then the side panel opens instead).
 */
async function showEnablePrompt(tab, command) {
  if (!/^https?:/.test(tab.url)) return false;
  await chrome.storage.session.set({ pendingEnable: { tabId: tab.id, command } });
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectEnablePrompt,
      args: [tab.id, Url.siteLabel(tab.url), Url.originPattern(tab.url)],
    });
    return true;
  } catch {
    return false;
  }
}

/** Runs in the page: adds the popup iframe (inside a closed shadow root). */
function injectEnablePrompt(tabId, site, pattern) {
  const ID = 'formpilot-enable-prompt';
  document.getElementById(ID)?.remove();
  const host = document.createElement('div');
  host.id = ID;
  host.style.cssText = 'position:fixed!important;top:16px!important;right:16px!important;z-index:2147483647!important;width:360px;max-width:calc(100vw - 32px);height:150px;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const frame = document.createElement('iframe');
  frame.src = chrome.runtime.getURL('prompt/enable.html') + `?tab=${tabId}&site=${encodeURIComponent(site)}&pattern=${encodeURIComponent(pattern)}`;
  frame.title = 'Turn on FillForMe';
  frame.allowTransparency = true;
  frame.style.cssText = 'width:100%;height:100%;border:0;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.28);color-scheme:normal;background:transparent;';
  shadow.append(frame);
  document.documentElement.append(host);
  const origin = new URL(chrome.runtime.getURL('')).origin;
  const onMessage = (e) => {
    if (e.origin !== origin || e.data?.formpilot !== 'close-enable-prompt') return;
    host.remove();
    window.removeEventListener('message', onMessage);
  };
  window.addEventListener('message', onMessage);
  frame.addEventListener('load', () => frame.focus());
}

/** Turn a site on from a shortcut (no prompt), then confirm on the page. */
async function activateSite(tab) {
  const pattern = Url.originPattern(tab.url);
  if (!(await Sites.hasAccess(pattern))) {
    // The user limited FillForMe's site access in Chrome: only Chrome's own prompt can lift that.
    if (!(await showEnablePrompt(tab, 'activate-site'))) chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
    return;
  }
  await turnOn(pattern, tab.id);
}

async function turnOn(pattern, tabId) {
  await Sites.enableSite(pattern, tabId);
  notify({ type: 'ui:sites' });
  const tab = await getTab(tabId);
  if (tab) await tryTop(tabId, 'toast', `FillForMe is on for ${Url.siteLabel(tab.url)}`, 'success').catch(() => {});
}

/** The popup turned the site on: register content scripts, then run the shortcut that was pressed. */
async function onPromptEnabled(tabId, pattern) {
  await Sites.enableSite(pattern, tabId);
  notify({ type: 'ui:sites' });
  const { pendingEnable } = await chrome.storage.session.get('pendingEnable');
  await chrome.storage.session.remove('pendingEnable');
  if (!pendingEnable || pendingEnable.tabId !== tabId) return;
  const tab = await getTab(tabId);
  if (!tab) return;
  if (pendingEnable.command === 'activate-site') {
    await tryTop(tabId, 'toast', `FillForMe is on for ${Url.siteLabel(tab.url)}`, 'success');
    return;
  }
  setTimeout(() => onCommand(pendingEnable.command, tab), 300);
}

/* ---------- message router ---------- */

const handlers = {
  /* From content scripts */
  async 'bg:page-hello'(msg, sender) {
    const tabId = sender.tab?.id;
    if (tabId == null) return null;
    const rec = await Rec.pageState(tabId);
    const play = await Player.pageState(tabId);
    return { recording: rec?.recording || null, bar: rec?.bar || play?.bar || null };
  },
  'bg:rec-step': (msg, sender) => Rec.addStep(msg.step, sender),
  async 'bg:bar-action'(msg, sender) {
    const tabId = sender.tab?.id;
    const actions = {
      'fill-go': () => runArmedFill(tabId),
      'fill-cancel': () => cancelArmedFill(tabId),
      'rec-pause': () => Rec.setPaused(true),
      'rec-resume': () => Rec.setPaused(false),
      'rec-stop': () => Rec.stop(),
      'play-pause': () => Player.pause(),
      'play-resume': () => Player.resume(),
      'play-stop': () => Player.stop(),
      'play-retry': () => Player.retry(),
      'play-skip': () => Player.skip(),
    };
    return actions[msg.action] ? actions[msg.action]() : null;
  },
  'bg:badge-toggle': (msg, sender) => AI.onBadgeToggle(sender.tab.id, sender.frameId, msg.idx, msg.selected),

  /* Sites */
  'bg:site-enable': (msg) => turnOn(msg.pattern, msg.tabId),
  'bg:prompt-enabled': (msg) => onPromptEnabled(msg.tabId, msg.pattern),
  'bg:site-remove': (msg) => Sites.removeSite(msg.pattern),
  'bg:sites': () => Sites.getEnabledOrigins(),
  'bg:site-status': (msg) => Sites.isEnabledUrl(msg.url),

  /* Recording */
  async 'bg:rec-start'(msg) {
    const busy = await busyMessage();
    if (busy) throw new Error(busy);
    return Rec.start(msg.tabId);
  },
  'bg:rec-pause': (msg) => Rec.setPaused(!!msg.paused),
  'bg:rec-stop': () => Rec.stop(),

  /* Playback */
  async 'bg:play'(msg) {
    if (await Rec.getSession()) throw new Error('Stop the recording before playing.');
    return Player.start(msg.tabId, msg.recordingId, msg);
  },
  'bg:play-control': (msg) => {
    const fn = { pause: Player.pause, resume: Player.resume, stop: Player.stop, retry: Player.retry, skip: Player.skip, dismiss: Player.dismiss }[msg.action];
    return fn ? fn() : null;
  },

  /* AI Fill */
  'bg:ai-scan': (msg) => AI.scan(msg.tabId),
  'bg:ai-get-scan': (msg) => AI.getScan(msg.tabId),
  'bg:ai-select': (msg) => AI.setSelection(msg.tabId, msg.changes),
  'bg:ai-hide': (msg) => AI.hideBadges(msg.tabId),
  'bg:ai-generate': (msg) => AI.generate(msg.tabId, { context: msg.context }),
  'bg:ai-fill': (msg) => (msg.allSteps
    ? AI.fillAllSteps(msg.tabId, { context: msg.context })
    : AI.fill(msg.tabId, { context: msg.context, presetValues: msg.presetValues })),
  'bg:ai-stop': (msg) => AI.stopMultiStep(msg.tabId),
  'bg:ai-undo': (msg) => AI.undo(msg.tabId),
  'bg:pick-next': (msg) => AI.pickNextButton(msg.tabId),

  /* Groq settings (the key is passed only from the settings form, never logged) */
  async 'bg:groq-models'(msg) {
    const s = await getSettings();
    const models = await listModels({ key: msg.key ?? s.groqKey, baseUrl: s.groqBaseUrl });
    return { models, selected: pickModel(s.model, models) };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('bg:')) return false;
  const handler = handlers[msg.type];
  if (!handler) return false;
  Promise.resolve()
    .then(() => handler(msg, sender))
    .then(
      (data) => sendResponse({ ok: true, data: data ?? null }),
      (e) => sendResponse({ ok: false, error: String(e?.message || e), code: e?.code })
    );
  return true; // async response
});

/* ---------- keyboard shortcuts ---------- */

async function onCommand(command, tabArg) {
  const tab = tabArg?.id ? tabArg : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!tab || !Url.isSupported(tab.url)) return;
  if (!(await Sites.isEnabledUrl(tab.url))) {
    if (command === 'activate-site') return void (await activateSite(tab).catch((e) => console.warn('[FillForMe] turn on failed', e)));
    // Ask on the page; fall back to the side panel where the page can't be reached.
    if (!(await showEnablePrompt(tab, command))) chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
    return;
  }
  try {
    if (command === 'activate-site') {
      await tryTop(tab.id, 'toast', `FillForMe is already on for ${Url.siteLabel(tab.url)}`, 'info');
      return;
    }

    if (command === 'toggle-recording') {
      const session = await Rec.getSession();
      if (session) return void (await Rec.stop());
      const busy = await busyMessage();
      if (busy) return void (await tryTop(tab.id, 'toast', busy, 'error'));
      await Rec.start(tab.id);
      return;
    }

    if (command === 'ai-fill') {
      // Pressed again while the fields are shown: fill now (same as Enter).
      if (await isArmed(tab.id)) return void (await runArmedFill(tab.id));
      const busy = await busyMessage();
      if (busy) return void (await tryTop(tab.id, 'toast', busy, 'error'));
      if (!(await confirmLiveOnPage(tab))) return;
      await armFill(tab.id);
      return;
    }

    if (command === 'play-last') {
      const busy = await busyMessage();
      if (busy) return void (await tryTop(tab.id, 'toast', busy, 'error'));
      const siteKey = Url.siteKey(tab.url);
      const site = await getSite(siteKey);
      let rec = site.lastRecordingId ? await getRecording(site.lastRecordingId) : null;
      if (!rec) rec = (await getRecordingsForSite(siteKey))[0];
      if (!rec) return void (await tryTop(tab.id, 'toast', `No recordings for this site yet. Press ${await shortcutText('toggle-recording')} to record one.`, 'info'));
      if (!(await confirmLiveOnPage(tab))) return;
      await Player.start(tab.id, rec.id, { runs: 1 });
    }
  } catch (e) {
    await tryTop(tab.id, 'toast', String(e.message || e), 'error');
  }
}
chrome.commands.onCommand.addListener(onCommand);

// Internal hook for automated tests (not reachable from web pages).
globalThis.__formpilot = { onCommand, showEnablePrompt };
