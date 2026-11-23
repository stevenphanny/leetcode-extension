// Notion API helpers shared by popup and options pages.
const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';

export const P = {
  name: 'Name',
  url: 'URL',
  difficulty: 'Difficulty',
  progress: 'Progress',
  topics: 'Topics',
  time: 'Time Spent (min)',
  date: 'Date Solved',
  review: 'Review Frequency',
  next: 'Next Review',
  notes: 'Notes',
};

export const PROGRESS = ['Needs review', 'Needs improvement', 'Completed'];
export const REVIEW = ['Daily', 'Weekly', 'Monthly', 'Once'];

// ---------- dates (local time, YYYY-MM-DD) ----------
const fmt = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const today = (now = new Date()) => fmt(now);

export function nextReview(frequency, from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  if (frequency === 'Daily') d.setDate(d.getDate() + 1);
  else if (frequency === 'Weekly') d.setDate(d.getDate() + 7);
  else if (frequency === 'Monthly') {
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last)); // Jan 31 -> Feb 28/29
  } else return null;
  return fmt(d);
}

// ---------- notes ----------
export function mergeNotes(newNote, oldNotes, date = today()) {
  const note = (newNote || '').trim();
  if (!note) return oldNotes || '';
  const entry = `[${date}] ${note}`;
  return oldNotes ? `${entry}\n\n${oldNotes}` : entry;
}

// Notion caps each rich_text item at 2000 chars and 100 items.
export function toRichText(text) {
  const out = [];
  for (let i = 0; i < text.length && out.length < 100; i += 2000) {
    out.push({ type: 'text', text: { content: text.slice(i, i + 2000) } });
  }
  return out;
}

const plain = (rich = []) => rich.map((r) => r.plain_text).join('');

// ---------- HTTP ----------
async function call(path, { method = 'GET', body, token } = {}) {
  if (!token) token = (await chrome.storage.local.get('token')).token;
  if (!token) throw new Error('No Notion token — open settings.');
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Notion error ${res.status}`);
  return data;
}

async function dbId() {
  const { databaseId } = await chrome.storage.local.get('databaseId');
  if (!databaseId) throw new Error('No database set — open settings.');
  return databaseId;
}

// ---------- setup ----------
const titleOf = (obj) => {
  if (obj.object === 'database') return plain(obj.title) || 'Untitled';
  const t = Object.values(obj.properties || {}).find((p) => p.type === 'title');
  return plain(t?.title) || 'Untitled';
};

export async function searchShared(token) {
  const data = await call('/search', { method: 'POST', token, body: { page_size: 100 } });
  const pages = [];
  const databases = [];
  for (const r of data.results) {
    if (r.archived || r.in_trash) continue;
    if (r.object === 'page') pages.push({ id: r.id, title: titleOf(r) });
    else if (r.object === 'database' && r.properties?.[P.url] && r.properties?.[P.next])
      databases.push({ id: r.id, title: titleOf(r) });
  }
  return { pages, databases };
}

const opts = (names, colors) => names.map((name, i) => ({ name, color: colors[i] }));

export async function createDatabase(parentPageId, token) {
  const db = await call('/databases', {
    method: 'POST',
    token,
    body: {
      parent: { type: 'page_id', page_id: parentPageId },
      title: [{ type: 'text', text: { content: 'LeetCode Tracker' } }],
      properties: {
        [P.name]: { title: {} },
        [P.difficulty]: { select: { options: opts(['Easy', 'Medium', 'Hard'], ['green', 'yellow', 'red']) } },
        [P.progress]: { select: { options: opts(PROGRESS, ['red', 'yellow', 'green']) } },
        [P.topics]: { multi_select: {} },
        [P.time]: { number: { format: 'number' } },
        [P.date]: { date: {} },
        [P.review]: { select: { options: opts(REVIEW, ['red', 'blue', 'purple', 'gray']) } },
        [P.next]: { date: {} },
        [P.notes]: { rich_text: {} },
        [P.url]: { url: {} },
      },
    },
  });
  return db.id;
}

// ---------- rows ----------
function parseRow(page) {
  const p = page.properties;
  return {
    id: page.id,
    notionUrl: page.url,
    title: plain(p[P.name]?.title),
    url: p[P.url]?.url,
    difficulty: p[P.difficulty]?.select?.name || '',
    progress: p[P.progress]?.select?.name || '',
    review: p[P.review]?.select?.name || '',
    dateSolved: p[P.date]?.date?.start || '',
    nextReview: p[P.next]?.date?.start || '',
    minutes: p[P.time]?.number ?? null,
    notes: plain(p[P.notes]?.rich_text),
  };
}

export async function findByUrl(url) {
  const data = await call(`/databases/${await dbId()}/query`, {
    method: 'POST',
    body: { filter: { property: P.url, url: { equals: url } }, page_size: 1 },
  });
  return data.results[0] ? parseRow(data.results[0]) : null;
}

export async function saveProblem({ existing, problem, progress, review, minutes, note }) {
  const date = today();
  const next = nextReview(review);
  const name = problem.number ? `${problem.number}. ${problem.title}` : problem.title;
  const notes = mergeNotes(note, existing?.notes, date);

  const properties = {
    [P.name]: { title: [{ type: 'text', text: { content: name, link: { url: problem.url } } }] },
    [P.url]: { url: problem.url },
    [P.topics]: { multi_select: problem.topics.map((n) => ({ name: n.replace(/,/g, ' ') })) },
    [P.progress]: { select: { name: progress } },
    [P.review]: { select: { name: review } },
    [P.time]: { number: Number.isFinite(minutes) ? minutes : null },
    [P.date]: { date: { start: date } },
    [P.next]: { date: next ? { start: next } : null },
    [P.notes]: { rich_text: toRichText(notes) },
  };
  if (problem.difficulty) properties[P.difficulty] = { select: { name: problem.difficulty } };

  const page = existing
    ? await call(`/pages/${existing.id}`, { method: 'PATCH', body: { properties } })
    : await call('/pages', { method: 'POST', body: { parent: { database_id: await dbId() }, properties } });
  return parseRow(page);
}

export async function listDue() {
  const data = await call(`/databases/${await dbId()}/query`, {
    method: 'POST',
    body: {
      filter: { property: P.next, date: { on_or_before: today() } },
      sorts: [{ property: P.next, direction: 'ascending' }],
      page_size: 100,
    },
  });
  return data.results.map(parseRow);
}
