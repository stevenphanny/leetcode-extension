// AI helpers for the AI tab: Google Gemini (free tier) or Anthropic Claude (paid).
// Plain fetch: the extension has no build step.

export const PROVIDERS = {
  gemini: { label: 'Google Gemini (free tier)', keyField: 'geminiKey' },
  anthropic: { label: 'Anthropic Claude Haiku (paid)', keyField: 'anthropicKey' },
};
export const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];
// Free-tier models to fall back to when the chosen one is busy, best first.
const GEMINI_FALLBACKS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];

// Settings for the chosen provider; key is undefined if not set.
export async function aiSettings() {
  const s = await chrome.storage.local.get(['aiProvider', 'geminiModel', 'geminiKey', 'anthropicKey']);
  const provider = s.aiProvider || 'gemini';
  return { provider, key: s[PROVIDERS[provider].keyField], geminiModel: s.geminiModel || GEMINI_MODELS[0] };
}

// messages: [{role:'user'|'assistant', content:string}]. Returns parsed JSON if schema, else text.
async function callModel(opts) {
  const s = await aiSettings();
  if (!s.key) throw new Error(`No ${PROVIDERS[s.provider].label} API key — add one in settings.`);
  return s.provider === 'gemini' ? callGemini(s, opts) : callClaude(s.key, opts);
}

// ---------- Gemini (generateContent) ----------
async function callGemini({ key, geminiModel }, { system, messages, schema, maxTokens = 8000 }) {
  const generationConfig = { maxOutputTokens: maxTokens };
  if (schema) {
    // JSON mode; the schema itself goes in the prompt and the result is checked below.
    generationConfig.responseMimeType = 'application/json';
    system += `\n\nRespond with only a JSON object matching this JSON Schema:\n${JSON.stringify(schema)}`;
  }
  // Low thinking = much faster; these tasks don't need deep reasoning. If a model
  // rejects the field, remember that and send without it.
  const { geminiNoThinkingCfg } = await chrome.storage.local.get('geminiNoThinkingCfg');
  if (!geminiNoThinkingCfg) generationConfig.thinkingConfig = { thinkingLevel: 'LOW' };
  const body = () =>
    JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig,
    });

  // Free-tier models are often overloaded (503) or rate limited (429, per model):
  // go straight to the next free model instead of waiting.
  const attempts = [geminiModel, ...GEMINI_FALLBACKS.filter((m) => m !== geminiModel)];
  let res, data;
  for (let i = 0; i < attempts.length; i++) {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${attempts[i]}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: body(),
    });
    data = await res.json().catch(() => ({}));
    if (res.status === 400 && generationConfig.thinkingConfig && /thinking/i.test(data.error?.message || '')) {
      delete generationConfig.thinkingConfig;
      await chrome.storage.local.set({ geminiNoThinkingCfg: true });
      i--; // same model again, without the field
      continue;
    }
    if (![429, 500, 503, 504].includes(res.status)) break;
  }
  if (res.status === 429) throw new Error('Gemini free-tier limits hit on every model — try again later.');
  if (res.status >= 500) throw new Error('Gemini is overloaded on every free model right now — try again in a few minutes.');
  if (!res.ok) throw new Error(data.error?.message || `Gemini API error ${res.status}`);
  if (data.promptFeedback?.blockReason) throw new Error(`Gemini blocked the request (${data.promptFeedback.blockReason}).`);
  const cand = data.candidates?.[0];
  if (cand?.finishReason === 'MAX_TOKENS') throw new Error('Response was cut off — try again.');
  const text = (cand?.content?.parts || []).filter((p) => !p.thought && p.text).map((p) => p.text).join('');
  if (!text) throw new Error(`Gemini returned no text (${cand?.finishReason || 'unknown reason'}).`);
  return schema ? parseJSON(text, schema) : text;
}

// Parse model JSON and fill any missing fields so rendering never crashes.
function parseJSON(text, schema) {
  const obj = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  for (const [k, def] of Object.entries(schema.properties)) {
    if (obj[k] !== undefined) continue;
    obj[k] = def.type === 'array' ? [] : def.type === 'boolean' ? false : '?';
  }
  return obj;
}

// ---------- Claude ----------
async function callClaude(anthropicKey, { system, messages, schema, maxTokens = 8000 }) {
  const body = {
    model: 'claude-haiku-5-5', // cheapest Claude model: $0.10 / $0.50 per MTok
    max_tokens: maxTokens,
    output_config: { effort: 'low' },
    system,
    messages,
  };
  if (schema) body.output_config.format = { type: 'json_schema', schema };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2026-10-21',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Claude API error ${res.status}`);
  if (data.stop_reason === 'refusal') throw new Error('The model declined this request.');
  if (data.stop_reason === 'max_tokens') throw new Error('Response was cut off — try again.');
  const text = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return schema ? JSON.parse(text) : text;
}

const problemBlock = (p, code, lang) =>
  `<problem>\n${p.number}. ${p.title} (${p.difficulty})\n\n${p.description || '(description unavailable)'}\n</problem>\n\n` +
  `<code language="${lang}">\n${code}\n</code>`;

// ---------- analyse ----------
const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'time', 'space', 'optimalTime', 'optimalSpace', 'timeOptimal', 'spaceOptimal',
    'meetsConstraints', 'constraintsNote', 'correctnessIssues', 'summary', 'improvement',
  ],
  properties: {
    time: { type: 'string', description: 'Big-O time of the submitted code, e.g. O(n log n)' },
    space: { type: 'string', description: 'Big-O extra space of the submitted code' },
    optimalTime: { type: 'string', description: 'Best known time complexity for this problem' },
    optimalSpace: { type: 'string', description: 'Best known space complexity for this problem' },
    timeOptimal: { type: 'boolean' },
    spaceOptimal: { type: 'boolean' },
    meetsConstraints: {
      type: 'boolean',
      description: 'Whether the code would pass within the input-size constraints and any stated time/space requirements (e.g. "O(1) extra space", "O(log n)")',
    },
    constraintsNote: { type: 'string', description: 'One or two sentences: which constraints matter and why it passes/fails them' },
    correctnessIssues: { type: 'array', items: { type: 'string' }, description: 'Bugs or missed edge cases; empty if none' },
    summary: { type: 'string', description: 'Two-sentence verdict' },
    improvement: {
      type: 'string',
      description: 'If not optimal: a nudge toward the better approach (name the technique/idea), without writing the solution code. Empty if already optimal.',
    },
  },
};

export function analyse(problem, code, lang) {
  return callModel({
    system:
      'You review LeetCode solutions. Determine the time and space complexity of the code exactly as written, ' +
      'compare against the best known complexity for the problem, and check it against the problem constraints ' +
      '(input sizes and any explicit follow-up requirements like O(1) space). Be precise and concise. ' +
      'Never write out a full solution.',
    messages: [{ role: 'user', content: problemBlock(problem, code, lang) }],
    schema: ANALYSIS_SCHEMA,
  });
}

// ---------- help (multi-turn, hints only) ----------
const HELP_SYSTEM = `You are a patient coding tutor helping a student who is stuck on a LeetCode problem.
Rules:
- Never give the full solution or write complete working code. At most show a single line or a tiny snippet to illustrate a syntax fix.
- Give the smallest useful hint first. Escalate only if the student asks for more or is still stuck after earlier hints.
- If their code has small bugs (off-by-one, wrong condition, typo, missed edge case, wrong return), point to where to look (line or variable) and ask a guiding question rather than fixing it for them.
- If their overall approach is wrong or too slow, say so and nudge toward the right idea with a question or the name of a technique.
- Keep replies short: 2–5 sentences, plain text, no headings.`;

// history: [{role:'user'|'assistant', content:string}] of earlier turns (without code context).
export function help(problem, code, lang, history, question) {
  const latest =
    problemBlock(problem, code, lang) +
    `\n\n${question?.trim() || "I'm stuck. Give me a hint about what to look at next."}`;
  return callModel({
    system: HELP_SYSTEM,
    messages: [...history, { role: 'user', content: latest }],
    maxTokens: 4000,
  });
}
