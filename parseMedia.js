import { parse } from './ptt.js';

// ==========================================
// 1. THE TRAFFIC COP (Router) WITH DIAGNOSTICS
// ==========================================
export function parseMediaData(rawString, fallbackTitle = null, knownType = 'unknown') {
    //console.log(`\n🚦 --- TRAFFIC COP INTERCEPT ---`);
    //console.log(`📦 Inspecting File: "${rawString}"`);
    
    let mediaType = knownType;

    if (mediaType === 'unknown') {
        // Run all regex checks so we can log them
        const hasWesternSeason = /[sS]\d{1,2}[eE]\d{1,2}/.test(rawString);
        const hasWesternMovie = /\b(19|20)\d{2}\b[\.\s\[\-]*(1080p|720p|2160p|4k|bluray|web-dl)/i.test(rawString);
        
        const hasAnimeBrackets = /^\[.*?\]/.test(rawString.trim()); 
        const hasCrc32 = /\[[a-f0-9]{8}\]/i.test(rawString);       
        const hasAnimeVocab = /\b(ova|oad|ncop|nced|dual audio|bdrip)\b/i.test(rawString);

        //console.log(`🔎 Tripwire Check for: ${rawString}`);
        //console.log(`   - Western TV (S01E01)?    : ${hasWesternSeason}`);
        //console.log(`   - Western Movie (Year+Res): ${hasWesternMovie}`);
        //console.log(`   - Anime Brackets ([Group]): ${hasAnimeBrackets}`);
        //console.log(`   - Anime Hash (CRC32)?     : ${hasCrc32}`);
        //console.log(`   - Anime Vocab (OVA/NCED)? : ${hasAnimeVocab}`);

        if (hasWesternSeason || hasWesternMovie) {
            mediaType = 'western';
            //console.log(`🤠 DECISION: WESTERN (Matched Western Signatures)`);
        } else if (hasAnimeBrackets || hasCrc32 || hasAnimeVocab) {
            mediaType = 'anime';
            //console.log(`🌸 DECISION: ANIME (Matched Anime Signatures)`);
        } else {
            mediaType = 'western';
            //console.log(`🤷 DECISION: DEFAULT WESTERN (No strong signatures found)`);
        }
    } else {
        //console.log(`✅ DECISION: Pre-determined as "${mediaType}" by knownType parameter.`);
    }


    // Route traffic to the correct specialized parser
    if (mediaType === 'anime') {
        return parseAnime(rawString, fallbackTitle);
    } else {
        return parseWestern(rawString, fallbackTitle);
    }
}

// ==========================================
// 2. THE WESTERN PARSER (For TV & Movies)
// ==========================================
function parseWestern(rawString, fallbackTitle = null) {
    let cleanName = rawString;

    // 1. PRE-WASH: Western Quirks
    
    // Extract Year safely BEFORE stripping brackets (e.g., "The Batman [2022]")
    let yearMatch = cleanName.match(/[\(\[](\d{4})[\)\]]/);
    let year = yearMatch ? yearMatch[1] : null;

    // Fix Multi-Episode Dashes (Turns "S01E01-E03" into "S01E01-03" for PTT)
    cleanName = cleanName.replace(/([sS]\d{1,2}[eE]\d{1,2})\s*-\s*[eE]?(\d{1,2})/g, '$1-$2');

    // Extract Daily Show Dates (e.g., "The.Daily.Show.2023.10.24")
    const dateMatch = cleanName.match(/(\d{4})[\.\- ](\d{2})[\.\- ](\d{2})/);
    let airDate = null;
    if (dateMatch) {
        airDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
        // Wipe it so it doesn't get glued to the title
        cleanName = cleanName.replace(/(\d{4})[\.\- ](\d{2})[\.\- ](\d{2})/, '');
    }

    // Strip "Complete Series" or "Seasons 1-5" bulk tags
    cleanName = cleanName.replace(/\bcomplete\s*(series|season)?\b/ig, '');
    cleanName = cleanName.replace(/seasons?\s*\d+\s*-\s*\d+/ig, '');

    // Standardize spacing (Western uploaders use dots instead of spaces)
    cleanName = cleanName.replace(/[\._]/g, ' ').trim();

    // 2. FEED TO PTT
    const parsed = parse(cleanName);

    // 3. THE WESTERN POWER-WASHER
    let finalTitle = parsed.title || fallbackTitle || cleanName;
    
    // Aggressively kill anything after S01E01 (Stops junk from sticking to the title)
    finalTitle = finalTitle.replace(/(^|\s)[sS]\d+[eE]\d+.*$/i, '');
    
    // Kill stray trailing years if PTT missed them
    finalTitle = finalTitle.replace(/\s\d{4}$/, '');
    
    // Strip all remaining brackets
    finalTitle = finalTitle.replace(/[\(\[].*?[\)\]]/g, ''); 
    
    // Final trim
    finalTitle = finalTitle.replace(/[\s\-\.]+$/, '').trim();

    if (!finalTitle && fallbackTitle) finalTitle = fallbackTitle;

    // 4. SMART RETURN
    return {
        ...parsed,
        title: finalTitle,
        year: parsed.year || year || '',
        airDate: airDate, // Crucial for daily shows or sports!
        resolution: parsed.resolution || 'HD',
        isComplete: rawString.toLowerCase().includes('complete'),
        isSpecial: false,
        mediaType: 'western' // Handful for debugging!
    };
}

export function parseAnime(rawString, fallbackTitle = null) {
    // 1. EARLY FLAG DETECTION (Catch Extras before we mangle the string)
    const isOvaMatch = rawString.match(/\b(ova|oad|special)\b/i);
    const isThemeMatch = rawString.match(/\b(ncop|nced|op|ed|opening|ending|creditless|theme)\b/i);

    // 2. THE UNIVERSAL SPACER KILLER & BASIC CLEANUP
    let cleanName = rawString
        // Strip the 8-character CRC32 hash (e.g. [A1B2C3D4])
        .replace(/\s*\[[a-fA-F0-9]{8}\](?=\.\w{3,4}$|$)/g, '')
        // Strip extensions
        .replace(/\.(mkv|mp4|avi|mov)$/i, '')
        // 💥 THE SPACER KILLER: Normalize _-_, ~, _, etc., into a standard hyphen
        .replace(/[\s_]*[~_-]+[\s_]*/g, ' - ')
        // Replace stray periods with spaces (but leave decimal episodes like 12.5 alone)
        .replace(/(?<!\d)\.(?!\d)/g, ' ')
        .trim();

    // 3. THE ANIME REGEX GAUNTLET (Catching the terrible naming tropes)
    // Trope A: "2nd Season - 12" or "2 Season - 12"
    cleanName = cleanName.replace(/(\d+)(?:st|nd|rd|th)?\s*season\s*-\s*(\d+)(?:st|nd|rd|th|ep)?/ig, 'S$1E$2');

    // Trope B: "Season 2 - 12"
    cleanName = cleanName.replace(/season\s*(\d+)\s*-\s*(\d+)/ig, 'S$1E$2');

    // Trope C: "2nd Episode - Season 1" or "2ep - season1"
    cleanName = cleanName.replace(/(\d+)(?:st|nd|rd|th)?\s*ep(?:isode)?\s*-\s*(?:season|s)\s*(\d+)/ig, 'S$2E$1');

    // Trope D: "Season 1 - Episode 2"
    cleanName = cleanName.replace(/season\s*(\d+)\s*-\s*episode\s*(\d+)/ig, 'S$1E$2');

    // 4. THE EXPLICIT SEASON INJECTOR (For standard "Title - 01" files)
    // If the gauntlet above didn't inject an 'S', we check if there's a text season (e.g. "Title 2nd Season - 01")
    let explicitSeason = 1;
    const textSeasonMatch = cleanName.match(/(?:(\d+)(?:st|nd|rd|th)?\s+season|season\s+(\d+))/i);
    if (textSeasonMatch) {
        explicitSeason = parseInt(textSeasonMatch[1] || textSeasonMatch[2], 10);
    }
    
    // Inject the Season and Episode format for PTT
    let sString = explicitSeason < 10 ? '0' + explicitSeason : explicitSeason;
    
    // Convert " - 01" or " - 12.5" to " S01E01"
    cleanName = cleanName.replace(/\s-\s0*(\d{1,4}(?:\.\d)?)(v\d)?(\s|\[|\(|$)/i, ` S${sString}E$1$3`);
    // Convert " EP 01" to " S01E01"
    cleanName = cleanName.replace(/\b[eE][pP]?\s*0*(\d{1,4}(?:\.\d)?)(v\d)?(\s|\[|\(|$)/i, ` S${sString}E$1$3`);

    // 5. FEED TO PTT
    const parsed = parse(cleanName);

    // 6. THE TITLE POWER-WASHER (Cleaning up the mess for Kitsu)
    let finalTitle = parsed.title || fallbackTitle || cleanName;
    
    // Drop Release groups from the TITLE (but PTT might have saved them in parsed.group!)
    finalTitle = finalTitle.replace(/^\[.*?\]\s*/, '');
    finalTitle = finalTitle.split(/[\[\(]/)[0];

    // Strip textual season markers
    finalTitle = finalTitle.replace(/\d+(st|nd|rd|th)?\s+season/ig, '');
    finalTitle = finalTitle.replace(/season\s+\d+/ig, '');

    // Aggressively kill S01E01 and absolutely everything after it
    finalTitle = finalTitle.replace(/(^|\s)[sS]\d+[eE]\d+.*$/i, '');
    finalTitle = finalTitle.replace(/(^|\s)[eE]\d+.*$/i, ''); // Standalone E01 killer
    
    finalTitle = finalTitle.replace(/\b(ncop|nced|op|ed)\d*\b/ig, '');
    finalTitle = finalTitle.replace(/\s+-\s+\d+.*$/, '');
    finalTitle = finalTitle.replace(/[\s\-\.]+$/, '').trim();

    if (!finalTitle && fallbackTitle) finalTitle = fallbackTitle;

    // 7. RETURN THE PERFECTED OBJECT
    return {
        ...parsed,
        title: finalTitle,
        year: parsed.year || '',
        season: parsed.season || explicitSeason,
        episode: parsed.episode,
        resolution: parsed.resolution || 'HD',
        isComplete: rawString.toLowerCase().includes('complete') || rawString.toLowerCase().includes('batch'),
        isSpecial: !!isOvaMatch,
        isTheme: !!isThemeMatch // Pass this to the Collision Engine!
    };
}

