/**
 * Side panel entry: finds the current tab, keeps state in sync with storage and the
 * service worker, and renders the site bar, tabs and the active view.
 */
import '../shared/url-utils.js';
import { getSettings, getSite, saveSite, getRecordingsForSite, getRecording, saveRecording } from '../shared/store.js';
import { app } from './state.js';
import { h, icon, send, toast, confirmBox, promptText, debounce } from './ui.js';
import { renderRecordTab } from './record-tab.js';
import { renderEditor } from './editor.js';
import { renderAITab, onAIMessage } from './ai-tab.js';
import { renderSettings } from './settings.js';
import { getOS, formatShortcut, OS_NAMES } from '../shared/shortcuts.js';

const { Url } = globalThis.FPShared;
const $ = (s) => document.querySelector(s);

// Debug / testing: sidepanel.html?tabId=123 targets a specific tab.
const params = new URLSearchParams(location.search);
const fixedTabId = params.has('tabId') ? Number(params.get('tabId')) : null;

/* ---------- loading ---------- */

async function currentTab() {
  if (fixedTabId != null) return chrome.tabs.get(fixedTabId).catch(() => null);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function reload() {
  const tab = await currentTab();
  const prevSite = app.site;
  const prevTabId = app.tab?.id;
  app.tab = tab;
  app.url = tab?.url || '';
  app.supported = !!tab && Url.isSupported(app.url);
  app.site = Url.siteKey(app.url);
  app.enabled = app.supported ? await send('bg:site-status', { url: app.url }).catch(() => false) : false;
  app.settings = await getSettings();
  app.siteData = await getSite(app.site);
  app.recordings = await getRecordingsForSite(app.site);
  const sess = await chrome.storage.session.get(['recording', 'playback']);
  app.recSession = sess.recording || null;
  app.playback = sess.playback || null;
  if (prevSite !== app.site || prevTabId !== app.tab?.id) {
    app.ai = { scan: null, busy: false, progress: '', result: null, preview: null, scanning: false };
    if (app.view === 'editor') app.view = 'record';
  }
  if (app.enabled && tab) app.ai.scan = await send('bg:ai-get-scan', { tabId: tab.id }).catch(() => null);
  render();
}

/* ---------- rendering ---------- */

function render() {
  renderRecStrip();
  renderSiteBar();
  renderFooter();
  renderTabs();
  const view = $('#view');
  const scroll = view.scrollTop;
  view.textContent = '';
  if (app.view === 'settings') view.append(renderSettings());
  else if (!app.supported) view.append(unsupportedState());
  else if (!app.enabled) view.append(enableState());
  else if (app.view === 'editor') view.append(renderEditor());
  else if (app.view === 'ai') view.append(renderAITab());
  else view.append(renderRecordTab());
  view.scrollTop = scroll;
}

/** Red strip across the top while recording – the one loud thing in the panel. */
function renderRecStrip() {
  const strip = $('#rec-strip');
  strip.textContent = '';
  const s = app.recSession;
  strip.className = s ? `rec-strip ${s.status === 'paused' ? 'paused' : ''}` : 'hidden';
  if (!s) return;
  const paused = s.status === 'paused';
  const n = s.steps.length;
  strip.append(
    h('span', { class: 'dot' }),
    h('span', { class: 'grow', text: `${paused ? 'Paused' : 'Recording'}, ${n} step${n === 1 ? '' : 's'}` }),
    h('button', { text: paused ? 'Resume' : 'Pause', on: { click: () => send('bg:rec-pause', { paused: !paused }).catch((e) => toast(e.message, 'error')) } }),
    h('button', { text: 'Stop and save', on: { click: () => send('bg:rec-stop').then((rec) => { if (!rec) toast('Nothing was recorded.'); }).catch((e) => toast(e.message, 'error')) } }));
}

function settingsButton() {
  return h('button', {
    class: 'icon-btn', title: app.view === 'settings' ? 'Close settings' : 'Settings',
    attrs: { 'aria-label': 'Settings' },
    on: { click: () => go(app.view === 'settings' ? app.lastTab : 'settings') },
  }, icon(app.view === 'settings' ? 'x' : 'settings', 16));
}

function renderSiteBar() {
  const bar = $('#site-bar');
  bar.textContent = '';
  const parts = [];
  if (app.view === 'settings') {
    parts.push(h('span', { class: 'host', text: 'Settings' }), h('span', { class: 'grow' }));
  } else if (!app.supported) {
    parts.push(h('span', { class: 'host muted', text: 'No page open' }), h('span', { class: 'grow' }));
  } else {
    parts.push(h('span', { class: 'host', text: Url.siteLabel(app.url), title: app.url }));
    if (Url.isLikelyProduction(app.url) && !app.siteData.liveOk) parts.push(h('span', { class: 'live', text: 'live site?', title: "This address doesn't look like a dev, test or staging site" }));
    parts.push(h('span', { class: 'grow' }));
    parts.push(app.enabled
      ? h('span', { class: 'state on', text: 'On' })
      : h('button', { class: 'btn small', text: 'Enable', on: { click: enableSite } }));
  }
  parts.push(settingsButton());
  bar.append(...parts);
}

/* ---------- keyboard shortcuts footer ---------- */

const SHORTCUT_NAMES = { 'activate-site': 'Turn on for this site', 'ai-fill': 'Fill this page', 'play-last': 'Play the last recording', 'toggle-recording': 'Start or stop recording' };
let shortcutList = null;
let deviceOS = '';

/** Read the current shortcuts and show them the way this device writes them (⌥⇧F on Mac, Alt+Shift+F on Windows). */
async function loadShortcuts() {
  deviceOS = await getOS();
  const cmds = await chrome.commands.getAll();
  shortcutList = cmds.filter((c) => SHORTCUT_NAMES[c.name]).map((c) => ({ name: SHORTCUT_NAMES[c.name], key: formatShortcut(c.shortcut, deviceOS) }));
  renderFooter();
}

function renderFooter() {
  const foot = $('#shortcuts');
  foot.textContent = '';
  const show = app.view !== 'settings' && app.supported && shortcutList;
  foot.classList.toggle('hidden', !show);
  if (!show) return;
  foot.append(
    h('div', { class: 'foot-head' },
      h('span', {}, 'Keyboard shortcuts', OS_NAMES[deviceOS] ? h('span', { class: 'foot-os', text: ` for ${OS_NAMES[deviceOS]}` }) : null),
      h('button', { class: 'link', text: 'Change', on: { click: () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }) } })),
    h('div', { class: 'shortcuts' },
      shortcutList.map((c) => [h('span', { class: c.key ? 'kbd' : 'muted', text: c.key || 'Not set' }), h('span', { text: c.name })])));
}

function renderTabs() {
  const tabs = $('#tabs');
  tabs.classList.toggle('hidden', app.view === 'settings' || !app.supported || !app.enabled || app.view === 'editor');
  tabs.querySelectorAll('.tab').forEach((t) => {
    const on = t.dataset.tab === (app.view === 'editor' ? 'record' : app.view);
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
  });
}

function unsupportedState() {
  return h('div', { class: 'empty' },
    h('h4', { text: 'Open the page with your form' }),
    h('p', { text: 'FillForMe works on http, https and local file pages.' }));
}

function enableState() {
  const isFile = app.url.startsWith('file:');
  return h('div', { class: 'empty' },
    h('h4', { text: `FillForMe is off for ${Url.siteLabel(app.url)}` }),
    h('p', { text: 'It only runs on sites you turn on. You can turn sites off again in Settings.' }),
    h('button', { class: 'btn primary', text: 'Turn on for this site', on: { click: enableSite } }),
    isFile ? h('p', { class: 'helper', style: { marginTop: '10px' }, text: 'Local files also need "Allow access to file URLs" on the extension\'s details page.' }) : null);
}

/**
 * Turn the site on. FillForMe has site access from install, so this needs no prompt,
 * unless the user limited its site access in Chrome; then Chrome's prompt asks again
 * (which is why this runs straight from the click).
 */
function enableSite() {
  const pattern = Url.originPattern(app.url);
  chrome.permissions.contains({ origins: [pattern] }).then((has) => has || chrome.permissions.request({ origins: [pattern] })).then(async (granted) => {
    if (!granted) return toast('Chrome did not allow FillForMe on this site.', 'error');
    await send('bg:site-enable', { tabId: app.tab.id, pattern }).catch(() => {});
    if (app.url.startsWith('file:') && !(await chrome.extension.isAllowedFileSchemeAccess())) {
      await confirmBox({
        title: 'One more step for local files',
        message: 'Open the extension details and turn on "Allow access to file URLs". Then reload your page.',
        okText: 'Open details',
      }).then((ok) => ok && chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }));
    }
    toast(`Turned on for ${Url.siteLabel(app.url)}`, 'success');
    await reload();
  }).catch((e) => toast(e.message, 'error'));
}

/* ---------- navigation ---------- */

function go(view, opts = {}) {
  if (view === 'record' || view === 'ai') app.lastTab = view;
  if (view === 'editor') { app.editorId = opts.id; app.editorToken = Date.now(); }
  if (view !== 'ai' && app.view === 'ai' && app.ai.scan && app.tab) {
    // Leaving AI Fill: hide the badges on the page.
    send('bg:ai-hide', { tabId: app.tab.id }).catch(() => {});
  }
  if (view === 'ai' && app.view !== 'ai' && app.ai.scan && app.tab) {
    // Coming back: show the badges again for the existing scan.
    send('bg:ai-scan', { tabId: app.tab.id }).then((scan) => { app.ai.scan = scan; render(); }).catch(() => {});
  }
  app.view = view;
  $('#view').scrollTop = 0;
  render();
}

/** Yellow warning before filling / replaying on something that looks like production. */
async function confirmLive() {
  if (!Url.isLikelyProduction(app.url)) return true;
  // Asked once per site: read fresh so an approval from a shortcut or another panel counts.
  app.siteData = await getSite(app.site);
  if (app.siteData.liveOk) return true;
  const ok = await confirmBox({
    title: 'This looks like a live site',
    message: `${Url.siteLabel(app.url)} doesn't look like a dev, test or staging site. Fill it anyway? You won't be asked again for this site.`,
    okText: 'Continue',
    tone: 'warn',
  });
  if (ok) app.siteData = await saveSite(app.site, { liveOk: true });
  return ok;
}

Object.assign(app, { render, reload, go, confirmLive });

/* ---------- events ---------- */

document.querySelectorAll('#tabs .tab').forEach((t) => t.addEventListener('click', () => go(t.dataset.tab)));

const reloadSoon = debounce(() => reload(), 250);

chrome.tabs.onActivated.addListener(() => { if (fixedTabId == null) reloadSoon(); });
chrome.windows?.onFocusChanged?.addListener(() => { if (fixedTabId == null) reloadSoon(); });

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('ui:')) return;
  switch (msg.type) {
    case 'ui:tab-updated':
      if (app.tab && msg.tabId === app.tab.id) reloadSoon();
      break;
    case 'ui:sites':
      reloadSoon();
      break;
    case 'ui:recording-saved':
      askRecordingName(msg.id);
      break;
    default:
      onAIMessage(msg, sender);
  }
});

/** After a recording stops, let the user name it (it's already saved under the page title). */
async function askRecordingName(id) {
  const rec = await getRecording(id);
  if (!rec) return;
  if (app.view !== 'record' && app.view !== 'editor') go('record');
  const name = await promptText({ title: 'Name this recording', label: 'Name', value: rec.name, okText: 'Save' });
  if (name && name !== rec.name) await saveRecording({ ...(await getRecording(id)), name });
  toast(`Saved "${name || rec.name}"`);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (changes.settings) {
      app.settings = { ...app.settings, ...(changes.settings.newValue || {}) };
      if (app.view !== 'settings') render();
    }
    if (changes.recordings) {
      const all = changes.recordings.newValue || {};
      app.recordings = Object.values(all).filter((r) => r.site === app.site).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      if (app.view === 'record') render();
    }
    if (changes.sites) app.siteData = (changes.sites.newValue || {})[app.site] || {};
  }
  if (area === 'session') {
    let dirty = false;
    if (changes.recording) { app.recSession = changes.recording.newValue || null; dirty = true; }
    if (changes.playback) { app.playback = changes.playback.newValue || null; dirty = true; }
    if (dirty) { renderRecStrip(); if (app.view === 'record') render(); }
  }
});

loadShortcuts();
window.addEventListener('focus', loadShortcuts); // pick up changes made in chrome://extensions/shortcuts
reload();
