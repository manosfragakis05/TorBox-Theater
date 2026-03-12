const TMDB_KEY = 'ee7a32cee36ed0cd1f028f10c32fa0cf';

const rowState = {
    'trending-row': { page: 1, endpoint: 'trending/movie/week', loading: false, hasMore: true },
    'new-row': { page: 1, endpoint: 'movie/now_playing', loading: false, hasMore: true },
    'global-search-grid': { page: 1, query: '', loading: false, hasMore: true },
    'action-row': { page: 1, endpoint: 'discover/movie?with_genres=28', loading: false, hasMore: true },
    'comedy-row': { page: 1, endpoint: 'discover/movie?with_genres=35&without_genres=80,18,28,53', loading: false, hasMore: true },
    'thriller-row': { page: 1, endpoint: 'discover/movie?with_genres=53,96&without_genres=28,878', loading: false, hasMore: true },    'anime-row': { page: 1, endpoint: 'discover/movie?with_genres=16&with_original_language=ja', loading: false, hasMore: true },
    'top-row': { page: 1, endpoint: 'movie/top_rated', loading: false, hasMore: true },
    'my-picks-row': { loading: false }
};

let isDragging = false;

function enableDragScroll(containerId) {
    const slider = document.getElementById(containerId);
    let isDown = false;
    let startX;
    let scrollLeft;

    slider.addEventListener('mousedown', (e) => {
        isDown = true;
        isDragging = false;
        slider.classList.add('cursor-grabbing');
        slider.classList.remove('snap-x'); // Smooth drag
        startX = e.pageX - slider.offsetLeft;
        scrollLeft = slider.scrollLeft;
    });

    slider.addEventListener('mouseleave', () => {
        isDown = false;
        slider.classList.remove('cursor-grabbing');
        slider.classList.add('snap-x');
    });

    slider.addEventListener('mouseup', () => {
        isDown = false;
        slider.classList.remove('cursor-grabbing');
        slider.classList.add('snap-x');
        setTimeout(() => isDragging = false, 50); // Delay protects the click
    });

    slider.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - slider.offsetLeft;
        const walk = (x - startX) * 2;
        if (Math.abs(walk) > 5) isDragging = true;
        slider.scrollLeft = scrollLeft - walk;
    });


    slider.addEventListener('scroll', () => {
        if (slider.scrollWidth - slider.scrollLeft - slider.clientWidth < 300) {
            fetchNextPage(containerId);
        }
    });
}


function appendCards(movies, containerId) {
    const row = document.getElementById(containerId);
    
    movies.forEach(movie => {
        if (!movie.poster_path) return;

        const card = document.createElement('div');
        card.className = "relative flex-none w-32 md:w-40 cursor-pointer transition-transform hover:scale-105 snap-start select-none";
        
        card.innerHTML = `
            <img src="https://image.tmdb.org/t/p/w500${movie.poster_path}" 
                 class="rounded-lg shadow-lg w-full h-auto object-cover border border-slate-700/50 bg-slate-800 aspect-[2/3]" 
                 draggable="false" 
                 alt="${movie.title}">
            <p class="text-xs text-slate-300 mt-2 truncate font-semibold pl-1">${movie.title}</p>
            <p class="text-[10px] text-slate-500 pl-1">${movie.release_date ? movie.release_date.split('-')[0] : ''}</p>
        `;
        
        card.onclick = (e) => {
            if (isDragging) {
                e.preventDefault();
                return; 
            }
            openMovieDetail(movie.id, movie.media_type || 'movie');
        };
        row.appendChild(card);
    });
}

// Fetches the initial Page 1
async function fetchAndBuildRow(endpoint, containerId) {
    const row = document.getElementById(containerId);
    row.innerHTML = '<p class="text-slate-400 pl-2 text-sm mt-4">Loading...</p>';

    rowState[containerId].page = 1;
    rowState[containerId].hasMore = true;
    rowState[containerId].loading = true;

    try {
        // SMART URL BUILDER: Checks if we need a '?' or an '&'
        const separator = endpoint.includes('?') ? '&' : '?';
        const url = `https://api.themoviedb.org/3/${endpoint}${separator}api_key=${TMDB_KEY}&language=en-US&page=1`;
        
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
        url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(state.query)}&page=${state.page}`;
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
        const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(query)}&page=1`;
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
// App Booter
export async function loadDiscover() {
    // 1. Activate Drag Scrolling
    enableDragScroll('global-search-grid');
    enableDragScroll('trending-row');
    enableDragScroll('new-row');
    enableDragScroll('top-row');
    enableDragScroll('action-row');
    enableDragScroll('comedy-row');
    enableDragScroll('thriller-row');
    enableDragScroll('anime-row');
    enableDragScroll('my-picks-row');

    // 2. Fetch the Data
    fetchAndBuildRow('trending/movie/week', 'trending-row');
    fetchAndBuildRow('movie/now_playing', 'new-row');
    fetchAndBuildRow('movie/top_rated', 'top-row');
    fetchAndBuildRow('discover/movie?with_genres=28', 'action-row');
    fetchAndBuildRow('discover/movie?with_genres=35&without_genres=80,18,28,53', 'comedy-row');
    fetchAndBuildRow('discover/movie?with_genres=53', 'thriller-row');
    fetchAndBuildRow('discover/movie?with_genres=16&with_original_language=ja', 'anime-row');

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
        // We use search/multi so it finds both Movies AND TV Shows!
        let url = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&query=${encodeURIComponent(cleanTitle)}&page=1`;
        if (year) url += `&primary_release_year=${year}`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.results && data.results.length > 0 && data.results[0].poster_path) {
            return `https://image.tmdb.org/t/p/w500${data.results[0].poster_path}`;
        }
        return null; // Return nothing if TMDB can't find it
    } catch (e) {
        return null;
    }
}

// --- THE GOAT LOADERS ---

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

export async function openMovieDetail(id, type = 'movie') {
    const view = document.getElementById('movie-detail-view');
    
    try {
        // 1. Fetch deep details from TMDB
        const url = `https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_KEY}&language=en-US`;
        const res = await fetch(url);
        const data = await res.json();

        // 2. Map data
        const title = data.title || data.name;
        const date = data.release_date || data.first_air_date || '';
        const year = date.split('-')[0];
        const runtime = data.runtime ? `${data.runtime}m` : (data.episode_run_time ? `${data.episode_run_time[0]}m` : '');
        const backdrop = data.backdrop_path ? `https://image.tmdb.org/t/p/original${data.backdrop_path}` : '';
        const poster = data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : '';

        // 3. Fill the HTML Info
        document.getElementById('detail-backdrop').style.backgroundImage = `url(${backdrop})`;
        document.getElementById('detail-poster').src = poster;
        document.getElementById('detail-title').innerText = title;
        document.getElementById('detail-year').innerText = year;
        document.getElementById('detail-runtime').innerText = runtime || 'N/A';
        document.getElementById('detail-rating').innerText = `TMDB ★ ${data.vote_average?.toFixed(1)}`;
        document.getElementById('detail-tagline').innerText = data.tagline || '';
        document.getElementById('detail-overview').innerText = data.overview;

        // 4. FIX: POPULATE THE TV DROPDOWNS!
        const tvSelector = document.getElementById('tv-selector');
        const seasonSelect = document.getElementById('season-select');
        const epSelect = document.getElementById('episode-select');

        if (type === 'tv') {
            tvSelector.classList.remove('hidden');
            seasonSelect.innerHTML = '';
            
            // Filter out "Season 0" (Specials)
            const validSeasons = data.seasons ? data.seasons.filter(s => s.season_number > 0) : [];
            
            validSeasons.forEach(s => {
                seasonSelect.innerHTML += `<option value="${s.season_number}">Season ${s.season_number}</option>`;
            });

            // Auto-fetch episodes when season changes
            seasonSelect.onchange = async () => {
                const sNum = seasonSelect.value;
                const sUrl = `https://api.themoviedb.org/3/tv/${id}/season/${sNum}?api_key=${TMDB_KEY}`;
                const sRes = await fetch(sUrl);
                const sData = await sRes.json();
                
                epSelect.innerHTML = '';
                sData.episodes.forEach(ep => {
                    epSelect.innerHTML += `<option value="${ep.episode_number}">Ep ${ep.episode_number}: ${ep.name}</option>`;
                });
            };
            
            // Trigger first load
            if (validSeasons.length > 0) {
                seasonSelect.value = validSeasons[0].season_number;
                seasonSelect.onchange(); 
            }
        } else {
            if (tvSelector) tvSelector.classList.add('hidden');
        }

        // 5. THE BUTTON ACTIONS
        const btnTorrent = document.getElementById('btn-torrent');
        const btnScraper = document.getElementById('btn-scraper');

        btnTorrent.onclick = () => {
            startTorrentioStream(id, title, type);
        };

        btnScraper.onclick = () => {
            // Grab the season and episode if it's a TV show
            const s = type === 'tv' ? document.getElementById('season-select').value : null;
            const e = type === 'tv' ? document.getElementById('episode-select').value : null;
            
            // Pass the raw data to our smart player function
            openIframePlayer(id, title, type, s, e);
        };

        // 6. FIX: ACTUALLY SHOW THE PAGE!
        view.classList.remove('translate-y-full');
        document.body.style.overflow = 'hidden';

    } catch (e) {
        console.error("Detail View Error:", e);
        alert("Couldn't load movie details.");
    }
}

// Global close function
window.closeMovieDetail = () => {
    document.getElementById('movie-detail-view').classList.add('translate-y-full');
    document.body.style.overflow = ''; // Restore scrolling
};

// --- THE STREAM TRIGGER ---
async function startTorrentioStream(id, title, type) {
    console.log(`Starting Torrentio for ${type}: ${title}`);
    try {
        // 1. Get IMDB ID
        const idUrl = `https://api.themoviedb.org/3/${type}/${id}/external_ids?api_key=${TMDB_KEY}`;
        const idRes = await fetch(idUrl);
        const idData = await idRes.json();
        const imdbId = idData.imdb_id;

        if (!imdbId) return alert("No IMDB ID found for streaming.");

        // 2. FIX: DYNAMIC TV EPISODE IN URL
        let typePath = `movie/${imdbId}`; // Default for movies
        
        if (type === 'tv') {
            const s = document.getElementById('season-select').value;
            const e = document.getElementById('episode-select').value;
            typePath = `series/${imdbId}:${s}:${e}`; // e.g. series/tt0903747:5:14
        }

        const torrentioUrl = `https://torrentio.strem.fun/providers=yts,eztv,rarbg,1337x,thepiratebay|qualityfilter=4k,remux|limit=3/stream/${typePath}.json`;
        
        const streamRes = await fetch(torrentioUrl);
        const streamData = await streamRes.json();

        if (streamData.streams?.length > 0) {
            const streamUrl = streamData.streams[0].url;
            import('./player.js').then(m => m.startPlayer(streamUrl, title));
        } else {
            alert("No streams found on Torrentio.");
        }
    } catch (e) { console.error(e); }
}

// --- SCRAPER IFRAME CONTROLS ---

// --- SERVERS ---
const IFRAME_PROVIDERS = [
    { name: "Server 2 (MultiEmbed)", movie: (id) => `https://multiembed.mov/?video_id=${id}&tmdb=1`, tv: (id, s, e) => `https://multiembed.mov/?video_id=${id}&tmdb=1&s=${s}&e=${e}` },
    { name: "Server 1 (VidLink / SFlix)", movie: (id) => `https://vidlink.pro/movie/${id}`, tv: (id, s, e) => `https://vidlink.pro/tv/${id}/${s}/${e}` },
    { name: "Server 3 (Cineby)", movie: (id) => `https://cineby.gd/embed/movie/${id}`, tv: (id, s, e) => `https://cineby.gd/embed/tv/${id}/${s}/${e}` },
    { name: "Server 4 (VidSrc CC)", movie: (id) => `https://vidsrc.cc/v2/embed/movie/${id}`, tv: (id, s, e) => `https://vidsrc.cc/v2/embed/tv/${id}/${s}/${e}` },
    { name: "Server 5 (VidSrc Net)", movie: (id) => `https://vidsrc.net/embed/movie?tmdb=${id}`, tv: (id, s, e) => `https://vidsrc.net/embed/tv?tmdb=${id}&season=${s}&episode=${e}` }
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