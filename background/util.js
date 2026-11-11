/** Small helpers for the service worker. */

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Send an event to the side panel (ignored if it isn't open). */
export function notify(msg) {
  try {
    chrome.runtime.sendMessage(msg).catch(() => {});
  } catch {
    /* no listeners */
  }
}

export async function getTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

/** Wait until a tab has finished loading (status "complete"). */
export function waitForTabComplete(tabId, timeout = 30000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve(v);
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') finish(true);
    };
    chrome.tabs.onUpdated.addListener(listener);
    const timer = setTimeout(() => finish(false), timeout);
    getTab(tabId).then((t) => {
      if (!t) finish(false);
      else if (t.status === 'complete') finish(true);
    });
  });
}

/**
 * After an action that may navigate (a click), wait a moment and – if the tab
 * started loading – wait for it to finish.
 */
export async function waitForSettle(tabId, ms = 250) {
  await sleep(ms);
  const t = await getTab(tabId);
  if (t && t.status === 'loading') {
    await waitForTabComplete(tabId);
    await sleep(150);
  }
}

/**
 * Keep the service worker alive during long operations (playback, multi-step fill).
 * Calling an extension API every 20s resets the idle timer.
 */
let keepAliveCount = 0;
let keepAliveTimer = null;
export function keepAlive(on) {
  keepAliveCount = Math.max(0, keepAliveCount + (on ? 1 : -1));
  if (keepAliveCount && !keepAliveTimer) {
    keepAliveTimer = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
  } else if (!keepAliveCount && keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

/**
 * A simple async lock: lock(fn) runs fn after all previously queued calls finished.
 * Used to serialize read-modify-write cycles on chrome.storage.session.
 */
export function createLock() {
  let tail = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => {});
    return run;
  };
}
