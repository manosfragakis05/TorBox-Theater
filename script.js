import { art, playDirect, clearPlayerInstance, stopPlayback } from './player.js';
import { getPosterForLibrary, TMDB_KEY } from './api.js';
import { parseMediaData } from './parseMedia.js';

let allTorrents = [];
let currentTorrentId = null;
let clickCooldown = false;

export const TRAKT_CLIENT_ID = '027c95542a22d861d8a4e82b7535560b457639527f09b5526315682c611488c9';
// PASTE YOUR CLOUDFLARE URL BELOW (keep the /?url= at the end!)
export const MY_PROXY = "https://bt-kd-8478.manosfragakis05.workers.dev/?url=";


//#region Global functions

export const appState = {
    currentStreamUrl: "",
    clickCooldown: false
};

// Cloudflare Proxy
export async function smartFetch(targetUrl, options = {}) {
    return fetch(MY_PROXY + encodeURIComponent(targetUrl), options);
}

// GLOBAL NOTIFICATION UI
export function showToast(message, type = 'info') {
    const toast = document.createElement('div');

    // Set colors and icons based on the type
    let bgColors = "bg-blue-600 border-blue-500";
    let icon = 'ℹ️';

    if (type === 'success') {
        bgColors = "bg-emerald-700 border-emerald-500";
        icon = '✅';
    } else if (type === 'error') {
        bgColors = "bg-red-700 border-red-500";
        icon = '❌';
    }

    // Modern, sliding, premium UI
    toast.className = `fixed top-5 right-5 ${bgColors} text-white border p-4 rounded-xl shadow-2xl z-[9999] transition-all duration-300 transform translate-y-[-20px] opacity-0 flex items-center gap-3 backdrop-blur-md`;

    toast.innerHTML = `
        <span class="text-xl drop-shadow-md">${icon}</span> 
        <span class="text-sm font-bold tracking-wide leading-tight">${message}</span>
    `;

    document.body.appendChild(toast);

    // 1. Animate In
    requestAnimationFrame(() => {
        toast.classList.remove('translate-y-[-20px]', 'opacity-0');
        toast.classList.add('translate-y-0', 'opacity-100');
    });

    // 2. Wait 3 seconds, Animate Out, then Delete
    setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('translate-y-[-20px]', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

window.showToast = showToast;
//#endregion

//#region TorBox Auth
async function authenticateTorboxUser() {
    const input = document.getElementById('api-input');
    const button = document.getElementById('loggin-btn');
    const key = input.value.trim();

    if (!key) return showToast("Please enter an API key.", 'error');

    button.innerText = "Verifying...";
    button.disabled = true;
    input.disabled = true;

    try {
        const targetUrl = 'https://api.torbox.app/v1/api/user/me';
        const res = await smartFetch(targetUrl, {
            headers: { 'Authorization': `Bearer ${key}` }
        });

        const data = await res.json();

        if (data.success && data.data) {
            localStorage.setItem('tb_api_key', key);
            button.innerText = "Connected!";
            button.classList.replace('bg-blue-600', 'bg-green-600');

            setTimeout(() => {
                checkAuth();
            }, 800);

        } else {
            throw new Error(data.detail || "Invalid API Key");
        }

    } catch (e) {
        showToast("Authentication Failed: " + e.message, 'error');
        button.innerText = "Log In";
        button.disabled = false;
        input.disabled = false;
        input.classList.add('border-red-500');
    }
}

function checkAuth() {
    const key = localStorage.getItem('tb_api_key');
    const authScreen = document.getElementById('auth-screen');

    if (!key) {
        authScreen.classList.remove('hidden');
    } else {
        authScreen.classList.add('hidden');
        loadLibrary(key);
        //initTrakt();
    }
}

checkAuth();

function toggleProfile(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('profile-dropdown');
    menu.classList.toggle('hidden');
}

function logoutTorBox() {
    if (confirm("Disconnect TorBox API?")) {
        localStorage.removeItem('tb_api_key');
        location.reload();
    }
}

// 🏠 THE CLEANED UP GOHOME
export function goHome() {
    stopPlayback(); // 👈 Instantly kills everything

    document.getElementById('player-wrapper').classList.add('hidden');
    document.getElementById('search-input').value = '';

    window.location.reload();

    refreshLibrary();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --- LIBRARY ---
async function loadLibrary(key) {
    document.getElementById('loading').classList.remove('hidden');
    document.getElementById('file-list').innerHTML = '';

    try {
        const res = await smartFetch('https://api.torbox.app/v1/api/torrents/mylist?bypass_cache=true', {
            headers: { 'Authorization': `Bearer ${key}` }
        });
        const data = await res.json();
        document.getElementById('loading').classList.add('hidden');

        if (data.success) {
            allTorrents = data.data.filter(t => t.download_finished);
            renderList(allTorrents);
        } else {
            showToast("Error: " + data.detail, 'error');
        }
    } catch (e) { showToast("Network Error", 'error'); }
}

export function renderList(items) {
    const list = document.getElementById('file-list');
    list.innerHTML = '';

    if (items.length === 0) {
        document.getElementById('empty-state').classList.remove('hidden');
        return;
    }
    document.getElementById('empty-state').classList.add('hidden');

    const vault = JSON.parse(localStorage.getItem('tmdb_vault') || '{}');
    const itemsNeedsFetching = []; // 🧠 We will store items that need API calls here!

    // 1. INSTANT UI RENDER (Draw all cards immediately so the app feels fast)
    items.forEach((t) => {
        const vidCount = t.files.filter(f => f.name.match(/\.(mkv|mp4|avi|mov)$/i)).length;
        const isShow = vidCount > 1;

        const mediaInfo = parseMediaData(t.name);
        const cleanName = mediaInfo.title;
        const year = mediaInfo.year;

        const hash = (t.hash || "").toLowerCase();
        let vaultData = vault[hash];

        const card = document.createElement('div');
        card.className = "relative flex-col cursor-pointer transition-transform hover:scale-105 select-none group";

        card.innerHTML = `
            <div class="relative w-full aspect-[2/3] bg-slate-800 rounded-lg shadow-lg overflow-hidden border border-slate-700/50">
                
                <img id="img-${t.id}" src="" class="absolute inset-0 w-full h-full object-cover hidden" draggable="false">

                <div id="fallback-${t.id}" class="absolute inset-0 flex items-center justify-center p-4 text-center text-slate-500 font-bold text-sm bg-slate-800">
                    ${cleanName}
                </div>

                <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
                    <div class="flex justify-between items-center mb-1">
                        <span class="text-white font-bold text-xs truncate drop-shadow-md">${isShow ? '📺 Series' : '🎬 Movie'}</span>
                        <button onclick="event.stopPropagation(); deleteTorrent(${t.id}, event);" class="text-red-500 hover:text-red-400 p-1 bg-black/50 rounded-full transition z-10">🗑️</button>
                    </div>
                </div>
                
                <div class="absolute top-2 right-2 bg-blue-600/90 text-white text-[10px] font-bold px-2 py-1 rounded backdrop-blur shadow-lg">
                    ${(t.size / 1073741824).toFixed(1)} GB
                </div>
            </div>
            <p class="text-xs text-slate-300 mt-2 truncate font-semibold pl-1">${cleanName}</p>
        `;

        card.onclick = () => {
            if (clickCooldown) { showToast("Please wait a moment."); return; }
            clickCooldown = true; setTimeout(() => clickCooldown = false, 2000);

            if (isShow) openPicker(t, vaultData);
            else {
                const vid = t.files.find(f => f.name.match(/\.(mkv|mp4|avi|mov)$/i)) || t.files[0];
                import('./player.js').then(m => m.requestLink(t.id, vid.id, t.name, vid.name));
            }
        };

        list.appendChild(card);

        // INSTANT POSTER LOADING
        const imgElement = document.getElementById(`img-${t.id}`);
        const fallbackElement = document.getElementById(`fallback-${t.id}`);

        if (vaultData && vaultData.poster) {
            imgElement.src = vaultData.poster;
            imgElement.classList.remove('hidden');
            fallbackElement.classList.add('hidden');
        } else {
            // 🧠 Queue it for the Batch Fetcher instead of bombing the API!
            itemsNeedsFetching.push({ t, cleanName, year, hash, imgElement, fallbackElement });
        }
    });

    // 2. THE BATCH FETCHER (Safely loads 5 missing posters at a time)
    if (itemsNeedsFetching.length > 0) {
        const fetchInBatches = async () => {
            const BATCH_SIZE = 5;

            for (let i = 0; i < itemsNeedsFetching.length; i += BATCH_SIZE) {
                const batch = itemsNeedsFetching.slice(i, i + BATCH_SIZE);

                // Fire 5 requests in parallel
                await Promise.all(batch.map(async (item) => {
                    const fetchedData = await getPosterForLibrary(item.cleanName, item.year);
                    const finalPoster = typeof fetchedData === 'string' ? fetchedData : (fetchedData?.poster);

                    if (finalPoster) {
                        item.imgElement.src = finalPoster;
                        item.imgElement.classList.remove('hidden');
                        item.fallbackElement.classList.add('hidden');

                        if (typeof fetchedData === 'object' && fetchedData.id) {
                            let safeVault = JSON.parse(localStorage.getItem('tmdb_vault') || '{}');
                            safeVault[item.hash] = { id: fetchedData.id, type: fetchedData.type, poster: fetchedData.poster };
                            //TEMP UNOOOOOOO
                            //localStorage.setItem('tmdb_vault', JSON.stringify(safeVault));
                        }
                    }
                }));

                // Wait 250ms before firing the next 5 (The safety valve!)
                await new Promise(resolve => setTimeout(resolve, 250));
            }
        };
        fetchInBatches();
    }
}

function refreshLibrary() {
    const key = localStorage.getItem('tb_api_key');
    if (key) loadLibrary(key);
}

// --- THE TMDB CACHE ENGINE (On a Data Diet) ---
export async function getTmdbSeasonData(tmdbId, cleanName, seasonNum = 1) {
    try {
        let finalId = tmdbId;

        if (!finalId && cleanName) {
            const searchUrl = `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_KEY}&query=${encodeURIComponent(cleanName)}&page=1`;
            const searchRes = await fetch(searchUrl);
            const searchData = await searchRes.json();
            if (searchData.results && searchData.results.length > 0) finalId = searchData.results[0].id;
        }
        if (!finalId) return null;

        const cacheKey = `tmdb_season_${finalId}_s${seasonNum}`;
        const cachedPayload = localStorage.getItem(cacheKey);

        /*if (cachedPayload) {
            const parsedCache = JSON.parse(cachedPayload);
            if (Date.now() < parsedCache.expiresAt) {
                console.log(`⚡ Loaded S${seasonNum} instantly from Cache!`);
                return parsedCache.data;
            }
        }*/

        const seasonUrl = `https://api.themoviedb.org/3/tv/${finalId}/season/${seasonNum}?api_key=${TMDB_KEY}`;
        const seasonRes = await fetch(seasonUrl);
        const seasonData = await seasonRes.json();

        // 🧠 THE DATA DIET: Strip out the useless TMDB data to save 90% of LocalStorage space!
        const slimEpisodes = seasonData.episodes ? seasonData.episodes.map(ep => ({
            episode_number: ep.episode_number,
            name: ep.name,
            still_path: ep.still_path,
            runtime: ep.runtime,
            air_date: ep.air_date
        })) : [];

        let isOngoing = false;
        if (slimEpisodes.length > 0) {
            const lastEp = slimEpisodes[slimEpisodes.length - 1];
            if (!lastEp.air_date || new Date(lastEp.air_date).getTime() > Date.now()) isOngoing = true;
        }

        const expireTime = isOngoing ? (12 * 60 * 60 * 1000) : (30 * 24 * 60 * 60 * 1000);

        //localStorage.setItem(cacheKey, JSON.stringify({
        //    expiresAt: Date.now() + expireTime,
        //    data: { episodes: slimEpisodes }
        //}));

        console.log(`🌐 Fetched S${seasonNum} from TMDB! (Cached for ${isOngoing ? '12 Hours' : '30 Days'})`);
        return { episodes: slimEpisodes };

    } catch (error) {
        console.error("Network error fetching TMDB season pack:", error);
        return null;
    }
}

// --- THE KITSU CHAIN-LINK ENGINE ---
export async function buildKitsuGrid(initialKitsuId, maxEpisodes, mainShowTitle = "", maxExplicitSeason = 1) {
    console.log(`🕵️ Building Kitsu Grid (Live Fetching)...`);
    let grid = [];
    let currentId = initialKitsuId;
    let currentAbsoluteStart = 1;
    const visitedIds = new Set();

    try {
        while (currentId && (currentAbsoluteStart <= maxEpisodes || grid.length < maxExplicitSeason)) {

            if (visitedIds.has(currentId)) {
                console.warn(`🛑 Circular Kitsu link detected at ID ${currentId}! Breaking loop to prevent crash.`);
                break;
            }
            visitedIds.add(currentId);

            const url = `https://kitsu.io/api/edge/anime/${currentId}?include=mediaRelationships.destination`;
            const res = await fetch(url);
            const data = await res.json();

            const animeData = data.data;
            // 🚨 LOG 1: See what show we are currently looking at
            console.log(`[GRID] Looking at ID: ${currentId} | Title: ${animeData.attributes.canonicalTitle} | Type: ${animeData.attributes.subtype}`);
            const epCount = animeData.attributes.episodeCount || 100; // Cap ongoing shows so it doesn't loop forever

            // Add this season to our mathematical grid
            grid.push({
                kitsuId: currentId,
                start: currentAbsoluteStart,
                end: currentAbsoluteStart + epCount - 1,
                title: animeData.attributes.canonicalTitle // 🧠 NEW: Save the official Kitsu name!
            });

            currentAbsoluteStart += epCount;

            // 🧠 THE FIX: Find the TRUE next season (Skip recap movies and OVAs!)
            let sequelId = null;
            if (data.included) {
                const sequels = data.included.filter(inc => inc.type === 'mediaRelationships' && inc.attributes.role === 'sequel');

                // 🧠 THE SMART LINK PICKER: If Kitsu users messed up and added multiple sequels,
                // we collect them all and force them into chronological order!
                let validDestinations = [];

                for (let seq of sequels) {
                    if (seq.relationships?.destination?.data) {
                        const destData = seq.relationships.destination.data;

                        if (destData.type === 'anime') {
                            const destAnime = data.included.find(inc => inc.type === 'anime' && inc.id === destData.id);

                            if (destAnime && destAnime.attributes && ['TV', 'ONA', 'special'].includes(destAnime.attributes.subtype)) {
                                validDestinations.push(destAnime);
                            }
                        }
                    }
                }

                if (validDestinations.length > 0) {
                    // Sort them by start date (oldest first) so we never skip a season!
                    validDestinations.sort((a, b) => {
                        const dateA = new Date(a.attributes.startDate || '2099-01-01');
                        const dateB = new Date(b.attributes.startDate || '2099-01-01');
                        return dateA - dateB;
                    });

                    // Grab the TRUE next season
                    sequelId = validDestinations[0].id;
                }
            }

            // 2. THE FALLBACK (If the chain broke, but we still need more episodes/seasons!)
            if (!sequelId && (currentAbsoluteStart <= maxEpisodes || grid.length < maxExplicitSeason) && mainShowTitle) {
                const nextSeasonNum = grid.length + 1;
                console.log(`[GRID] ⚠️ Broken link detected! Attempting Hail Mary text search for Season ${nextSeasonNum}...`);

                // Try searching for "Show Name Season X"
                const searchUrl = `https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(mainShowTitle + ' Season ' + nextSeasonNum)}&page[limit]=3`;
                const searchRes = await fetch(searchUrl);
                const searchData = await searchRes.json();

                if (searchData.data && searchData.data.length > 0) {
                    // Safety Check: Must be TV/ONA and MUST air chronologically AFTER the current season
                    const currentStartDate = new Date(animeData.attributes.startDate || '2000-01-01');

                    const validHits = searchData.data.filter(hit => {
                        const hitDate = new Date(hit.attributes.startDate || '2099-01-01');
                        return ['TV', 'ONA'].includes(hit.attributes.subtype) && hitDate > currentStartDate;
                    });

                    if (validHits.length > 0) {
                        validHits.sort((a, b) => new Date(a.attributes.startDate) - new Date(b.attributes.startDate));
                        sequelId = validHits[0].id;
                        console.log(`[GRID] 🏈 Hail Mary Success! Forcibly linked ID ${sequelId} as Season ${nextSeasonNum}`);
                    }
                }
            }

            currentId = sequelId; // Move to the next link
        }

        console.log(`🌐 Built Live Kitsu Grid:`, grid);
        return grid;

    } catch (e) {
        console.warn("Failed to build Kitsu Grid", e);
        return null;
    }
}

// --- THE KITSU CACHE ENGINE (Now with Parallel Fetching!) ---
export async function getKitsuEpisodesCached(kitsuId) {
    const cacheKey = `kitsu_eps_${kitsuId}`;
    const cachedPayload = localStorage.getItem(cacheKey);

    /*if (cachedPayload) {
        const parsedCache = JSON.parse(cachedPayload);
        if (Date.now() < parsedCache.expiresAt) {
            console.log(`⚡ Loaded Kitsu Episodes instantly from Cache!`);
            return parsedCache.data;
        }
    }*/

    let allKitsuEpisodes = [];

    try {
        // 1. Fetch Page 1 to find out how many total episodes exist
        const firstRes = await fetch(`https://kitsu.io/api/edge/anime/${kitsuId}/episodes?page[limit]=20&page[offset]=0`);
        const firstData = await firstRes.json();

        if (firstData.data) {
            const slimFirst = firstData.data.map(ep => ({
                number: parseInt(ep.attributes.number),
                canonicalTitle: ep.attributes.canonicalTitle,
                thumbnail: ep.attributes.thumbnail ? ep.attributes.thumbnail.original : null,
                length: ep.attributes.length
            }));
            allKitsuEpisodes.push(...slimFirst);

            // 2. ⚡ PARALLEL FETCH: Fire the remaining pages safely in batches!
            const total = firstData.meta.count;

            if (total > 20) {
                // First, create a list of all the offsets we need to fetch
                const offsets = [];
                for (let offset = 20; offset < total; offset += 20) {
                    offsets.push(offset);
                }

                const BATCH_SIZE = 5; // Fetch 5 pages (100 episodes) at a time

                // Loop through our offsets in chunks of 5
                for (let i = 0; i < offsets.length; i += BATCH_SIZE) {
                    const batchOffsets = offsets.slice(i, i + BATCH_SIZE);

                    // Fire the 5 requests in parallel
                    const batchPromises = batchOffsets.map(offset =>
                        fetch(`https://kitsu.io/api/edge/anime/${kitsuId}/episodes?page[limit]=20&page[offset]=${offset}`).then(r => r.json())
                    );

                    const extraPages = await Promise.all(batchPromises);

                    // Process the results
                    extraPages.forEach(pageData => {
                        if (pageData.data) {
                            // Change this in both slim maps inside getKitsuEpisodesCached!
                            const slim = pageData.data.map(ep => ({
                                number: parseInt(ep.attributes.number),
                                canonicalTitle: ep.attributes.canonicalTitle || (ep.attributes.titles ? (ep.attributes.titles.en_us || ep.attributes.titles.en_jp || ep.attributes.titles.en) : null),
                                thumbnail: ep.attributes.thumbnail ? ep.attributes.thumbnail.original : null,
                                length: ep.attributes.length
                            }));
                            allKitsuEpisodes.push(...slim);
                        }
                    });

                    // 🛑 SAFETY VALVE: If there are more batches left, wait 250ms before firing again
                    if (i + BATCH_SIZE < offsets.length) {
                        await new Promise(resolve => setTimeout(resolve, 250));
                    }
                }
            }
        }

        const expireTime = 24 * 60 * 60 * 1000;
        //localStorage.setItem(cacheKey, JSON.stringify({ expiresAt: Date.now() + expireTime, data: allKitsuEpisodes }));

        console.log(`[KITSU CACHE] Fetched ${allKitsuEpisodes.length} episodes for Kitsu ID: ${kitsuId}. First episode number is:`, allKitsuEpisodes[0]?.number);

        console.log(`🌐 Fetched Kitsu in Parallel! (Cached for 24 Hours)`);
        return allKitsuEpisodes;

    } catch (e) {
        console.warn("Kitsu fetch failed", e);
        return null;
    }
}

// Episode Table with 2D Franchise Mapping & Kitsu Slicer
async function openPicker(torrent, vaultData) {
    const picker = document.getElementById('file-picker');
    const list = document.getElementById('picker-list');
    const title = document.getElementById('picker-title');

    const tmdbId = null; //vaultData ? vaultData.id : null;
    let initialKitsuId = null; //vaultData ? vaultData.kitsuId : null;

    picker.classList.remove('hidden');
    currentTorrentId = torrent.id;

    // 1. EXTRACT AND PARSE ALL FILES
    const videoFiles = torrent.files.filter(f => f.name.match(/\.(mkv|mp4|avi|mov)$/i));
    const baseInfo = parseMediaData(torrent.name);

    let maxAbsoluteEpisode = 0;
    let maxExplicitSeason = 1;

    videoFiles.forEach(file => {
        file.info = parseMediaData(file.name.split('/').pop(), baseInfo.title);
        if (file.info.episode > maxAbsoluteEpisode) maxAbsoluteEpisode = file.info.episode;
        if (file.info.season > maxExplicitSeason) maxExplicitSeason = file.info.season;
    });

    videoFiles.sort((a, b) => (a.info.episode || 0) - (b.info.episode || 0));

    let animeGrid = null;

    // 🧠 THE MISSING LINK: If the vault didn't have the Kitsu ID, fetch it right now!
    if (!initialKitsuId && maxAbsoluteEpisode > 0) {
        console.log("🕵️ Kitsu ID missing from vault! Fetching via text search...");
        try {
            const searchRes = await fetch(`https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(baseInfo.title)}&page[limit]=5`);
            const searchData = await searchRes.json();

            if (searchData.data && searchData.data.length > 0) {
                // 🧠 THE DYNAMIC FILTER: Let the files dictate what we look for!
                const isSingleFile = videoFiles.length === 1;
                let validHits = searchData.data;

                if (isSingleFile) {
                    validHits = searchData.data.filter(hit => ['movie', 'special', 'OVA'].includes(hit.attributes.subtype));
                } else {
                    validHits = searchData.data.filter(hit => ['TV', 'ONA'].includes(hit.attributes.subtype));
                }

                // 🛡️ Safety net: If our strict filter deleted everything, just use the raw search results
                if (validHits.length === 0) validHits = searchData.data;

                // 🛑 THE WESTERN MEDIA KILLSWITCH (The John Wick Fix)
                // Kitsu will aggressively hallucinate if it doesn't know a show. We must verify the names match!
                const searchWords = baseInfo.title.toLowerCase().split(/[\s\-:]+/).filter(w => w.length > 2); // Get words longer than 2 letters

                validHits = validHits.filter(hit => {
                    const titles = hit.attributes.titles || {};
                    const en = (titles.en || "").toLowerCase();
                    const romaji = (titles.en_jp || "").toLowerCase();
                    const canonical = (hit.attributes.canonicalTitle || "").toLowerCase();

                    // Does Kitsu's answer contain at least ONE meaningful word from our search?
                    return searchWords.some(w => en.includes(w) || romaji.includes(w) || canonical.includes(w));
                });

                if (validHits.length > 0) {
                    // Sort the surviving hits by date to guarantee we start at the beginning
                    const sortedHits = validHits.sort((a, b) => {
                        const dateA = new Date(a.attributes.startDate || '2099-01-01');
                        const dateB = new Date(b.attributes.startDate || '2099-01-01');
                        return dateA - dateB;
                    });

                    initialKitsuId = sortedHits[0].id;
                    console.log(`🎯 Smart Sort Success! Snagged ID: ${initialKitsuId}`);
                } else {
                    console.log(`🛑 Kitsu returned garbage for "${baseInfo.title}". Assuming Western Media!`);
                    initialKitsuId = null; // Kill the Kitsu pipeline entirely
                }
            } else {
                initialKitsuId = null;
            }
        } catch (e) { console.log("Text search failed."); }
    }


    const mainShowTitle = baseInfo.title.toLowerCase().trim();
    const titlesToVerify = new Set();

    // Now build the grid!
    if (initialKitsuId && maxAbsoluteEpisode > 0) {
        animeGrid = await buildKitsuGrid(initialKitsuId, maxAbsoluteEpisode, mainShowTitle, maxExplicitSeason);
    }

    // We will use this dictionary to translate fake names into the main name
    const titleTranslationMap = {};

    videoFiles.forEach(file => {
        const rawTitle = (file.info.title || mainShowTitle).toLowerCase().trim();

        const isSmall = file.size < 150 * 1024 * 1024;
        const isThemeMatch = file.name.match(/\b(ncop|nced|op|ed|opening|ending|creditless|theme)\b/i);
        const isExtra = isThemeMatch || (isSmall && !file.info.episode);

        // If it's NOT an extra, and it's a weird name we haven't seen yet, queue it up!
        if (!isExtra && rawTitle !== mainShowTitle) {
            titlesToVerify.add(rawTitle);
        }
    });

    const uniqueTitlesArray = Array.from(titlesToVerify);

    // ==========================================
    // 🛑 NEW STEP 2: KITSU VERIFICATION & MAPPING
    // ==========================================
    // Only run this if we found weird titles AND we successfully built a grid to check against
    if (uniqueTitlesArray.length > 0 && animeGrid) {
        console.log(`🕵️ Verifying ${uniqueTitlesArray.length} unique rogue titles against Kitsu...`);

        // Fire the checks in parallel so it doesn't slow down the UI
        await Promise.all(uniqueTitlesArray.map(async (rogueTitle) => {
            try {
                const searchRes = await fetch(`https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(rogueTitle)}&page[limit]=3`);
                const searchData = await searchRes.json();

                if (searchData.data && searchData.data.length > 0) {
                    // Check the top 3 hits just in case Kitsu's #1 result was a fuzzy match
                    for (let hit of searchData.data) {
                        const foundId = hit.id;

                        // DOES THIS ID EXIST IN OUR GRID?
                        const matchesGrid = animeGrid.some(g => g.kitsuId === foundId);

                        if (matchesGrid) {
                            // BINGO! Math proves this rogue title belongs to the main show.
                            // Put it in the dictionary so we can translate it later.
                            titleTranslationMap[rogueTitle] = mainShowTitle;
                            console.log(`🔗 Mapped rogue title: "${rogueTitle}" -> belongs to Main Show (Matched ID: ${foundId})`);
                            break; // We found the match, stop looking at other hits
                        }
                    }
                }
            } catch (e) {
                console.warn(`Failed to verify rogue title: ${rogueTitle}`);
            }
        }));
    }

    const franchiseMap = {};
    const mainShowLedger = {};

    // 🛡️ PASS 1: Secure the Main Show's Slots (Applying the Grid Math!)
    videoFiles.forEach(file => {
        let rawTitle = (file.info.title || mainShowTitle).toLowerCase().trim();

        // 🧠 THE MAGIC TRICK: If Kitsu verified this fake name, swap it for the real one!
        if (titleTranslationMap[rawTitle]) {
            rawTitle = titleTranslationMap[rawTitle];
        }

        let s = file.info.season != null ? file.info.season : 1;
        let epNum = file.info.episode;

        if (animeGrid && epNum) {
            let gridIndex = -1;

            // 1. If explicit season 2 or higher (S02E01), trust the file's season tag!
            if (file.info.season > 1) {
                gridIndex = file.info.season - 1;
            }
            // 2. If it defaulted to Season 1, use the Absolute Math to find its true home!
            else if (rawTitle === mainShowTitle) {
                gridIndex = animeGrid.findIndex(g => epNum >= g.start && epNum <= g.end);
                if (gridIndex !== -1) {
                    epNum = (epNum - animeGrid[gridIndex].start) + 1;
                }
            }
            if (gridIndex !== -1 && animeGrid[gridIndex]) s = gridIndex + 1;
        }

        // Secure it in the ledger if it matches the show OR had an explicit season
        if ((rawTitle === mainShowTitle || file.info.season) && epNum) {
            if (!mainShowLedger[s]) mainShowLedger[s] = new Set();
            mainShowLedger[s].add(epNum);
        }
    });

    // ⚓ PASS 2: Place the files, catch Movies, and detect Collisions!
    videoFiles.forEach(file => {
        const isSmall = file.size < 150 * 1024 * 1024;
        const isThemeMatch = file.name.match(/\b(ncop|nced|op|ed|opening|ending|creditless|theme)\b/i);
        const isExtra = isThemeMatch || (isSmall && !file.info.episode);

        let epNum = file.info.episode;
        let rawTitle = (file.info.title || mainShowTitle).toLowerCase().trim();

        // 🧠 THE MAGIC TRICK: Swap it in Pass 2 as well!
        if (titleTranslationMap[rawTitle]) {
            rawTitle = titleTranslationMap[rawTitle];
        }

        let s = isExtra ? 'extras' : (file.info.season != null ? file.info.season : 1);
        let showName = mainShowTitle;
        let targetKitsuId = initialKitsuId;
        let kitsuTitle = null;

        if (!isExtra) {
            // 🎬 MOVIES & SPECIALS CATCHER
            if (!epNum || file.info.isSpecial) {
                showName = "🎬 Movies & Specials";
                s = 'movies';
            }
            else {
                if (animeGrid) {
                    let gridIndex = -1;

                    if (file.info.season > 1) {
                        gridIndex = file.info.season - 1;
                    } else if (rawTitle === mainShowTitle) {
                        gridIndex = animeGrid.findIndex(g => epNum >= g.start && epNum <= g.end);
                        if (gridIndex !== -1) {
                            epNum = (epNum - animeGrid[gridIndex].start) + 1;
                        }
                    }

                    // Apply the Kitsu ID and Official Title!
                    if (gridIndex !== -1 && animeGrid[gridIndex]) {
                        s = gridIndex + 1;
                        targetKitsuId = animeGrid[gridIndex].kitsuId;
                        kitsuTitle = animeGrid[gridIndex].title;
                    }
                }

                // 💥 COLLISION DETECTOR
                if (rawTitle !== mainShowTitle) {
                    if (!mainShowLedger[s]) mainShowLedger[s] = new Set();
                    if (mainShowLedger[s].has(epNum)) showName = rawTitle;
                    else {
                        mainShowLedger[s].add(epNum);
                        showName = mainShowTitle;
                    }
                }
            }
        }

        // Save the translated math onto the file object so the renderer can use it!
        file.mappedEpisode = epNum;
        file.mappedKitsuId = targetKitsuId;
        file.kitsuTitle = kitsuTitle;

        // Build the 2D Map
        if (!franchiseMap[showName]) franchiseMap[showName] = {};
        if (!franchiseMap[showName][s]) franchiseMap[showName][s] = [];
        franchiseMap[showName][s].push({ file: file, info: file.info });
    });

    const uniqueShows = Object.keys(franchiseMap);
    const isMegaPack = uniqueShows.length > 1;

    // 🎯 Set initial state
    let currentShow = franchiseMap[mainShowTitle] ? mainShowTitle : uniqueShows.sort((a, b) => Object.values(franchiseMap[b]).flat().length - Object.values(franchiseMap[a]).flat().length)[0];

    const dynamicKitsuCache = {};
    dynamicKitsuCache[currentShow] = initialKitsuId;

    // 4. 📺 BUILD THE DYNAMIC UI HEADER
    let showSelectorHTML = '';
    if (isMegaPack) {
        showSelectorHTML = `
            <select id="library-show-select" class="bg-slate-800 text-sm font-bold text-fuchsia-400 border border-slate-600 rounded-lg p-1.5 outline-none cursor-pointer max-w-[150px] truncate shrink-0 shadow-lg">
                ${uniqueShows.map(show => `<option value="${show}" ${show === currentShow ? 'selected' : ''}>${show.replace(/\b\w/g, l => l.toUpperCase())}</option>`).join('')}
            </select>
        `;
    }

    const seasonContainer = document.createElement('div');
    seasonContainer.id = "season-dropdown-container";

    title.innerHTML = `
        <div class="flex items-center w-full gap-3 overflow-hidden">
            <span class="truncate flex-1 font-bold text-slate-200" title="${baseInfo.title}">${baseInfo.title}</span> 
            ${showSelectorHTML}
        </div>
    `;
    title.querySelector('.flex').appendChild(seasonContainer);

    // 5. THE RENDER FUNCTION
    const renderSeason = async (selectedShow, seasonNum) => {
        list.innerHTML = `
            <div class="col-span-full flex justify-center p-10">
                <svg class="animate-spin h-8 w-8 text-fuchsia-500" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
            </div>
        `;

        // 🛡️ Generate a unique ID for this specific render cycle
        const currentRenderToken = Date.now().toString();
        list.dataset.renderToken = currentRenderToken;

        let tmdbSeasonData = null;
        let kitsuEpisodes = null;
        let activeKitsuId = null;

        const showData = franchiseMap[selectedShow] || {};
        const filesToRender = seasonNum === 'raw' ? videoFiles.map(f => ({ file: f, info: f.info })) : (showData[seasonNum] || []);

        if (seasonNum !== 'raw' && seasonNum !== 'extras' && seasonNum !== 'movies') {
            try {
                // 1. Figure out the Kitsu ID for this specific season
                if (selectedShow === mainShowTitle && filesToRender.length > 0) {
                    activeKitsuId = filesToRender[0].file.mappedKitsuId;
                } else {
                    if (dynamicKitsuCache[selectedShow] === undefined) {
                        const searchRes = await fetch(`https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(selectedShow)}`);
                        const searchData = await searchRes.json();
                        dynamicKitsuCache[selectedShow] = (searchData.data && searchData.data.length > 0) ? searchData.data[0].id : null;
                    }
                    activeKitsuId = dynamicKitsuCache[selectedShow];
                }

                // 2. Fetch Kitsu Data
                if (activeKitsuId) {
                    kitsuEpisodes = await getKitsuEpisodesCached(activeKitsuId);
                }

                // 3. 🩹 THE TMDB VIBE CHECK
                // We consider Kitsu "trash" if it gave us nothing, or if the first episode is just lazily named "Episode 1" with no thumbnail.
                let kitsuIsTrash = false;
                if (kitsuEpisodes && kitsuEpisodes.length > 0) {
                    const firstEp = kitsuEpisodes[0];
                    if (!firstEp.thumbnail || (firstEp.canonicalTitle && firstEp.canonicalTitle.match(/^Episode \d+$/i))) {
                        kitsuIsTrash = true;
                    }
                } else {
                    kitsuIsTrash = true; // No Kitsu data at all
                }

                // 4. Fetch TMDB Backup if needed!
                if (kitsuIsTrash && tmdbId) {
                    console.log(`🩹 Kitsu dropped the ball on Season ${seasonNum}. Fetching TMDB backup...`);
                    tmdbSeasonData = await getTmdbSeasonData(tmdbId, mainShowTitle, seasonNum);
                } else if (!activeKitsuId) {
                    // Normal Western TV Show fallback
                    tmdbSeasonData = await getTmdbSeasonData(tmdbId, selectedShow, seasonNum);
                }

            } catch (e) { console.log("Failed to fetch episode data.", e); }
        }

        list.innerHTML = '';

        const libImg = document.getElementById(`img-${torrent.id}`);
        const fallbackPoster = libImg && !libImg.classList.contains('hidden') ? libImg.src : '';

        let accentColor = activeKitsuId ? 'fuchsia' : 'blue';
        if (seasonNum === 'raw' || seasonNum === 'movies') accentColor = 'amber';
        if (seasonNum === 'extras') accentColor = 'emerald';

        // 🧠 THE O(1) SPEED UP: Build Hash Maps before we start looping!
        const kitsuMap = {};
        if (kitsuEpisodes) kitsuEpisodes.forEach(ep => kitsuMap[ep.number] = ep);

        const tmdbMap = {};
        if (tmdbSeasonData && tmdbSeasonData.episodes) tmdbSeasonData.episodes.forEach(ep => tmdbMap[ep.episode_number] = ep);

        filesToRender.forEach(({ file, info }, index) => {
            const epNum = file.mappedEpisode || info.episode;

            let kEp = null;
            let tEp = null;
            let isMatchedByTMDB = false;

            const isRaw = seasonNum === 'raw' || seasonNum === 'extras' || seasonNum === 'movies';

            if (!isRaw) {
                // 🚀 INSTANT LOOKUP: Grab both if we have them!
                if (kitsuEpisodes && epNum) kEp = kitsuMap[epNum];
                if (tmdbSeasonData && epNum) {
                    tEp = tmdbMap[epNum];
                    if (tEp) isMatchedByTMDB = true;
                }
            }

            // 🧠 THE HYBRID FALLBACK ENGINE (Title)
            // Does Kitsu have a REAL title? (Not just "Episode 12")
            let hasGoodKitsuTitle = kEp && kEp.canonicalTitle && !kEp.canonicalTitle.match(/^Episode \d+$/i);

            const epName = isRaw ? file.name.split('/').pop() :
                (hasGoodKitsuTitle ? kEp.canonicalTitle :
                    (tEp && tEp.name ? tEp.name :
                        (kEp && kEp.canonicalTitle ? kEp.canonicalTitle : `Episode ${epNum || index + 1}`)));

            // 🧠 THE HYBRID FALLBACK ENGINE (Image)
            // TMDB High-Res > Kitsu Thumbnail > Fallback Poster
            let stillImage = fallbackPoster;
            if (!isRaw) {
                if (tEp && tEp.still_path) {
                    stillImage = `https://image.tmdb.org/t/p/w500${tEp.still_path}`;
                } else if (kEp && kEp.thumbnail) {
                    stillImage = kEp.thumbnail;
                }
            }

            // 🧠 THE HYBRID FALLBACK ENGINE (Runtime)
            const runtime = (!isRaw && tEp && tEp.runtime) ? tEp.runtime : (kEp ? kEp.length : null);
            const fileSize = (file.size / 1073741824).toFixed(2) + ' GB';

            const card = document.createElement('div');
            const cardId = `card-${torrent.id}-${seasonNum}-${index}`;

            // 🧠 SMART LABELING: Give Extras and Raw files proper numbered titles!
            let topLabel = `E${epNum || index + 1}`;
            if (seasonNum === 'extras') topLabel = `Intro / Outro ${index + 1}`;
            else if (seasonNum === 'raw') topLabel = `Raw File ${index + 1}`;
            else if (seasonNum === 'movies') topLabel = file.info.isSpecial ? `⭐ OVA` : `🎬 Movie`;

            card.className = `episode-card h-full relative flex flex-col w-full rounded-xl border-2 border-slate-700 bg-slate-800/80 overflow-hidden cursor-pointer transition-all hover:border-${accentColor}-500 hover:shadow-[0_0_15px_rgba(${activeKitsuId ? '217,70,239' : '59,130,246'},0.2)] group select-none`;

            card.innerHTML = `
                <div class="relative aspect-video bg-slate-900 w-full flex-shrink-0 border-b border-slate-700/50">
                    <img id="img-${cardId}" src="${stillImage}" draggable="false" class="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" loading="lazy">
                    
                    <div class="absolute inset-0 flex items-center justify-center">
                        <div class="w-12 h-12 rounded-full bg-${accentColor}-600/90 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all transform scale-75 group-hover:scale-100 shadow-[0_0_20px_rgba(37,99,235,0.4)] backdrop-blur-sm">
                            <svg class="w-6 h-6 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                        </div>
                    </div>

                    <div class="absolute bottom-2 right-2 bg-black/85 px-2 py-1 rounded text-[11px] text-white font-bold flex gap-2.5 backdrop-blur-md shadow-lg border border-white/10">
                        <span id="runtime-${cardId}" class="opacity-90 ${runtime ? '' : 'hidden'}">${runtime ? runtime + 'm' : ''}</span>
                        <span class="text-${accentColor}-400">${fileSize}</span>
                    </div>
                </div>
                
                <div class="p-3.5 flex-1 flex flex-col justify-center gap-1">
                    <p id="label-${cardId}" class="text-sm text-${accentColor}-400 font-extrabold tracking-wide">${topLabel}</p>
                    <p id="title-${cardId}" class="text-xs text-slate-200 line-clamp-2 leading-relaxed group-hover:text-white transition-colors" title="${file.name}">${epName}</p>
                </div>
            `;

            card.onclick = () => {
                if (clickCooldown) return;
                clickCooldown = true; setTimeout(() => clickCooldown = false, 2000);
                closePicker();
                import('./player.js').then(m => m.requestLink(torrent.id, file.id, torrent.name, file.name));
            };

            list.appendChild(card);

            // 🎬 🧠 THE MOVIE LAZY LOADER! (Now with Waterfall Anti-Spam)
            if (seasonNum === 'movies') {
                const cleanQuery = file.name.replace(/\.(mkv|mp4|avi)$/i, '').replace(/\[.*?\]|\(.*?\)/g, '').replace(/_/g, ' ').trim();

                setTimeout(() => {
                    if (list.dataset.renderToken !== currentRenderToken) return;

                    fetch(`https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(cleanQuery)}&page[limit]=1`)
                        .then(r => r.json())
                        .then(data => {
                            if (list.dataset.renderToken !== currentRenderToken) return;

                            if (data.data && data.data.length > 0) {
                                const hit = data.data[0].attributes;
                                const imgEl = document.getElementById(`img-${cardId}`);
                                const titleEl = document.getElementById(`title-${cardId}`);
                                const labelEl = document.getElementById(`label-${cardId}`);
                                const runtimeEl = document.getElementById(`runtime-${cardId}`);

                                // Prefer horizontal backgrounds, but fallback to posters!
                                const bestImage = hit.coverImage ? hit.coverImage.original : (hit.posterImage ? hit.posterImage.large : null);

                                if (imgEl && bestImage) imgEl.src = bestImage;
                                if (titleEl) titleEl.innerText = hit.canonicalTitle || hit.titles.en_jp;

                                // Inject the runtime and un-hide it
                                if (runtimeEl && hit.episodeLength) {
                                    runtimeEl.innerText = `${hit.episodeLength}m`;
                                    runtimeEl.classList.remove('hidden');
                                }

                                // Smart Badge Logic
                                if (labelEl) {
                                    let badge = '⭐ Special';
                                    if (hit.subtype === 'movie') badge = '🎬 Movie';
                                    else if (hit.subtype === 'OVA' || file.info.isSpecial) badge = '⭐ OVA';
                                    labelEl.innerText = badge;
                                }
                            }
                        }).catch(e => console.log("Movie metadata fetch failed"));
                }, index * 250);
            }
        });
    };

    // 6. ⚙️ THE UI ENGINE
    const updateSeasonDropdown = (selectedShow) => {
        const showData = franchiseMap[selectedShow];
        const numericSeasons = Object.keys(showData).filter(k => k !== 'extras' && k !== 'raw' && k !== 'movies').map(Number).sort((a, b) => a - b);

        let defaultSeason = 'raw';
        if (numericSeasons.includes(1)) defaultSeason = 1;
        else if (numericSeasons.length > 0) defaultSeason = numericSeasons[0];
        else if (showData['movies']) defaultSeason = 'movies';
        else if (showData['extras']) defaultSeason = 'extras';

        seasonContainer.innerHTML = `
            <select id="library-season-select" class="bg-slate-800 text-sm font-bold text-blue-400 border border-slate-600 rounded-lg p-1.5 outline-none cursor-pointer max-w-[120px] md:max-w-[200px] truncate shrink-0">
                ${numericSeasons.map(s => {
            // 🧠 NEW: Grab the official name we saved, or fallback to "Season X"
            const officialName = showData[s][0]?.file?.kitsuTitle;
            const displayName = officialName ? officialName : `Season ${s}`;
            return `<option value="${s}">${displayName}</option>`;
        }).join('')}
                ${showData['movies'] ? `<option value="movies" class="bg-slate-900 text-amber-400">🎬 Movies</option>` : ''}
                ${showData['extras'] ? `<option value="extras" class="bg-slate-900 text-emerald-400">🎵 Extras</option>` : ''}
                <option value="raw" class="bg-slate-900 text-amber-400">⚠️ All Files (Raw)</option>
            </select>
        `;

        document.getElementById('library-season-select').addEventListener('change', (e) => {
            const val = e.target.value;
            renderSeason(selectedShow, (val === 'raw' || val === 'extras' || val === 'movies') ? val : parseInt(val));
        });

        renderSeason(selectedShow, defaultSeason);
    };

    if (isMegaPack) {
        document.getElementById('library-show-select').addEventListener('change', (e) => {
            currentShow = e.target.value;
            updateSeasonDropdown(currentShow);
        });
    }

    updateSeasonDropdown(currentShow);
}

function closePicker() {
    document.getElementById('file-picker').classList.add('hidden');
}

export async function scrobble(action, movieName, progress) {
    const token = localStorage.getItem('trakt_token');
    if (!token) return;

    const body = {
        movie: { title: movieName },
        progress: progress || 0,
        app_version: "1.0"
    };

    const endpoint = action === 'stop' ? 'scrobble/stop' : 'scrobble/start';

    try {
        await smartFetch(`https://api.trakt.tv/${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'trakt-api-version': '2',
                'trakt-api-key': TRAKT_CLIENT_ID
            },
            body: JSON.stringify(body)
        });
    } catch (e) { console.log("Trakt Error", e); }
}

// --- DEVICE (GHOST) LIBRARY LOGIC ---
let expectedLocalFile = null;

window.triggerLocalFilePicker = function (expectedName = null, expectedSize = null) {
    if (expectedName) {
        expectedLocalFile = { name: expectedName, size: expectedSize };
        showToast(`Please re-select: ${expectedName}`, 'info');
    } else {
        expectedLocalFile = null;
    }
    document.getElementById('local-file-input').click();
};

window.processLocalFile = async function (event) {
    const file = event.target.files[0];
    if (!file) return;

    event.target.value = '';

    if (expectedLocalFile) {
        if (file.name !== expectedLocalFile.name || file.size !== expectedLocalFile.size) {
            showToast(`Incorrect file! Expected: ${expectedLocalFile.name}`, 'error');
            return;
        }
    }

    const localVault = JSON.parse(localStorage.getItem('local_ghost_vault') || '{}');

    if (!localVault[file.name]) {
        showToast("Adding to library...", "info");
        const parsedData = parseMediaData(file.name);

        let posterUrl = '';
        try {
            const tmdbData = await import('./api.js').then(m => m.getPosterForLibrary(parsedData.title, parsedData.year));
            posterUrl = typeof tmdbData === 'string' ? tmdbData : (tmdbData?.poster || '');
        } catch (e) { console.warn("Could not fetch poster for local file."); }

        localVault[file.name] = {
            name: file.name,
            size: file.size,
            cleanTitle: parsedData.title,
            poster: posterUrl,
            lastPlayed: Date.now()
        };
        localStorage.setItem('local_ghost_vault', JSON.stringify(localVault));
        renderLocalLibrary();
    } else {
        localVault[file.name].lastPlayed = Date.now();
        localStorage.setItem('local_ghost_vault', JSON.stringify(localVault));
    }

    const fileBlobUrl = URL.createObjectURL(file);

    import('./player.js').then(m => {
        m.startPlayer(fileBlobUrl, file.name);
    });
};

window.renderLocalLibrary = function () {
    const localVault = JSON.parse(localStorage.getItem('local_ghost_vault') || '{}');
    const files = Object.values(localVault).sort((a, b) => b.lastPlayed - a.lastPlayed);

    const list = document.getElementById('local-file-list');
    const emptyState = document.getElementById('local-empty-state');

    if (!list || !emptyState) return;

    list.innerHTML = '';

    if (files.length === 0) {
        emptyState.classList.remove('hidden');
        return;
    }
    emptyState.classList.add('hidden');

    files.forEach(fileData => {
        const card = document.createElement('div');
        card.className = "relative flex-col cursor-pointer transition-transform hover:scale-105 select-none group";

        const fallbackInitials = fileData.cleanTitle.substring(0, 2).toUpperCase();

        card.innerHTML = `
            <div class="relative w-full aspect-[2/3] bg-slate-800 rounded-lg shadow-lg overflow-hidden border border-slate-700/50">
                ${fileData.poster
                ? `<img src="${fileData.poster}" class="absolute inset-0 w-full h-full object-cover">`
                : `<div class="absolute inset-0 flex items-center justify-center p-4 text-center text-slate-500 font-bold text-2xl bg-slate-800">${fallbackInitials}</div>`
            }
                
                <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-center items-center pb-4">
                    <div class="w-12 h-12 bg-emerald-500/90 rounded-full flex items-center justify-center text-white shadow-lg backdrop-blur-sm transform scale-75 group-hover:scale-100 transition-all">
                        <svg class="w-6 h-6 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    </div>
                    <span class="text-white text-[10px] font-bold mt-2 uppercase tracking-widest text-center px-2">Tap to re-link<br>and play</span>
                </div>
                
                <button onclick="event.stopPropagation(); deleteLocalGhost('${fileData.name}')" class="absolute top-2 right-2 text-white bg-black/60 hover:bg-red-600 p-1.5 rounded-full transition opacity-0 group-hover:opacity-100 backdrop-blur-sm">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>
            <p class="text-xs text-slate-300 mt-2 truncate font-semibold pl-1">${fileData.cleanTitle}</p>
        `;

        card.onclick = () => window.triggerLocalFilePicker(fileData.name, fileData.size);
        list.appendChild(card);
    });
};

window.deleteLocalGhost = function (fileName) {
    if (!confirm("Remove this from your device library? (The actual file will NOT be deleted from your device).")) return;

    const localVault = JSON.parse(localStorage.getItem('local_ghost_vault') || '{}');
    delete localVault[fileName];
    localStorage.setItem('local_ghost_vault', JSON.stringify(localVault));
    renderLocalLibrary();
};

window.renderLocalLibrary();

//#region Search
let searchTimeout = null;

export function handleSearch() {
    const query = document.getElementById('search-input').value.toLowerCase().trim();

    if (query.startsWith('http') || query.startsWith('magnet:')) {
        document.getElementById('global-search-results').classList.add('hidden');
        return;
    }

    const filtered = allTorrents.filter(t => t.name.toLowerCase().includes(query));
    renderList(filtered);

    clearTimeout(searchTimeout);

    if (query.length >= 3) {
        // Switch to the 1-second (1000ms) delay
        searchTimeout = setTimeout(() => {
            // Auto-switch to the discover tab for the best viewing experience!
            showDiscoverTab();
            import('./api.js').then(module => module.searchTMDB(query));
        }, 1000);
    } else {
        document.getElementById('global-search-results').classList.add('hidden');
    }
}

function handleSearchSubmit() {
    const query = document.getElementById('search-input').value.trim();
    const inputField = document.getElementById('search-input');

    if (query.startsWith('http://') || query.startsWith('https://')) {
        inputField.blur();
        startPlayer(query, "Direct Stream"); // Using the imported function
        return;
    }

    if (query.startsWith('magnet:')) {
        inputField.blur();
        if (typeof addMagnetToTorBox === 'function') {
            addMagnetToTorBox(query, (err, res) => {
                if (!err) {
                    showToast(`Added: ${res.name}`, 'success');
                    inputField.value = "";
                    refreshLibrary();
                }
            });
        } else {
            showToast("Magnet adding function not implemented yet.");
        }
        return;
    }

    inputField.blur();
}

// --- DELETE TORRENT ---
async function deleteTorrent(torrentId, event) {
    if (event) event.stopPropagation();
    if (!confirm("Are you sure you want to delete this from TorBox?")) return;

    const key = localStorage.getItem('tb_api_key');
    const targetUrl = 'https://api.torbox.app/v1/api/torrents/controltorrent';

    try {
        const res = await smartFetch(targetUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                torrent_id: torrentId,
                operation: "delete"
            })
        });

        const data = await res.json();

        if (data.success) {
            showToast("Deleted successfully!", 'success');
            refreshLibrary();
        } else {
            showToast("Error: " + data.detail, 'error');
        }
    } catch (e) {
        console.error("Delete Error:", e);
        showToast("Failed to delete torrent.", 'error');
    }
}

// --- TAB NAVIGATION UI ---
export function showLibraryTab() {
    // 1. Swap the content
    document.getElementById('discover-tab').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');

    // 2. Light up the Library button (Blue)
    const libBtn = document.getElementById('tab-library');
    libBtn.className = "flex-1 py-2.5 rounded-lg bg-blue-600 text-white font-bold text-sm shadow transition-all";

    // 3. Dim the Discover button (Gray)
    const discBtn = document.getElementById('tab-discover');
    discBtn.className = "flex-1 py-2.5 rounded-lg text-slate-400 font-bold text-sm hover:text-white hover:bg-slate-700/50 transition-all";
}

export function showDiscoverTab() {
    // 1. Swap the content
    document.getElementById('dashboard').classList.add('hidden');
    document.getElementById('discover-tab').classList.remove('hidden');

    // 2. Light up the Discover button (Blue)
    const discBtn = document.getElementById('tab-discover');
    discBtn.className = "flex-1 py-2.5 rounded-lg bg-blue-600 text-white font-bold text-sm shadow transition-all";

    // 3. Dim the Library button (Gray)
    const libBtn = document.getElementById('tab-library');
    libBtn.className = "flex-1 py-2.5 rounded-lg text-slate-400 font-bold text-sm hover:text-white hover:bg-slate-700/50 transition-all";

    // Only fetch from the API if the grid is empty!
    if (document.getElementById('trending-row').innerHTML.trim() === '') {
        import('./api.js').then(module => module.loadDiscover());
    }
}

// Attach to the window object so your HTML buttons can trigger them
window.showLibraryTab = showLibraryTab;
window.showDiscoverTab = showDiscoverTab;

// Close dropdown when clicking outside
window.onclick = function (event) {
    if (!event.target.closest('.w-10') && !event.target.closest('#profile-dropdown')) {
        document.getElementById('profile-dropdown').classList.add('hidden');
    }
}

window.toggleSetupLayer = () => {
    const layer = document.getElementById('setup-layer');
    layer.classList.toggle('hidden');

    // Prevent background scrolling when open
    if (!layer.classList.contains('hidden')) {
        document.body.style.overflow = 'hidden';
    } else {
        document.body.style.overflow = '';
    }
};

// Global variable to hold the active stream URL
appState.currentStreamUrl = "";

function openExternalPlayer(player) {
    const videoUrl = appState.currentStreamUrl;

    if (!videoUrl) {
        showToast("No video stream selected yet.", "error");
        return;
    }

    const encodedUrl = encodeURIComponent(videoUrl);
    let deepLink = '';

    switch (player) {
        case 'vlc':
            deepLink = videoUrl.replace(/^https?:\/\//i, 'vlc://');
            break;

        case 'infuse':
            deepLink = `infuse://x-callback-url/play?url=${encodedUrl}`;
            break;

        case 'outplayer':
            deepLink = `outplayer://${encodedUrl}`;
            break;

        case 'mxplayer':
            deepLink = `intent:${videoUrl}#Intent;package=com.mxtech.videoplayer.ad;S.title=${encodeURIComponent("TorBox Stream")};end`;
            break;

        case 'iina':
            deepLink = `iina://weblink?url=${encodedUrl}`;
            break;
    }

    // Hide the modal
    document.getElementById('external-player-modal').classList.add('hidden');

    // Trigger the OS app
    window.location.href = deepLink;
}

// -------------------------------------------------------------
// --- GLOBAL EXPORTS  ---
// -------------------------------------------------------------
window.authenticateTorboxUser = authenticateTorboxUser;
window.playDirect = playDirect;
window.goHome = goHome;
window.handleSearch = handleSearch;
window.handleSearchSubmit = handleSearchSubmit;
window.toggleProfile = toggleProfile;
window.logoutTorBox = logoutTorBox;
window.closePicker = closePicker;
window.deleteTorrent = deleteTorrent;
window.openExternalPlayer = openExternalPlayer;