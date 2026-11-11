/**
 * Bridge from the service worker into page frames.
 *
 * Instead of message passing, we call `globalThis.__FP.api[method](...args)` inside the
 * content-script world with chrome.scripting.executeScript. This gives us a real
 * request/response per frame (with frameId), awaits async results, and lets us inject
 * the content scripts on demand when a frame doesn't have them yet.
 */

/** Content script files, in load order. Also used for dynamic registration. */
export const CONTENT_FILES = [
  'shared/url-utils.js',
  'shared/templates.js',
  'shared/generator.js',
  'shared/validator.js',
  'content/dom-utils.js',
  'content/scanner.js',
  'content/filler.js',
  'content/overlay.js',
  'content/recorder.js',
  'content/main.js',
];

/** Runs inside the page (isolated world). Must be self-contained. */
function invokeInPage(method, args) {
  const FP = globalThis.__FP;
  const api = FP && FP.api;
  // Missing, or left over from a previous version of the extension (dead runtime).
  if (!api || (typeof FP.alive === 'function' && !FP.alive())) return { __fpMissing: true };
  if (typeof api[method] !== 'function') return { __fpError: `Unknown method ${method}` };
  return Promise.resolve()
    .then(() => api[method](...(args || [])))
    .then(
      (value) => ({ value: value === undefined ? null : value }),
      (e) => ({ __fpError: String((e && e.message) || e) })
    );
}

/** Inject the content scripts into specific frames (or all frames). */
export async function injectContent(tabId, frameIds) {
  const target = frameIds ? { tabId, frameIds } : { tabId, allFrames: true };
  try {
    await chrome.scripting.executeScript({ target, files: CONTENT_FILES });
  } catch (e) {
    // Frames we have no permission for, or that went away, are ignored.
    console.debug('[FillForMe] inject failed', e?.message);
  }
}

/**
 * Call an API method in one frame. Injects the content scripts if needed.
 * Throws on errors from the page; returns the method's return value.
 */
export async function callFrame(tabId, frameId, method, ...args) {
  const run = () =>
    chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: invokeInPage,
      args: [method, args],
    });
  let [res] = await run();
  if (res?.result?.__fpMissing) {
    await injectContent(tabId, [frameId]);
    [res] = await run();
  }
  const r = res?.result;
  if (!r || r.__fpMissing) throw new Error('FillForMe is not active on this page. Is the site enabled?');
  if (r.__fpError) throw new Error(r.__fpError);
  return r.value;
}

/**
 * Call an API method in every frame we can access.
 * Returns [{ frameId, value }] (frames that throw are reported with `error`).
 */
export async function callAllFrames(tabId, method, ...args) {
  const run = (target) =>
    chrome.scripting.executeScript({ target, func: invokeInPage, args: [method, args] });
  let results = await run({ tabId, allFrames: true });
  const missing = results.filter((r) => r.result?.__fpMissing).map((r) => r.frameId);
  if (missing.length) {
    await injectContent(tabId, missing);
    const again = await run({ tabId, frameIds: missing });
    results = results.filter((r) => !missing.includes(r.frameId)).concat(again);
  }
  return results
    .filter((r) => r.result && !r.result.__fpMissing)
    .map((r) =>
      r.result.__fpError
        ? { frameId: r.frameId, error: r.result.__fpError }
        : { frameId: r.frameId, value: r.result.value }
    );
}

/** List the frames of a tab we can reach: [{ frameId, url, top }]. */
export async function listFrames(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => ({ url: location.origin + location.pathname, top: window === window.top }),
  });
  return results.map((r) => ({ frameId: r.frameId, ...(r.result || {}) }));
}

/** Call the top frame and swallow errors (used for cosmetic things like the floating bar). */
export async function tryTop(tabId, method, ...args) {
  try {
    return await callFrame(tabId, 0, method, ...args);
  } catch {
    return null;
  }
}
