// post-matches.js
// Auto-create Blogger posts for today's + tomorrow's FUTURE matches from your JSON.
// Safe with Blogger rate limits (small batch, delay, stop on 429).

const {
  CLIENT_ID,
  CLIENT_SECRET,
  REFRESH_TOKEN,
  BLOG_ID,
  JSON_URL = 'https://raw.githubusercontent.com/albinchristo04/ptv/refs/heads/main/events_with_m3u8.json'
} = process.env;

// ---- config ----
const MAX_NEW_POSTS_PER_RUN = 3;      // how many posts to create per run
const DELAY_BETWEEN_POSTS_MS = 2000;  // 2 seconds between posts

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN || !BLOG_ID) {
  console.error('[FATAL] Missing one of CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN / BLOG_ID env vars');
  process.exit(1);
}

// Small helper
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Get access token from refresh token
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

  const json = await res.json();
  if (!res.ok || !json.access_token) {
    console.error('[FATAL] Failed to get access token:', res.status, JSON.stringify(json));
    throw new Error('Failed to get access_token');
  }
  return json.access_token;
}

// List posts with label "match" and collect match IDs from labels "match:<sid>"
async function fetchExistingMatchIds(accessToken) {
  const existing = new Set();
  let pageToken;

  while (true) {
    const url = new URL(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts`);
    url.searchParams.set('maxResults', '500');
    url.searchParams.set('fetchBodies', 'false');
    url.searchParams.set('labels', 'match');   // only posts with label "match"
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json();

    if (!res.ok) {
      console.warn('[WARN] Failed to list posts for dedupe:', res.status, JSON.stringify(data));
      break;
    }

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

    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  return existing;
}

// Filter matches: today + tomorrow (UTC) AND in the future
function filterUpcomingTodayTomorrow(streams) {
  const now = new Date();
  const nowTs = Math.floor(now.getTime() / 1000);

  const startTodayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  ) / 1000;

  const startDayAfterTomorrowUtc = startTodayUtc + 2 * 24 * 60 * 60; // today + tomorrow

  const result = streams.filter(s => {
    const ts = Number(s.starts_at);
    if (!ts || Number.isNaN(ts)) return false;

    // Only matches with kickoff between [startToday, day after tomorrow) and in the future
    return ts >= startTodayUtc && ts < startDayAfterTomorrowUtc && ts >= nowTs;
  });

  return result;
}

function normalizeStreams(json) {
  const streams = [];
  if (json.events && Array.isArray(json.events.streams)) {
    json.events.streams.forEach(cat => {
      if (Array.isArray(cat.streams)) {
        cat.streams.forEach(s => {
          s._category = cat.category || cat.category_name || '';
          streams.push(s);
        });
      }
    });
  } else if (Array.isArray(json)) {
    json.forEach(s => streams.push(s));
  }
  return streams;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

async function main() {
  console.log('Starting post-matches run...');

  const accessToken = await getAccessToken();
  console.log('[OK] Got access token');

  // Fetch JSON
  const res = await fetch(JSON_URL);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch JSON: ${res.status} ${text}`);
  }
  const json = await res.json();

  const streams = normalizeStreams(json);
  const upcoming = filterUpcomingTodayTomorrow(streams);
  console.log(`[INFO] Upcoming (today+tomorrow, future) matches: ${upcoming.length}`);

  // Dedupe using existing posts' labels
  const existingMatchIds = await fetchExistingMatchIds(accessToken);
  console.log(`[INFO] Existing match IDs in Blogger (via label match:<id>): ${existingMatchIds.size}`);

  let createdCount = 0;

  for (const s of upcoming) {
    if (createdCount >= MAX_NEW_POSTS_PER_RUN) {
      console.log(`[INFO] Reached MAX_NEW_POSTS_PER_RUN = ${MAX_NEW_POSTS_PER_RUN}, stopping.`);
      break;
    }

    const sid = String(s.id || s.tag || s.uri_name || s.name || s.title || '').trim();
    if (!sid) continue;

    if (existingMatchIds.has(sid)) {
      console.log(`[SKIP] Match ${sid} already has a post.`);
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
        `match:${sid}`,       // used for dedupe later
        'match',              // generic label so we can filter with labels=match
        s._category || 'sport'
      ]
    };

    console.log(`[POST] Creating post for match ${sid} (${title})`);

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
      console.error('[ERROR] Failed to create post for', sid, postRes.status, text);

      if (postRes.status === 429) {
        console.error('[RATE LIMIT] Hit Blogger rateLimitExceeded (429). Stopping this run.');
        break;
      }

      continue; // move to next match on other errors
    }

    const postJson = await postRes.json();
    console.log('[OK] Created post:', sid, postJson.id, title);
    createdCount++;

    // Polite delay between posts to reduce risk of 429
    await sleep(DELAY_BETWEEN_POSTS_MS);
  }

  console.log(`[DONE] Created ${createdCount} new posts this run.`);
}

main().catch(err => {
  console.error('[FATAL] Fatal error in post-matches:', err);
  process.exit(1);
});
