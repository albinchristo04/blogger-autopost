// generate-telegram-links.js
// Prints "Title – URL" for upcoming (today+tomorrow) matches that already have posts.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  CLIENT_ID,
  CLIENT_SECRET,
  REFRESH_TOKEN,
  BLOG_ID,
  JSON_URL = 'https://raw.githubusercontent.com/albinchristo04/tarjetarojaenvivoo/refs/heads/main/results/player_urls_latest.json'
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
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    console.error('Failed to get access token:', res.status, JSON.stringify(json));
    process.exit(1);
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

function filterUpcomingTodayTomorrow(streams) {
  const now = new Date();
  const nowTs = Math.floor(now.getTime() / 1000);

  const startTodayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  ) / 1000;

  const startDayAfterTomorrowUtc = startTodayUtc + 2 * 24 * 60 * 60;

  return streams.filter(s => {
    const ts = Number(s.starts_at);
    if (!ts || Number.isNaN(ts)) return false;
    return ts >= startTodayUtc && ts < startDayAfterTomorrowUtc;
  });
}

async function fetchMatchPosts(accessToken) {
  const map = new Map(); // sid -> { url, title }
  let pageToken;

  while (true) {
    const url = new URL(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts`);
    url.searchParams.set('maxResults', '500');
    url.searchParams.set('fetchBodies', 'false');
    url.searchParams.set('labels', 'match');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json();

    if (!res.ok) {
      console.error('Failed to list posts:', res.status, JSON.stringify(data));
      break;
    }

    if (Array.isArray(data.items)) {
      for (const post of data.items) {
        if (!Array.isArray(post.labels)) continue;
        let sid = null;
        for (const label of post.labels) {
          if (label.startsWith('match:')) {
            sid = label.slice('match:'.length);
            break;
          }
        }
        if (sid) {
          map.set(sid, { url: post.url, title: post.title });
        }
      }
    }

    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  return map;
}

function slugify(text) {
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

async function main() {
  const accessToken = await getAccessToken();

  const MATCHES_FILE = path.join(__dirname, 'rojadirecta_events.json');
  if (!fs.existsSync(MATCHES_FILE)) {
    console.error('[FATAL] rojadirecta_events.json not found. Run libre.py first.');
    process.exit(1);
  }

  const rawData = JSON.parse(fs.readFileSync(MATCHES_FILE, 'utf8'));
  const events = rawData.events || [];

  // Transform and deduplicate
  const uniqueEvents = [];
  const seenKeys = new Set();
  for (const e of events) {
    const key = `${e.description}|${e.date}|${e.time}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    uniqueEvents.push(e);
  }

  const groupedMatches = uniqueEvents.map(e => {
    let starts_at = 0;
    if (e.date && e.time) {
      const dtStr = `${e.date}T${e.time}`;
      starts_at = Math.floor(new Date(dtStr).getTime() / 1000);
    }
    const slug = slugify(e.description).slice(0, 30);
    const dateStr = (e.date || '').replace(/-/g, '');
    const sid = `${slug}-${dateStr}`;

    return {
      name: e.description,
      starts_at: starts_at,
      sid: sid
    };
  });

  const upcoming = filterUpcomingTodayTomorrow(groupedMatches);
  const postsMap = await fetchMatchPosts(accessToken);

  console.log('--- Telegram share links (today + tomorrow) ---');
  for (const s of upcoming) {
    const sid = s.sid;
    if (!sid) continue;
    const postInfo = postsMap.get(sid);
    if (!postInfo) continue;

    const title = s.name || postInfo.title || sid;
    console.log(`${title} – ${postInfo.url}`);
  }
}

main().catch(err => {
  console.error('Fatal error in generate-telegram-links:', err);
  process.exit(1);
});
