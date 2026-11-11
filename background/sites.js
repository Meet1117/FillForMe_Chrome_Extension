/**
 * Site permissions.
 *
 * FillForMe only runs on sites you enable. Enabling a site grants an optional host
 * permission (requested from the side panel, which has the user gesture). Here we keep
 * the dynamically registered content scripts in sync with the granted origins.
 */
import '../shared/url-utils.js';
import { CONTENT_FILES, injectContent } from './bridge.js';

const { Url } = globalThis.FPShared;
const SCRIPT_ID = 'formpilot-content';
/** Origins granted at install time that are not "sites" (the Groq API). */
const INTERNAL = ['https://api.groq.com/*'];

/** Origin patterns the user enabled, e.g. ["http://localhost/*"]. */
export async function getEnabledOrigins() {
  const { origins = [] } = await chrome.permissions.getAll();
  return origins.filter((o) => !INTERNAL.includes(o));
}

/** Is FillForMe enabled for this URL? */
export async function isEnabledUrl(url) {
  if (!Url.isSupported(url)) return false;
  const origins = await getEnabledOrigins();
  return origins.some((p) => Url.patternMatches(p, url));
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

/** Called after the side panel got a new permission: register + inject into the open tab. */
export async function onSiteEnabled(tabId) {
  await syncContentScripts();
  if (tabId) await injectContent(tabId);
}

/** Remove a site (revokes the permission). */
export async function removeSite(pattern) {
  await chrome.permissions.remove({ origins: [pattern] });
  await syncContentScripts();
}
