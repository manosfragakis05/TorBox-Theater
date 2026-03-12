import { feed, playMKV } from './mkv-remux-tool/mkv_lib.js';
import { smartFetch, scrobble } from './script.js'; // Import the tools from main script

export let art = null;
export let currentStreamUrl = "";

// --- PLAYER LOGIC ---
export async function requestLink(tid, fid, torrentName, fileName) {
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
        alert("Error requesting link.");
    } finally {
        list.style.opacity = '1';
    }
}

export function startPlayer(url, name) {
    currentStreamUrl = url;
    document.getElementById('player-wrapper').classList.remove('hidden');

    if (art) art.destroy();

    const isMkv = name.toLowerCase().endsWith('.mkv') || url.toLowerCase().split('?')[0].endsWith('.mkv');
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    const videoType = (isMkv && isIOS) ? 'wasm_mkv' : 'auto';

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

        customType: {
            wasm_mkv: async function (videoElement, artUrl, art) {
                console.log("🍎 iOS/Forced MKV Detected! Booting WebAssembly Engine...");
                art.notice.show = "Booting Engine...";
                try {
                    await playMKV(artUrl, videoElement, 0);
                } catch (error) {
                    console.error("Engine Crash:", error);
                    art.notice.show = "Error: Engine failed to decode this MKV.";
                }
            }
        },
    });

    art.on('video:error', () => {
        console.log("❌ Player Error Detected!");
        handlePlaybackFailure("Format not supported or link is dead.");
    });

    art.on('play', () => { scrobble('start', name, 0); });
    art.on('pause', () => { scrobble('stop', name, art.currentTime / art.duration * 100); });
    art.on('destroy', () => { scrobble('stop', name, art.currentTime / art.duration * 100); });

    art.play();

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
        if (isMkv && !scoutSent) {
            scoutSent = true;
            console.log("🕵️ Native video is playing! Bandwidth is free. Sending Scout...");

            try {
                const engine = await feed(url);

                if (engine.audioTracks && engine.audioTracks.length > 1) {
                    console.log(`🎧 Found ${engine.audioTracks.length} tracks! Adding menu...`);

                    const langMap = {
                        'eng': 'English', 'gr': 'Greek', 'jpn': 'Japanese', 'spa': 'Spanish',
                        'fre': 'French', 'ger': 'German', 'ita': 'Italian', 'und': 'Unknown'
                    };

                    const trackOptions = engine.audioTracks.map((t, index) => {
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

                            await engine.switchAudioTrack(item.trackNumber);

                            if (engine.video !== art.video) {
                                console.log("🎬 Hijacking Native Player -> Switching to WASM Engine...");
                                await playMKV(url, art.video);

                                const restoreVideo = () => {
                                    art.currentTime = savedTime;
                                    if (wasPlaying) art.play();
                                    art.video.removeEventListener('loadeddata', restoreVideo);
                                };
                                art.video.addEventListener('loadeddata', restoreVideo);
                            }
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
    clearPlayerInstance(); // Clear it internally

    document.getElementById('player-wrapper').classList.add('hidden');

    const errorDiv = document.createElement('div');
    errorDiv.className = "fixed top-5 right-5 bg-red-600 text-white p-4 rounded shadow-lg z-50 transition-opacity duration-500";
    errorDiv.innerHTML = `<strong>Playback Failed</strong><br><span class="text-sm">${reason}</span>`;
    document.body.appendChild(errorDiv);

    setTimeout(() => errorDiv.remove(), 5000);
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