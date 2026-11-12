/**
 * AI Fill tab: find fields (badges on the page), choose which to fill, describe the
 * data, fill with Groq (or random data), preview, Undo / Regenerate, multi-step fill.
 */
import '../shared/generator.js';
import { saveSite, saveSettings } from '../shared/store.js';
import { app } from './state.js';
import { h, icon, send, toast, debounce } from './ui.js';
import { submitToggle } from './record-tab.js';

const saveContext = debounce((text) => saveSite(app.site, { context: text }), 400);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/* ---------- messages from the worker / page ---------- */

export function onAIMessage(msg) {
  if (!app.tab || msg.tabId !== app.tab.id) return;
  switch (msg.type) {
    case 'ui:ai-scan':
      app.ai.scan = msg.data;
      if (app.view === 'ai') app.render();
      break;
    case 'ui:ai-selection':
      if (app.ai.scan) {
        app.ai.scan.selection[msg.key] = msg.selected;
        if (app.view === 'ai') app.render();
      }
      break;
    case 'ui:ai-progress':
      app.ai.progress = msg.text;
      if (app.view === 'ai') app.render();
      break;
    case 'ui:ai-reset':
      if (!app.ai.busy) {
        app.ai.scan = null;
        app.ai.result = null;
        app.ai.preview = null;
        if (app.view === 'ai') app.render();
      }
      break;
    case 'ui:ai-filled':
      app.ai.result = msg.result;
      if (app.view === 'ai') app.render();
      break;
    default:
  }
}

/* ---------- view ---------- */

export function renderAITab() {
  const wrap = h('div', {});
  const { scan, busy, preview } = app.ai;

  if (!app.settings.groqKey) {
    wrap.append(h('p', { class: 'banner' }, 'No Groq key yet, so fields get random data. ',
      h('button', { class: 'link', text: 'Add a key', on: { click: () => app.go('settings') } })));
  }

  if (preview) {
    wrap.append(previewBlock(preview));
    return wrap;
  }

  if (!scan) {
    wrap.append(h('div', { class: 'block' },
      h('button', { class: `btn big primary ${app.ai.scanning ? 'disabled' : ''}`, on: { click: () => doScan() } },
        app.ai.scanning ? h('span', { class: 'spinner' }) : null, 'Find fields'),
      h('p', { class: 'helper', text: 'Marks every field on the page so you can choose which ones to fill.' })));
  } else {
    wrap.append(fieldsBlock(scan));
  }

  wrap.append(optionsBlock());

  if (scan || app.settings.fillAllSteps) wrap.append(actionBlock());
  if (app.ai.result && !busy) wrap.append(resultBlock(app.ai.result));
  return wrap;
}

/* ---------- scanning & selection ---------- */

async function doScan() {
  app.ai.scanning = true;
  app.ai.result = null;
  app.render();
  try {
    app.ai.scan = await send('bg:ai-scan', { tabId: app.tab.id });
    if (!app.ai.scan.fields.length) toast('No fields to fill on this page.');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    app.ai.scanning = false;
    app.render();
  }
}

function selectedFields(scan) {
  return scan.fields.filter((f) => scan.selection[f.key] && !f.unsupported);
}

async function changeSelection(changes) {
  Object.assign(app.ai.scan.selection, changes);
  app.render();
  await send('bg:ai-select', { tabId: app.tab.id, changes }).catch((e) => toast(e.message, 'error'));
}

function quick(kind) {
  const changes = {};
  for (const f of app.ai.scan.fields) {
    if (f.unsupported) continue;
    changes[f.key] = kind === 'all' ? true : kind === 'none' ? false : kind === 'empty' ? !!f.empty : !!f.required;
  }
  changeSelection(changes);
}

const KIND_LABEL = {
  'checkbox-group': 'checkboxes', 'custom-select': 'dropdown', contenteditable: 'rich text', 'datetime-local': 'date and time',
  select: 'dropdown', textarea: 'text', tel: 'phone', url: 'link',
};

function fieldsBlock(scan) {
  const sel = selectedFields(scan);
  const fillable = scan.fields.filter((f) => !f.unsupported).length;
  const results = new Map((app.ai.result?.results || []).map((r) => [r.key, r]));
  const list = h('ul', { class: 'field-list' },
    scan.fields.map((f) => {
      const on = !!scan.selection[f.key];
      const r = results.get(f.key);
      return h('li', { class: on ? '' : 'off', title: f.unsupported || f.help || '' },
        h('input', {
          type: 'checkbox', checked: on, disabled: !!f.unsupported, attrs: { 'aria-label': f.label },
          on: { change: (e) => changeSelection({ [f.key]: e.target.checked }) },
        }),
        h('span', { class: 'fl' }, f.label || f.name || 'Unlabelled field', f.required ? h('span', { class: 'req', text: '*' }) : null),
        r?.warning ? h('span', { class: 'warn-icon', title: r.warning }, icon('alert', 13)) : null,
        h('span', { class: 'kind', text: f.unsupported ? 'not supported' : KIND_LABEL[f.kind] || f.kind }));
    }));
  const q = (label, kind) => h('button', { class: 'link', text: label, on: { click: () => quick(kind) } });
  return h('div', { class: 'block' },
    h('div', { class: 'ai-head' },
      h('b', { text: `${sel.length} of ${fillable} selected` }),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost small', text: 'Find again', on: { click: () => doScan() } }),
        h('button', { class: 'btn ghost small', text: 'Clear', title: 'Remove the marks from the page', on: { click: hide } }))),
    h('div', { class: 'quick' }, q('All', 'all'), q('None', 'none'), q('Empty only', 'empty'), q('Required only', 'required')),
    scan.fields.length ? list : h('p', { class: 'muted', text: 'No fields to fill on this page.' }),
    h('p', { class: 'helper', text: 'You can also click the marks on the page. FillForMe remembers your choice for this page.' }));
}

async function hide() {
  await send('bg:ai-hide', { tabId: app.tab.id }).catch(() => {});
  app.ai.scan = null;
  app.ai.result = null;
  app.render();
}

/* ---------- options ---------- */

function optionsBlock() {
  const site = app.siteData;
  const allSteps = !!app.settings.fillAllSteps;
  return h('div', { class: 'block' },
    h('label', { class: 'field' },
      h('span', { class: 'label', text: 'Describe the data (optional)' }),
      h('textarea', {
        class: 'input', rows: 3, value: site.context || '',
        placeholder: 'Water testing lab, customer is a hotel in Mumbai, samples collected this week',
        on: { input: (e) => { app.siteData.context = e.target.value; saveContext(e.target.value); } },
      }),
      h('p', { class: 'helper', text: 'Saved for this site.' })),
    h('div', { style: { marginTop: '8px' } },
      toggle('Fill all steps', 'Fills a step, clicks Next, and repeats until the last step.', allSteps,
        (v) => setSetting({ fillAllSteps: v })),
      allSteps ? h('div', { class: 'helper', style: { margin: '0 0 6px 21px' } },
        site.nextLabel ? `Next button: "${site.nextLabel}". ` : 'Next button is found automatically. ',
        h('button', { class: 'link', text: site.nextLabel ? 'Pick again' : 'Pick it yourself', on: { click: pickNext } }),
        site.nextSelectors ? [' or ', h('button', { class: 'link', text: 'use automatic', on: { click: async () => { app.siteData = await saveSite(app.site, { nextSelectors: null, nextLabel: '' }); app.render(); } } })] : null) : null,
      toggle('Preview before filling', 'Check and edit the values before they go into the page.', !!app.settings.previewBeforeFill,
        (v) => setSetting({ previewBeforeFill: v })),
      submitToggle()));
}

function toggle(title, desc, checked, onChange) {
  return h('label', { class: 'toggle' },
    h('input', { type: 'checkbox', checked, on: { change: (e) => onChange(e.target.checked) } }),
    h('span', {}, h('div', { text: title }), h('div', { class: 'd', text: desc })));
}

async function setSetting(patch) {
  app.settings = await saveSettings(patch);
  app.render();
}

async function pickNext() {
  toast('Click the Next button on the page. Press Esc to cancel.', 'info');
  try {
    const picked = await send('bg:pick-next', { tabId: app.tab.id });
    if (picked) {
      app.siteData = { ...app.siteData, nextSelectors: picked.selectors, nextLabel: picked.label };
      toast(`Next button set to "${picked.label}"`);
      app.render();
    }
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ---------- fill ---------- */

function actionBlock() {
  const { busy, scan } = app.ai;
  const allSteps = !!app.settings.fillAllSteps;
  const count = scan ? selectedFields(scan).length : 0;
  if (busy) {
    return h('div', { class: 'block' },
      h('div', { class: 'result' }, h('span', { class: 'spinner' }), h('span', { text: app.ai.progress || 'Filling…' })),
      allSteps ? h('div', { class: 'btn-row', style: { marginTop: '8px' } },
        h('button', { class: 'btn small', text: 'Stop after this step', on: { click: () => send('bg:ai-stop', { tabId: app.tab.id }) } })) : null);
  }
  const label = allSteps ? 'Fill all steps' : `Fill ${plural(count, 'field')}`;
  return h('div', { class: 'block' },
    h('button', { class: `btn big primary ${!allSteps && !count ? 'disabled' : ''}`, text: label, on: { click: () => doFill() } }));
}

async function doFill() {
  if (!(await app.confirmLive())) return;
  const context = app.siteData.context || '';
  const allSteps = !!app.settings.fillAllSteps;
  app.ai.busy = true;
  app.ai.progress = app.settings.groqKey ? 'Getting values from Groq…' : 'Filling…';
  app.render();
  try {
    if (app.settings.previewBeforeFill && !allSteps) {
      const gen = await send('bg:ai-generate', { tabId: app.tab.id, context });
      if (gen.notice) toast(gen.notice, 'info');
      app.ai.preview = { values: gen.values, source: gen.source };
      return;
    }
    const res = await send('bg:ai-fill', { tabId: app.tab.id, context, allSteps });
    app.ai.result = res;
    if (res.notice) toast(res.notice, res.errorCode && res.errorCode !== 'no_key' ? 'error' : 'info');
    else if (allSteps) toast(res.message || 'Done', 'info');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    app.ai.busy = false;
    app.ai.progress = '';
    app.render();
  }
}

function previewBlock(preview) {
  const scan = app.ai.scan;
  const fields = scan ? selectedFields(scan) : [];
  const values = { ...preview.values };
  const rows = fields.map((f) => h('div', { class: 'row' },
    h('span', { text: f.label || f.name, title: f.label }),
    h('input', {
      class: 'input sm', value: values[f.key] ?? '', placeholder: 'random',
      on: { input: (e) => { values[f.key] = e.target.value; } },
    })));
  const apply = async () => {
    app.ai.preview = null;
    app.ai.busy = true;
    app.ai.progress = 'Filling…';
    app.render();
    try {
      const preset = {};
      for (const [k, v] of Object.entries(values)) if (v !== '' && v != null) preset[k] = v;
      app.ai.result = await send('bg:ai-fill', { tabId: app.tab.id, presetValues: preset });
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      app.ai.busy = false;
      app.render();
    }
  };
  return h('div', { class: 'block' },
    h('div', { class: 'ai-head' }, h('b', { text: 'Check the values' }), h('span', { class: 'small muted', text: 'Empty means random' })),
    h('div', { class: 'preview-list' }, rows),
    h('div', { class: 'btn-row end', style: { marginTop: '10px' } },
      h('button', { class: 'btn', text: 'Cancel', on: { click: () => { app.ai.preview = null; app.render(); } } }),
      h('button', { class: 'btn primary', text: 'Fill these values', on: { click: apply } })));
}

function resultBlock(res) {
  const warnings = (res.results || []).filter((r) => r.warning);
  const text = res.message || `Filled ${res.filled} of ${plural(res.total, 'field')}${res.source === 'random' ? ' with random data' : ''}${res.submitted ? ` and clicked "${res.submitted}"` : ''}.`;
  return h('div', { class: 'block' },
    h('div', {}, text),
    warnings.length ? h('details', { class: 'warnings' },
      h('summary', { text: `${plural(warnings.length, 'field')} got a fallback value` }),
      h('ul', {}, warnings.map((w) => h('li', { text: `${w.label || 'Field'}: ${w.warning}` })))) : null,
    h('div', { class: 'btn-row', style: { marginTop: '8px' } },
      h('button', { class: 'btn', text: 'Undo', on: { click: undo } }),
      h('button', { class: 'btn', text: 'Regenerate', on: { click: () => doFill() } })));
}

async function undo() {
  try {
    const n = await send('bg:ai-undo', { tabId: app.tab.id });
    toast(n ? `Restored ${plural(n, 'field')}` : 'Nothing to undo');
    app.ai.result = null;
    app.render();
  } catch (e) {
    toast(e.message, 'error');
  }
}
