// cleanup-finished.js
// Deletes Blogger posts for matches that are already finished (older than FINISHED_HOURS).

const {
  CLIENT_ID,
  CLIENT_SECRET,
  REFRESH_TOKEN,
  BLOG_ID,
  JSON_URL = 'https://raw.githubusercontent.com/albinchristo04/tarjetarojaenvivoo/refs/heads/main/results/player_urls_latest.json'
} = process.env;

const FINISHED_HOURS = 4;           // consider match finished 4h after kickoff
const MAX_DELETES_PER_RUN = 10;     // safety

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN || !BLOG_ID) {
  console.error('[FATAL] Missing one of CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN / BLOG_ID env vars');
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

  const json = await res.json();
  if (!res.ok || !json.access_token) {
    console.error('[FATAL] Failed to get access token:', res.status, JSON.stringify(json));
    throw new Error('Failed to get access_token');
  }
  return json.access_token;
}

function normalizeStreams(json) {
  const streams = [];

  // New format: json.events is an array
  if (json.events && Array.isArray(json.events)) {
    json.events.forEach(e => {
      // Check if it's the new format item (has event_title)
      if (e.event_title) {
        const s = {};
        s.name = e.event_title;
        s.iframe = e.player_url;
        s._category = e.sport || '';

        // Extract league from title if needed
        if (!s._category && s.name.includes(':')) {
          const parts = s.name.split(':');
          s._category = parts[0].trim();
          s.name = parts.slice(1).join(':').trim();
        }

        // Parse time. Format: "HH:MM:SS"
        // We assume this is for the current day.
        if (e.event_time) {
          const [h, m, sec] = e.event_time.split(':').map(Number);
          const date = new Date();
          date.setHours(h, m, sec || 0, 0);
          s.starts_at = Math.floor(date.getTime() / 1000);
        }

        streams.push(s);
      } else {
        streams.push(e);
      }
    });
    return streams;
  }

  // Old format
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

async function listMatchPosts(accessToken) {
  const posts = [];
  let pageToken;

  while (true) {
    const url = new URL(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts`);
    url.searchParams.set('maxResults', '500');
    url.searchParams.set('labels', 'match');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json();

    if (!res.ok) {
      console.error('[WARN] Failed to list posts:', res.status, JSON.stringify(data));
      break;
    }

    if (Array.isArray(data.items)) {
      posts.push(...data.items);
    }

    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  return posts;
}

async function main() {
  console.log('Starting cleanup-finished run...');

  const accessToken = await getAccessToken();
  console.log('[OK] Got access token');

  // Fetch events JSON
  const evRes = await fetch(JSON_URL);
  if (!evRes.ok) {
    const text = await evRes.text();
    throw new Error(`Failed to fetch JSON: ${evRes.status} ${text}`);
  }
  const evJson = await evRes.json();
  const streams = normalizeStreams(evJson);

  const matchById = new Map();
  for (const s of streams) {
    const sid = String(s.id || s.tag || s.uri_name || s.name || s.title || '').trim();
    if (!sid) continue;
    matchById.set(sid, s);
  }

  const posts = await listMatchPosts(accessToken);
  console.log(`[INFO] Found ${posts.length} match posts in Blogger.`);

  const nowTs = Date.now() / 1000;
  const cutoffSeconds = FINISHED_HOURS * 3600;
  let deleted = 0;

  for (const post of posts) {
    if (deleted >= MAX_DELETES_PER_RUN) {
      console.log(`[INFO] Reached MAX_DELETES_PER_RUN = ${MAX_DELETES_PER_RUN}, stopping.`);
      break;
    }

    const labels = post.labels || [];
    const matchLabel = labels.find(l => l.startsWith('match:'));
    if (!matchLabel) continue;

    const sid = matchLabel.slice('match:'.length);
    const match = matchById.get(sid);
    if (!match || !match.starts_at) {
      // If unknown match or no starts_at, optionally delete if post is very old
      continue;
    }

    const startsTs = Number(match.starts_at);
    if (!startsTs || Number.isNaN(startsTs)) continue;

    const age = nowTs - startsTs;
    if (age < cutoffSeconds) {
      continue; // not finished yet
    }

    console.log(`[DELETE] Deleting finished match post ${sid} (postId=${post.id})`);

    const delRes = await fetch(
      `https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts/${post.id}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );

    if (!delRes.ok) {
      const text = await delRes.text();
      console.error('[ERROR] Failed to delete post', post.id, delRes.status, text);
      continue;
    }

    deleted++;
  }

  console.log(`[DONE] Deleted ${deleted} finished match posts this run.`);
}

main().catch(err => {
  console.error('[FATAL] cleanup-finished error:', err);
  process.exit(1);
});
