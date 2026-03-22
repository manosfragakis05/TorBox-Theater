import { smartFetch, parseMediaData, showToast } from './script.js';


//#region TMDB LOGIC
export const TMDB_KEY = 'ee7a32cee36ed0cd1f028f10c32fa0cf';

const activeMedia = { id: null, type: null, poster: null };

const rowState = {
    'trending-row': { page: 1, endpoint: 'trending/movie/week', loading: false, hasMore: true },
    'new-row': { page: 1, endpoint: 'movie/now_playing', loading: false, hasMore: true },
    'global-search-grid': { page: 1, query: '', loading: false, hasMore: true },
    'action-row': { page: 1, endpoint: 'discover/movie?with_genres=28', loading: false, hasMore: true },
    'comedy-row': { page: 1, endpoint: 'discover/movie?with_genres=35&without_genres=80,18,28,53', loading: false, hasMore: true },
    'thriller-row': { page: 1, endpoint: 'discover/movie?with_genres=53,96&without_genres=28,878', loading: false, hasMore: true }, 'anime-row': { page: 1, endpoint: 'discover/movie?with_genres=16&with_original_language=ja', loading: false, hasMore: true },
    'top-row': { page: 1, endpoint: 'movie/top_rated', loading: false, hasMore: true },
    'my-picks-row': { loading: false }
};

let isDragging = false;

// --- 🚨 GLOBAL DRAG STATE 🚨 ---
let isDown = false;
let activeSlider = null;
let startX;
let scrollLeft;
let globalDragInitialized = false;

// We attach the movement to the WINDOW, not the row. 
// This lets you drag your mouse way outside the box without it stopping!
function initGlobalDrag() {
    if (globalDragInitialized) return;

    window.addEventListener('mousemove', (e) => {
        if (!isDown || !activeSlider) return;

        e.preventDefault(); // Stops the weird "ghost image" dragging

        // Actively kill any accidental blue text highlighting on the screen
        if (window.getSelection) {
            window.getSelection().removeAllRanges();
        }

        const x = e.pageX - activeSlider.offsetLeft;
        const walk = (x - startX) * 2; // The * 2 makes it scroll slightly faster than you drag

        if (Math.abs(walk) > 5) isDragging = true;

        activeSlider.scrollLeft = scrollLeft - walk;
    });

    window.addEventListener('mouseup', () => {
        if (!isDown || !activeSlider) return;
        isDown = false;

        activeSlider.classList.remove('cursor-grabbing');
        // ❌ DELETED: activeSlider.classList.add('snap-x');

        document.body.classList.remove('select-none');

        setTimeout(() => {
            isDragging = false;
            activeSlider = null;
        }, 50);
    })

    globalDragInitialized = true;
}

export function enableDragScroll(containerId) {
    initGlobalDrag(); // Set up the window listeners (it only runs once)

    const slider = document.getElementById(containerId);
    if (!slider) return;

    slider.addEventListener('mousedown', (e) => {
        isDown = true;
        isDragging = false;
        activeSlider = slider;

        slider.classList.add('cursor-grabbing');
        // ❌ DELETED: slider.classList.remove('snap-x');

        document.body.classList.add('select-none');

        startX = e.pageX - slider.offsetLeft;
        scrollLeft = slider.scrollLeft;
    });

    // Notice: We completely deleted the 'mouseleave' event!

    slider.addEventListener('scroll', () => {
        if (slider.scrollWidth - slider.scrollLeft - slider.clientWidth < 300) {
            // Only fetch if it's NOT the episode list (prevents crashing the TV row)
            if (containerId !== 'episode-list') {
                fetchNextPage(containerId);
            }
        }
    });
}

function appendCards(movies, containerId) {
    const row = document.getElementById(containerId);

    movies.forEach(movie => {
        if (movie.media_type === 'person' || !movie.poster_path) return;

        // --- 🚨 THE BULLETPROOF TYPE DETECTOR 🚨 ---
        // 1. Check if TMDB explicitly told us the type.
        // 2. If missing (like in discover/tv), check if it has a 'name' property instead of 'title'.
        const detectedType = movie.media_type || (movie.name ? 'tv' : 'movie');

        // Pick the right text fields based on what it is
        const displayTitle = movie.title || movie.name;
        const displayDate = movie.release_date || movie.first_air_date || '';
        const year = displayDate.split('-')[0] || 'N/A';

        const card = document.createElement('div');
        card.className = "relative flex-none w-32 md:w-40 cursor-pointer transition-transform hover:scale-105 select-none";

        card.innerHTML = `
            <img src="https://image.tmdb.org/t/p/w500${movie.poster_path}" 
                 class="rounded-lg shadow-lg w-full h-auto object-cover border border-slate-700/50 bg-slate-800 aspect-[2/3]" 
                 draggable="false" 
                 alt="${displayTitle}">
            <p class="text-xs text-slate-300 mt-2 truncate font-semibold pl-1">${displayTitle}</p>
            <p class="text-[10px] text-slate-500 pl-1">${year}</p>
        `;

        card.onclick = (e) => {
            if (isDragging) {
                e.preventDefault();
                return;
            }
            // Pass the perfectly detected type to the detail screen!
            openMovieDetail(movie.id, detectedType);
        };
        row.appendChild(card);
    });
}

async function fetchAndBuildRow(endpoint, containerId) {
    const row = document.getElementById(containerId);
    row.innerHTML = '<p class="text-slate-400 pl-2 text-sm mt-4">Loading...</p>';

    // --- THE SHUFFLE LOGIC ---
    let startPage = 1;
    const staticRows = ['trending-row', 'new-row'];
    if (!staticRows.includes(containerId)) {
        startPage = Math.floor(Math.random() * 3) + 1;
    }

    rowState[containerId].page = startPage;
    rowState[containerId].hasMore = true;
    rowState[containerId].loading = true;
    rowState[containerId].endpoint = endpoint;

    try {
        const separator = endpoint.includes('?') ? '&' : '?';
        // Use our startPage variable here!
        const url = `https://api.themoviedb.org/3/${endpoint}${separator}api_key=${TMDB_KEY}&language=en-US&page=${startPage}`;

        const response = await fetch(url);
        const data = await response.json();

        row.innerHTML = '';
        appendCards(data.results, containerId);

        if (data.page >= data.total_pages) rowState[containerId].hasMore = false;
    } catch (e) {
        row.innerHTML = '<p class="text-red-500 pl-2">Failed to load.</p>';
    } finally {
        rowState[containerId].loading = false;
    }
}

async function fetchNextPage(containerId) {
    const state = rowState[containerId];
    if (!state || state.loading || !state.hasMore) return;

    state.loading = true;
    state.page += 1;

    let url = '';
    if (containerId === 'global-search-grid') {
        url = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(state.query)}&page=${state.page}`;
    } else {
        // SMART URL BUILDER FOR PAGINATION
        const separator = state.endpoint.includes('?') ? '&' : '?';
        url = `https://api.themoviedb.org/3/${state.endpoint}${separator}api_key=${TMDB_KEY}&language=en-US&page=${state.page}`;
    }

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.results.length === 0 || state.page >= data.total_pages) {
            state.hasMore = false;
        }

        appendCards(data.results, containerId);
    } catch (e) {
        console.error("Pagination Error:", e);
    } finally {
        state.loading = false;
    }
}

// TMDB Search Engine (Page 1)
export async function searchTMDB(query) {
    const container = document.getElementById('global-search-results');
    const row = document.getElementById('global-search-grid');

    container.classList.remove('hidden');
    row.innerHTML = '<p class="text-slate-500 pl-2 text-sm mt-4">Searching the web...</p>';

    // Reset state for new searches
    rowState['global-search-grid'].query = query;
    rowState['global-search-grid'].page = 1;
    rowState['global-search-grid'].hasMore = true;
    rowState['global-search-grid'].loading = true;

    try {
        const url = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(query)}&page=1`;
        const response = await fetch(url);
        const data = await response.json();

        row.innerHTML = '';

        if (data.results.length === 0) {
            row.innerHTML = '<p class="text-slate-500 pl-2 text-sm mt-4">No results found.</p>';
            return;
        }

        appendCards(data.results, 'global-search-grid');
        if (data.page >= data.total_pages) rowState['global-search-grid'].hasMore = false;
    } catch (e) {
        row.innerHTML = '<p class="text-red-500 pl-2 text-sm mt-4">Search failed.</p>';
    } finally {
        rowState['global-search-grid'].loading = false;
    }
}

// App Booter
export async function loadDiscover() {
    // 1. Activate Drag Scrolling
    enableDragScroll('global-search-grid');
    enableDragScroll('episode-list');
    enableDragScroll('trending-row');
    enableDragScroll('new-row');
    enableDragScroll('top-row');
    enableDragScroll('action-row');
    enableDragScroll('comedy-row');
    enableDragScroll('thriller-row');
    enableDragScroll('anime-row');
    enableDragScroll('my-picks-row');

    // 2. Fetch the Data
    // 1. THE FRESH STUFF (Always loads Page 1 to stay current)
    fetchAndBuildRow('trending/all/week', 'trending-row'); // 'all' includes hot TV shows too!
    fetchAndBuildRow('movie/now_playing', 'new-row');

    // 2. THE SHUFFLED CLASSICS (These will use the random page logic below)
    fetchAndBuildRow('movie/top_rated', 'top-row');

    // Action Bangers: High votes guarantee you get Die Hard / Matrix / Dark Knight instead of direct-to-DVD junk
    fetchAndBuildRow('discover/movie?with_genres=28&sort_by=vote_count.desc&vote_average.gte=7&vote_count.gte=3000', 'action-row');

    // Comedy Legends: (Note: Comedies naturally score lower on TMDB, so 6.5 is the sweet spot)
    fetchAndBuildRow('discover/movie?with_genres=35&sort_by=vote_count.desc&vote_average.gte=6.5&vote_count.gte=2000', 'comedy-row');

    // Thriller Masterpieces: (without_genres=27,28 removes pure Horror and pure Action)
    fetchAndBuildRow('discover/movie?with_genres=53&without_genres=27,28&sort_by=vote_count.desc&vote_average.gte=7.5&vote_count.gte=1500', 'thriller-row');

    // Anime Peak: Switched to discover/tv so you actually get Attack on Titan, Death Note, etc.
    fetchAndBuildRow('discover/tv?with_genres=16&with_original_language=ja&sort_by=vote_count.desc&vote_count.gte=500', 'anime-row');

    loadMyPicks();
}

// The Bridge to Torrentio (Next step!)
async function handleMovieClick(tmdbId, title) {
    console.log(`Clicked: ${title} (TMDB ID: ${tmdbId})`);
    try {
        const url = `https://api.themoviedb.org/3/movie/${tmdbId}/external_ids?api_key=${TMDB_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        const imdbId = data.imdb_id;

        if (imdbId) {
            console.log(`✅ Success! IMDB ID: ${imdbId}`);
            alert(`You clicked: ${title}\nIMDB ID: ${imdbId}\n\nReady for Torrentio!`);
        } else {
            alert(`Sorry, no IMDB ID found for ${title}.`);
        }
    } catch (e) {
        console.error("Translation Error:", e);
    }
}

export async function getPosterForLibrary(cleanTitle, year) {
    try {
        let url = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(cleanTitle)}&page=1`;
        if (year) url += `&primary_release_year=${year}`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.results && data.results.length > 0) {
            const bestMatch = data.results[0];

            // Return the full package so the Vault can cache it!
            return {
                id: bestMatch.id,
                type: bestMatch.media_type || (bestMatch.name ? 'tv' : 'movie'),
                poster: bestMatch.poster_path ? `https://image.tmdb.org/t/p/w500${bestMatch.poster_path}` : null
            };
        }
        return null;
    } catch (e) {
        return null;
    }
}


// MY PICKS
export async function loadMyPicks() {
    const containerId = 'my-picks-row';
    const row = document.getElementById(containerId);
    if (!row) return;

    row.innerHTML = '<p class="text-slate-500 pl-2">Assembling the legends...</p>';

    const myFavorites = [
        // THE GOATS
        { id: 1396, type: 'tv' },     // Breaking Bad
        { id: 1607, type: 'movie' },  // A Bronx Tale
        { id: 278, type: 'movie' },   // Shawshank Redemption
        { id: 389, type: 'movie' },   // 12 Angry Men

        // THE TRILOGIES
        { id: 11, type: 'movie' },    // Star Wars: A New Hope
        { id: 1891, type: 'movie' },  // Empire Strikes Back
        { id: 1892, type: 'movie' },  // Return of the Jedi
        { id: 1893, type: 'movie' },  // Phantom Menace (For Darth Maul)
        { id: 1894, type: 'movie' },  // Attack of the Clones
        { id: 1895, type: 'movie' },  // Revenge of the Sith

        // THE CAPED CRUSADERS
        { id: 155, type: 'movie' },   // The Dark Knight
        { id: 414906, type: 'movie' }, // The Batman (2022)
        { id: 299534, type: 'movie' }, // Avengers: Endgame

        // THE ANIME PEAK
        { id: 1429, type: 'tv' },     // Attack on Titan
        { id: 45790, type: 'tv' },    // Jojo's
        { id: 95479, type: 'tv' },    // Jujutsu Kaisen
        { id: 30984, type: 'tv' },    // Bleach
        { id: 127532, type: 'tv' }    // Solo Leveling
    ];

    try {
        const movieData = await Promise.all(myFavorites.map(async (item) => {
            const url = `https://api.themoviedb.org/3/${item.type}/${item.id}?api_key=${TMDB_KEY}&language=en-US`;
            const res = await fetch(url);
            const data = await res.json();
            return {
                ...data,
                title: data.title || data.name,
                release_date: data.release_date || data.first_air_date,
                media_type: item.type
            };
        }));

        row.innerHTML = '';
        appendCards(movieData, containerId);

    } catch (e) {
        console.error("Vibe Check Failed:", e);
    }
}

//Open FULL file page(description and both playbacks)
export async function openMovieDetail(id, type = 'movie') {
    const view = document.getElementById('movie-detail-view');

    try {
        // 1. Fetch the correct endpoint based on our detected type
        const url = `https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_KEY}&language=en-US`;
        const res = await fetch(url);
        const data = await res.json();

        // 2. Map data (Handle both Movie and TV formats safely)
        const title = data.title || data.name;
        const date = data.release_date || data.first_air_date || '';
        const year = date ? date.split('-')[0] : 'N/A';
        const runtime = data.runtime ? `${data.runtime}m` : (data.episode_run_time && data.episode_run_time.length > 0 ? `${data.episode_run_time[0]}m` : 'N/A');
        const backdrop = data.backdrop_path ? `https://image.tmdb.org/t/p/original${data.backdrop_path}` : '';
        const poster = data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : '';

        activeMedia.id = id;
        activeMedia.type = type;
        activeMedia.poster = poster;

        // 3. Fill the HTML Info
        document.getElementById('detail-backdrop').style.backgroundImage = `url(${backdrop})`;
        document.getElementById('detail-poster').src = poster;
        document.getElementById('detail-title').innerText = title;
        document.getElementById('detail-year').innerText = year;
        document.getElementById('detail-runtime').innerText = runtime;
        document.getElementById('detail-rating').innerText = `★ ${data.vote_average?.toFixed(1)}`;
        document.getElementById('detail-overview').innerText = data.overview || "No description available.";

        // --- 🚨 THE CUSTOM PREMIUM TV CONTROLS LOGIC 🚨 ---
        const tvControls = document.getElementById('tv-controls');
        // We now use a hidden input for the season value
        const seasonSelectInput = document.getElementById('season-select');
        const customSeasonTrigger = document.getElementById('custom-season-trigger');
        const customSeasonText = document.getElementById('custom-season-text');
        const customSeasonMenu = document.getElementById('custom-season-menu');
        const seasonChevron = document.getElementById('season-chevron');

        const episodeList = document.getElementById('episode-list');
        const selectedEpisodeInput = document.getElementById('selected-episode');

        if (type === 'tv' && tvControls) {
            tvControls.classList.remove('hidden');
            tvControls.classList.add('flex');
            customSeasonMenu.innerHTML = '';
            customSeasonMenu.classList.add('hidden'); // Ensure closed on load
            seasonChevron.classList.remove('rotate-180');

            const validSeasons = data.seasons ? data.seasons.filter(s => s.season_number > 0) : [];

            // The function that runs when you pick a new season
            const handleSeasonChange = async (sNum) => {
                // Update the UI
                seasonSelectInput.value = sNum;
                customSeasonText.innerText = `Season ${sNum}`;
                customSeasonMenu.classList.add('hidden');
                seasonChevron.classList.remove('rotate-180');

                // Style the selected option in the list
                document.querySelectorAll('.season-option').forEach(opt => {
                    if (opt.dataset.season == sNum) {
                        opt.classList.add('bg-blue-600/20', 'text-blue-400', 'border-l-4', 'border-blue-500');
                        opt.classList.remove('text-white', 'border-l-4', 'border-transparent');
                    } else {
                        opt.classList.remove('bg-blue-600/20', 'text-blue-400', 'border-blue-500');
                        opt.classList.add('text-white', 'border-transparent');
                    }
                });

                // Fetch the episodes for this season
                const sUrl = `https://api.themoviedb.org/3/tv/${id}/season/${sNum}?api_key=${TMDB_KEY}`;
                const sRes = await fetch(sUrl);
                const sData = await sRes.json();

                episodeList.innerHTML = '';

                if (sData.episodes && sData.episodes.length > 0) {
                    selectedEpisodeInput.value = sData.episodes[0].episode_number;

                    sData.episodes.forEach((ep, index) => {
                        const imgPath = ep.still_path ? ep.still_path : data.backdrop_path;
                        const stillImage = imgPath ? `https://image.tmdb.org/t/p/w300${imgPath}` : '';

                        const isSelected = index === 0 ? 'border-blue-500 bg-blue-500/10' : 'border-slate-700 bg-slate-800/50';

                        const card = document.createElement('div');
                        card.className = `episode-card relative flex-none w-40 md:w-48 rounded-xl border-2 ${isSelected} overflow-hidden cursor-pointer transition-all hover:border-blue-400 shrink-0 group select-none`;

                        card.onclick = (e) => {
                            if (isDragging) {
                                e.preventDefault();
                                return;
                            }
                            selectedEpisodeInput.value = ep.episode_number;
                            document.querySelectorAll('.episode-card').forEach(c => {
                                c.classList.remove('border-blue-500', 'bg-blue-500/10');
                                c.classList.add('border-slate-700', 'bg-slate-800/50');
                            });
                            card.classList.remove('border-slate-700', 'bg-slate-800/50');
                            card.classList.add('border-blue-500', 'bg-blue-500/10');
                        };

                        card.innerHTML = `
                            <div class="relative aspect-video bg-slate-900 w-full">
                                <img src="${stillImage}" draggable="false" class="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" loading="lazy">
                                <div class="absolute bottom-1 right-1 bg-black/80 px-1.5 py-0.5 rounded text-[9px] text-white font-bold">
                                    ${ep.runtime ? ep.runtime + 'm' : ''}
                                </div>
                            </div>
                            <div class="p-2">
                                <p class="text-xs text-blue-400 font-bold tracking-wide">E${ep.episode_number}</p>
                                <p class="text-[10px] text-slate-300 truncate mt-0.5" title="${ep.name}">${ep.name}</p>
                            </div>
                        `;
                        episodeList.appendChild(card);
                    });
                }
            };

            // Populate the Custom Dropdown Menu
            validSeasons.forEach(s => {
                const btn = document.createElement('button');
                // These are your beautiful, styled options!
                btn.className = `season-option w-full text-left px-5 py-3 hover:bg-slate-700/50 transition border-l-4 border-transparent text-white font-bold text-sm border-b border-slate-700/30 last:border-b-0`;
                btn.dataset.season = s.season_number;
                btn.innerText = `Season ${s.season_number}`;
                btn.onclick = () => handleSeasonChange(s.season_number);
                customSeasonMenu.appendChild(btn);
            });

            // Toggle Menu logic (Open/Close on click)
            customSeasonTrigger.onclick = () => {
                customSeasonMenu.classList.toggle('hidden');
                seasonChevron.classList.toggle('rotate-180');
            };

            // Trigger the first season to load automatically
            if (validSeasons.length > 0) {
                handleSeasonChange(validSeasons[0].season_number);
            }
        } else if (tvControls) {
            tvControls.classList.add('hidden');
            tvControls.classList.remove('flex');
        }

        // 👇 --- ADD THIS MISSING BLOCK --- 👇
        const btnTorrent = document.getElementById('btn-torrent');
        const btnScraper = document.getElementById('btn-scraper');

        // Play (High Quality) Button
        btnTorrent.onclick = () => {
            startTorrentioStream(id, title, type);
        };

        // Play (Direct Stream) Button
        btnScraper.onclick = () => {
            // Grab the season and episode (from our new hidden input!) if it's a TV show
            const s = type === 'tv' ? document.getElementById('season-select').value : null;
            const e = type === 'tv' ? document.getElementById('selected-episode').value : null;

            // Pass the data to the iframe player
            openIframePlayer(id, title, type, s, e);
        };
        // 👆 --- END OF MISSING BLOCK --- 👆

        // 4. Show the page!
        view.classList.remove('translate-y-full');
        document.body.style.overflow = 'hidden';

    } catch (e) {
        console.error("Detail View Error:", e);
        showToast(`Failed to load info. TMDB might be missing data for this ${type}.`, 'error');
    }
}


// Global close function
window.closeMovieDetail = () => {
    document.getElementById('movie-detail-view').classList.add('translate-y-full');
    document.body.style.overflow = ''; // Restore scrolling
};


//#region HARDWARE CHECK
function getHardwareSupport() {
    const audio = document.createElement('audio');
    const video = document.createElement('video');

    // 1. Simple canPlayType checks
    const dolby = audio.canPlayType('audio/mp4; codecs="ec-3"') !== '' || audio.canPlayType('audio/mp4; codecs="ac-3"') !== '';
    const claimsHevc = video.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') !== '' || video.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0"') !== '';

    // 2. The Apple Reality Check
    const isApple = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);

    // 3. The Final Verdict: Only trust HEVC if the browser claims it AND it's an Apple device.
    const trustHevc = claimsHevc && isApple;

    return { dolby, claimsHevc, isApple, trustHevc };
}

window.DEVICE_HW = getHardwareSupport();

// 👇 THE CLEAN UI BADGE 👇
//const uiBadge = document.getElementById('dev-simple-hw-badge') || document.createElement('div');
//uiBadge.id = 'dev-simple-hw-badge';
//uiBadge.className = "fixed bottom-4 left-4 bg-slate-900/95 text-slate-300 px-4 py-3 rounded-xl border-2 border-slate-700 shadow-2xl z-[9999] text-xs font-mono pointer-events-none flex flex-col gap-1.5";
//
//const HW = window.DEVICE_HW;
//uiBadge.innerHTML = `
//    <div class="border-b border-slate-700 pb-1 mb-1 text-[10px] text-slate-500 font-bold tracking-widest uppercase">Hardware Scanner v3</div>
//    <div class="flex justify-between gap-6"><span>Dolby Audio:</span> <span class="${HW.dolby ? 'text-emerald-400' : 'text-red-400'} font-bold">${HW.dolby ? "YES" : "NO"}</span></div>
//    <div class="flex justify-between gap-6"><span>Claims HEVC:</span> <span class="${HW.claimsHevc ? 'text-amber-400' : 'text-red-400'} font-bold">${HW.claimsHevc ? "YES" : "NO"}</span></div>
//    <div class="flex justify-between gap-6"><span>Is Apple OS:</span> <span class="${HW.isApple ? 'text-emerald-400' : 'text-slate-500'} font-bold">${HW.isApple ? "YES" : "NO"}</span></div>
//    <div class="border-t border-slate-700 pt-1 mt-1 flex justify-between gap-6"><span>Trust HEVC:</span> <span class="${HW.trustHevc ? 'text-emerald-400' : 'text-red-500'} font-bold">${HW.trustHevc ? "SAFE" : "NUKE IT"}</span></div>
//`;
//if (!document.getElementById('dev-simple-hw-badge')) document.body.appendChild(uiBadge);
//#endregion

//#region Filter

// SMART LANGUAGE EXTRACTOR
function extractLanguageData(pttLanguages, rawTitle) {
    let flags = new Set();
    let textLangs = new Set();
    let isMulti = false;
    const lowerTitle = rawTitle.toLowerCase();

    // 1. Check for "Multi" or "Dual" Audio tags
    if (lowerTitle.match(/multi.?audio|dual.?audio|multi.?subs|\bmulti\b/)) {
        isMulti = true;
    }

    // 2. Extract Emojis directly from Torrentio's string
    const emojiMatch = rawTitle.match(/(🇬🇧|🇺🇸|🇫🇷|🇲🇽|🇪🇸|🇮🇹|🇷🇺|🇮🇳|🇵🇹|🇩🇪|🇯🇵|🇰🇷)/g);
    if (emojiMatch) {
        // Normalize US flags to UK flags so we don't get duplicates for English
        emojiMatch.forEach(flag => flags.add(flag === '🇺🇸' ? '🇬🇧' : flag));
    }

    // 3. Translate PTT's text array into Emojis!
    const flagDictionary = {
        english: '🇬🇧', eng: '🇬🇧', en: '🇬🇧',
        french: '🇫🇷', fre: '🇫🇷', fra: '🇫🇷',
        spanish: '🇪🇸', spa: '🇪🇸', esp: '🇪🇸',
        italian: '🇮🇹', ita: '🇮🇹',
        russian: '🇷🇺', rus: '🇷🇺',
        german: '🇩🇪', ger: '🇩🇪',
        portuguese: '🇵🇹', por: '🇵🇹',
        japanese: '🇯🇵', jpn: '🇯🇵',
        korean: '🇰🇷', kor: '🇰🇷',
        hindi: '🇮🇳', hin: '🇮🇳'
    };

    if (Array.isArray(pttLanguages)) {
        pttLanguages.forEach(lang => {
            const key = lang.toLowerCase();
            if (flagDictionary[key]) {
                flags.add(flagDictionary[key]);
            } else {
                // If we don't have a flag for it, just capitalize the word (e.g., "Arabic")
                textLangs.add(lang.charAt(0).toUpperCase() + lang.slice(1));
            }
        });
    }

    // 4. Fallback: If nothing was found, but it says "ENG" in the title
    if (flags.size === 0 && textLangs.size === 0 && lowerTitle.match(/\beng\b|\ben\b/)) {
        flags.add('🇬🇧');
    }

    // 5. Build the Beautiful UI String
    let uiString = Array.from(flags).join(' ');
    if (textLangs.size > 0) {
        uiString += (uiString ? ' • ' : '') + Array.from(textLangs).join(', ');
    }

    // Add a highly visible MULTI badge if applicable
    if (isMulti) {
        uiString += (uiString ? ' ' : '') + `<span class="text-[9px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded ml-1 border border-blue-500/30 font-bold uppercase tracking-wider">Multi-Audio</span>`;
    }

    // 6. Calculate the "Diversity Score" for the Sorter
    // +1 point per language, +3 bonus points if it's explicitly Multi-Audio
    const score = flags.size + textLangs.size + (isMulti ? 3 : 0);

    return {
        uiText: uiString.trim(),
        score: score,
        isMultiDub: isMulti
    };
}

function filterAndSortStreams(streams) {
    // 1️⃣ PARSE AND TAG EVERYTHING
    let parsedStreams = streams.map(stream => {
        const fullTitle = stream.title || "";
        const rawFileName = fullTitle.split('\n')[0];

        // 🧠 Feed it to PTT
        const parsed = parseMediaData(rawFileName);
        const cleanTitle = parsed.title || "";

        // 📊 Regex for Seeders & Size
        const seederMatch = fullTitle.match(/👤\s*(\d+)/);
        const seeders = seederMatch ? parseInt(seederMatch[1]) : 0;

        const sizeMatch = fullTitle.match(/💾\s*([\d.]+)\s*([a-zA-Z]+)/);
        const sizeText = sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2]}` : "Unknown";
        let sizeBytes = 0;
        if (sizeMatch) {
            const val = parseFloat(sizeMatch[1]);
            const unit = sizeMatch[2].toUpperCase();
            sizeBytes = unit.includes('GB') ? val * 1024 : val;
        }

        const siteMatch = fullTitle.match(/⚙️\s*([^\n]+)/);
        const trackerName = siteMatch ? siteMatch[1].trim() : "Direct Source";

        // Languages from helper function
        const langData = extractLanguageData(parsed.languages, fullTitle);

        let videoCodec = (parsed.codec || "HD").toUpperCase();
        if (videoCodec === 'H264' || videoCodec === 'X264') videoCodec = 'x264';
        if (videoCodec === 'H265' || videoCodec === 'X265' || videoCodec === 'HEVC') videoCodec = 'HEVC/x265';
        const quality = parsed.quality || "";
        const badgeText = quality ? `${videoCodec} • ${quality}` : videoCodec;

        let audioText = "Standard Audio";
        let audioColor = "text-slate-400";
        const metaAudio = (parsed.audio || "").toLowerCase();

        const isDolby = metaAudio.includes('dolby') || metaAudio.includes('ac3') || metaAudio.includes('eac3') || metaAudio.includes('dd') || metaAudio.includes('atmos');
        const isWebSafeAudio = metaAudio.includes('aac') || metaAudio.includes('mp3') || metaAudio.includes('opus');

        if (isWebSafeAudio) {
            audioText = "AAC / Web-Safe";
            audioColor = "text-emerald-400";
        } else if (metaAudio.includes('flac') || metaAudio.includes('alac')) {
            audioText = "FLAC (Lossless)";
            audioColor = "text-cyan-400";
        } else if (isDolby) {
            audioText = "Dolby Audio";
            audioColor = "text-amber-400";
        }

        if (langData.isMultiDub) audioText += " (Multi Audio)";

        const isx264 = videoCodec.includes('x264') || videoCodec.includes('h264') || videoCodec.includes('avc');
        const isHEVC = videoCodec.includes('hevc') || videoCodec.includes('x265') || videoCodec.includes('h265') || parsed.hdr || cleanTitle.includes('dv');

        return {
            ...stream, meta: parsed, seeders, fullTitle, sizeText, sizeBytes,
            langCount: langData.score,
            isx264, isHEVC, isDolby, isMultiDub: langData.isMultiDub, isWebSafeAudio,
            uiTracker: trackerName,
            uiLangs: langData.uiText,
            uiBadge: badgeText,
            uiAudioText: audioText, uiAudioColor: audioColor
        };
    });

    // 2️⃣ THE INCINERATOR
    let validStreams = parsedStreams.filter(s => {
        const noCams = s.meta.quality !== 'Cam' && s.meta.quality !== 'Telesync';
        const noHardcoded = s.meta.hardcoded !== true;
        return s.seeders > 0 && noCams && noHardcoded;
    });

    // 3️⃣ THE MASTER SORT (Highest Seeders first)
    validStreams.sort((a, b) => b.seeders - a.seeders);

    const all4K = validStreams.filter(s => s.meta.resolution === '4k' || s.meta.resolution === '2160p' || s.fullTitle.toLowerCase().includes('4k'));
    const all1080p = validStreams.filter(s => s.meta.resolution === '1080p' || (s.fullTitle.toLowerCase().includes('1080p') && !s.fullTitle.toLowerCase().includes('4k')));

    // 🎰 4️⃣ THE 3-SLOT PICKER
    function fillSlots(pool) {
        if (pool.length === 0) return [];

        // Slot 1 is ALWAYS the absolute most seeded file.
        let slot1 = pool[0];

        // Slot 2: Hunt for the most-seeded file that HAS Dolby AND isn't Slot 1
        let slot2 = pool.find(s => s.isDolby && s !== slot1);
        if (!slot2 && pool.length > 1) slot2 = pool.find(s => s !== slot1);

        // Slot 3: The Multi-Language Champion
        // We filter out Slot 1 and 2, then sort the remaining pool by the highest `langCount`
        let remaining = pool.filter(s => s !== slot1 && s !== slot2);
        let slot3 = null;

        if (remaining.length > 0) {
            // Sort by language count first. If it's a tie, fallback to highest seeders!
            remaining.sort((a, b) => {
                if (b.langCount !== a.langCount) return b.langCount - a.langCount;
                return b.seeders - a.seeders;
            });

            // Only assign Slot 3 if it genuinely has multiple languages or if we just want a 3rd option
            // (We'll just give them the next best file to guarantee 3 slots)
            slot3 = remaining[0];
        }

        return [slot1, slot2, slot3].filter(Boolean); // .filter(Boolean) safely removes any empty slots
    }

    const top4K = fillSlots(all4K);
    const top1080p = fillSlots(all1080p);

    // 📱 5️⃣ THE "STORAGE SAVER" SLOT
    let storageSaver = [...all1080p]
        .filter(s => s.sizeBytes > 0 && !top1080p.includes(s) && !top4K.includes(s))
        .sort((a, b) => a.sizeBytes - b.sizeBytes)[0] || null;

    // 6️⃣ THE LEFTOVERS
    const selectedSet = new Set([...top4K, ...top1080p, storageSaver]);

    const more4K = all4K.filter(s => !selectedSet.has(s));
    const more1080p = all1080p.filter(s => !selectedSet.has(s));

    return { top4K, top1080p, storageSaver, more4K, more1080p };
}

// --- MODAL UI BUILDER ---
function showStreamPicker(categorizedStreams, movieTitle) {
    const modal = document.getElementById('stream-picker-modal');
    const list = document.getElementById('stream-picker-list');

    document.getElementById('stream-picker-title').innerText = `Select Stream: ${movieTitle}`;
    list.innerHTML = '';
    modal.classList.remove('hidden');

    // Container for 4K
    const container4K = document.createElement('div');
    container4K.id = 'stream-container-4k';
    container4K.className = 'flex flex-col gap-3 mb-6';

    if (categorizedStreams.top4K.length > 0) {
        const header4K = document.createElement('div');
        header4K.className = "text-amber-400 font-bold text-xs mb-2 mt-1 uppercase tracking-wider flex items-center gap-2";
        header4K.innerHTML = `<span>📺 4K UHD Cinematic</span> <span class="h-[1px] flex-1 bg-amber-400/20"></span>`;
        list.appendChild(header4K);
        list.appendChild(container4K);
        renderStreamCategory('stream-container-4k', categorizedStreams.top4K, categorizedStreams.more4K, movieTitle);
    }

    // Container for 1080p
    const container1080p = document.createElement('div');
    container1080p.id = 'stream-container-1080p';
    container1080p.className = 'flex flex-col gap-3 mb-6';

    if (categorizedStreams.top1080p.length > 0) {
        const header1080p = document.createElement('div');
        header1080p.className = "text-blue-400 font-bold text-xs mb-2 mt-4 uppercase tracking-wider flex items-center gap-2";
        header1080p.innerHTML = `<span>💻 1080p HD (Best for Wi-Fi)</span> <span class="h-[1px] flex-1 bg-blue-400/20"></span>`;
        list.appendChild(header1080p);
        list.appendChild(container1080p);
        renderStreamCategory('stream-container-1080p', categorizedStreams.top1080p, categorizedStreams.more1080p, movieTitle);
    }

    // Container for the Storage Saver
    if (categorizedStreams.storageSaver) {
        const containerSaver = document.createElement('div');
        containerSaver.id = 'stream-container-saver';
        containerSaver.className = 'flex flex-col gap-3 mb-6';

        const headerSaver = document.createElement('div');
        headerSaver.className = "text-emerald-400 font-bold text-xs mb-2 mt-4 uppercase tracking-wider flex items-center gap-2";
        headerSaver.innerHTML = `<span>📱 Storage Saver (Fast Download)</span> <span class="h-[1px] flex-1 bg-emerald-400/20"></span>`;

        list.appendChild(headerSaver);
        list.appendChild(containerSaver);

        // Render just the 1 card, pass it an empty array for the "more" streams
        renderStreamCategory('stream-container-saver', [categorizedStreams.storageSaver], [], movieTitle);
    }

    if (categorizedStreams.top4K.length === 0 && categorizedStreams.top1080p.length === 0) {
        list.innerHTML = `<div class="p-4 text-center text-red-400 font-bold">No cached 4K or 1080p streams found.</div>`;
    }
}

// --- RENDER HELPER WITH "LOAD MORE" ---
function renderStreamCategory(containerId, topStreams, moreStreams, movieTitle) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    // 1. Render Top 3
    topStreams.forEach((stream, index) => {
        const isRecommended = index === 0;
        container.appendChild(createStreamCard(stream, movieTitle, true, index === 0));
    });

    // 2. Build Load More
    if (moreStreams.length > 0) {
        const moreContainer = document.createElement('div');
        moreContainer.className = "hidden flex-col gap-2 mt-2 w-full";

        moreStreams.forEach(stream => {
            moreContainer.appendChild(createStreamCard(stream, movieTitle, false, false));
        });

        const loadBtn = document.createElement('button');
        loadBtn.className = "w-full py-2.5 mt-2 bg-slate-800/80 text-slate-400 border border-slate-700 rounded-xl text-xs font-bold tracking-wider uppercase hover:bg-slate-700 hover:text-white transition-all";
        loadBtn.innerHTML = `⬇ Load ${moreStreams.length} More (Sorted by Seeders)`;

        loadBtn.onclick = () => {
            moreContainer.classList.remove('hidden');
            moreContainer.classList.add('flex');
            loadBtn.remove();
        };

        container.appendChild(loadBtn);
        container.appendChild(moreContainer);
    }
}

// HELPER FUNCTION TO BUILD UI CARDS
function createStreamCard(stream, movieTitle, isPremium, isRecommended) {
    // 1. Fallbacks for Seeders/Size
    const seeders = stream.seeders !== undefined ? stream.seeders : "0";
    const size = stream.sizeText || "Unknown Size";

    // 2. HASH EXTRACTION
    let trueHash = stream.infoHash;
    if (!trueHash && stream.url) {
        const hashMatch = stream.url.match(/\/([a-fA-F0-9]{40})\//);
        if (hashMatch) trueHash = hashMatch[1];
    }
    const safeTitle = encodeURIComponent(movieTitle.replace(/\s+/g, '.'));
    const magnetLink = `magnet:?xt=urn:btih:${trueHash}&dn=${safeTitle}`;

    // --- STYLING ---
    const baseClasses = "w-full text-left border p-4 rounded-xl transition-all flex flex-col gap-2 group shadow-lg";
    let colorClasses = isPremium ? "bg-slate-800/80 hover:bg-slate-700 border-slate-600" : "bg-slate-900/50 hover:bg-slate-800 border-slate-800 opacity-80 hover:opacity-100";
    let buttonHover = "group-hover:bg-blue-600";

    let recommendedBadge = "";
    if (isRecommended) {
        colorClasses = "bg-emerald-900/20 hover:bg-emerald-800/30 border-emerald-500/50";
        buttonHover = "group-hover:bg-emerald-600";
        recommendedBadge = `<span class="bg-emerald-500 text-white text-[9px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wide shadow-sm">Recommended</span>`;
    }

    // Notice how we just use stream.uiTracker, stream.uiBadge, etc.!
    const customTitleHTML = `
        <div class="flex items-center flex-wrap gap-2">
            <span class="font-bold ${isPremium ? 'text-blue-300' : 'text-slate-400'} text-sm">${stream.uiTracker}</span>
            ${isRecommended ? recommendedBadge : ''}
            ${stream.uiLangs ? `<span class="text-sm drop-shadow-md">${stream.uiLangs}</span>` : ''}
            <span class="bg-slate-700/50 text-slate-300 text-[9px] px-1.5 py-0.5 rounded uppercase font-bold border border-slate-600">${stream.uiBadge}</span>
        </div>
    `;

    const btn = document.createElement('button');
    btn.className = `${baseClasses} ${colorClasses}`;

    btn.innerHTML = `
        <div class="flex justify-between items-start w-full gap-2">
            ${customTitleHTML}
            <span class="text-[10px] whitespace-nowrap font-bold uppercase tracking-wider bg-slate-900 px-3 py-1.5 rounded-lg text-slate-300 ${buttonHover} group-hover:text-white transition-colors mt-0.5">Send to TorBox</span>
        </div>
        <span class="text-xs text-slate-300 font-medium flex items-center gap-2 mt-1">
            👤 ${seeders} • ${size} • 
            <span class="font-bold ${stream.uiAudioColor}">🔊 ${stream.uiAudioText}</span>
        </span>
    `;

    btn.onclick = () => {
        closeStreamPicker();
        // 🧠 THE VAULT CONNECTION: Pass the data into the TorBox sender!
        sendMagnetToTorbox(magnetLink, movieTitle);
    };

    return btn;
}


//#region Torrent Link
export async function startTorrentioStream(id, movieTitle, type) {
    const tbKey = localStorage.getItem('tb_api_key');
    if (!tbKey) return showToast('Please connect your TorBox API in the settings first');

    const btn = document.getElementById('btn-torrent');
    const originalText = btn.innerHTML;
    btn.innerHTML = '⏳ Searching Torrentio...';
    btn.disabled = true;

    try {
        const idUrl = `https://api.themoviedb.org/3/${type}/${id}/external_ids?api_key=${TMDB_KEY}`;
        const idRes = await fetch(idUrl);
        const idData = await idRes.json();
        const imdbId = idData.imdb_id;

        if (!imdbId) throw new Error("No IMDB ID found for streaming.");

        let typePath = `movie/${imdbId}`;
        if (type === 'tv') {
            const s = document.getElementById('season-select').value;
            const e = document.getElementById('selected-episode').value;
            typePath = `series/${imdbId}:${s}:${e}`;
        }

        // We expanded the quality filter and limit to give you better choices!
        // 🚨 THE FIX: Removed the broken "providers" tag!
        const torrentioUrl = `https://torrentio.strem.fun/torbox=${tbKey}|debridoptions=nodownloadlinks/stream/${typePath}.json`;
        const streamRes = await fetch(torrentioUrl);
        const streamData = await streamRes.json();

        if (!streamData.streams || streamData.streams.length === 0) {
            throw new Error("No streams found on Torrentio.");
        }

        // 🚨 RUN THE DATA THROUGH OUR NEW ENGINE 🚨
        const categorizedStreams = filterAndSortStreams(streamData.streams);

        if (categorizedStreams.top4K.length === 0 && categorizedStreams.top1080p.length === 0) {
            throw new Error("Found streams, but none were instantly cached in 4K or 1080p.");
        }

        const debugData = {
            streams4K: categorizedStreams.top4K.map(s => ({ score: s.score, name: s.name, title: s.title })),
            streams1080p: categorizedStreams.top1080p.map(s => ({ score: s.score, name: s.name, title: s.title }))
        };
        console.log("🔍 CLEAN FILTERED LINK DATA:", debugData);

        // Send the CATEGORIZED data to our visual picker!
        showStreamPicker(categorizedStreams, movieTitle);

    } catch (e) {
        console.error(e);
        showToast(e.message, 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

window.closeStreamPicker = () => {
    document.getElementById('stream-picker-modal').classList.add('hidden');
};


// Add a link to users library  
async function sendMagnetToTorbox(magnetLink, movieTitle) {
    const tbKey = localStorage.getItem('tb_api_key');
    if (!tbKey) return;

    const btn = document.getElementById('btn-torrent');
    const originalText = btn.innerHTML;
    btn.innerHTML = '⚡ Adding to Cloud...';
    btn.disabled = true;

    try {
        // 🧠 THE METADATA VAULT
        const hashMatch = magnetLink.match(/urn:btih:([a-zA-Z0-9]+)/i);

        // Read directly from the activeMedia state we locked earlier!
        if (hashMatch && activeMedia.id) {
            const hash = hashMatch[1].toLowerCase();
            let vault = JSON.parse(localStorage.getItem('tmdb_vault') || '{}');

            vault[hash] = {
                id: activeMedia.id,
                type: activeMedia.type,
                poster: activeMedia.poster
            };
            localStorage.setItem('tmdb_vault', JSON.stringify(vault));
            console.log(`📦 Saved [${hash}] -> ${movieTitle} to Local Vault!`);
        }

        // --- NORMAL TORBOX API CALL ---
        const tbUrl = 'https://api.torbox.app/v1/api/torrents/createtorrent';
        const formData = new FormData();
        formData.append('magnet', magnetLink);

        const tbRes = await smartFetch(tbUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${tbKey}` },
            body: formData
        });

        const tbData = await tbRes.json();

        if (tbData.success) {
            showToast(`Added "${movieTitle}" to your Library!`, 'success');

            window.closeMovieDetail();

            // Allow 1.5 seconds for TorBox to parse the file before switching to the library
            setTimeout(() => {
                if (typeof window.showLibraryTab === 'function') window.showLibraryTab();
                if (typeof window.refreshLibrary === 'function') window.refreshLibrary();
                else location.reload();
            }, 1500);

        } else {
            throw new Error(tbData.detail || "TorBox rejected the magnet.");
        }
    } catch (e) {
        console.error(e);
        showToast(`Failed to add: ${e.message}`, 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

//#region IFRAMES
const IFRAME_PROVIDERS = [
    // Your current favorite
    { name: "Server 1 (VidSrc Net)", movie: (id) => `https://vidsrc.net/embed/movie?tmdb=${id}`, tv: (id, s, e) => `https://vidsrc.net/embed/tv?tmdb=${id}&season=${s}&episode=${e}` },

    // Solid Alternative - uses different sources
    { name: "Server 2 (VidSrc XYZ)", movie: (id) => `https://vidsrc.xyz/embed/movie/${id}`, tv: (id, s, e) => `https://vidsrc.xyz/embed/tv/${id}/${s}/${e}` },

    // Completely different database (Good for "Video Not Found" errors)
    { name: "Server 3 (SuperEmbed)", movie: (id) => `https://multiembed.mov/?video_id=${id}&tmdb=1`, tv: (id, s, e) => `https://multiembed.mov/?video_id=${id}&tmdb=1&s=${s}&e=${e}` }
];

// --- SCRAPER IFRAME CONTROLS ---

window.openIframePlayer = (tmdbId, title, type, season, episode) => {
    // 1. Set the Title
    document.getElementById('iframe-title').innerText = `Playing: ${title}`;
    const iframe = document.getElementById('scraper-iframe');
    const injectionPoint = document.getElementById('iframe-header-injection-point');

    // 2. Clear out the dropdown from the last movie you watched
    injectionPoint.innerHTML = '';

    // 3. Create the new Dropdown Menu
    const selectBox = document.createElement('select');
    selectBox.className = "bg-slate-800 text-white border border-slate-600 rounded-lg p-1.5 outline-none text-sm cursor-pointer shadow-lg max-w-[130px] md:max-w-none truncate";

    // 4. Fill the dropdown with our servers
    IFRAME_PROVIDERS.forEach((provider, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.text = provider.name;
        selectBox.appendChild(option);
    });

    // 5. Instantly swap servers when you pick a new one
    selectBox.onchange = (e) => {
        const provider = IFRAME_PROVIDERS[e.target.value];
        iframe.src = type === 'tv' ? provider.tv(tmdbId, season, episode) : provider.movie(tmdbId);
    };

    // 6. Put the dropdown next to the close button
    injectionPoint.appendChild(selectBox);

    // 7. Load Server 1 (VidLink) by default
    const defaultProvider = IFRAME_PROVIDERS[0];
    iframe.src = type === 'tv' ? defaultProvider.tv(tmdbId, season, episode) : defaultProvider.movie(tmdbId);

    // 8. Show the theater and lock scrolling
    document.getElementById('iframe-player-view').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
};

window.closeIframePlayer = () => {
    document.getElementById('scraper-iframe').src = '';
    document.getElementById('iframe-player-view').classList.add('hidden');
    document.body.style.overflow = '';
};