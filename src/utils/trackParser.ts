import type { ParsedTrackInfo, NormalizedTrackInfo } from '../types';

// Characters: - (hyphen U+002D), – (en dash U+2013), — (em dash U+2014), ― (horizontal bar U+2015)
const SEPARATOR_REGEX = /(\s+[\u002D\u2013\u2014\u2015]+\s+|[\u002D\u2013\u2014\u2015]{2,})/;
const INVALID_PATTERNS = [
    /^\s*$/,
    /^[\u002D\u2013\u2014\u2015]/,
    /[\u002D\u2013\u2014\u2015]$/,
    /(.)\1{4,}/,
    /[\u002D\u2013\u2014\u2015]{2,}/,
];

const hasInvalidPatterns = (text: string): boolean => INVALID_PATTERNS.some((p) => p.test(text));

export function parseSoundCloudTitle(title: string): ParsedTrackInfo {
    if (!title || typeof title !== 'string') {
        return { artist: null, track: '' };
    }

    const cleanTitle = title.split('\n')[0].trim();

    const match = cleanTitle.match(SEPARATOR_REGEX);
    if (match && match.index && match.index > 0) {
        const artist = cleanTitle.substring(0, match.index).trim();
        const track = cleanTitle.substring(match.index + match[0].length).trim();

        if (artist.length > 0 && track.length > 0 && !hasInvalidPatterns(artist) && !hasInvalidPatterns(track)) {
            return { artist, track };
        }
    }

    return {
        artist: null,
        track: cleanTitle,
    };
}

/** Трек и артист для заголовка окна и превью: без заглушек, артистом загрузчик, если название не делится */
export function trackParts(titleFromPage: string, authorFromPage: string, useTrackParser: boolean): { track: string; artist: string } {
    const name = titleFromPage.split('\n')[0].trim();
    const parsed = useTrackParser ? parseSoundCloudTitle(name) : { artist: null, track: name };
    return { track: parsed.track, artist: parsed.artist || authorFromPage.trim() };
}

/** Позиция и длительность в секундах; сайт иногда пишет вместо длительности остаток со знаком минус */
export function trackSeconds(elapsedText: string, durationText: string): { elapsed: number; duration: number } {
    const seconds = (value: string): number => {
        const parts = value.trim().replace(/^-/, '').split(':').map(Number);
        if (parts.some((part) => !Number.isFinite(part) || part < 0)) return 0;
        return parts.reduce((total, part) => total * 60 + part, 0) * (value.trim().startsWith('-') ? -1 : 1);
    };
    const elapsed = Math.max(0, seconds(elapsedText));
    const raw = seconds(durationText);
    return { elapsed, duration: raw < 0 ? elapsed - raw : raw };
}

export function formatClock(total: number): string {
    return Math.floor(total / 60) + ':' + String(Math.floor(total % 60)).padStart(2, '0');
}

export function normalizeTrackInfo(
    titleFromPage: string,
    authorFromPage: string,
    useTrackParser: boolean = true,
): NormalizedTrackInfo {
    if (!useTrackParser || !titleFromPage) {
        // Fallback to original behavior
        return {
            artist: authorFromPage || 'Unknown Artist',
            track: titleFromPage.split('\n')[0].trim() || 'Unknown Track',
        };
    }

    const parsed = parseSoundCloudTitle(titleFromPage);
    return {
        artist: parsed.artist || authorFromPage || 'Unknown Artist',
        track: parsed.track || 'Unknown Track',
    };
}

// Test function to validate regex parsing
/*
function testTrackParser() {
    const testCases = [
        "Artist Name - Song Title",              // hyphen with spaces
        "Artist Name -- Song Title",             // double hyphen with spaces
        "Artist Name — Song Title",              // em dash with spaces
        "Artist Name—Song Title",                // em dash without spaces
        "Just a Song Title",                     // no separator
        "- No Artist",                           // separator at start
        "No Song -",                             // separator at end
        "Her head is so0o0o0o0 rolling (POST-MORTEM MIX)",  // repeated characters (invalid)
        "FRONT DOOR ENTRY ONLY ---- until I cant feel a thing",  // 2+ separators without spaces (invalid)
        "a - b",                                 // short but valid
        "Valid Artist - Valid Track",            // valid parse
        "",                                      // empty string
        "Artist\nWith\nNewlines - Song Title"    // with newlines
    ];

    console.log("=== Track Parser Test Results ===");
    testCases.forEach((testCase, index) => {
        const result = parseSoundCloudTitle(testCase);
        console.log(`${index + 1}. "${testCase}"`);
        console.log(`   -> Artist: "${result.artist}", Track: "${result.track}"`);
        console.log("");
    });
}

testTrackParser();
*/
