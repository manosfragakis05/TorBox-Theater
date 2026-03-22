import { MKVPlayer } from './engine/mkv_lib.js';
import { smartFetch, scrobble, showToast, stopPlayback } from './script.js'; // Import the tools from main script

export let art = null;
export let currentStreamUrl = "";

// --- PLAYER LOGIC ---
export async function requestLink(tid, fid, torrentName, fileName) {
    stopPlayback();

    window.abortPlayback = false;

    const key = localStorage.getItem('tb_api_key');
    const list = document.getElementById('file-list');
    list.style.opacity = '0.5';

    try {
        const targetUrl = `https://api.torbox.app/v1/api/torrents/requestdl?token=${key}&torrent_id=${tid}&file_id=${fid}&zip=false`;
        const res = await smartFetch(targetUrl);
        const data = await res.json();

        if (data.success) {
            startPlayer(data.data, fileName || torrentName);
        } else {
            alert("Link Error: " + data.detail);
        }
    } catch (e) {
        showToast("Error requesting link.", 'error');
    } finally {
        list.style.opacity = '1';
    }

    if (window.abortPlayback) {
        console.log("Ghost playback prevented! User went home.");
        return;
    }
}

export function startPlayer(url, name) {
    stopPlayback();

    window.abortPlayback = false;

    currentStreamUrl = url;
    document.getElementById('player-wrapper').classList.remove('hidden');

    if (art) art.destroy();

    const isMkv = name.toLowerCase().endsWith('.mkv') || url.toLowerCase().split('?')[0].endsWith('.mkv');
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    const videoType = isMkv ? 'wasm_mkv' : 'auto';

    if (window.abortPlayback) {
        console.warn("🛑 Race Condition Prevented: Aborting player initialization!");
        return;
    }

    art = new Artplayer({
        container: '.artplayer-app',
        url: url,
        title: name,
        type: videoType,
        autoSize: false,
        playsInline: true,
        fullscreen: true,
        fullscreenWeb: true,
        setting: true,
        lock: true,
        fastForward: true,
        theme: '#3b82f6',
        pip: true,
        autoPlayback: true,
        miniProgressBar: false,
        screenshot: false,
        subtitleOffset: false,
        playbackRate: false,

        // Download MKV from given link
        controls: [
            {
                position: 'right',
                html: '<svg style="width:22px;height:22px;margin-top:2px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>',
                tooltip: 'Download Original File',
                click: function () {
                    // This opens the TorBox link in a new tab, instantly starting the raw MKV download!
                    window.open(url, '_blank');
                },
            }
        ],

        customType: {
            wasm_mkv: async function (videoElement, artUrl, artInstance) {
                console.log("MKV Detected! Booting WebAssembly Engine...");
                artInstance.notice.show = "Booting Engine...";

                try {
                    // Use the new class!
                    const player = new MKVPlayer(videoElement);
                    await player.load(artUrl);
                    artInstance.mkvEngine = player;

                    artInstance.notice.show = "Engine Ready!";

                    videoElement.addEventListener('loadeddata', () => {
                        artInstance.play();
                    }, { once: true });
                } catch (error) {
                    console.error("Engine Crash:", error);
                    artInstance.notice.show = "Error: Engine failed to decode this MKV.";
                }
            }
        },
    });

    art.on('video:error', () => {
        console.log("❌ Player Error Detected!");
        handlePlaybackFailure("Format not supported or link is dead.");
    });

    art.on('destroy', () => {
        console.log("Player destroyed. Checking for background engines...");
        if (art.mkvEngine) {
            art.mkvEngine.destroy(); // Pull the kill switch!
            art.mkvEngine = null;
        }
    });

    //art.on('play', () => { scrobble('start', name, 0); });
    //art.on('pause', () => { scrobble('stop', name, art.currentTime / art.duration * 100); });
    //art.on('destroy', () => { scrobble('stop', name, art.currentTime / art.duration * 100); });

    if (videoType !== 'wasm_mkv') {
        art.play();
    }

    art.on('ready', () => {
        if (isIOS) {
            console.log("🍎 iPhone detected. Hijacking the Fullscreen button...");
            art.controls.update({
                name: 'fullscreen',
                click: function () {
                    art.fullscreenWeb = !art.fullscreenWeb;
                    if (art.fullscreenWeb) art.notice.show = "Switched to Web Fullscreen";
                }
            });
        }
    });

    let scoutSent = false;
    art.on('video:playing', async () => {
        // Make sure it's an MKV and the main engine actually exists
        if (isMkv && !scoutSent && art.mkvEngine) {
            scoutSent = true;
            console.log("🕵️ Fetching tracks from existing engine...");

            try {
                // Grab the ALREADY RUNNING engine
                const player = art.mkvEngine;

                // Grab the tracks instantly from memory
                const audioTracks = player.getAudioTracks();

                if (audioTracks && audioTracks.length > 1) {
                    console.log(`🎧 Found ${audioTracks.length} tracks! Adding menu...`);

                    const langMap = {
                        'eng': 'English', 'gr': 'Greek', 'jpn': 'Japanese', 'spa': 'Spanish',
                        'fre': 'French', 'ger': 'German', 'ita': 'Italian', 'und': 'Unknown'
                    };

                    const trackOptions = audioTracks.map((t, index) => {
                        let langName = langMap[t.language] || (index === 0 ? 'Primary' : `Track ${t.track_number}`);
                        const codecName = t.codec_string ? ` (${t.codec_string})` : '';

                        return {
                            html: `${langName}${codecName}`,
                            trackNumber: t.track_number,
                            default: index === 0
                        };
                    });

                    art.setting.add({
                        html: 'Audio Track',
                        tooltip: trackOptions[0].html,
                        selector: trackOptions,
                        onSelect: async function (item) {
                            art.notice.show = `Swapping audio...`;
                            const savedTime = art.currentTime;
                            const wasPlaying = art.playing;

                            player.setAudioTrack(item.trackNumber);

                            const restoreVideo = () => {
                                art.currentTime = savedTime;
                                if (wasPlaying) art.play();
                                art.video.removeEventListener('loadeddata', restoreVideo);
                            };
                            art.video.addEventListener('loadeddata', restoreVideo);

                            return item.html;
                        }
                    });
                }
            } catch (e) {
                console.warn("Scout failed to read tracks:", e);
            }
        }
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function handlePlaybackFailure(reason) {
    if (!art) return;
    art.destroy();
    clearPlayerInstance();
    document.getElementById('player-wrapper').classList.add('hidden');

    // 🛑 USE THE NEW GLOBAL SYSTEM
    showToast(`Playback Failed: ${reason}`, 'error');
}

export function playDirect() {
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

// Helper to safely clear the player variable from other files
export function clearPlayerInstance() {
    art = null;
}