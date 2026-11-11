/**
 * Recording editor: readable step list with value modes (Fixed / Random / Counter / AI),
 * value editing, extra wait, delete and drag-to-reorder. Changes save automatically.
 */
import '../shared/templates.js';
import { saveRecording } from '../shared/store.js';
import { describeStep, shortUrl, TEXT_KINDS, QUICK_KINDS, optionText, isSubmitStep } from '../shared/steps.js';
import { app } from './state.js';
import { h, icon, toast, debounce } from './ui.js';

const { Templates } = globalThis.FPShared;
let rec = null;       // working copy
let savedEl = null;   // "Saved" indicator
let listEl = null;
let openedToken = null;

const persist = debounce(async () => {
  await saveRecording(rec);
  if (savedEl) {
    savedEl.textContent = 'Saved';
    setTimeout(() => { if (savedEl) savedEl.textContent = ''; }, 1500);
  }
}, 350);

function changed() {
  if (savedEl) savedEl.textContent = 'Saving…';
  persist();
}

export function renderEditor() {
  const source = app.recordings.find((r) => r.id === app.editorId);
  if (!source) {
    setTimeout(() => app.go('record'));
    return h('div');
  }
  if (!rec || rec.id !== source.id || openedToken !== app.editorToken) {
    rec = structuredClone(source);
    openedToken = app.editorToken;
  }
  rec.playOptions = rec.playOptions || { speed: 'normal', noReload: false };

  savedEl = h('span', { class: 'saved' });
  const nameInput = h('input', {
    class: 'input', value: rec.name, attrs: { 'aria-label': 'Recording name' },
    on: { input: (e) => { rec.name = e.target.value || 'Untitled'; changed(); } },
  });

  listEl = h('ul', { class: 'steps' });
  renderSteps();

  const hasAI = rec.steps.some((s) => s.mode === 'ai');
  return h('div', {},
    h('div', { class: 'ed-head' },
      h('button', { class: 'icon-btn', title: 'Back', attrs: { 'aria-label': 'Back' }, on: { click: back } }, icon('back', 18)),
      nameInput, savedEl),

    h('div', { class: 'ed-options' },
      h('div', {},
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn small', text: 'Set text fields to Random', on: { click: () => setAll('random') } }),
          h('button', { class: 'btn small', text: 'Set text fields to AI', on: { click: () => setAll('ai') } })),
        h('p', { class: 'helper', text: 'Random and AI give each run new data. Dropdowns, radios and checkboxes keep their recorded value unless you change them below.' })),
      h('div', { class: 'btn-row' },
        h('span', { text: 'Speed' }),
        segmented(['fast', 'normal', 'slow'], rec.playOptions.speed, (v) => { rec.playOptions.speed = v; changed(); })),
      h('label', { class: 'toggle' },
        h('input', { type: 'checkbox', checked: !!rec.playOptions.noReload, on: { change: (e) => { rec.playOptions.noReload = e.target.checked; changed(); } } }),
        h('span', {}, h('div', { text: "Don't reload between runs" }),
          h('div', { class: 'd', text: `Each run normally starts again at ${shortUrl(rec.startUrl)}. Turn this on if your app shows an empty form after you submit.` }))),
      h('label', { class: 'field' },
        h('span', { class: 'label', text: hasAI ? 'Describe the data for AI steps' : 'Describe the data for AI steps (optional)' }),
        h('textarea', {
          class: 'input', rows: 2, value: rec.aiContext || '',
          placeholder: 'Water testing lab, customer is a hotel in Mumbai',
          on: { input: (e) => { rec.aiContext = e.target.value; changed(); } },
        }))),

    h('div', { class: 'section-title' }, h('span', { text: 'Steps' }), h('span', { class: 'count', text: `${rec.steps.length}, drag to reorder` })),
    listEl,
    h('p', { class: 'helper', text: 'In Counter values, {{n}} is the run number, {{date}} is today, {{time}} is the time as HHmmss, and {{random:4}} is four random digits.' }));
}

function back() {
  rec = null;
  app.go('record');
}

function segmented(values, current, onChange) {
  const wrap = h('div', { class: 'seg', attrs: { role: 'radiogroup' } });
  for (const v of values) {
    const b = h('button', {
      class: v === current ? 'on' : '', text: v[0].toUpperCase() + v.slice(1),
      attrs: { role: 'radio', 'aria-checked': String(v === current) },
      on: { click: () => { wrap.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); onChange(v); } },
    });
    wrap.append(b);
  }
  return wrap;
}

function setAll(mode) {
  let n = 0;
  for (const s of rec.steps) {
    if (s.action === 'fill' && QUICK_KINDS.includes(s.kind) && !s.masked) { s.mode = mode; n++; }
  }
  changed();
  renderSteps();
  toast(n ? `${n} field${n === 1 ? '' : 's'} set to ${mode === 'ai' ? 'AI' : 'Random'}` : 'No text fields to change');
}

/* ---------- step list ---------- */

function renderSteps() {
  listEl.textContent = '';
  rec.steps.forEach((step, i) => listEl.append(stepRow(step, i)));
  if (!rec.steps.length) listEl.append(h('div', { class: 'empty' }, h('p', { text: 'All steps were deleted. Record again to add steps.' })));
}

function modeOptions(step) {
  const opts = [['fixed', 'Fixed'], ['random', 'Random']];
  if (TEXT_KINDS.includes(step.kind) && !step.masked) opts.push(['counter', 'Counter']);
  opts.push(['ai', 'AI']);
  return opts;
}

function stepRow(step, i) {
  const row = h('li', { class: `step ${step.action === 'navigate' ? 'nav' : ''} ${step.unsupported ? 'unsupported' : ''}`, dataset: { index: String(i) } });
  const grip = h('span', { class: 'grip', title: 'Drag to reorder' }, icon('grip', 14));
  const del = h('button', { class: 'icon-btn', title: 'Delete step', attrs: { 'aria-label': 'Delete step' }, on: { click: () => { rec.steps.splice(i, 1); changed(); renderSteps(); } } }, icon('x', 14));

  const desc = h('div', { class: 'desc' }, descNode(step));
  const body = h('div', { class: 'body' }, h('div', { class: 'line1' }, h('span', { class: 'num', text: String(i + 1) }), desc, del));

  const wait = h('label', { class: 'wait', title: 'Extra wait after this step' }, 'Then wait',
    h('input', { class: 'input sm', type: 'number', min: 0, step: 100, value: step.waitAfter || 0, on: { input: (e) => { step.waitAfter = Math.max(0, parseInt(e.target.value, 10) || 0); changed(); } } }), 'ms');

  if (step.unsupported) {
    body.append(h('div', { class: 'note', text: `${step.unsupported}. This step is skipped.` }));
  } else if (step.action === 'fill') {
    body.append(h('div', { class: 'line2' }, modeSelect(step, desc), valueEditor(step), wait));
    if (step.mode === 'counter') {
      body.append(h('div', { class: 'note', text: `Next run: ${Templates.expand(step.template || Templates.suggest(step.value), { n: rec.nextN || 1 })}` }));
    }
  } else if (step.action === 'click') {
    const isSubmit = isSubmitStep(step);
    body.append(h('div', { class: 'line2' },
      h('label', { class: 'submit-flag' },
        h('input', { type: 'checkbox', checked: isSubmit, on: { change: (e) => { step.submit = e.target.checked; changed(); renderSteps(); } } }),
        'This is the submit button'),
      wait));
    if (isSubmit && !app.settings.autoSubmit) {
      body.append(h('div', { class: 'note', text: 'Playback stops before this click, because "Submit the form when done" is off.' }));
    }
  } else {
    body.append(h('div', { class: 'line2' }, wait));
  }

  row.append(grip, body);
  enableDrag(row, grip, i);
  return row;
}

function descNode(step) {
  if (step.action !== 'fill') return describeStep(step);
  const verb = step.kind === 'checkbox' ? '' : ['select', 'radio', 'custom-select'].includes(step.kind) ? 'Choose in ' : 'Type into ';
  return [verb, h('span', { class: 'lbl', text: `"${step.label}"` })];
}

function modeSelect(step, descEl) {
  const sel = h('select', {
    class: `input sm ${step.mode === 'ai' ? 'mode-ai' : ''}`, attrs: { 'aria-label': 'Value mode' },
    on: { change: (e) => {
      step.mode = e.target.value;
      if (step.mode === 'counter' && !step.template) step.template = Templates.suggest(step.value);
      changed();
      renderSteps();
    } },
  }, modeOptions(step).map(([v, label]) => h('option', { value: v, text: label, selected: (step.mode || 'fixed') === v })));
  return sel;
}

function valueEditor(step) {
  const mode = step.mode || 'fixed';
  if (mode === 'random') return h('input', { class: 'input sm val', disabled: true, placeholder: 'New random value each run' });
  if (mode === 'ai') return h('input', { class: 'input sm val', disabled: true, placeholder: 'AI writes a fresh value each run' });
  if (mode === 'counter') {
    return h('input', { class: 'input sm val', value: step.template || '', placeholder: 'e.g. Sample-{{n}}', on: { input: (e) => { step.template = e.target.value; changed(); } } });
  }
  // Fixed
  if (step.kind === 'checkbox') {
    return h('select', { class: 'input sm val', on: { change: (e) => { step.value = e.target.value; changed(); } } },
      h('option', { value: 'true', text: 'Checked', selected: step.value === 'true' }),
      h('option', { value: 'false', text: 'Unchecked', selected: step.value !== 'true' }));
  }
  const options = (step.field?.options || []).filter((o) => o.value !== '' || o.text);
  if ((step.kind === 'select' || step.kind === 'radio') && options.length) {
    const hasCurrent = options.some((o) => String(o.value) === String(step.value));
    return h('select', { class: 'input sm val', on: { change: (e) => { step.value = e.target.value; changed(); } } },
      hasCurrent ? null : h('option', { value: step.value, text: optionText(step, step.value) || '(empty)', selected: true }),
      options.map((o) => h('option', { value: o.value, text: o.text || o.value, selected: String(o.value) === String(step.value) })));
  }
  const input = h('input', {
    class: 'input sm val', value: step.value ?? '', type: step.masked ? 'password' : 'text',
    on: { input: (e) => { step.value = e.target.value; changed(); } },
  });
  if (!step.masked) return input;
  const eye = h('button', { class: 'icon-btn', style: { width: '26px', height: '26px' }, title: 'Show / hide', on: { click: () => { input.type = input.type === 'password' ? 'text' : 'password'; } } }, icon('eye', 14));
  return h('span', { class: 'input-group val' }, input, eye);
}

/* ---------- drag to reorder ---------- */

let dragIndex = null;
function enableDrag(row, grip, i) {
  grip.addEventListener('mousedown', () => { row.draggable = true; });
  row.addEventListener('dragstart', (e) => {
    dragIndex = i;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(i));
  });
  row.addEventListener('dragend', () => {
    row.draggable = false;
    row.classList.remove('dragging');
    listEl.querySelectorAll('.step').forEach((r) => r.classList.remove('drop-before', 'drop-after'));
  });
  row.addEventListener('dragover', (e) => {
    if (dragIndex === null) return;
    e.preventDefault();
    const r = row.getBoundingClientRect();
    const before = e.clientY < r.top + r.height / 2;
    row.classList.toggle('drop-before', before);
    row.classList.toggle('drop-after', !before);
  });
  row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    if (dragIndex === null) return;
    const r = row.getBoundingClientRect();
    let to = e.clientY < r.top + r.height / 2 ? i : i + 1;
    const [moved] = rec.steps.splice(dragIndex, 1);
    if (dragIndex < to) to--;
    rec.steps.splice(to, 0, moved);
    dragIndex = null;
    changed();
    renderSteps();
  });
}
