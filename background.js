// Service worker: runs AI requests so they finish (and get saved) even if the popup closes.
// State lives in chrome.storage.local; the popup renders from it and listens for changes.
//   job:<kind>:<slug>  {status:'running'|'error', startedAt, error?, question?}
//   analysis:<slug>    last analysis result
//   help:<slug>        hint thread [{role, content}]
import { analyse, help } from './ai.js';

const jobKey = (kind, slug) => `job:${kind}:${slug}`;

// Read the code from LeetCode's Monaco editor, in the page's own JS world
// (content scripts can't see window.monaco).
async function getEditorCode(tabId) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const ed = window.monaco?.editor;
      if (!ed) return null;
      const models = (ed.getEditors?.() || []).map((e) => e.getModel()).filter(Boolean);
      const pool = models.length ? models : ed.getModels();
      const code = pool
        .filter((m) => m.getLanguageId() !== 'plaintext')
        .sort((a, b) => b.getValueLength() - a.getValueLength())[0];
      return code ? { code: code.getValue(), lang: code.getLanguageId() } : null;
    },
  });
  if (!result?.code?.trim()) throw new Error("Couldn't read the code editor. Reload the LeetCode tab and try again.");
  return result;
}

// Chrome stops an idle service worker after ~30s; calling an extension API
// resets that timer, so ping one while any request is in flight.
let running = 0;
let keepAlive = null;
function hold() {
  if (running++ === 0) keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
}
function release() {
  if (--running === 0) clearInterval(keepAlive);
}

async function run({ kind, tabId, problem, question }) {
  const key = jobKey(kind, problem.slug);
  const cur = (await chrome.storage.local.get(key))[key];
  if (cur?.status === 'running' && Date.now() - cur.startedAt < 180000) return; // already going
  await chrome.storage.local.set({ [key]: { status: 'running', startedAt: Date.now(), question } });
  hold();
  try {
    const { code, lang } = await getEditorCode(tabId);
    if (kind === 'analyse') {
      const a = await analyse(problem, code, lang);
      await chrome.storage.local.set({ ['analysis:' + problem.slug]: a });
    } else {
      const hk = 'help:' + problem.slug;
      const history = (await chrome.storage.local.get(hk))[hk] || [];
      const reply = await help(problem, code, lang, history, question);
      // History keeps only the short text; the current code is attached fresh each turn.
      history.push({ role: 'user', content: question || 'Give me a hint.' }, { role: 'assistant', content: reply });
      await chrome.storage.local.set({ [hk]: history });
    }
    await chrome.storage.local.remove(key);
  } catch (err) {
    await chrome.storage.local.set({ [key]: { status: 'error', error: err.message, question } });
  } finally {
    release();
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'aiRun') run(msg);
});
