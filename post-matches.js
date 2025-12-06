// post-matches.js
// Run via GitHub Actions on schedule. Uses Blogger API to create posts
// for today's + tomorrow's matches from your JSON, with dedupe via labels.

const {
  CLIENT_ID,
  CLIENT_SECRET,
  REFRESH_TOKEN,
  BLOG_ID,
  JSON_URL = 'https://raw.githubusercontent.com/albinchristo04/ptv/refs/heads/main/events_with_m3u8.json'
} = process.env;

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN || !BLOG_ID) {
  console.error('Missing one of CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN / BLOG_ID env vars');
  process.exit(1);
}

async function getAccessToken() {
  const form = new URLSearchParams();
  form.set('client_id', CLIENT_ID);
  form.set('client_secret', CLIENT_SECRET);
  form.set('refresh_token', REFRESH_TOKEN.trim());
  form.set('grant_type', 'refresh_token');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get access token: ${res.status} ${text}`);
  }
  const json = await res.json();
  if (!json.access_token) throw new Error('No access_token in token response');
  return json.access_token;
}

async function fetchExistingMatchLabels(accessToken) {
  // Get existing posts and collect match IDs from labels like "match:<sid>"
  const existing = new Set();
  let pageToken = undefined;

  do {
    const url = new URL(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts`);
    url.searchParams.set('maxResults', '500');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn('Failed to list posts:', res.status, text);
      break;
    }
    const data = await res.json();
    if (Array.isArray(data.items)) {
      for (const post of data.items) {
        if (Array.isArray(post.labels)) {
          for (const label of post.labels) {
            if (label.startsWith('match:')) {
              const sid = label.slice('match:'.length);
              existing.add(sid);
            }
          }
        }
      }
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return existing;
}

function filterTodayTomorrow(streams) {
  const now = new Date();
  const startTodayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;
  const startDayAfterTomorrowUtc = startTodayUtc + 2 * 24 * 60 * 60;

  return streams.filter(s => {
    const ts = Number(s.starts_at);
    if (!ts || Number.isNaN(ts)) return false;
    return ts >= startTodayUtc && ts < startDayAfterTomorrowUtc;
  });
}

async function main() {
  const accessToken = await getAccessToken();
  console.log('Got access token');

  // Fetch JSON
  const res = await fetch(JSON_URL);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch JSON: ${res.status} ${text}`);
  }
  const j = await res.json();

  // Normalize streams
  const streams = [];
  if (j.events && Array.isArray(j.events.streams)) {
    j.events.streams.forEach(cat => {
      if (Array.isArray(cat.streams)) {
        cat.streams.forEach(s => {
          s._category = cat.category || cat.category_name || '';
          streams.push(s);
        });
      }
    });
  } else if (Array.isArray(j)) {
    j.forEach(s => streams.push(s));
  }

  const upcoming = filterTodayTomorrow(streams);
  console.log(`Upcoming (today+tomorrow) matches count: ${upcoming.length}`);

  // Dedupe by label "match:<sid>"
  const existingMatchIds = await fetchExistingMatchLabels(accessToken);
  console.log(`Existing match IDs in Blogger: ${existingMatchIds.size}`);

  // Limit per run to be safe
  const MAX_NEW_POSTS = 10;
  let createdCount = 0;

  for (const s of upcoming) {
    if (createdCount >= MAX_NEW_POSTS) break;

    const sid = String(s.id || s.tag || s.uri_name || s.name || s.title || '').trim();
    if (!sid) continue;
    if (existingMatchIds.has(sid)) {
      console.log(`Skipping existing match ${sid}`);
      continue;
    }

    const title = s.name || s.title || sid;
    const starts = s.starts_at ? new Date(Number(s.starts_at) * 1000).toLocaleString() : 'TBA';
    const iframe = s.iframe || (s.resolved_m3u8 && s.resolved_m3u8[0] && s.resolved_m3u8[0].url) || '';
    const posterHtml = s.poster ? `<p><img src="${escapeHtml(s.poster)}" style="max-width:100%;height:auto"></p>` : '';

    const content = `
      <p><strong>Category:</strong> ${escapeHtml(s._category || '')}</p>
      <p><strong>Starts:</strong> ${escapeHtml(starts)}</p>
      ${posterHtml}
      <p>${escapeHtml(s.tag || '')}</p>
      ${iframe ? `<p><iframe src="${escapeHtml(iframe)}" width="100%" height="480" frameborder="0" allowfullscreen></iframe></p>` : ''}
      <p>Auto-generated from events JSON.</p>
    `;

    const postBody = {
      title,
      content,
      labels: [
        `match:${sid}`,
        s._category || 'match'
      ]
    };

    const postRes = await fetch(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(postBody)
    });

    if (!postRes.ok) {
      const text = await postRes.text();
      console.error('Failed to create post for', sid, postRes.status, text);
      continue;
    }

    const postJson = await postRes.json();
    console.log('Created post:', sid, postJson.id, title);
    createdCount++;
  }

  console.log(`Done. Created ${createdCount} new posts.`);
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
