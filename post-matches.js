// post-matches.js
// Auto-create Blogger posts for today's + tomorrow's FUTURE matches from your JSON,
// with embedded AdSense blocks and a match layout.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Env vars (provided via GitHub Actions or locally)
const {
  CLIENT_ID,
  CLIENT_SECRET,
  REFRESH_TOKEN,
  BLOG_ID,
  JSON_URL = 'https://raw.githubusercontent.com/albinchristo04/tarjetarojaenvivoo/refs/heads/main/results/player_urls_latest.json'
} = process.env;

// ---- Config ----
const MAX_NEW_POSTS_PER_RUN = 5;      // Post more per run since we run less frequently
const DELAY_BETWEEN_POSTS_MS = 3000;  // 3 seconds between posts for safety

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

// ---- GPT Ad Blocks ----

// Loader script (include once per post - though theme has it, this ensures it works if theme changes)
// We also define the specific slots for THIS post here to ensure they exist.
// Note: We use unique IDs for each post's ads if possible, but since this is a static page view,
// standard IDs are fine as long as they don't conflict on the SAME page.
// However, to be safe and allow multiple ads of same type, we define them here.

const ADS_BOOTSTRAP = `
<script async src="https://securepubads.g.doubleclick.net/tag/js/gpt.js" crossorigin="anonymous"></script>
<script>
  window.googletag = window.googletag || {cmd: []};
  googletag.cmd.push(function() {
    // Define slots for the post content
    googletag.defineSlot('/23250651813/header_728x90', [728, 90], 'div-gpt-ad-post-header').addService(googletag.pubads());
    googletag.defineSlot('/23250651813/Banner', [[300, 250], [250, 250], [336, 280]], 'div-gpt-ad-post-player').addService(googletag.pubads());
    googletag.defineSlot('/23250651813/Banner', [[300, 250], [250, 250], [336, 280]], 'div-gpt-ad-post-body').addService(googletag.pubads());
    googletag.defineSlot('/23250651813/Banner', [[300, 250], [250, 250], [336, 280]], 'div-gpt-ad-post-bottom').addService(googletag.pubads());
    
    googletag.pubads().enableSingleRequest();
    googletag.pubads().collapseEmptyDivs();
    googletag.enableServices();
  });
</script>
`;

// Header Ad (728x90)
const AD_TOP = `
<!-- /23250651813/header_728x90 -->
<div id='div-gpt-ad-post-header' style='min-width: 728px; min-height: 90px; margin: 1rem auto; text-align: center;'>
  <script>
    googletag.cmd.push(function() { googletag.display('div-gpt-ad-post-header'); });
  </script>
</div>
`;

// Body Ad (Banner)
const AD_BODY = `
<!-- /23250651813/Banner -->
<div id='div-gpt-ad-post-body' style='min-width: 250px; min-height: 250px; margin: 1rem auto; text-align: center;'>
  <script>
    googletag.cmd.push(function() { googletag.display('div-gpt-ad-post-body'); });
  </script>
</div>
`;

// Player Ad (Banner)
const AD_PLAYER = `
<!-- /23250651813/Banner -->
<div id='div-gpt-ad-post-player' style='min-width: 250px; min-height: 250px; margin: 0.75rem auto; text-align: center;'>
  <script>
    googletag.cmd.push(function() { googletag.display('div-gpt-ad-post-player'); });
  </script>
</div>
`;

// Bottom Ad (Banner)
const AD_BOTTOM = `
<!-- /23250651813/Banner -->
<div id='div-gpt-ad-post-bottom' style='min-width: 250px; min-height: 250px; margin: 1rem auto; text-align: center;'>
  <script>
    googletag.cmd.push(function() { googletag.display('div-gpt-ad-post-bottom'); });
  </script>
</div>
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
        s.canal_name = e.canal_name || ''; // Capture channel name

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

// Group streams by match name to handle multiple channels per match
function groupMatches(streams) {
  const groups = {};
  for (const s of streams) {
    const key = s.name; // e.g. "Pisa vs Como"
    if (!key) continue;

    if (!groups[key]) {
      groups[key] = {
        ...s,
        streams: []
      };
    }

    // Add this stream to the list
    groups[key].streams.push({
      name: s.canal_name || `Stream ${groups[key].streams.length + 1}`,
      url: s.iframe
    });
  }
  return Object.values(groups);
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
    return ts >= startTodayUtc && ts < startDayAfterTomorrowUtc;
  });
}

// Build HTML content for a match post, with ads + featured image + multi-stream player
function buildPostContent(match) {
  const startsTs = Number(match.starts_at);
  const starts = startsTs
    ? new Date(startsTs * 1000).toLocaleString()
    : 'TBA';

  const title = match.name || match.title || '';
  const league = match._category || '';
  const tag = match.tag || '';

  // Prepare streams
  const streamList = match.streams && match.streams.length > 0
    ? match.streams
    : [{ name: 'Live Stream', url: match.iframe || (match.resolved_m3u8 && match.resolved_m3u8[0] && match.resolved_m3u8[0].url) || '' }];

  const defaultIframe = streamList[0].url;

  const posterHtml = match.poster
    ? `<div class="match-featured-image"><img src="${escapeHtml(match.poster)}" alt="${escapeHtml(title)}" loading="lazy"/></div>`
    : '';

  // Generate buttons HTML
  let buttonsHtml = '';
  if (streamList.length > 1) {
    buttonsHtml = `<div class="stream-buttons" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;">`;
    streamList.forEach((s, idx) => {
      const activeClass = idx === 0 ? 'active-stream' : '';
      buttonsHtml += `<button class="stream-btn ${activeClass}" onclick="changeStream('${escapeHtml(s.url)}', this)" style="padding:8px 16px;cursor:pointer;background:#eee;border:none;border-radius:4px;font-weight:bold;">${escapeHtml(s.name)}</button>`;
    });
    buttonsHtml += `</div>`;
  }

  // Script to handle stream switching
  const switcherScript = `
<script>
function changeStream(url, btn) {
  var iframe = document.getElementById('match-iframe');
  if(iframe) iframe.src = url;
  
  // Update active button style
  var btns = document.querySelectorAll('.stream-btn');
  btns.forEach(function(b) { b.style.background = '#eee'; b.style.color = '#000'; });
  if(btn) { btn.style.background = '#d32f2f'; btn.style.color = '#fff'; }
}
// Set initial active button style
document.addEventListener('DOMContentLoaded', function() {
  var firstBtn = document.querySelector('.stream-btn');
  if(firstBtn) { firstBtn.style.background = '#d32f2f'; firstBtn.style.color = '#fff'; }
});
</script>
`;

  return `
${ADS_BOOTSTRAP}
${switcherScript}

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
        
        ${buttonsHtml}

        <div class="match-player-frame">
          ${defaultIframe
      ? `<iframe id="match-iframe" src="${escapeHtml(defaultIframe)}"
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
          <li><strong>Channels:</strong> ${streamList.length} Available</li>
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

function slugify(text) {
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

async function main() {
  console.log('🚀 Starting post-matches run...');
  console.log(`⏰ Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);

  const accessToken = await getAccessToken();
  console.log('[OK] Got access token');

  // Read local rojadirecta_events.json
  const MATCHES_FILE = path.join(__dirname, 'rojadirecta_events.json');

  if (!fs.existsSync(MATCHES_FILE)) {
    console.error('[FATAL] rojadirecta_events.json not found. Run libre.py first.');
    process.exit(1);
  }

  const rawData = JSON.parse(fs.readFileSync(MATCHES_FILE, 'utf8'));
  const events = rawData.events || [];

  // Deduplicate by description + date + time
  const uniqueEvents = [];
  const seenKeys = new Set();
  for (const e of events) {
    const key = `${e.description}|${e.date}|${e.time}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    uniqueEvents.push(e);
  }

  // Transform to internal format
  const groupedMatches = uniqueEvents.map(e => {
    // Parse date/time
    let starts_at = 0;
    if (e.date && e.time) {
      const dtStr = `${e.date}T${e.time}`;
      starts_at = Math.floor(new Date(dtStr).getTime() / 1000);
    }

    // Map channels to streams, preferring decoded_url
    const streams = (e.channels || []).map((c, idx) => ({
      name: c.name || `Stream ${idx + 1}`,
      url: c.decoded_url || c.url
    }));

    // Create a robust SID for Blogger labels (max 50 chars total)
    // match:slug-date
    const slug = slugify(e.description).slice(0, 30);
    const dateStr = (e.date || '').replace(/-/g, '');
    const sid = `${slug}-${dateStr}`;

    return {
      name: e.description,
      title: e.description,
      _category: e.country,
      starts_at: starts_at,
      streams: streams,
      poster: e.flag_url,
      sid: sid
    };
  });

  const upcoming = filterUpcomingTodayTomorrow(groupedMatches);

  console.log(`📊 Stats:`);
  console.log(`   Total events: ${events.length}`);
  console.log(`   Unique events: ${uniqueEvents.length}`);
  console.log(`   Upcoming matches (today + tomorrow): ${upcoming.length}`);

  if (upcoming.length === 0) {
    console.log('✅ No upcoming matches found. All done!');
    process.exit(10); // Signal: No matches to post
  }

  // Dedupe with Blogger labels
  const existingMatchIds = await fetchExistingMatchIds(accessToken);
  console.log(`   Existing posts in Blogger: ${existingMatchIds.size}`);

  // Filter out already posted
  const newMatches = upcoming.filter(s => s.sid && !existingMatchIds.has(s.sid));
  
  console.log(`   New matches to post: ${newMatches.length}`);

  if (newMatches.length === 0) {
    console.log('✅ All matches already posted. Nothing new!');
    process.exit(10); // Signal: No new matches
  }

  let createdCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const s of newMatches) {
    if (createdCount >= MAX_NEW_POSTS_PER_RUN) {
      console.log(`ℹ️  Reached MAX_NEW_POSTS_PER_RUN = ${MAX_NEW_POSTS_PER_RUN}`);
      console.log(`   ${newMatches.length - createdCount - skippedCount - failedCount} matches remaining for next run`);
      break;
    }

    const sid = s.sid;
    if (!sid) {
      skippedCount++;
      continue;
    }

    const title = s.name || s.title || sid;
    console.log(`\n📝 [${createdCount + 1}/${Math.min(MAX_NEW_POSTS_PER_RUN, newMatches.length)}] Posting: ${title}`);
    console.log(`   Match ID: ${sid}`);
    console.log(`   Streams: ${s.streams.length}`);

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

    try {
      const postRes = await fetch(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(postBody)// Add this at the end of your post-matches.js file

// After successfully posting all matches, exit with code 10 to signal "no more matches"
// After posting some matches but more remain, exit with code 0 to continue
// On error, exit with appropriate error code

// Add this at the end of your post-matches.js file

// After successfully posting all matches, exit with code 10 to signal "no more matches"
// After posting some matches but more remain, exit with code 0 to continue
// On error, exit with appropriate error code

// Example implementation:
async function main() {
  try {
    console.log('🔍 Fetching matches from source...');
    const matches = await fetchMatchesFromSource();
    
    if (!matches || matches.length === 0) {
      console.log('✅ No new matches found. All up to date!');
      process.exit(10); // Signal: No more matches to post
    }
    
    console.log(`📋 Found ${matches.length} matches to process`);
    
    // Get existing posts to avoid duplicates
    const existingPosts = await getExistingBlogPosts();
    const existingTitles = new Set(existingPosts.map(post => post.title));
    
    // Filter out already posted matches
    const newMatches = matches.filter(match => !existingTitles.has(match.title));
    
    if (newMatches.length === 0) {
      console.log('✅ All matches already posted. Nothing new!');
      process.exit(10); // Signal: No more matches to post
    }
    
    console.log(`📝 Posting ${newMatches.length} new matches...`);
    
    let successCount = 0;
    let failCount = 0;
    
    // Post matches with rate limiting
    for (let i = 0; i < newMatches.length; i++) {
      const match = newMatches[i];
      
      try {
        await postMatchToBlogger(match);
        successCount++;
        console.log(`✅ Posted: ${match.title} (${i + 1}/${newMatches.length})`);
        
        // Rate limiting: wait 2 seconds between posts
        if (i < newMatches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error) {
        failCount++;
        console.error(`❌ Failed to post: ${match.title}`, error.message);
        
        // If rate limited, stop and let workflow retry later
        if (error.message.includes('rate') || error.message.includes('quota')) {
          console.log('⚠️  Rate limited. Will retry later.');
          process.exit(1); // Signal: Error, retry needed
        }
      }
    }
    
    console.log(`\n📊 Summary: ${successCount} posted, ${failCount} failed`);
    
    // Check if there might be more matches to fetch
    if (matches.length >= 50) { // Adjust based on your API's page size
      console.log('📍 More matches may be available. Will check again.');
      process.exit(0); // Signal: Success, but check again
    }
    
    console.log('✅ All available matches processed!');
    process.exit(10); // Signal: All done
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1); // Signal: Error occurred
  }
}

// Run the script
main();

// Helper function examples (adjust to your actual implementation):

async function fetchMatchesFromSource() {
  // Your code to fetch matches from the source
  // Return array of match objects
}

async function getExistingBlogPosts() {
  // Your code to get existing blog posts
  // Return array of existing posts
}

async function postMatchToBlogger(match) {
  // Your code to post a match to Blogger
  // Throw error if posting fails
}
