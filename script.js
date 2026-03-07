let art = null;
let allTorrents = [];
let currentStreamUrl = "";
let currentTorrentId = null;

const TRAKT_CLIENT_ID = '027c95542a22d861d8a4e82b7535560b457639527f09b5526315682c611488c9';
// PASTE YOUR CLOUDFLARE URL BELOW (keep the /?url= at the end!)
const MY_PROXY = "https://torrent-proxy.manosfragakis05.workers.dev/?url=";

// --- THE CLOUDFLARE TUNNEL ---
async function smartFetch(targetUrl, options = {}) {
    // We encode the TorBox URL so it safely passes through the Cloudflare URL
    return fetch(MY_PROXY + encodeURIComponent(targetUrl), options);
}

// --- AUTH & PROFILE ---
function isLoggedIn() {
    return !!localStorage.getItem('tb_api_key'); 
}

async function authenticateTorboxUser()
{
    const input = document.getElementById('api-input');
    const button = document.getElementById('loggin-btn');
    const key = input.value.trim();

    if (!key) return alert("Please enter an API key.");

    button.innerText = "Verifying...";
    button.disabled = true;
    input.disabled = true;

    try {
        const targetUrl = 'https://api.torbox.app/v1/api/user/me';
        // USE SMARTFETCH HERE
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

function toggleProfile() {
    const menu = document.getElementById('profile-dropdown');
    menu.classList.toggle('hidden');
}

function logoutTorBox() {
    if (confirm("Disconnect TorBox API?")) {
        localStorage.removeItem('tb_api_key');
        location.reload();
    }
}

// --- LIBRARY ---
async function loadLibrary(key) {
    document.getElementById('loading').classList.remove('hidden');
    document.getElementById('file-list').innerHTML = '';

    try {
        // USE SMARTFETCH HERE
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

function renderList(items) {
    const list = document.getElementById('file-list');
    list.innerHTML = '';

    if (items.length === 0) {
        document.getElementById('empty-state').classList.remove('hidden');
        return;
    }
    document.getElementById('empty-state').classList.add('hidden');

    items.forEach(t => {
        const card = document.createElement('div');
        card.className = "movie-card bg-slate-800 p-4 rounded-xl border border-slate-700/50 cursor-pointer flex justify-between items-center";

        const vidCount = t.files.filter(f => f.name.match(/\.(mkv|mp4|avi|mov)$/i)).length;
        const label = vidCount > 1 ? `${vidCount} Episodes` : 'Movie';

        card.innerHTML = `
            <div class="overflow-hidden">
                <h3 class="font-bold text-slate-100 truncate pr-4">${t.name}</h3>
                <p class="text-xs text-slate-400">${(t.size / 1073741824).toFixed(2)} GB • ${label}</p>
            </div>
            <div class="flex items-center gap-3">
                <button onclick="deleteTorrent(${t.id}, event)" class="text-red-500 hover:bg-red-500/20 p-2 rounded-full transition-colors z-10">
                    🗑️
                </button>
                <div class="text-blue-500 bg-blue-500/10 p-2 rounded-full">
                    ${vidCount > 1 ? '☰' : '▶'}
                </div>
            </div>
        `;

        card.onclick = () => {
            if (vidCount > 1) {
                openPicker(t);
            } else {
                const vid = t.files.find(f => f.name.match(/\.(mkv|mp4|avi|mov)$/i)) || t.files[0];
                requestLink(t.id, vid.id, t.name, vid.name);
            }
        };
        list.appendChild(card);
    });
}

function refreshLibrary() {
    const key = localStorage.getItem('tb_api_key');
    loadLibrary(key);
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
            requestLink(currentTorrentId, file.id, torrent.name, file.name);
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

    // USE SMARTFETCH HERE
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
        // USE SMARTFETCH HERE
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

async function scrobble(action, movieName, progress) {
    const token = localStorage.getItem('trakt_token');
    if (!token) return;

    const body = {
        movie: { title: movieName },
        progress: progress || 0,
        app_version: "1.0"
    };

    const endpoint = action === 'stop' ? 'scrobble/stop' : 'scrobble/start';

    try {
        // USE SMARTFETCH HERE
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
function handleSearch() {
    const query = document.getElementById('search-input').value.toLowerCase().trim();

    if (query.startsWith('http') || query.startsWith('magnet:')) {
        return; 
    }

    const filtered = allTorrents.filter(t => t.name.toLowerCase().includes(query));
    renderList(filtered);
}

function handleSearchSubmit() {
    const query = document.getElementById('search-input').value.trim();
    const inputField = document.getElementById('search-input');

    if (query.startsWith('http://') || query.startsWith('https://')) {
        inputField.blur();
        startPlayer(query, "Direct Stream");
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

// --- PLAYER ---
async function requestLink(tid, fid, torrentName, fileName) {
    const key = localStorage.getItem('tb_api_key');
    const list = document.getElementById('file-list');
    list.style.opacity = '0.5';

    try {
        const targetUrl = `https://api.torbox.app/v1/api/torrents/requestdl?token=${key}&torrent_id=${tid}&file_id=${fid}&zip=false`;
        // USE SMARTFETCH HERE
        const res = await smartFetch(targetUrl);
        const data = await res.json();

        if (data.success) {
            startPlayer(data.data, fileName || torrentName);
        } else {
            alert("Link Error: " + data.detail);
        }
    } catch (e) {
        alert("Error requesting link.");
    } finally {
        list.style.opacity = '1';
    }
}

function startPlayer(url, name) {
    currentStreamUrl = url;
    document.getElementById('player-wrapper').classList.remove('hidden');

    if (art) art.destroy();

    // 1. Detect if the file is an MKV
    const isMkv = name.toLowerCase().endsWith('.mkv') || url.toLowerCase().split('?')[0].endsWith('.mkv');
    
    // 2. Detect if the user is on iOS (iPhone or iPad)
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    // 3. The Smart Router: Only use the engine if it's an MKV ON iOS.
    const videoType = (isMkv && isIOS) ? 'wasm_mkv' : 'auto';

    art = new Artplayer({
        container: '.artplayer-app',
        url: url,
        title: name,
        type: videoType, // This triggers the interceptor below if needed
        autoSize: false,
        fullscreen: true,
        playsInline: true,
        setting: true,
        playbackRate: true,
        subtitleOffset: true,
        lock: true,
        fastForward: true,
        autoOrientation: true,
        theme: '#3b82f6', // Changed to blue to match your UI!
        miniProgressBar: false,
        pip: true,
        screenshot: true,
        autoPlayback: true,
        
        // --- THE ENGINE INTERCEPTOR ---
        customType: {
            wasm_mkv: async function (videoElement, url, art) {
                console.log("🍎 iOS + MKV Detected! Waking up Rust Engine...");
                art.notice.show = "Initializing Rust Engine for iOS...";
                
                try {
                    // 1. Boot up the WebAssembly Engine
                    await window.initWasm();
                    console.log("✅ Engine Online.");
                    art.notice.show = "Demuxing Video Stream...";

                    // 2. Spin up your custom Rust Demuxer
                    // (Ensure the method names here match exactly what you wrote in your Rust code!)
                    const demuxer = new window.WasmDemuxer(url);
                    
                    // 3. Tell the demuxer to feed the raw video element
                    await demuxer.play(videoElement);
                    
                    console.log("🎬 Engine connected. Playing!");
                    
                } catch (error) {
                    console.error("Engine Crash:", error);
                    handlePlaybackFailure("WASM Engine failed to decode this MKV.");
                }
            }
        }
    });

    art.on('video:error', () => {
        console.log("❌ Player Error Detected!");
        handlePlaybackFailure("Format not supported or link is dead.");
    });

    const stallCheck = setTimeout(() => {
        if (art.video.currentTime < 1 || art.video.readyState < 3) {
            console.warn("⚠️ Stream timed out (Stalled).");
            handlePlaybackFailure("Connection timed out. Connection is too slow.");
        }
    }, 15000);

    art.on('video:playing', () => {
        clearTimeout(stallCheck);
    });

    art.on('play', () => { scrobble('start', name, 0); });
    art.on('pause', () => { scrobble('stop', name, art.currentTime / art.duration * 100); });
    art.on('destroy', () => { scrobble('stop', name, art.currentTime / art.duration * 100); });

    art.play();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handlePlaybackFailure(reason) {
    if (!art) return;
    
    art.destroy();
    art = null;

    document.getElementById('player-wrapper').classList.add('hidden');

    const errorDiv = document.createElement('div');
    errorDiv.className = "fixed top-5 right-5 bg-red-600 text-white p-4 rounded shadow-lg z-50 transition-opacity duration-500";
    errorDiv.innerHTML = `
        <strong>Playback Failed</strong><br>
        <span class="text-sm">${reason}</span>
    `;
    document.body.appendChild(errorDiv);

    setTimeout(() => errorDiv.remove(), 5000);
}

// --- DIRECT PLAY LOGIC ---
function playDirect() {
    const url = document.getElementById('direct-input').value.trim();
    
    if (!url) return alert("Please paste a link first!");

    if (url.startsWith("magnet:")) {
        alert("❌ Error: You cannot play a Magnet link directly.\n\nMagnet links must be converted by TorBox/Real-Debrid first. Please log in to add this torrent.");
        return; 
    }

    if (!url.startsWith("http://") && !url.startsWith("https://")) {
        alert("❌ Error: Invalid Link.");
        return;
    }

    document.getElementById('auth-screen').classList.add('hidden');
    
    const cleanName = url.split('/').pop().split('?')[0] || "Direct Stream";
    startPlayer(url, decodeURIComponent(cleanName));
}

// --- DELETE TORRENT ---
async function deleteTorrent(torrentId, event) {
    // Stop the click from opening the movie
    if (event) event.stopPropagation(); 
    
    if (!confirm("Are you sure you want to delete this from TorBox?")) return;

    const key = localStorage.getItem('tb_api_key');
    const targetUrl = 'https://api.torbox.app/v1/api/torrents/controltorrent';

    try {
        // Use your smartFetch proxy here!
        const res = await smartFetch(targetUrl, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                torrent_id: torrentId,
                operation: "delete" // <-- CHANGED TO LOWERCASE!
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

// Init
checkAuth();

// Close dropdown when clicking outside
window.onclick = function (event) {
    if (!event.target.matches('.w-10') && !event.target.closest('#profile-dropdown')) {
        document.getElementById('profile-dropdown').classList.add('hidden');
    }
}