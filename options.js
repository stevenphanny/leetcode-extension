import { searchShared, createDatabase } from './notion.js';
import { PROVIDERS, GEMINI_MODELS, aiSettings } from './ai.js';

const $ = (id) => document.getElementById(id);

function status(el, msg, cls = 'muted') {
  $(el).className = 'status ' + cls;
  $(el).textContent = msg;
}

async function refreshCurrent() {
  const { databaseId, databaseTitle } = await chrome.storage.local.get(['databaseId', 'databaseTitle']);
  $('current').textContent = databaseId
    ? `Connected to “${databaseTitle || 'LeetCode Tracker'}”. You're ready — open a LeetCode problem and click the extension.`
    : 'Not set up.';
  $('current').className = databaseId ? 'ok' : 'muted';
}

async function connect(token) {
  status('token-status', 'Connecting…');
  const { pages, databases } = await searchShared(token);
  await chrome.storage.local.set({ token });
  status('token-status', 'Connected.', 'ok');

  $('parent').replaceChildren(...pages.map((p) => new Option(p.title, p.id)));
  $('create').disabled = !pages.length;
  if (!pages.length) status('db-status', 'No pages shared with the integration yet — add it under a page’s Connections, then reconnect.', 'error');
  else status('db-status', '');

  $('existing').replaceChildren(...databases.map((d) => new Option(d.title, d.id)));
  $('existing-wrap').classList.toggle('hidden', !databases.length);
  $('db-card').classList.remove('hidden');
}

$('connect').onclick = async () => {
  const token = $('token').value.trim();
  if (!token) return status('token-status', 'Paste a token first.', 'error');
  try {
    await connect(token);
  } catch (e) {
    status('token-status', e.message, 'error');
  }
};

$('create').onclick = async () => {
  $('create').disabled = true;
  status('db-status', 'Creating database…');
  try {
    const token = $('token').value.trim();
    const id = await createDatabase($('parent').value, token);
    await chrome.storage.local.set({ databaseId: id, databaseTitle: 'LeetCode Tracker' });
    status('db-status', 'Database created.', 'ok');
    refreshCurrent();
  } catch (e) {
    status('db-status', e.message, 'error');
  } finally {
    $('create').disabled = false;
  }
};

$('use').onclick = async () => {
  const sel = $('existing').selectedOptions[0];
  if (!sel) return;
  await chrome.storage.local.set({ databaseId: sel.value, databaseTitle: sel.text });
  status('db-status', 'Using existing database.', 'ok');
  refreshCurrent();
};

// ---------- AI provider ----------
for (const [id, p] of Object.entries(PROVIDERS)) $('ai-provider').add(new Option(p.label, id));
for (const m of GEMINI_MODELS) $('gemini-model').add(new Option(m, m));

async function showProvider() {
  const provider = $('ai-provider').value;
  const keyField = PROVIDERS[provider].keyField;
  $('help-gemini').classList.toggle('hidden', provider !== 'gemini');
  $('help-anthropic').classList.toggle('hidden', provider !== 'anthropic');
  $('gemini-model-wrap').classList.toggle('hidden', provider !== 'gemini');
  $('ai-key-label').textContent = provider === 'gemini' ? 'Gemini API key' : 'Anthropic API key';
  $('ai-key').value = (await chrome.storage.local.get(keyField))[keyField] || '';
  status('ai-status', '');
}
$('ai-provider').onchange = showProvider;

$('ai-save').onclick = async () => {
  const provider = $('ai-provider').value;
  const keyField = PROVIDERS[provider].keyField;
  const key = $('ai-key').value.trim();
  await chrome.storage.local.set({ aiProvider: provider, geminiModel: $('gemini-model').value });
  if (!key) {
    await chrome.storage.local.remove(keyField);
    return status('ai-status', 'Key removed.');
  }
  await chrome.storage.local.set({ [keyField]: key });
  status('ai-status', 'Saved.', 'ok');
};

(async () => {
  const s = await aiSettings();
  $('ai-provider').value = s.provider;
  $('gemini-model').value = s.geminiModel;
  await showProvider();
  const { token } = await chrome.storage.local.get('token');
  if (token) {
    $('token').value = token;
    connect(token).catch((e) => status('token-status', e.message, 'error'));
  }
  refreshCurrent();
})();
