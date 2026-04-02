import { parse } from 'https://cdn.jsdelivr.net/npm/parse-torrent-title@2.1.0/+esm';

import { art, startPlayer, playDirect, clearPlayerInstance } from './player.js';
import { getPosterForLibrary, TMDB_KEY } from './api.js';

let allTorrents = [];
let currentTorrentId = null;
let clickCooldown = false;

export const TRAKT_CLIENT_ID = '027c95542a22d861d8a4e82b7535560b457639527f09b5526315682c611488c9';
// PASTE YOUR CLOUDFLARE URL BELOW (keep the /?url= at the end!)
export const MY_PROXY = "https://bt-kd-8478.manosfragakis05.workers.dev/?url=";


//#region Global functions

// Cloudflare Proxy
export async function smartFetch(targetUrl, options = {}) {
    return fetch(MY_PROXY + encodeURIComponent(targetUrl), options);
}

// GLOBAL PTT CLEANER
export function parseMediaData(rawString) {
    // 0. THE IRONCLAD EXTRACTOR: Lock in the S/E numbers before PTT gets confused
    let explicitSeason = null;
    let explicitEpisode = null;
    const strictMatch = rawString.match(/[sS](\d{1,3})[\.\-\s]?[eE](\d{1,4})/i);
    if (strictMatch) {
        explicitSeason = parseInt(strictMatch[1], 10);
        explicitEpisode = parseInt(strictMatch[2], 10);
    }

    // 1. THE PRE-WASH: Nuke uploader tags, extensions, and weird characters
    let preWashed = rawString
        .replace(/^\[.*?\]\s*/g, '')  // Kills [SubsPlease], [Erai-raws], etc.
        .replace(/^\(.*?\)\s*/g, '')  // Kills leading parentheses 
        .replace(/^[^a-zA-Z0-9]+/g, '') // Kills leading dashes or punctuation
        .replace(/\.(mkv|mp4|avi|mov)$/i, '') // Kills file extensions
        .replace(/[\._]/g, ' ')       // Converts dots and underscores to spaces
        .trim();

    // 2. THE ANIME TRANSLATOR
    preWashed = preWashed.replace(/\s-\s0*(\d{1,4})(v\d)?(\s|\[|\(|$)/i, ' S01E$1$3');
    preWashed = preWashed.replace(/\b[eE][pP]?\s*0*(\d{1,4})(v\d)?(\s|\[|\(|$)/i, ' S01E$1$3');

    // 3. Feed it to PTT
    const parsed = parse(preWashed);

    // 4. THE TITLE POWER-WASHER
    let finalTitle = parsed.title || preWashed;
    finalTitle = finalTitle.split(/[\[\(]/)[0];
    finalTitle = finalTitle.replace(/\sS\d+E\d+.*$/i, '');
    finalTitle = finalTitle.replace(/\s+-\s+\d+.*$/, '');
    finalTitle = finalTitle.replace(/[\s\-\.]+$/, '').trim();

    // 5. SMART OVERRIDES (This fixes Mr. Robot!)
    let finalSeason = explicitSeason || parsed.season;
    let finalEpisode = explicitEpisode || parsed.episode;
    
    // Anime fallback
    if (finalEpisode && !finalSeason) {
        finalSeason = 1; 
    }

    return {
        ...parsed, 
        title: finalTitle,
        year: parsed.year || '',
        season: finalSeason,
        episode: finalEpisode,
        resolution: parsed.resolution || 'HD',
        isComplete: rawString.toLowerCase().includes('complete') || rawString.toLowerCase().includes('season')
    };
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

// UNIVERSAL MEDIA KILLER
export function stopPlayback() {
    // 1. Throw the Kill Switch
    window.abortPlayback = true;

    // 2. The Bulldozer
    try {
        if (typeof art !== 'undefined' && art) {
            if (art.mkvEngine && typeof art.mkvEngine.destroy === 'function') {
                console.log("🧨 Nuking MKV Engine...");
                art.mkvEngine.destroy();
                art.mkvEngine = null;
            }
            art.pause();
            art.destroy(true);
            clearPlayerInstance(); // Assuming this is imported/available!
        }
    } catch (e) {
        console.log("Player destruction bypassed or already dead.");
    }

    // 3. The DOM Nuke
    document.querySelectorAll('video, audio').forEach(media => {
        try {
            media.pause();
            media.removeAttribute('src');
            media.src = '';
            media.load();
            media.remove();
        } catch (e) { }
    });
}

// 🏠 THE CLEANED UP GOHOME
export function goHome() {
    stopPlayback(); // 👈 Instantly kills everything

    document.getElementById('player-wrapper').classList.add('hidden');
    document.getElementById('search-input').value = '';

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

    // 🛑 CRITICAL FIX 1: You must define and open the vault here!
    const vault = JSON.parse(localStorage.getItem('tmdb_vault') || '{}');

    items.forEach(async (t) => {
        const vidCount = t.files.filter(f => f.name.match(/\.(mkv|mp4|avi|mov)$/i)).length;
        const isShow = vidCount > 1;

        // Get clean info from PTT
        const mediaInfo = parseMediaData(t.name);
        const cleanName = mediaInfo.title;
        const year = mediaInfo.year;

        // Check Locally
        const hash = (t.hash || "").toLowerCase();
        let vaultData = vault[hash];

        // Build the visual card (Starts with a gray placeholder)
        const card = document.createElement('div');
        card.className = "relative flex-col cursor-pointer transition-transform hover:scale-105 select-none group";

        // 🛑 CRITICAL FIX 2: Added event.stopPropagation() to the delete button so it doesn't trigger playback!
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
            if (clickCooldown) {
                showToast("Please wait a moment.");
                return;
            }
            clickCooldown = true;
            setTimeout(() => clickCooldown = false, 2000);

            if (isShow) {
                openPicker(t, vaultData ? vaultData.id : null);
            } else {
                const vid = t.files.find(f => f.name.match(/\.(mkv|mp4|avi|mov)$/i)) || t.files[0];
                import('./player.js').then(m => m.requestLink(t.id, vid.id, t.name, vid.name));
            }
        };

        list.appendChild(card);

        // INSTANT POSTER LOADING
        const imgElement = document.getElementById(`img-${t.id}`);
        const fallbackElement = document.getElementById(`fallback-${t.id}`);

        if (vaultData && vaultData.poster) {
            // INSTANT LOAD: We already know the exact poster from when they clicked "Add"
            imgElement.src = vaultData.poster;
            imgElement.classList.remove('hidden');
            fallbackElement.classList.add('hidden');
        } else {
            // FALLBACK: Not in vault. Do the slow text search...
            const fetchedData = await getPosterForLibrary(cleanName, year);
            
            // Safely handle both string and object returns just in case api.js isn't updated yet!
            const finalPoster = typeof fetchedData === 'string' ? fetchedData : (fetchedData?.poster);

            if (finalPoster) {
                imgElement.src = finalPoster;
                imgElement.classList.remove('hidden');
                fallbackElement.classList.add('hidden');
                
                // 🧠 THE MISSING HYBRID MAGIC: Save it to the vault so we NEVER do this slow fetch again!
                if (typeof fetchedData === 'object' && fetchedData.id) {
                    vault[hash] = { 
                        id: fetchedData.id, 
                        type: fetchedData.type, 
                        poster: fetchedData.poster 
                    };
                    localStorage.setItem('tmdb_vault', JSON.stringify(vault));
                    
                    // Attach it to 'vaultData' right now so the Episode Picker can use it!
                    vaultData = vault[hash];
                }
            }
        }
    });
}

function refreshLibrary() {
    const key = localStorage.getItem('tb_api_key');
    if (key) loadLibrary(key);
}

// The correct names from TMDB
export async function getTmdbSeasonData(tmdbId, cleanName, seasonNum = 1) {
    try {
        let finalId = tmdbId;

        // 1. THE FALLBACK: If we don't have an ID, search TMDB using the clean name
        if (!finalId && cleanName) {
            const searchUrl = `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_KEY}&query=${encodeURIComponent(cleanName)}&page=1`;
            const searchRes = await fetch(searchUrl);
            const searchData = await searchRes.json();

            if (searchData.results && searchData.results.length > 0) {
                finalId = searchData.results[0].id;
            }
        }

        // 2. THE FAILSAFE: If the search found absolutely nothing, bail out safely
        if (!finalId) {
            console.warn(`TMDB Search failed to find an ID for: ${cleanName}`);
            return null; 
        }

        // 3. THE PAYLOAD: We have an ID! Go get the official Season Pack
        const seasonUrl = `https://api.themoviedb.org/3/tv/${finalId}/season/${seasonNum}?api_key=${TMDB_KEY}`;
        const seasonRes = await fetch(seasonUrl);
        const seasonData = await seasonRes.json();

        // This object contains the `.episodes` array with all the official names and image hashes!
        return seasonData;

    } catch (error) {
        console.error("Network error fetching TMDB season pack:", error);
        return null;
    }
}

// Episode Table
// 🛑 Make sure you add 'async' here!
async function openPicker(torrent, tmdbId) {
    const picker = document.getElementById('file-picker');
    const list = document.getElementById('picker-list');
    const title = document.getElementById('picker-title');

    title.innerText = torrent.name;
    picker.classList.remove('hidden');
    currentTorrentId = torrent.id;

    // 🌟 PREMIUM LOADING UI
    list.innerHTML = `
        <div class="flex items-center justify-center p-10 w-full text-slate-400">
            <svg class="animate-spin -ml-1 mr-3 h-8 w-8 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span class="font-bold tracking-wide">Fetching episodes...</span>
        </div>
    `;

    const videoFiles = torrent.files.filter(f => f.name.match(/\.(mkv|mp4|avi|mov)$/i));
    videoFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    const libImg = document.getElementById(`img-${torrent.id}`);
    const fallbackPoster = libImg && !libImg.classList.contains('hidden') ? libImg.src : '';

    // 🧠 1. GUESS THE SEASON FROM THE FIRST FILE
    let targetSeason = 1;
    let cleanTitle = torrent.name;

    if (videoFiles.length > 0) {
        const firstFileInfo = parseMediaData(videoFiles[0].name.split('/').pop());
        if (firstFileInfo.season) targetSeason = firstFileInfo.season;
        if (firstFileInfo.title) cleanTitle = firstFileInfo.title;
    }

    // 🧠 2. FETCH THE TMDB DATA FIRST!
    let tmdbSeasonData = null;
    try {
        tmdbSeasonData = await getTmdbSeasonData(tmdbId, cleanTitle, targetSeason);
    } catch (e) {
        console.log("Failed to fetch TMDB season data.");
    }

    list.innerHTML = ''; // Clear the loading spinner

    // 🧠 3. LOOP FILES & MATCH TO TMDB DATA
    videoFiles.forEach((file, index) => {
        const cleanFileName = file.name.split('/').pop();
        const fileInfo = parseMediaData(cleanFileName);
        const epNum = fileInfo.episode;
        
        // 🎯 THE MATCH: Find this specific episode in the TMDB payload
        let officialEp = null;
        if (tmdbSeasonData && tmdbSeasonData.episodes && epNum) {
            officialEp = tmdbSeasonData.episodes.find(e => e.episode_number === epNum);
        }

        // Determine Final Display Values
        const epName = officialEp?.name || `Episode ${epNum || index + 1}`;
        const stillImage = officialEp?.still_path ? `https://image.tmdb.org/t/p/w300${officialEp.still_path}` : fallbackPoster;
        const runtime = officialEp?.runtime ? `${officialEp.runtime}m` : '';
        const fileSize = (file.size / 1073741824).toFixed(2) + ' GB';

        const card = document.createElement('div');
        card.className = "episode-card shrink-0 h-full relative flex flex-col w-56 md:w-64 rounded-xl border-2 border-slate-700 bg-slate-800/80 overflow-hidden cursor-pointer transition-all hover:border-blue-500 hover:shadow-[0_0_15px_rgba(59,130,246,0.2)] group select-none";

        card.innerHTML = `
            <div class="relative aspect-video bg-slate-900 w-full flex-shrink-0 border-b border-slate-700/50">
                <img src="${stillImage}" draggable="false" class="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" loading="lazy">
                
                <div class="absolute inset-0 flex items-center justify-center">
                    <div class="w-12 h-12 rounded-full bg-blue-600/90 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all transform scale-75 group-hover:scale-100 shadow-[0_0_20px_rgba(37,99,235,0.4)] backdrop-blur-sm">
                        <svg class="w-6 h-6 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    </div>
                </div>

                <div class="absolute bottom-2 right-2 bg-black/85 px-2 py-1 rounded text-[11px] text-white font-bold flex gap-2.5 backdrop-blur-md shadow-lg border border-white/10">
                    ${runtime ? `<span class="opacity-90">${runtime}</span>` : ''}
                    <span class="text-blue-400">${fileSize}</span>
                </div>
            </div>
            
            <div class="p-3.5 flex-1 flex flex-col justify-center gap-1">
                <p class="text-sm text-blue-400 font-extrabold tracking-wide">E${epNum || index + 1}</p>
                <p class="text-xs text-slate-200 line-clamp-2 leading-relaxed group-hover:text-white transition-colors" title="${file.name}">${epName}</p>
            </div>
        `;

        card.onclick = () => {
            if (clickCooldown) return;
            clickCooldown = true;
            setTimeout(() => clickCooldown = false, 2000);

            closePicker();
            import('./player.js').then(m => m.requestLink(currentTorrentId, file.id, torrent.name, file.name));
        };

        list.appendChild(card);
    });
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
window.currentStreamUrl = ""; 

function openExternalPlayer(player) {
    const videoUrl = window.currentStreamUrl;

    if (!videoUrl) {
        showToast("No video stream selected yet.", "error");
        return;
    }

    const encodedUrl = encodeURIComponent(videoUrl);
    let deepLink = '';

    switch(player) {
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