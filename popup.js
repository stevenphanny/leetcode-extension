import { PROGRESS, REVIEW, findByUrl, saveProblem, listDue, today } from './notion.js';
import { analyse, help, aiSettings } from './ai.js';

const $ = (id) => document.getElementById(id);
let problem = null;
let existing = null;
let progress = '';
let dueLoaded = false;
let notionReady = true;
let problemPromise = null;

// ---------- tabs ----------
function show(tab) {
  for (const t of ['log', 'due', 'ai']) {
    $('tab-' + t).classList.toggle('active', tab === t);
    $(t).classList.toggle('hidden', tab !== t || (t !== 'ai' && !notionReady));
  }
  $('setup').classList.toggle('hidden', notionReady || tab === 'ai');
  if (tab === 'due' && notionReady && !dueLoaded) loadDue();
  if (tab === 'ai') loadAI();
}
$('tab-log').onclick = () => show('log');
$('tab-due').onclick = () => show('due');
$('tab-ai').onclick = () => show('ai');
$('open-settings').onclick = $('setup-btn').onclick = () => chrome.runtime.openOptionsPage();

// ---------- form controls ----------
for (const r of REVIEW) $('review').add(new Option(r, r));
$('review').value = 'Weekly';

for (const p of PROGRESS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.v = p;
  b.textContent = p;
  b.onclick = () => setProgress(p);
  $('progress').append(b);
}
function setProgress(p) {
  progress = p;
  for (const b of $('progress').children) b.classList.toggle('on', b.dataset.v === p);
}

// ---------- problem info from the page ----------
async function getProblem(tabId) {
  const ask = () => chrome.tabs.sendMessage(tabId, { type: 'getProblem' });
  try {
    return await ask();
  } catch {
    // Tab was open before the extension loaded: inject and retry.
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return await ask();
  }
}

async function activeProblemTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url && /^https:\/\/leetcode\.com\/problems\/[^/]+/.test(tab.url) ? tab : null;
}

// Problem info, fetched once per popup open and shared by the Log and AI tabs.
function loadProblem() {
  problemPromise ??= (async () => {
    const tab = await activeProblemTab();
    if (!tab) return null;
    const p = await getProblem(tab.id);
    if (!p || p.error) throw new Error(p?.error || 'Could not read problem.');
    return { ...p, tabId: tab.id };
  })();
  return problemPromise;
}

async function loadLog() {
  problem = await loadProblem();
  if (!problem) {
    $('log-msg').textContent = 'Open a LeetCode problem to log it.';
    show('due');
    return;
  }

  const key = 'timer:' + problem.slug;
  const ms = (await chrome.storage.local.get(key))[key] || 0;
  $('minutes').value = Math.round(ms / 60000);

  $('p-title').textContent = problem.number ? `${problem.number}. ${problem.title}` : problem.title;
  $('p-title').href = problem.url;
  $('p-diff').textContent = problem.difficulty || '?';
  $('p-diff').className = problem.difficulty;
  $('p-topics').textContent = problem.topics.join(', ') || 'no topics';

  existing = await findByUrl(problem.url);
  if (existing) {
    $('existing').classList.remove('hidden');
    $('ex-date').textContent = existing.dateSolved || '?';
    $('ex-link').href = existing.notionUrl;
    $('ex-notes').textContent = existing.notes;
    $('ex-notes-wrap').classList.toggle('hidden', !existing.notes);
    if (existing.review) $('review').value = existing.review;
    if (existing.progress) setProgress(existing.progress);
    $('save').textContent = 'Update in Notion';
  }

  $('log-msg').classList.add('hidden');
  $('form').classList.remove('hidden');
  $('note').focus();
}

$('form').onsubmit = async (e) => {
  e.preventDefault();
  if (!progress) {
    $('status').className = 'status error';
    $('status').textContent = 'Pick a progress level.';
    return;
  }
  $('save').disabled = true;
  $('status').className = 'status muted';
  $('status').textContent = 'Saving…';
  try {
    const minutes = parseInt($('minutes').value, 10);
    const row = await saveProblem({
      existing,
      problem,
      progress,
      review: $('review').value,
      minutes: Number.isNaN(minutes) ? null : minutes,
      note: $('note').value,
    });
    await chrome.storage.local.remove('timer:' + problem.slug);
    existing = row;
    $('note').value = '';
    $('existing').classList.remove('hidden');
    $('ex-date').textContent = row.dateSolved;
    $('ex-link').href = row.notionUrl;
    $('ex-notes').textContent = row.notes;
    $('ex-notes-wrap').classList.toggle('hidden', !row.notes);
    $('save').textContent = 'Update in Notion';
    $('status').className = 'status ok';
    $('status').textContent = row.nextReview ? `Saved · review ${row.nextReview}` : 'Saved';
    dueLoaded = false;
  } catch (err) {
    $('status').className = 'status error';
    $('status').textContent = err.message;
  } finally {
    $('save').disabled = false;
  }
};

// ---------- due list ----------
async function loadDue() {
  dueLoaded = true;
  $('due-msg').classList.remove('hidden');
  $('due-msg').className = 'muted';
  $('due-msg').textContent = 'Loading…';
  $('due-list').replaceChildren();
  try {
    const rows = await listDue();
    $('tab-due').textContent = `Due (${rows.length})`;
    if (!rows.length) {
      $('due-msg').textContent = 'Nothing due. 🎉';
      return;
    }
    $('due-msg').classList.add('hidden');
    const t = today();
    for (const r of rows) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = r.url || r.notionUrl;
      a.textContent = r.title;
      a.onclick = (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: a.href });
      };
      const meta = document.createElement('div');
      meta.className = 'meta';
      const diff = document.createElement('span');
      diff.className = r.difficulty;
      diff.textContent = r.difficulty;
      meta.append(
        diff,
        ` · ${r.progress || '—'} · ${r.review} · ${r.nextReview < t ? 'overdue since' : 'due'} ${r.nextReview}`
      );
      li.append(a, meta);
      $('due-list').append(li);
    }
  } catch (err) {
    $('due-msg').className = 'error';
    $('due-msg').textContent = err.message;
  }
}

// ---------- AI tab ----------
// Read the code from LeetCode's Monaco editor. Runs in the page's own JS world
// because the content script can't see window.monaco.
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

let aiLoaded = false;
let chatHistory = [];
const helpKey = () => 'help:' + problem.slug;
const analysisKey = () => 'analysis:' + problem.slug;

function aiMsg(text, cls = 'muted') {
  $('ai-msg').className = cls;
  $('ai-msg').textContent = text;
  $('ai-msg').classList.toggle('hidden', !text);
  $('ai-body').classList.toggle('hidden', !!text);
}

async function loadAI() {
  if (aiLoaded) return;
  aiLoaded = true;
  try {
    if (!(await aiSettings()).key) return aiMsg('Add a Gemini (free) or Anthropic API key in settings (⚙) to use AI features.');
    problem ??= await loadProblem();
    if (!problem) return aiMsg('Open a LeetCode problem to use AI features.');
    aiMsg('');
    const saved = await chrome.storage.local.get([helpKey(), analysisKey()]);
    chatHistory = saved[helpKey()] || [];
    renderChat();
    if (saved[analysisKey()]) renderAnalysis(saved[analysisKey()]);
  } catch (err) {
    aiLoaded = false;
    aiMsg(err.message, 'error');
  }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const badge = (ok, yes = 'optimal', no = 'not optimal') =>
  el('span', 'badge ' + (ok ? 'yes' : 'no'), ok ? yes : no);

function renderAnalysis(a) {
  const box = $('analysis');
  box.replaceChildren();
  box.classList.remove('hidden');

  const grid = el('div', 'verdict');
  grid.append(el('span'), el('span', 'h', 'Yours'), el('span', 'h', 'Best known'));
  grid.append(el('span', null, 'Time'), el('code', null, a.time), el('code', null, a.optimalTime));
  grid.append(el('span'), badge(a.timeOptimal), el('span'));
  grid.append(el('span', null, 'Space'), el('code', null, a.space), el('code', null, a.optimalSpace));
  grid.append(el('span'), badge(a.spaceOptimal), el('span'));
  box.append(grid);

  const c = el('p', 'ai-text');
  c.append(badge(a.meetsConstraints, 'meets constraints', 'fails constraints'), ' ' + a.constraintsNote);
  box.append(c, el('p', 'ai-text', a.summary));

  if (a.correctnessIssues.length) {
    const p = el('div', 'ai-text');
    p.append(el('b', 'error', 'Possible issues'));
    const ul = el('ul');
    for (const i of a.correctnessIssues) ul.append(el('li', null, i));
    p.append(ul);
    box.append(p);
  }
  if (a.improvement) {
    const p = el('p', 'ai-text');
    p.append(el('b', null, 'Nudge: '), a.improvement);
    box.append(p);
  }

  if (notionReady) {
    const add = el('button', null, 'Add complexity to notes');
    add.type = 'button';
    add.style.marginTop = '8px';
    add.onclick = () => {
      const line =
        `Time ${a.time}, Space ${a.space}` +
        (a.timeOptimal && a.spaceOptimal ? ' (optimal)' : ` (best: ${a.optimalTime} / ${a.optimalSpace})`);
      $('note').value = $('note').value ? `${$('note').value}\n${line}` : line;
      add.textContent = 'Added to Log tab notes ✓';
    };
    box.append(add);
  }
}

$('analyse').onclick = async () => {
  $('analyse').disabled = true;
  $('analyse').textContent = 'Analysing…';
  try {
    const { code, lang } = await getEditorCode(problem.tabId);
    const a = await analyse(problem, code, lang);
    await chrome.storage.local.set({ [analysisKey()]: a });
    renderAnalysis(a);
  } catch (err) {
    $('analysis').classList.remove('hidden');
    $('analysis').replaceChildren(el('p', 'error ai-text', err.message));
  } finally {
    $('analyse').disabled = false;
    $('analyse').textContent = 'Analyse';
  }
};

function renderChat() {
  $('chat').replaceChildren(
    ...chatHistory.map((m) => el('div', 'm ' + (m.role === 'user' ? 'user' : 'bot'), m.content))
  );
  $('chat').scrollTop = $('chat').scrollHeight;
  $('help-send').textContent = chatHistory.length ? 'Next hint' : 'Hint';
}

async function sendHelp() {
  if ($('help-send').disabled) return;
  const q = $('help-q').value.trim();
  $('help-send').disabled = true;
  $('help-status').className = 'status muted';
  $('help-status').textContent = 'Thinking…';
  try {
    const { code, lang } = await getEditorCode(problem.tabId);
    const reply = await help(problem, code, lang, chatHistory, q);
    // History keeps only the short text; the current code is attached fresh each turn.
    chatHistory.push({ role: 'user', content: q || 'Give me a hint.' }, { role: 'assistant', content: reply });
    await chrome.storage.local.set({ [helpKey()]: chatHistory });
    $('help-q').value = '';
    $('help-status').textContent = '';
    renderChat();
  } catch (err) {
    $('help-status').className = 'status error';
    $('help-status').textContent = err.message;
  } finally {
    $('help-send').disabled = false;
  }
}
$('help-send').onclick = sendHelp;
$('help-q').onkeydown = (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendHelp();
};
$('help-reset').onclick = async () => {
  chatHistory = [];
  await chrome.storage.local.remove(helpKey());
  renderChat();
};

// ---------- init ----------
(async () => {
  const { token, databaseId } = await chrome.storage.local.get(['token', 'databaseId']);
  if (!token || !databaseId) {
    notionReady = false;
    show('log');
    return;
  }
  // Fetch due count in the background so the tab label shows it.
  listDue()
    .then((rows) => ($('tab-due').textContent = `Due (${rows.length})`))
    .catch(() => {});
  try {
    await loadLog();
  } catch (err) {
    $('log-msg').className = 'error';
    $('log-msg').textContent = err.message;
  }
})();
