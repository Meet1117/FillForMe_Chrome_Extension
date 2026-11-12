/**
 * Settings: Groq key (show/hide + Test Key), model, locale, wait timeout,
 * enabled sites and import/export. (Keyboard shortcuts are listed at the bottom of the main panel.)
 */
import { saveSettings, LOCALES, exportAll, importAll } from '../shared/store.js';
import { app } from './state.js';
import { h, icon, send, toast, confirmBox, downloadJSON, pickJSONFile } from './ui.js';

let models = null; // cached model list for this panel session

export function renderSettings() {
  const s = app.settings;

  /* --- Groq --- */
  const keyInput = h('input', {
    class: 'input', type: 'password', value: s.groqKey || '', placeholder: 'gsk_…', autocomplete: 'off', spellcheck: false,
    attrs: { 'aria-label': 'Groq API key' },
    on: { change: async (e) => { app.settings = await saveSettings({ groqKey: e.target.value.trim() }); status.textContent = ''; } },
  });
  const eye = h('button', { class: 'btn', title: 'Show / hide key', attrs: { 'aria-label': 'Show or hide key' } }, icon('eye', 15));
  eye.addEventListener('click', () => {
    const show = keyInput.type === 'password';
    keyInput.type = show ? 'text' : 'password';
    eye.textContent = '';
    eye.append(icon(show ? 'eyeOff' : 'eye', 15));
  });
  const status = h('div', { class: 'status-line' });
  const testBtn = h('button', { class: 'btn', text: 'Test key' });
  testBtn.addEventListener('click', async () => {
    const key = keyInput.value.trim();
    if (!key) { status.className = 'status-line err'; status.textContent = 'Paste your key first.'; return; }
    status.className = 'status-line'; status.textContent = 'Checking…';
    try {
      app.settings = await saveSettings({ groqKey: key });
      const res = await send('bg:groq-models', { key });
      models = res.models;
      if (!app.settings.model || !models.includes(app.settings.model)) app.settings = await saveSettings({ model: res.selected });
      fillModels(modelSelect);
      status.className = 'status-line ok';
      status.textContent = `Key works. ${models.length} models available.`;
    } catch (e) {
      status.className = 'status-line err';
      status.textContent = e.message;
    }
  });

  const modelSelect = h('select', { class: 'input', attrs: { 'aria-label': 'Model' }, on: { change: async (e) => { app.settings = await saveSettings({ model: e.target.value }); toast('Model saved'); } } });
  fillModels(modelSelect);
  if (!models && s.groqKey) loadModels(modelSelect);

  const localeSelect = h('select', { class: 'input', on: { change: async (e) => { app.settings = await saveSettings({ locale: e.target.value }); toast('Saved'); } } },
    LOCALES.map((l) => h('option', { value: l.code, text: l.label, selected: s.locale === l.code })));

  const timeout = h('input', {
    class: 'input', type: 'number', min: 1, max: 120, value: Math.round((s.timeoutMs || 10000) / 1000), style: { width: '90px' },
    on: { change: async (e) => { const sec = Math.min(120, Math.max(1, parseInt(e.target.value, 10) || 10)); app.settings = await saveSettings({ timeoutMs: sec * 1000 }); } },
  });

  /* --- Sites --- */
  const siteList = h('ul', { class: 'site-list' }, h('li', { class: 'muted', text: 'Loading…' }));
  loadSites(siteList);

  return h('div', {},
    section('Groq',
      h('label', { class: 'field' },
        h('span', { class: 'label', text: 'API key' }),
        h('div', { class: 'input-group' }, keyInput, eye, testBtn),
        status,
        h('p', { class: 'helper' }, 'Get a free key at ', h('a', { class: 'link', href: 'https://console.groq.com/keys', target: '_blank', text: 'console.groq.com/keys' }),
          '. It stays in this browser and is only sent to Groq.')),
      h('label', { class: 'field' },
        h('span', { class: 'label', text: 'Model' }),
        h('div', { class: 'input-group' }, modelSelect,
          h('button', { class: 'btn', title: 'Reload model list', on: { click: () => loadModels(modelSelect, true) } }, icon('refresh', 14))),
        null),
      h('label', { class: 'field' },
        h('span', { class: 'label', text: 'Country for test data' }),
        localeSelect,
        h('p', { class: 'helper', text: 'Names, phone numbers and addresses follow this country.' }))),

    section('Playback',
      h('label', { class: 'field' },
        h('span', { class: 'label', text: 'Wait for a field up to' }),
        h('div', { class: 'btn-row' }, timeout, h('span', { class: 'muted', text: 'seconds' })),
        h('p', { class: 'helper', text: 'For slow pages and dropdowns that load their options.' }))),

    section('Sites', siteList,
      h('p', { class: 'helper', text: 'FillForMe only runs on these sites. Removing one keeps its recordings.' })),

    section('Import and export',
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', text: 'Export everything', on: { click: doExport } }),
        h('button', { class: 'btn', text: 'Import file', on: { click: doImport } })),
      h('p', { class: 'helper', text: 'A JSON file with all recordings and settings, without your API key.' })),

    h('p', { class: 'helper', text: `Version ${chrome.runtime.getManifest().version}` }));
}

function section(title, ...children) {
  return h('div', { class: 'set-section' }, h('h3', { text: title }), ...children);
}

function fillModels(select) {
  const current = app.settings.model;
  select.textContent = '';
  const list = models || (current ? [current] : []);
  if (!list.length) {
    select.append(h('option', { value: '', text: app.settings.groqKey ? 'Loading models…' : 'Add your key to load models' }));
    return;
  }
  for (const m of list) select.append(h('option', { value: m, text: m, selected: m === current }));
}

async function loadModels(select, force = false) {
  if (!app.settings.groqKey) return toast('Add your Groq key first.', 'info');
  try {
    if (force || !models) {
      const res = await send('bg:groq-models', {});
      models = res.models;
      if (!app.settings.model || !models.includes(app.settings.model)) app.settings = await saveSettings({ model: res.selected });
    }
    fillModels(select);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function loadSites(list) {
  const origins = await send('bg:sites').catch(() => []);
  list.textContent = '';
  if (!origins.length) {
    list.append(h('li', { class: 'muted', text: 'None yet. Open your app and press Option+A (Alt+A on Windows), or click Enable at the top.' }));
    return;
  }
  for (const o of origins) {
    list.append(h('li', {},
      h('span', { text: o.replace(/\/\*$/, '').replace('file://', 'Local files') }),
      h('button', { class: 'btn ghost small', text: 'Remove', on: { click: async () => {
        if (!(await confirmBox({ title: 'Remove site?', message: `FillForMe will stop working on ${o}. Recordings are kept.`, okText: 'Remove', danger: true }))) return;
        await send('bg:site-remove', { pattern: o }).catch((e) => toast(e.message, 'error'));
        await loadSites(list);
        app.reload();
      } } })));
  }
}

async function doExport() {
  const data = await exportAll();
  const d = new Date();
  downloadJSON(`fillforme-export-${d.toISOString().slice(0, 10)}.json`, data);
  toast(`Exported ${data.recordings.length} recording${data.recordings.length === 1 ? '' : 's'}`, 'success');
}

async function doImport() {
  try {
    const data = await pickJSONFile();
    if (!data) return;
    const res = await importAll(data);
    toast(`Imported ${res.recordings} recording${res.recordings === 1 ? '' : 's'}`, 'success');
    await app.reload();
  } catch (e) {
    toast(e.message, 'error');
  }
}
