// post-matches.js
// Auto-create Blogger posts for today's + tomorrow's FUTURE matches from your JSON,
// with embedded AdSense blocks and a match layout.

// Env vars (provided via GitHub Actions or locally)
const {
  CLIENT_ID,
  CLIENT_SECRET,
  REFRESH_TOKEN,
  BLOG_ID,
  JSON_URL = 'https://raw.githubusercontent.com/albinchristo04/tarjetarojaenvivoo/refs/heads/main/results/player_urls_latest.json'
} = process.env;

// ---- Config ----
const MAX_NEW_POSTS_PER_RUN = 3;      // safe with Blogger rate limits
const DELAY_BETWEEN_POSTS_MS = 2000;  // 2 seconds between posts

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN || !BLOG_ID) {
  console.error('[FATAL] Missing one of CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN / BLOG_ID env vars');
  process.exit(1);
}

// Helpers
const sleep = ms => new Promise(r => setTimeout(r, ms));

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

// ---- AdSense blocks ----

// Loader script (include once per post)
const ADS_BOOTSTRAP = `
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7025462814384100" crossorigin="anonymous"></script>
`;

// newads1 – hero / top area
const AD_TOP = `
<!-- newads1 -->
<ins class="adsbygoogle"
     style="display:block;margin:1rem 0"
     data-ad-client="ca-pub-7025462814384100"
     data-ad-slot="9326880581"
     data-ad-format="auto"
     data-full-width-responsive="true"></ins>
<script>
  (adsbygoogle = window.adsbygoogle || []).push({});
</script>
`;

// evaulthubsports_page_body_Blog1_1x1_as – body / under match info
const AD_BODY = `
<!-- evaulthubsports_page_body_Blog1_1x1_as -->
<ins class="adsbygoogle"
     style="display:block;margin:1rem 0"
     data-ad-client="ca-pub-7025462814384100"
     data-ad-slot="5285609513"
     data-ad-format="auto"
     data-full-width-responsive="true"></ins>
<script>
  (adsbygoogle = window.adsbygoogle || []).push({});
</script>
`;

// bxads53 – near player
const AD_PLAYER = `
<!-- bxads53 -->
<ins class="adsbygoogle"
     style="display:block;margin:0.75rem 0"
     data-ad-client="ca-pub-7025462814384100"
     data-ad-slot="2965148688"
     data-ad-format="auto"
     data-full-width-responsive="true"></ins>
<script>
  (adsbygoogle = window.adsbygoogle || []).push({});
</script>
`;

// bxads3 – sidebar / bottom
const AD_BOTTOM = `
<!-- bxads3 -->
<ins class="adsbygoogle"
     style="display:block;margin:1rem 0"
     data-ad-client="ca-pub-7025462814384100"
     data-ad-slot="3088329811"
     data-ad-format="auto"
     data-full-width-responsive="true"></ins>
<script>
  (adsbygoogle = window.adsbygoogle || []).push({});
</script>
`;

// ---- OAuth token handling ----

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

// ---- Blogger helpers ----

// List posts with label "match" and collect match IDs from labels "match:<sid>"
async function fetchExistingMatchIds(accessToken) {
  const existing = new Set();
  let pageToken;

  while (true) {
    const url = new URL(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts`);
    url.searchParams.set('maxResults', '500');
    url.searchParams.set('fetchBodies', 'false');
    url.searchParams.set('labels', 'match');   // only posts tagged with "match"
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

// ---- JSON normalization + filtering ----

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
  if (json.events && json.events.streams && Array.isArray(json.events.streams)) {
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

  return streams.filter(s => {
    const ts = Number(s.starts_at);
    if (!ts || Number.isNaN(ts)) return false;
    return ts >= startTodayUtc && ts < startDayAfterTomorrowUtc && ts >= nowTs;
  });
}

// Build HTML content for a match post, with ads + featured image
function buildPostContent(match) {
  const startsTs = Number(match.starts_at);
  const starts = startsTs
    ? new Date(startsTs * 1000).toLocaleString()
    : 'TBA';

  const title = match.name || match.title || '';
  const league = match._category || '';
  const tag = match.tag || '';
  const iframe = match.iframe || (match.resolved_m3u8 && match.resolved_m3u8[0] && match.resolved_m3u8[0].url) || '';
  const posterHtml = match.poster
    ? `<div class="match-featured-image"><img src="${escapeHtml(match.poster)}" alt="${escapeHtml(title)}" loading="lazy"/></div>`
    : '';

  return `
${ADS_BOOTSTRAP}

<div class="match-page">
  ${AD_TOP}

  <div class="match-header-card">
    ${posterHtml}
    <div class="match-header-text">
      <span class="match-league">${escapeHtml(league || 'Live Match')}</span>
      <h1 class="match-title">${escapeHtml(title)}</h1>
      <div class="match-meta">
        <span>Kickoff: ${escapeHtml(starts)}</span>
        ${tag ? `<span class="match-tag">${escapeHtml(tag)}</span>` : ''}
      </div>
    </div>
  </div>

  <div class="match-layout">
    <div class="match-main-column">
      <div class="match-player-card">
        <div class="match-player-header">
          <span>Live Stream</span>
          <span class="match-badge">HD</span>
        </div>

        ${AD_PLAYER}

        <div class="match-player-frame">
          ${iframe
      ? `<iframe src="${escapeHtml(iframe)}"
                         width="100%"
                         height="100%"
                         frameborder="0"
                         allowfullscreen
                         allow="autoplay; encrypted-media"></iframe>`
      : `<div class="match-player-empty">Stream not yet available. Please check closer to kickoff.</div>`
    }
        </div>

        ${AD_PLAYER}
      </div>

      <div class="match-body-card">
        <h2>Match Information</h2>
        <ul class="match-info-list">
          <li><strong>Match:</strong> ${escapeHtml(title)}</li>
          ${league ? `<li><strong>League:</strong> ${escapeHtml(league)}</li>` : ''}
          <li><strong>Kickoff Time:</strong> ${escapeHtml(starts)}</li>
        </ul>

        ${AD_BODY}

        <p class="match-note">
          Streams usually go live a few minutes before kickoff. If the stream stops,
          try refreshing the page or check back shortly for alternative servers.
        </p>
      </div>

      ${AD_BOTTOM}
    </div>

    <aside class="match-sidebar">
      <div class="match-ad-placeholder">
        ${AD_BODY}
      </div>
      <div class="match-ad-placeholder">
        ${AD_BOTTOM}
      </div>
    </aside>
  </div>
</div>
`;
}

// ---- Main flow ----

async function main() {
  console.log('Starting post-matches run...');

  const accessToken = await getAccessToken();
  console.log('[OK] Got access token');

  // Fetch events JSON
  const res = await fetch(JSON_URL);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch JSON: ${res.status} ${text}`);
  }
  const json = await res.json();

  const streams = normalizeStreams(json);
  const upcoming = filterUpcomingTodayTomorrow(streams);
  console.log(`[INFO] Upcoming (today+tomorrow, future) matches: ${upcoming.length}`);

  // Dedupe with Blogger labels
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
    console.log(`[POST] Creating post for match ${sid} (${title})`);

    const content = buildPostContent(s);

    const postBody = {
      title,
      content,
      labels: [
        `match:${sid}`,        // for dedupe
        'match',               // for list filter
        s._category || 'sport'
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
      console.error('[ERROR] Failed to create post for', sid, postRes.status, text);

      if (postRes.status === 429) {
        console.error('[RATE LIMIT] Hit Blogger rateLimitExceeded (429). Stopping this run.');
        break;
      }

      continue;
    }

    const postJson = await postRes.json();
    console.log('[OK] Created post:', sid, postJson.id, title);
    createdCount++;

    // delay between posts to be nice to API
    await sleep(DELAY_BETWEEN_POSTS_MS);
  }

  console.log(`[DONE] Created ${createdCount} new posts this run.`);
}

// Run
main().catch(err => {
  console.error('[FATAL] Fatal error in post-matches:', err);
  process.exit(1);
});
