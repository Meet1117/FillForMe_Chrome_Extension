/**
 * Sites FillForMe is turned on for.
 *
 * FillForMe gets access to all sites when it is installed (manifest host_permissions),
 * so turning a site on needs no Chrome prompt: the site is added to a list kept in
 * storage, and the content scripts are registered for exactly the sites on that list.
 * On every other site FillForMe does nothing.
 *
 * If the user limits FillForMe's site access in Chrome (puzzle menu → "This can read
 * and change site data"), Chrome withholds access; hasAccess() reports that, and the
 * enable popup asks Chrome for access again.
 */
import '../shared/url-utils.js';
import { CONTENT_FILES, injectContent } from './bridge.js';

const { Url } = globalThis.FPShared;
const SCRIPT_ID = 'formpilot-content';
const KEY = 'enabledSites';
/** Install-time origins that are not "sites": the Groq API and the all-sites grants. */
const NOT_SITES = ['https://api.groq.com/*', 'http://*/*', 'https://*/*', 'file:///*', '*://*/*', '<all_urls>'];

/** Origin patterns the user turned on, e.g. ["http://localhost/*"]. */
export async function getEnabledOrigins() {
  const { [KEY]: list = [] } = await chrome.storage.local.get(KEY);
  return list;
}

async function saveOrigins(list) {
  await chrome.storage.local.set({ [KEY]: [...new Set(list)] });
}

/** Is FillForMe turned on for this URL (and does Chrome let it run there)? */
export async function isEnabledUrl(url) {
  if (!Url.isSupported(url)) return false;
  const origins = await getEnabledOrigins();
  if (!origins.some((p) => Url.patternMatches(p, url))) return false;
  return hasAccess(Url.originPattern(url));
}

/** Does Chrome currently let FillForMe run on this origin pattern? */
export async function hasAccess(pattern) {
  try {
    return await chrome.permissions.contains({ origins: [pattern] });
  } catch {
    return false;
  }
}

/** Re-register content scripts so they match exactly the enabled origins. */
export async function syncContentScripts() {
  const origins = await getEnabledOrigins();
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  } catch {
    /* nothing registered */
  }
  if (!origins.length) return;
  await chrome.scripting.registerContentScripts([
    {
      id: SCRIPT_ID,
      matches: origins,
      js: CONTENT_FILES,
      allFrames: true,
      matchOriginAsFallback: true,
      runAt: 'document_idle',
      persistAcrossSessions: true,
    },
  ]);
}

/** Turn a site on: add it to the list, register the content scripts, inject into the open tab. */
export async function enableSite(pattern, tabId) {
  const origins = await getEnabledOrigins();
  if (!origins.includes(pattern)) await saveOrigins([...origins, pattern]);
  await syncContentScripts();
  if (tabId) await injectContent(tabId);
}

/** Turn a site off. Recordings are kept. */
export async function removeSite(pattern) {
  await saveOrigins((await getEnabledOrigins()).filter((p) => p !== pattern));
  // Sites turned on by older versions were optional permissions; drop those too.
  await chrome.permissions.remove({ origins: [pattern] }).catch(() => {});
  await syncContentScripts();
}

/** Older versions kept each site as an optional host permission: move them onto the list. */
export async function migrateLegacySites() {
  const { origins = [] } = await chrome.permissions.getAll();
  const legacy = origins.filter((o) => !NOT_SITES.includes(o));
  if (legacy.length) await saveOrigins([...(await getEnabledOrigins()), ...legacy]);
}
