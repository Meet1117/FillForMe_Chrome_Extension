/**
 * Recording step helpers shared by the service worker and the side panel (ES module).
 */

/** Short path for display, e.g. "/orders/new#step-2". */
export function shortUrl(url) {
  try {
    const u = new URL(url);
    return (u.pathname + u.hash) || '/';
  } catch {
    return String(url || '');
  }
}

/** Human readable step, e.g. Type "John Smith" into "Customer Name". */
export function describeStep(step) {
  if (step.action === 'click') return `Click "${step.label}"`;
  if (step.action === 'navigate') return `Page changes to ${shortUrl(step.url)}`;
  const v = step.masked ? '••••••' : (step.field?.valueText || step.value);
  if (step.kind === 'checkbox') return `${step.value === 'true' ? 'Check' : 'Uncheck'} "${step.label}"`;
  if (['select', 'radio', 'custom-select'].includes(step.kind)) return `Choose "${optionText(step, v)}" in "${step.label}"`;
  if (step.kind === 'file') return `Upload a file to "${step.label}"`;
  return `Type "${String(v ?? '').slice(0, 40)}" into "${step.label}"`;
}

/** Visible text for a recorded select value. */
export function optionText(step, value) {
  const opt = (step.field?.options || []).find((o) => String(o.value) === String(value));
  return opt ? opt.text : value;
}

/** Field kinds that hold free text (Counter mode makes sense for these). */
export const TEXT_KINDS = ['text', 'email', 'tel', 'url', 'search', 'textarea', 'contenteditable', 'password'];

/** Kinds included by "Make all text fields Random/AI". */
export const QUICK_KINDS = ['text', 'email', 'tel', 'url', 'search', 'textarea', 'contenteditable', 'number', 'date', 'time', 'datetime-local'];

/* ---------- submit detection ---------- */

/** Button text that moves to the next step of a form (never treated as submit). */
export const NEXT_RE = /^(next|continue|proceed|forward|go to next|next step|save\s*(&|and)\s*(next|continue|proceed))\b|\b(next|continue)\s*[›»>→]*$/i;
/** Button text that submits or saves a form. */
export const SUBMIT_RE = /\b(submit|save|finish|complete|place order|confirm|pay|register|sign up|create|send|book|apply|done|update)\b/i;
const NOT_SUBMIT_RE = /\b(back|previous|prev|cancel|reset|clear|close|draft)\b/i;

/**
 * Is this recorded step the click that submits / saves the form?
 * The user can override the guess in the editor (step.submit = true / false).
 */
export function isSubmitStep(step) {
  if (!step || step.action !== 'click') return false;
  if (typeof step.submit === 'boolean') return step.submit;
  const label = String(step.label || '').trim();
  return SUBMIT_RE.test(label) && !NEXT_RE.test(label) && !NOT_SUBMIT_RE.test(label);
}
