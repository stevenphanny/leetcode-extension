# LeetCode → Notion

Tiny Chrome extension (no build, no dependencies) that logs LeetCode problems to a
Notion database and shows which ones are due for review.

## Install
1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick this folder.
2. Pin the extension. Settings open via the ⚙ in the popup (or right-click icon → Options).

## Setup (once)
1. Create an internal integration at <https://www.notion.so/profile/integrations>, copy its secret.
2. In Notion, open the page that should hold the tracker → `⋯` → **Connections** → add the integration.
3. In the extension settings: paste the token → **Save & connect** → pick the page → **Create**.

The database is created with these columns:

| Column | Filled by |
|---|---|
| Name (linked to problem) | auto |
| URL | auto (used to find existing rows) |
| Difficulty | auto |
| Topics | auto |
| Date Solved | auto (today) |
| Time Spent (min) | auto from timer, editable |
| Progress — Needs review 🔴 / Needs improvement 🟡 / Completed 🟢 | you |
| Review Frequency — Daily / Weekly / Monthly / Once | you (default Weekly) |
| Notes | you |
| Next Review | auto (Date Solved + frequency; blank for Once) |

Optional: add a Notion view filtered by **Next Review is on or before Today**,
sorted ascending, to see due problems inside Notion.

## Use
- Open a problem. The timer counts while the tab is visible and focused.
- Click the icon → choose progress → (optional) notes → **Add to Notion**.
- Logging the same problem again updates its row: date, time, progress, frequency
  overwrite; new notes are added on top with a date stamp, old notes kept.
- **Due** tab lists problems with Next Review ≤ today; click to open.

## AI tab (optional)
In settings (step 3) pick a provider and paste its key:
- **Google Gemini (free tier)**: key from <https://aistudio.google.com/apikey>, no billing.
  Daily rate limits apply, and Google may use free-tier prompts to improve its products.
- **Anthropic Claude Haiku 5.5 (paid)**: key from <https://platform.claude.com/settings/keys>.
- **Analyse** reads the code in the LeetCode editor and reports time/space complexity vs.
  the best known, whether it fits the problem constraints, likely bugs, and a nudge (no full
  solution). *Add complexity to notes* drops the result into the Log tab's notes.
- **Hint** gives the smallest useful hint for your current code; press again for the next
  one, or type what's going wrong. The thread is saved per problem; **Reset** clears it.
- Requests run in the background (`background.js`), so closing the popup mid-request is
  fine: reopen it and the result is there. Unsent hint text is kept too.

## Updating
Edit the files, then hit the ↻ reload icon on the extension in `chrome://extensions`, and
refresh any open LeetCode tabs. Settings and saved data are kept.

## Notes
- The token is stored in `chrome.storage.local` on this machine only.
- Changing Review Frequency directly in Notion does not recompute Next Review;
  re-save through the extension (or edit Next Review by hand).
