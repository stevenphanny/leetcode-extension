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
  $('p-diff').className = 'pill ' + (problem.difficulty || '');
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
      a.onclick = (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: a.href });
      };
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = r.title;
      const meta = document.createElement('div');
      meta.className = 'meta';
      const diff = document.createElement('span');
      diff.className = 'pill ' + r.difficulty;
      diff.textContent = r.difficulty;
      const prog = document.createElement('span');
      prog.textContent = r.progress || 'No progress set';
      const when = document.createElement('span');
      const late = r.nextReview < t;
      when.className = 'when' + (late ? ' late' : '');
      when.textContent = late ? `Overdue since ${r.nextReview}` : 'Due today';
      meta.append(diff, prog, when);
      a.append(name, meta);
      li.append(a);
      $('due-list').append(li);
    }
  } catch (err) {
    $('due-msg').className = 'error';
    $('due-msg').textContent = err.message;
  }
}

// ---------- AI tab ----------
// Requests run in background.js, so they finish even if the popup closes. This
// side only sends jobs and renders whatever is in storage (see background.js).
let aiLoaded = false;
const K = {
  analysis: () => 'analysis:' + problem.slug,
  help: () => 'help:' + problem.slug,
  job: (kind) => `job:${kind}:${problem.slug}`,
  draft: () => 'draft:' + problem.slug,
};
const STALE_MS = 180000; // a "running" job older than this was lost (worker restarted)

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
    const s = await chrome.storage.local.get([K.analysis(), K.help(), K.job('analyse'), K.job('help'), K.draft()]);
    $('help-q').value = s[K.draft()] || '';
    if (s[K.analysis()]) renderAnalysis(s[K.analysis()]);
    renderChat(s[K.help()] || []);
    renderJob('analyse', s[K.job('analyse')]);
    renderJob('help', s[K.job('help')]);
    chrome.storage.onChanged.addListener(onStorage);
  } catch (err) {
    aiLoaded = false;
    aiMsg(err.message, 'error');
  }
}

function onStorage(changes, area) {
  if (area !== 'local' || !problem) return;
  if (K.analysis() in changes) renderAnalysis(changes[K.analysis()].newValue);
  if (K.help() in changes) renderChat(changes[K.help()].newValue || []);
  for (const kind of ['analyse', 'help']) {
    if (K.job(kind) in changes) renderJob(kind, changes[K.job(kind)].newValue);
  }
}

// Show a job's state: running (with a live timer), error, or idle.
const timers = {};
function renderJob(kind, job) {
  const btn = kind === 'analyse' ? $('analyse') : $('help-send');
  const stat = kind === 'analyse' ? $('analyse-status') : $('help-status');
  clearInterval(timers[kind]);
  const running = job?.status === 'running' && Date.now() - job.startedAt < STALE_MS;
  btn.disabled = running;
  if (running) {
    const label = kind === 'analyse' ? 'Analysing' : 'Thinking';
    const usual = kind === 'analyse' ? '15–20s' : '5–15s';
    const tick = () => {
      stat.className = 'status muted running';
      stat.textContent = `${label}… ${Math.round((Date.now() - job.startedAt) / 1000)}s of usually ${usual}. Safe to close.`;
    };
    tick();
    timers[kind] = setInterval(tick, 1000);
  } else if (job?.status === 'error' || job?.status === 'running') {
    stat.className = 'status error';
    stat.textContent = job.status === 'error' ? job.error : 'Request was interrupted. Try again.';
    if (kind === 'help' && job.question && !$('help-q').value) $('help-q').value = job.question;
  } else {
    stat.className = 'status muted';
    stat.textContent = kind === 'analyse' ? 'Complexity and constraints, about 15–20s.' : '';
  }
}

function startJob(kind, question) {
  chrome.runtime.sendMessage({ type: 'aiRun', kind, tabId: problem.tabId, problem, question });
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function renderAnalysis(a) {
  const box = $('analysis');
  box.replaceChildren();
  box.classList.toggle('hidden', !a);
  if (!a) return;

  // Yours vs best known, for time and space.
  const cx = el('div', 'cx');
  for (const [k, yours, best, ok] of [
    ['Time', a.time, a.optimalTime, a.timeOptimal],
    ['Space', a.space, a.optimalSpace, a.spaceOptimal],
  ]) {
    const row = el('div', 'cx-row');
    const right = el('span', 'best');
    if (ok) right.textContent = 'Optimal';
    else right.append('Best ', el('code', null, best));
    row.append(el('span', 'k', k), el('span', 'v ' + (ok ? 'good' : 'meh'), yours), right);
    cx.append(row);
  }
  box.append(cx);

  const fact = el('p', 'fact');
  fact.append(
    el('span', 'dot' + (a.meetsConstraints ? '' : ' bad')),
    el('span', null, (a.meetsConstraints ? 'Fits the constraints. ' : 'Breaks the constraints. ') + a.constraintsNote)
  );
  box.append(fact, el('p', 'ai-text', a.summary));

  if (a.correctnessIssues.length) {
    const p = el('div', 'ai-text');
    p.append(el('b', 'error', 'Possible bugs'));
    const ul = el('ul');
    for (const i of a.correctnessIssues) ul.append(el('li', null, i));
    p.append(ul);
    box.append(p);
  }
  if (a.improvement) {
    const p = el('p', 'nudge');
    p.append(el('b', null, 'Try this: '), a.improvement);
    box.append(p);
  }

  if (notionReady) {
    const add = el('button', 'ghost', 'Add complexity to notes');
    add.type = 'button';
    add.style.margin = '10px 0 0 -10px';
    add.onclick = () => {
      const line =
        `Time ${a.time}, Space ${a.space}` +
        (a.timeOptimal && a.spaceOptimal ? ' (optimal)' : ` (best: ${a.optimalTime} / ${a.optimalSpace})`);
      $('note').value = $('note').value ? `${$('note').value}\n${line}` : line;
      add.textContent = 'Added to your Log notes';
    };
    box.append(add);
  }
}

$('analyse').onclick = () => startJob('analyse');

function renderChat(history) {
  $('chat').replaceChildren(
    ...history.map((m) => el('div', 'm ' + (m.role === 'user' ? 'user' : 'bot'), m.content))
  );
  $('chat').scrollTop = $('chat').scrollHeight;
  $('help-send').textContent = history.length ? 'Next hint' : 'Get a hint';
}

function sendHelp() {
  if ($('help-send').disabled) return;
  startJob('help', $('help-q').value.trim());
  $('help-q').value = '';
  chrome.storage.local.remove(K.draft());
}
$('help-send').onclick = sendHelp;
$('help-q').onkeydown = (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendHelp();
};
$('help-q').oninput = () => chrome.storage.local.set({ [K.draft()]: $('help-q').value });
$('help-reset').onclick = () => chrome.storage.local.remove([K.help(), K.job('help')]);

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
