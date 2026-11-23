// Runs on leetcode.com/problems/*. Tracks active solve time and reports problem info.
(() => {
  if (window.__lcNotionLoaded) return;
  window.__lcNotionLoaded = true;

  const TICK_MS = 10000;

  const slugOf = () => (location.pathname.match(/^\/problems\/([^/]+)/) || [])[1] || null;

  // Count time only while this tab is visible and focused. LeetCode is an SPA,
  // so the slug is re-read every tick.
  const timer = setInterval(async () => {
    if (!chrome.runtime?.id) return clearInterval(timer); // extension reloaded
    const slug = slugOf();
    if (!slug || document.visibilityState !== 'visible' || !document.hasFocus()) return;
    const key = 'timer:' + slug;
    try {
      const cur = (await chrome.storage.local.get(key))[key] || 0;
      await chrome.storage.local.set({ [key]: cur + TICK_MS });
    } catch {
      clearInterval(timer);
    }
  }, TICK_MS);

  function csrfToken() {
    const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return m ? m[1] : '';
  }

  async function fromGraphQL(slug) {
    const res = await fetch('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrftoken': csrfToken() },
      body: JSON.stringify({
        query: `query q($titleSlug: String!) {
          question(titleSlug: $titleSlug) { questionFrontendId title difficulty topicTags { name } }
        }`,
        variables: { titleSlug: slug },
      }),
    });
    const q = (await res.json())?.data?.question;
    if (!q) throw new Error('no question data');
    return {
      number: q.questionFrontendId,
      title: q.title,
      difficulty: q.difficulty,
      topics: q.topicTags.map((t) => t.name),
    };
  }

  function fromDOM() {
    const title = document.title.replace(/\s*-\s*LeetCode\s*$/i, '').trim();
    const m = title.match(/^(\d+)\.\s*(.*)$/);
    const diffEl = document.querySelector('[class*="text-difficulty-"]');
    const topics = [...document.querySelectorAll('a[href^="/tag/"]')].map((a) => a.textContent.trim());
    return {
      number: m ? m[1] : '',
      title: m ? m[2] : title,
      difficulty: diffEl ? diffEl.textContent.trim() : '',
      topics: [...new Set(topics)].filter(Boolean),
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'getProblem') return;
    const slug = slugOf();
    if (!slug) {
      sendResponse({ error: 'Not a problem page' });
      return;
    }
    (async () => {
      let info;
      try {
        info = await fromGraphQL(slug);
      } catch {
        info = fromDOM();
      }
      sendResponse({ ...info, slug, url: `https://leetcode.com/problems/${slug}/` });
    })();
    return true; // async response
  });
})();
