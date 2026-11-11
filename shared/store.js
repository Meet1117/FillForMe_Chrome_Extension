/**
 * Storage helpers (ES module) used by the service worker and the side panel.
 *
 * chrome.storage.local:
 *   settings   – { groqKey, model, locale, timeoutMs, fillAllSteps, previewBeforeFill, autoSubmit }
 *   recordings – { [id]: Recording }
 *   sites      – { [siteKey]: { context, nextSelectors, nextLabel, lastRecordingId, liveOk, aiSelections } }
 * chrome.storage.session:
 *   recording  – active recording session (survives page loads)
 *   playback   – active playback state (survives page loads + worker restarts)
 */

export const DEFAULT_SETTINGS = {
  groqKey: '',
  model: '',
  locale: 'IN',
  timeoutMs: 10000,
  fillAllSteps: false,
  previewBeforeFill: false,
  /** Click Submit / Save after filling. Off = fill, then leave submitting to the user. */
  autoSubmit: false,
  /** Hidden setting (not in the UI) – lets tests point at a mock server. */
  groqBaseUrl: '',
};

export const LOCALES = [
  { code: 'IN', label: 'India' },
  { code: 'US', label: 'United States' },
  { code: 'UK', label: 'United Kingdom' },
];

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------- settings ---------- */

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

/* ---------- recordings ---------- */

export async function getRecordings() {
  const { recordings } = await chrome.storage.local.get('recordings');
  return recordings || {};
}

export async function getRecording(id) {
  return (await getRecordings())[id] || null;
}

export async function saveRecording(rec) {
  const all = await getRecordings();
  all[rec.id] = { ...rec, updatedAt: Date.now() };
  await chrome.storage.local.set({ recordings: all });
  return all[rec.id];
}

export async function deleteRecording(id) {
  const all = await getRecordings();
  delete all[id];
  await chrome.storage.local.set({ recordings: all });
}

/** Recordings for one site, newest first. */
export async function getRecordingsForSite(site) {
  return Object.values(await getRecordings())
    .filter((r) => r.site === site)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/* ---------- per-site data ---------- */

export async function getSites() {
  const { sites } = await chrome.storage.local.get('sites');
  return sites || {};
}

export async function getSite(site) {
  return (await getSites())[site] || {};
}

export async function saveSite(site, patch) {
  const all = await getSites();
  all[site] = { ...(all[site] || {}), ...patch };
  await chrome.storage.local.set({ sites: all });
  return all[site];
}

/* ---------- import / export ---------- */

/** Everything except the API key, as a plain object ready for JSON. */
export async function exportAll() {
  const settings = await getSettings();
  delete settings.groqKey;
  delete settings.groqBaseUrl;
  return {
    app: 'FillForMe',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    recordings: Object.values(await getRecordings()),
    sites: await getSites(),
  };
}

/** Merge an exported file into storage. Returns counts for the UI. */
export async function importAll(data) {
  // 'FormPilot' was the extension's earlier name – keep accepting those files.
  if (!data || !['FillForMe', 'FormPilot'].includes(data.app) || !Array.isArray(data.recordings)) {
    throw new Error('This file is not a FillForMe export.');
  }
  const all = await getRecordings();
  let count = 0;
  for (const rec of data.recordings) {
    if (!rec || !rec.id || !Array.isArray(rec.steps)) continue;
    all[rec.id] = rec;
    count++;
  }
  await chrome.storage.local.set({ recordings: all });
  if (data.sites && typeof data.sites === 'object') {
    const sites = await getSites();
    for (const [k, v] of Object.entries(data.sites)) sites[k] = { ...(sites[k] || {}), ...v };
    await chrome.storage.local.set({ sites });
  }
  if (data.settings && typeof data.settings === 'object') {
    const { groqKey, groqBaseUrl, ...rest } = data.settings; // never import a key
    await saveSettings(rest);
  }
  return { recordings: count };
}
