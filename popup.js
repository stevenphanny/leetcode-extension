import { PROGRESS, REVIEW, findByUrl, saveProblem, listDue, today } from './notion.js';

const $ = (id) => document.getElementById(id);
let problem = null;
let existing = null;
let progress = '';
let dueLoaded = false;

// ---------- tabs ----------
function show(tab) {
  $('tab-log').classList.toggle('active', tab === 'log');
  $('tab-due').classList.toggle('active', tab === 'due');
  $('log').classList.toggle('hidden', tab !== 'log');
  $('due').classList.toggle('hidden', tab !== 'due');
  if (tab === 'due' && !dueLoaded) loadDue();
}
$('tab-log').onclick = () => show('log');
$('tab-due').onclick = () => show('due');
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

async function loadLog() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https:\/\/leetcode\.com\/problems\/[^/]+/.test(tab.url)) {
    $('log-msg').textContent = 'Open a LeetCode problem to log it.';
    show('due');
    return;
  }

  problem = await getProblem(tab.id);
  if (!problem || problem.error) throw new Error(problem?.error || 'Could not read problem.');

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

// ---------- init ----------
(async () => {
  const { token, databaseId } = await chrome.storage.local.get(['token', 'databaseId']);
  if (!token || !databaseId) {
    for (const id of ['log', 'due']) $(id).classList.add('hidden');
    $('setup').classList.remove('hidden');
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
