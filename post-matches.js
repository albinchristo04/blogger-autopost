// post-matches.js
// Auto-create Blogger posts for today's + tomorrow's FUTURE matches from your JSON,
// with dedupe + featured image + automatic cleanup of finished matches.
//
// Requires env:
//   CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN, BLOG_ID, JSON_URL

const {
  CLIENT_ID,
  CLIENT_SECRET,
  REFRESH_TOKEN,
  BLOG_ID,
  JSON_URL = 'https://raw.githubusercontent.com/albinchristo04/ptv/refs/heads/main/events_with_m3u8.json'
} = process.env;

// ---- config ----
const MAX_NEW_POSTS_PER_RUN = 3;          // how many new posts to create per run
const DELAY_BETWEEN_POSTS_MS = 2000;      // delay between create calls
const MAX_DELETES_PER_RUN = 5;            // how many finished posts to delete per run
const FINISHED_OFFSET_SECONDS = 3 * 3600; // consider match "finished" this long after kickoff

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN || !BLOG_ID) {
  console.error('[FATAL] Missing one of CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN / BLOG_ID');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- auth ----
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

// ---- helpers ----
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
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

// Only today + tomorrow (UTC) AND future kickoffs
function filterUpcomingTodayTomorrow(streams) {
  const now = new Date();
  const nowTs = Math.floor(now.getTime() / 1000);

  const startTodayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  ) / 1000;

  const startDayAfterTomorrowUtc = startTodayUtc + 2 * 24 * 60 * 60; // today + tomorrow

  return streams.filter(s => {
    const ts = Number(s.starts_at);
    if (!ts || Number.isNaN(ts)) return false;
    return ts >= startTodayUtc && ts < startDayAfterTomorrowUtc && ts >= nowTs;
  });
}

// Collect existing match IDs from labels "match:<id>"
async function fetchExistingMatchIds(accessToken) {
  const existing = new Set();
  let pageToken;

  while (true) {
    const url = new URL(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts`);
    url.searchParams.set('maxResults', '500');
    url.searchParams.set('fetchBodies', 'false');
    url.searchParams.set('labels', 'match'); // only those posts

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

// Delete finished matches based on label "kickoff:<unixTs>"
async function deleteFinishedPosts(accessToken) {
  const nowTs = Math.floor(Date.now() / 1000);
  const cutoffTs = nowTs - FINISHED_OFFSET_SECONDS;
  let deleted = 0;
  let pageToken;

  while (deleted < MAX_DELETES_PER_RUN) {
    const url = new URL(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts`);
    url.searchParams.set('maxResults', '200');
    url.searchParams.set('labels', 'match'); // only match posts
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json();

    if (!res.ok) {
      console.warn('[CLEANUP] Failed to list posts for cleanup:', res.status, JSON.stringify(data));
      break;
    }

    if (!Array.isArray(data.items) || data.items.length === 0) break;

    for (const post of data.items) {
      if (deleted >= MAX_DELETES_PER_RUN) break;

      let kickoffTs = null;
      if (Array.isArray(post.labels)) {
        for (const label of post.labels) {
          if (label.startsWith('kickoff:')) {
            const raw = label.slice('kickoff:'.length);
            const v = Number(raw);
            if (!Number.isNaN(v) && v > 0) kickoffTs = v;
          }
        }
      }

      // If we never stored kickoff, fall back to published date
      if (!kickoffTs && post.published) {
        kickoffTs = Math.floor(new Date(post.published).getTime() / 1000);
      }

      if (!kickoffTs) continue;

      if (kickoffTs < cutoffTs) {
        console.log(`[CLEANUP] Deleting finished match post ${post.id} (kickoff ${kickoffTs})`);
        const delRes = await fetch(
          `https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts/${post.id}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${accessToken}` }
          }
        );

        if (delRes.status === 204) {
          deleted++;
          await sleep(1000); // be gentle with API
        } else {
          const t = await delRes.text();
          console.warn('[CLEANUP] Failed to delete post', post.id, delRes.status, t);
        }
      }
    }

    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  console.log(`[CLEANUP] Deleted ${deleted} finished posts this run.`);
}

// ---- main ----
async function main() {
  console.log('Starting post-matches run...');

  const accessToken = await getAccessToken();
  console.log('[OK] Got access token');

  // 1) Fetch JSON and build upcoming list
  const res = await fetch(JSON_URL);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch JSON: ${res.status} ${text}`);
  }
  const json = await res.json();

  const streams = normalizeStreams(json);
  const upcoming = filterUpcomingTodayTomorrow(streams);
  console.log(`[INFO] Upcoming (today+tomorrow, future) matches: ${upcoming.length}`);

  // 2) Dedupe using existing posts
  const existingMatchIds = await fetchExistingMatchIds(accessToken);
  console.log(`[INFO] Existing match IDs in Blogger: ${existingMatchIds.size}`);

  // 3) Create new posts (limited)
  let createdCount = 0;

  for (const s of upcoming) {
    if (createdCount >= MAX_NEW_POSTS_PER_RUN) {
      console.log(`[INFO] Reached MAX_NEW_POSTS_PER_RUN = ${MAX_NEW_POSTS_PER_RUN}, stopping create loop.`);
      break;
    }

    const sid = String(s.id || s.tag || s.uri_name || s.name || s.title || '').trim();
    if (!sid) continue;

    if (existingMatchIds.has(sid)) {
      console.log(`[SKIP] Match ${sid} already has a post.`);
      continue;
    }

    const title = s.name || s.title || sid;
    const startsTs = Number(s.starts_at) || null;
    const starts = startsTs
      ? new Date(startsTs * 1000).toLocaleString()
      : 'TBA';

    const iframeUrl = s.iframe || (s.resolved_m3u8 && s.resolved_m3u8[0] && s.resolved_m3u8[0].url) || '';
    const poster = s.poster || '';
    const league = s._category || '';
    const tag = s.tag || '';

    // ---- FEATURED IMAGE: poster at top; Blogger will use first <img> as thumbnail ----
    const featuredImageHtml = poster
      ? `<div class="match-featured-image"><img src="${escapeHtml(poster)}" alt="${escapeHtml(title)}" loading="lazy" /></div>`
      : '';

    // ---- HTML content with improved layout ----
    const content = `
<div class="match-page">
  <div class="match-header glass-panel">
    <div class="match-header-main">
      <div class="match-header-text">
        ${league ? `<span class="league-tag">${escapeHtml(league)}</span>` : ''}
        <h1 class="match-title">${escapeHtml(title)}</h1>
        <div class="match-meta">
          <span class="match-time-label">Kickoff:</span>
          <span class="match-time-value">${escapeHtml(starts)}</span>
        </div>
      </div>
      <div class="match-header-actions">
        <button class="btn-ghost" onclick="location.reload()">
          🔄 Refresh
        </button>
        <button class="btn-ghost danger">
          ⚠️ Report Issue
        </button>
      </div>
    </div>
  </div>

  ${featuredImageHtml}

  <div class="match-layout">
    <div class="match-main glass-panel">
      <div class="server-section">
        <div class="server-header">
          <h2>Select Server</h2>
          <p class="server-note">If one server doesn't work, try another one or refresh the page.</p>
        </div>
        <div class="server-list">
          <button class="server-button active">
            <span class="server-icon">▶️</span>
            <div class="server-label">
              <div class="server-name">Main Server</div>
              ${tag ? `<div class="server-tag">${escapeHtml(tag)}</div>` : ''}
            </div>
          </button>
        </div>
      </div>

      <div class="player-wrapper glass-panel">
        ${iframeUrl
          ? `
        <div class="player-frame">
          <iframe
            src="${escapeHtml(iframeUrl)}"
            width="100%"
            height="100%"
            frameborder="0"
            allowfullscreen="true"
            allow="autoplay; encrypted-media"
          ></iframe>
        </div>`
          : `
        <div class="player-placeholder">
          <p>No stream available for this match yet.</p>
        </div>`}
      </div>

      <div class="match-extra glass-panel">
        <h2>Match Info</h2>
        <ul class="match-info-list">
          ${league ? `<li><strong>Competition:</strong> ${escapeHtml(league)}</li>` : ''}
          ${tag ? `<li><strong>Tag:</strong> ${escapeHtml(tag)}</li>` : ''}
          ${startsTs ? `<li><strong>Kickoff (local time):</strong> ${escapeHtml(starts)}</li>` : ''}
        </ul>
        <p class="match-disclaimer">
          Streams are embedded from external sources. If a stream does not load, please refresh or try again closer to kick-off.
        </p>
      </div>
    </div>

    <aside class="match-sidebar">
      <div class="glass-panel sidebar-section">
        <h3>Match Alerts</h3>
        <p>Join our community to get alerts when streams are updated.</p>
        <a class="btn-discord" href="https://discord.gg/5QgbhJV4" target="_blank" rel="noopener noreferrer">
          Join Discord
        </a>
      </div>

      <div class="glass-panel sidebar-section sidebar-ads">
        <h3>Advertisement</h3>
        <div class="ad-slot ad-slot-vertical">
          <!-- Place your vertical ad code here -->
        </div>
      </div>

      <div class="glass-panel sidebar-section">
        <h3>Related Matches</h3>
        <p>Add manual links to other important matches here or via widgets.</p>
      </div>
    </aside>
  </div>

  <div class="glass-panel match-bottom-ads">
    <h3>More Streams</h3>
    <div class="ad-slot ad-slot-horizontal">
      <!-- Place your horizontal ad code here -->
    </div>
  </div>
</div>
    `;

    const labels = [
      `match:${sid}`,          // dedupe id
      'match',                 // generic label to list all matches
      league || 'sport'
    ];

    if (startsTs) {
      labels.push(`kickoff:${startsTs}`); // used for cleanup
    }

    const postBody = {
      title,
      content,
      labels
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
        console.error('[RATE LIMIT] Hit Blogger rateLimitExceeded (429). Stopping create loop.');
        break;
      }
      continue;
    }

    const postJson = await postRes.json();
    console.log('[OK] Created post:', sid, postJson.id, title);
    createdCount++;

    await sleep(DELAY_BETWEEN_POSTS_MS);
  }

  console.log(`[DONE] Created ${createdCount} new posts this run.`);

  // 4) Clean up finished matches
  await deleteFinishedPosts(accessToken);
}

main().catch(err => {
  console.error('[FATAL] Fatal error in post-matches:', err);
  process.exit(1);
});
