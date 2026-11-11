/**
 * Record tab: start recording, live step feed, playback progress, and the list
 * of saved recordings for this site. Recording controls live in the red strip
 * at the top of the panel (sidepanel.js).
 */
import { saveRecording, deleteRecording, saveSettings, uid } from '../shared/store.js';
import { describeStep, isSubmitStep } from '../shared/steps.js';
import { app } from './state.js';
import { h, icon, send, toast, confirmBox, promptText, popMenu, downloadJSON, timeAgo } from './ui.js';

const ACTIVE = ['running', 'paused', 'error'];
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function renderRecordTab() {
  const wrap = h('div', {});
  const s = app.recSession;

  if (s && s.tabId === app.tab.id) wrap.append(liveFeed(s));
  else if (s) wrap.append(h('p', { class: 'muted', text: 'Recording is running in another tab.' }));
  else {
    const busy = app.playback && ACTIVE.includes(app.playback.status);
    wrap.append(h('div', {},
      h('button', { class: `btn big record-big ${busy ? 'disabled' : ''}`, on: { click: startRecording } }, icon('record', 10), 'Start recording'),
      h('p', { class: 'helper', text: 'Fill the form once. You can then replay it as often as you like.' })));
  }

  wrap.append(submitToggle());

  if (app.playback) wrap.append(playbackBlock(app.playback));

  wrap.append(h('div', { class: 'section-title' },
    h('span', { text: 'Recordings' }),
    app.recordings.length ? h('span', { class: 'count', text: String(app.recordings.length) }) : null));

  if (!app.recordings.length) {
    wrap.append(h('p', { class: 'muted', style: { margin: '0' }, text: 'None for this site yet.' }));
  } else {
    const list = h('div', { class: 'stack' });
    for (const rec of app.recordings) list.append(recordingRow(rec));
    wrap.append(list);
  }
  return wrap;
}

/* ---------- recording ---------- */

async function startRecording() {
  try {
    await send('bg:rec-start', { tabId: app.tab.id });
  } catch (e) {
    toast(e.message, 'error');
  }
}

function liveFeed(s) {
  if (!s.steps.length) return h('p', { class: 'muted', style: { margin: 0 }, text: 'Type into fields and click buttons on the page. Each step shows up here.' });
  const start = Math.max(0, s.steps.length - 10);
  return h('ol', { class: 'step-feed', style: { marginTop: 0 } },
    s.steps.slice(start).map((st, i) => h('li', {}, h('b', { text: String(start + i + 1) }), h('span', { text: describeStep(st) }))));
}

/** Shared setting (also shown in AI Fill): click Submit / Save, or leave it to the user. */
export function submitToggle() {
  const on = !!app.settings.autoSubmit;
  return h('label', { class: 'toggle', style: { marginTop: '12px' } },
    h('input', { type: 'checkbox', checked: on, on: { change: async (e) => { app.settings = await saveSettings({ autoSubmit: e.target.checked }); app.render(); } } }),
    h('span', {},
      h('div', { text: 'Submit the form when done' }),
      h('div', { class: 'd', text: on
        ? 'FillForMe clicks the Submit or Save button after filling.'
        : 'FillForMe fills the fields and stops before Submit, so you can check and submit yourself.' })));
}

/* ---------- playback ---------- */

function playbackBlock(st) {
  const rec = app.recordings.find((r) => r.id === st.recordingId);
  const total = rec?.steps.length || 0;
  const control = (action) => send('bg:play-control', { action }).catch((e) => toast(e.message, 'error'));
  const otherTab = st.tabId !== app.tab.id ? ' (other tab)' : '';
  const block = (...kids) => h('div', { class: 'card', style: { marginTop: '14px' } }, ...kids);

  if (st.status === 'done' || st.status === 'stopped') {
    const s = st.stats || {};
    const errors = s.errors || [];
    const warnings = s.warnings || [];
    return block(
      h('div', { class: 'live-head' }, h('span', { class: 'live-title', text: st.heldSubmit ? `Filled: ${st.name}` : `${st.status === 'done' ? 'Finished' : 'Stopped'}: ${st.name}` }),
        h('button', { class: 'btn ghost small', text: 'Dismiss', on: { click: () => control('dismiss') } })),
      st.heldSubmit ? h('p', { style: { margin: '4px 0' }, text: `All fields are filled. Click "${st.heldSubmit}" on the page when you're ready.` }) : null,
      h('div', { class: 'summary' },
        h('b', { text: String(s.completed || 0) }), ` of ${st.totalRuns} ${st.totalRuns === 1 ? 'run' : 'runs'} completed, `,
        h('b', { text: String(s.skipped || 0) }), ' skipped, ',
        h('b', { text: String(errors.length) }), ` ${errors.length === 1 ? 'error' : 'errors'}`),
      errors.length ? h('details', { class: 'warnings' }, h('summary', { text: 'Show errors' }), h('ul', {}, errors.map((e) => h('li', { text: e })))) : null,
      warnings.length ? h('details', { class: 'warnings' }, h('summary', { text: `Show ${plural(warnings.length, 'note')}` }), h('ul', {}, warnings.slice(0, 50).map((e) => h('li', { text: e })))) : null);
  }

  const done = (st.run - 1) * total + st.stepIndex;
  const pct = total ? Math.min(100, Math.round((done / (st.totalRuns * total)) * 100)) : 0;
  const isErr = st.status === 'error';
  return block(
    h('div', { class: 'live-head' },
      h('div', { class: 'live-title' },
        isErr ? 'Stopped at a step' : st.status === 'paused' ? 'Paused' : `Playing ${st.name}`,
        h('div', { class: 'small muted', text: `Run ${st.run} of ${st.totalRuns}, step ${Math.min(st.stepIndex + 1, total)} of ${total}${otherTab}` }))),
    h('div', { class: 'progress' }, h('div', { style: { width: `${pct}%` } })),
    isErr ? h('div', { class: 'err-box' },
      h('b', { text: st.error?.label || 'This step' }), h('br'),
      h('span', { class: 'muted', text: st.error?.message || 'Element not found.' })) : null,
    h('div', { class: 'btn-row' },
      isErr ? [
        h('button', { class: 'btn primary', text: 'Retry', on: { click: () => control('retry') } }),
        h('button', { class: 'btn', text: 'Skip step', on: { click: () => control('skip') } }),
      ] : st.status === 'paused'
        ? h('button', { class: 'btn primary', text: 'Resume', on: { click: () => control('resume') } })
        : h('button', { class: 'btn', text: 'Pause', on: { click: () => control('pause') } }),
      h('button', { class: 'btn danger', text: 'Stop', on: { click: () => control('stop') } })));
}

/* ---------- recordings list ---------- */

function metaLine(rec) {
  const counts = {};
  for (const s of rec.steps) if (s.action === 'fill' && s.mode && s.mode !== 'fixed') counts[s.mode] = (counts[s.mode] || 0) + 1;
  const modes = Object.entries(counts).map(([m, n]) => `${n} ${m === 'ai' ? 'AI' : m}`);
  const when = rec.lastRunAt ? `last run ${timeAgo(rec.lastRunAt)}` : `saved ${timeAgo(rec.createdAt)}`;
  return `${plural(rec.steps.length, 'step')}${modes.length ? ` (${modes.join(', ')})` : ''}, ${when}`;
}

function recordingRow(rec) {
  const busy = (app.playback && ACTIVE.includes(app.playback.status)) || !!app.recSession;
  const singleRun = !app.settings.autoSubmit && rec.steps.some(isSubmitStep);
  const runsInput = h('input', {
    class: 'input sm', type: 'number', min: 1, max: 1000,
    value: singleRun ? 1 : app.runs[rec.id] || 1,
    disabled: singleRun,
    title: singleRun ? 'Turn on "Submit the form when done" to run more than once' : '',
    attrs: { 'aria-label': 'Number of runs' },
    on: { input: (e) => { app.runs[rec.id] = Math.max(1, parseInt(e.target.value, 10) || 1); } },
  });
  return h('div', { class: 'card rec-card' },
    h('div', { class: 'top' },
      h('div', { class: 'name', text: rec.name, title: rec.name }),
      h('button', { class: 'icon-btn', title: 'More', attrs: { 'aria-label': 'More actions' }, on: { click: (e) => menu(e.currentTarget, rec) } }, icon('more', 16))),
    h('div', { class: 'sub', text: metaLine(rec) }),
    h('div', { class: 'btn-row' },
      h('button', { class: `btn primary small ${busy ? 'disabled' : ''}`, text: 'Play', on: { click: () => play(rec) } }),
      h('label', { class: 'runs', title: runsInput.title }, runsInput, 'times'),
      h('span', { style: { flex: 1 } }),
      h('button', { class: 'btn ghost small', text: 'Edit', on: { click: () => app.go('editor', { id: rec.id }) } })));
}

async function play(rec) {
  if (!(await app.confirmLive())) return;
  try {
    await send('bg:play', { tabId: app.tab.id, recordingId: rec.id, runs: app.runs[rec.id] || 1 });
  } catch (e) {
    toast(e.message, 'error');
  }
}

function menu(anchor, rec) {
  popMenu(anchor, [
    { label: 'Rename', icon: 'edit', onClick: async () => {
      const name = await promptText({ title: 'Rename recording', label: 'Name', value: rec.name });
      if (name) await saveRecording({ ...rec, name });
    } },
    { label: 'Duplicate', icon: 'copy', onClick: async () => {
      await saveRecording({ ...structuredClone(rec), id: uid('rec'), name: `${rec.name} (copy)`, createdAt: Date.now(), nextN: 1, lastRunAt: null });
      toast('Duplicated');
    } },
    { label: 'Export', icon: 'download', onClick: () => {
      downloadJSON(`fillforme-${rec.name.replace(/[^\w-]+/g, '-').slice(0, 40)}.json`, { app: 'FillForMe', version: 1, exportedAt: new Date().toISOString(), recordings: [rec] });
    } },
    { label: 'Delete', icon: 'trash', danger: true, onClick: async () => {
      if (await confirmBox({ title: 'Delete this recording?', message: `"${rec.name}" will be removed. This can't be undone.`, okText: 'Delete', danger: true })) {
        await deleteRecording(rec.id);
        toast('Deleted');
      }
    } },
  ]);
}
