import { art, requestLink, startPlayer, playDirect, clearPlayerInstance } from './player.js';
import { loadDiscover } from './api.js';
import { getPosterForLibrary } from './api.js';

let allTorrents = [];
let currentTorrentId = null;

export const TRAKT_CLIENT_ID = '027c95542a22d861d8a4e82b7535560b457639527f09b5526315682c611488c9';
// PASTE YOUR CLOUDFLARE URL BELOW (keep the /?url= at the end!)
export const MY_PROXY = "https://bt-kd-8478.manosfragakis05.workers.dev/?url=";

// --- THE CLOUDFLARE TUNNEL ---
export async function smartFetch(targetUrl, options = {}) {
    return fetch(MY_PROXY + encodeURIComponent(targetUrl), options);
}

// --- AUTH & PROFILE ---
function isLoggedIn() {
    return !!localStorage.getItem('tb_api_key');
}

async function authenticateTorboxUser() {
    const input = document.getElementById('api-input');
    const button = document.getElementById('loggin-btn');
    const key = input.value.trim();

    if (!key) return alert("Please enter an API key.");

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
        alert("Authentication Failed: " + e.message);
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
        initTrakt();
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

// --- NAVIGATION ---
function goHome() {
    // Stop the movie and hide the player safely
    if (art) {
        art.destroy();
        clearPlayerInstance(); // Used our new helper instead of art = null
    }
    document.getElementById('player-wrapper').classList.add('hidden');
    document.getElementById('search-input').value = '';

    // Show library again
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
            alert("Error: " + data.detail);
        }
    } catch (e) { alert("Network Error"); }
}

export function renderList(items) {
    const list = document.getElementById('file-list');
    list.innerHTML = '';

    if (items.length === 0) {
        document.getElementById('empty-state').classList.remove('hidden');
        return;
    }
    document.getElementById('empty-state').classList.add('hidden');

    items.forEach(async (t) => {
        const vidCount = t.files.filter(f => f.name.match(/\.(mkv|mp4|avi|mov)$/i)).length;
        const isShow = vidCount > 1;

        // 1. THE TORRENT TITLE CLEANER
        // Replace dots with spaces
        let cleanName = t.name.replace(/[\._]/g, ' '); 
        
        // Extract the year if it exists (e.g., 1999 or 2022)
        const yearMatch = cleanName.match(/\b(19\d{2}|20\d{2})\b/);
        const year = yearMatch ? yearMatch[0] : '';
        
        // Ruthlessly chop off everything from the year/resolution onwards
        // We added s\d{2}e\d{2} (which catches S03E06) and 'season' to the chop list!
        cleanName = cleanName.replace(/\b(s\d{2}e\d{2}|s\d{2}|season \d|episode \d|19\d{2}|20\d{2}|1080p|720p|2160p|4k|bluray|web-dl|webrip|hdrip|cam|ts|x264|x265|hevc|remux|h264|h265)\b.*$/i, '');
        cleanName = cleanName.replace(/[\(\)\[\]\-]/g, '').trim(); // Remove random brackets

        // 2. Build the visual card (Starts with a gray placeholder)
        const card = document.createElement('div');
        card.className = "relative flex-col cursor-pointer transition-transform hover:scale-105 select-none group";

        // We use a dark gradient overlay so the white text is always readable over the poster
        card.innerHTML = `
            <div class="relative w-full aspect-[2/3] bg-slate-800 rounded-lg shadow-lg overflow-hidden border border-slate-700/50">
                <img id="img-${t.id}" src="" class="absolute inset-0 w-full h-full object-cover hidden" draggable="false">
                
                <div id="fallback-${t.id}" class="absolute inset-0 flex items-center justify-center p-4 text-center text-slate-500 font-bold text-sm bg-slate-800">
                    ${cleanName}
                </div>

                <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
                    <div class="flex justify-between items-center mb-1">
                        <span class="text-white font-bold text-xs truncate drop-shadow-md">${isShow ? '📺 Series' : '🎬 Movie'}</span>
                        <button onclick="deleteTorrent(${t.id}, event)" class="text-red-500 hover:text-red-400 p-1 bg-black/50 rounded-full transition z-10">🗑️</button>
                    </div>
                </div>
                
                <div class="absolute top-2 right-2 bg-blue-600/90 text-white text-[10px] font-bold px-2 py-1 rounded backdrop-blur shadow-lg">
                    ${(t.size / 1073741824).toFixed(1)} GB
                </div>
            </div>
            <p class="text-xs text-slate-300 mt-2 truncate font-semibold pl-1">${cleanName}</p>
        `;

        card.onclick = () => {
            if (isShow) {
                openPicker(t);
            } else {
                const vid = t.files.find(f => f.name.match(/\.(mkv|mp4|avi|mov)$/i)) || t.files[0];
                import('./player.js').then(m => m.requestLink(t.id, vid.id, t.name, vid.name));
            }
        };
        
        list.appendChild(card);

        // 3. Silently fetch the poster in the background!
        const posterUrl = await getPosterForLibrary(cleanName, year);
        if (posterUrl) {
            const imgElement = document.getElementById(`img-${t.id}`);
            const fallbackElement = document.getElementById(`fallback-${t.id}`);
            
            imgElement.src = posterUrl;
            imgElement.classList.remove('hidden'); // Show the poster
            fallbackElement.classList.add('hidden'); // Hide the raw text
        }
    });
}

function refreshLibrary() {
    const key = localStorage.getItem('tb_api_key');
    if (key) loadLibrary(key);
}

// --- FILE PICKER ---
function openPicker(torrent) {
    const picker = document.getElementById('file-picker');
    const list = document.getElementById('picker-list');
    const title = document.getElementById('picker-title');

    title.innerText = torrent.name.substring(0, 30) + "...";
    list.innerHTML = '';
    currentTorrentId = torrent.id;

    const videoFiles = torrent.files.filter(f => f.name.match(/\.(mkv|mp4|avi|mov)$/i));
    videoFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    videoFiles.forEach(file => {
        const btn = document.createElement('button');
        btn.className = "w-full text-left p-3 rounded hover:bg-slate-700 border-b border-slate-700/50 truncate flex items-center gap-3";
        btn.innerHTML = `<span class="text-blue-400">▶</span><span class="text-sm text-slate-200">${file.name}</span>`;
        btn.onclick = () => {
            closePicker();
            requestLink(currentTorrentId, file.id, torrent.name, file.name); // Using the imported function
        };
        list.appendChild(btn);
    });
    picker.classList.remove('hidden');
}

function closePicker() {
    document.getElementById('file-picker').classList.add('hidden');
}

// --- TRAKT LOGIC ---
function initTrakt() {
    const btn = document.getElementById('trakt-action-btn');
    const dot = document.getElementById('trakt-status-dot');

    if (localStorage.getItem('trakt_token')) {
        btn.innerText = "Log out Trakt";
        btn.classList.add('text-red-400');
        dot.classList.remove('bg-red-500');
        dot.classList.add('bg-green-500');
    } else {
        btn.innerText = "Connect Trakt";
        btn.classList.remove('text-red-400');
        dot.classList.remove('bg-green-500');
        dot.classList.add('bg-red-500');
    }
}

async function handleTraktAuth() {
    if (localStorage.getItem('trakt_token')) {
        if (confirm("Log out of Trakt?")) {
            localStorage.removeItem('trakt_token');
            initTrakt();
            toggleProfile();
        }
        return;
    }

    const res = await smartFetch('https://api.trakt.tv/oauth/device/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: TRAKT_CLIENT_ID })
    });
    const data = await res.json();

    document.getElementById('trakt-modal').classList.remove('hidden');
    document.getElementById('trakt-code').innerText = data.user_code;
    toggleProfile();

    const interval = setInterval(async () => {
        const poll = await smartFetch('https://api.trakt.tv/oauth/device/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: data.device_code,
                client_id: TRAKT_CLIENT_ID,
                client_secret: 'YOUR_SECRET_NOT_NEEDED_FOR_DEVICE_FLOW'
            })
        });

        if (poll.status === 200) {
            const tokenData = await poll.json();
            localStorage.setItem('trakt_token', tokenData.access_token);
            clearInterval(interval);
            closeTraktModal();
            initTrakt();
            alert("Trakt Connected!");
        }
    }, data.interval * 1000);
}

function closeTraktModal() {
    document.getElementById('trakt-modal').classList.add('hidden');
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

// --- SEARCH ---
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
                    alert(`Added: ${res.name}`);
                    inputField.value = "";
                    refreshLibrary();
                }
            });
        } else {
            alert("Magnet adding function not implemented yet.");
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
            alert("Deleted successfully!");
            refreshLibrary();
        } else {
            alert("Error: " + data.detail);
        }
    } catch (e) {
        console.error("Delete Error:", e);
        alert("Failed to delete torrent.");
    }
}

// --- TAB NAVIGATION UI ---
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
window.handleTraktAuth = handleTraktAuth;
window.closeTraktModal = closeTraktModal;
window.closePicker = closePicker;
window.deleteTorrent = deleteTorrent;