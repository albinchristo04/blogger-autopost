// process-matches.js
// Fetches raw matches, normalizes, groups by match, and saves to matches.json

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JSON_URL = 'https://raw.githubusercontent.com/albinchristo04/tarjetarojaenvivoo/refs/heads/main/results/player_urls_latest.json';
const OUTPUT_FILE = path.join(__dirname, 'matches.json');

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
                s.canal_name = e.canal_name || '';

                // Extract league from title if needed
                if (!s._category && s.name.includes(':')) {
                    const parts = s.name.split(':');
                    s._category = parts[0].trim();
                    s.name = parts.slice(1).join(':').trim();
                }

                // Parse time. Format: "HH:MM:SS"
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

    // Old format fallback
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

async function main() {
    console.log('Fetching JSON...');
    const res = await fetch(JSON_URL);
    if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
    const json = await res.json();

    console.log('Normalizing...');
    const streams = normalizeStreams(json);

    console.log('Grouping...');
    const grouped = groupMatches(streams);

    console.log(`Saving ${grouped.length} matches to ${OUTPUT_FILE}...`);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(grouped, null, 2));
    console.log('Done.');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
