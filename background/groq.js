/**
 * Groq API client (OpenAI-compatible). Only the service worker calls this.
 * The API key is read from chrome.storage.local by the caller and is never logged
 * or included in error messages.
 */

const DEFAULT_BASE = 'https://api.groq.com/openai/v1';

/** Preferred default models, best first. Falls back to the first chat model available. */
const PREFERRED_MODELS = ['llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b'];

/** Models that are not general chat models (speech, guards, agents, embeddings…). */
const NON_CHAT = /whisper|tts|playai|orpheus|guard|embed|compound|distil|vision-preview|safeguard/i;

export class GroqError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function request(path, { key, baseUrl, method = 'GET', body, signal }) {
  if (!key) throw new GroqError('no_key', 'No Groq API key yet. Add one in Settings (⚙). Random data was used instead.');
  let res;
  try {
    res = await fetch((baseUrl || DEFAULT_BASE) + path, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw new GroqError('aborted', 'Cancelled.');
    throw new GroqError('network', 'Could not reach Groq. Check your internet connection and try again.');
  }
  if (res.ok) return res.json();

  let data = {};
  try { data = await res.json(); } catch { /* not JSON */ }
  const apiMsg = String(data?.error?.message || '').slice(0, 200);
  const apiCode = String(data?.error?.code || '');
  if (res.status === 401 || res.status === 403) {
    throw new GroqError('invalid_key', 'Groq rejected the API key. Check the key in Settings (⚙).');
  }
  if (res.status === 429) {
    const wait = res.headers.get('retry-after');
    throw new GroqError('rate_limit', `Groq rate limit reached. Please wait ${wait ? `${Math.ceil(+wait)} seconds` : 'a minute'} and try again.`);
  }
  if (res.status === 404 || apiCode === 'model_not_found' || apiCode === 'model_decommissioned') {
    throw new GroqError('model', 'The selected model is not available. Pick another model in Settings (⚙).');
  }
  if (res.status === 400 && /json/i.test(apiCode + apiMsg)) {
    throw new GroqError('bad_json', 'The AI returned data that was not valid JSON.');
  }
  if (res.status >= 500) throw new GroqError('server', 'Groq is having trouble right now. Try again in a moment.');
  throw new GroqError('api', `Groq error (${res.status})${apiMsg ? ': ' + apiMsg : ''}`);
}

/** List chat model ids, sorted with preferred models first. */
export async function listModels({ key, baseUrl }) {
  const data = await request('/models', { key, baseUrl });
  const ids = (data?.data || [])
    .filter((m) => m && m.id && m.active !== false && !NON_CHAT.test(m.id))
    .map((m) => m.id)
    .sort();
  const preferred = PREFERRED_MODELS.filter((id) => ids.includes(id));
  return [...preferred, ...ids.filter((id) => !preferred.includes(id))];
}

/** Pick the model to use: the saved one if available, else a preferred default, else the first. */
export function pickModel(saved, available) {
  if (saved && (!available?.length || available.includes(saved))) return saved;
  if (available?.length) return PREFERRED_MODELS.find((id) => available.includes(id)) || available[0];
  return PREFERRED_MODELS[0];
}

/**
 * Chat completion that must return a JSON object.
 * Throws GroqError('bad_json') if the content can't be parsed.
 */
export async function chatJSON({ key, baseUrl, model, system, user, temperature = 0.4, signal }) {
  const data = await request('/chat/completions', {
    key,
    baseUrl,
    method: 'POST',
    signal,
    body: {
      model: model || PREFERRED_MODELS[0],
      temperature,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    },
  });
  const content = data?.choices?.[0]?.message?.content || '';
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed;
  } catch {
    // Some models wrap JSON in text; try the first {...} block before giving up.
    const m = /\{[\s\S]*\}/.exec(content);
    if (m) {
      try { return JSON.parse(m[0]); } catch { /* fall through */ }
    }
    throw new GroqError('bad_json', 'The AI returned data that was not valid JSON.');
  }
}

export { PREFERRED_MODELS };
