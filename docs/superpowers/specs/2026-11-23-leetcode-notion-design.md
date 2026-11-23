# LeetCode → Notion extension — design

## Intent
Log LeetCode problems to a Notion database with minimal typing, and see which
problems are due for review. Lightweight: no server, no build step, no deps.

## Goals
- Auto-fill: name + link, number, difficulty, topics, date solved, time spent (timer).
- User fills: progress, review frequency, notes.
- Re-logging a problem updates its existing row (matched by URL), never duplicates.
- Popup "Due" tab lists problems whose Next Review ≤ today; click opens LeetCode.
- Extension creates the Notion database itself during setup.

## Non-goals
- Badge counts / background polling, notifications.
- leetcode.cn support.
- Sync of edits made directly in Notion back into computed fields.

## Approaches considered (due tracking)
1. Notion formula column + filtered view — zero extension work.
2. Popup Due tab querying Notion — small extra work. **Picked 1 + 2.**
3. Icon badge with periodic background checks — rejected (weight).

Implementation call: "Next Review" is a plain date the extension computes
(Daily +1d, Weekly +7d, Monthly +1mo, Once = blank) instead of a formula.
Reason: formulas can't be validated through the API and blank-for-"Once" is
awkward in formula syntax. Trade-off: editing frequency inside Notion doesn't
recompute the date.

## Design
- Manifest V3. Files: `manifest.json`, `content.js`, `popup.*`, `options.*`, `notion.js`.
- `content.js` on `leetcode.com/problems/*`: tracks active time per problem slug
  (counts only while tab visible + focused, 10s ticks, stored in
  `chrome.storage.local` as `timer:<slug>`); answers `getProblem` via LeetCode
  GraphQL, DOM fallback.
- `notion.js`: Notion REST calls from extension pages (host permission bypasses
  CORS). API version `2022-06-28`.
- Database columns: Name (title, linked), URL, Difficulty, Progress, Topics,
  Time Spent (min), Date Solved, Review Frequency, Next Review, Notes.
- Update behaviour: Progress/frequency/time/date overwrite (time = latest
  attempt); new notes are prepended with a date stamp, old notes kept.
- Timer resets after a successful save.
- Token + database id stored in `chrome.storage.local`.
