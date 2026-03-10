// mkv_lib.js - Standalone WebAssembly MKV SDK
import init, { get_mkv_info, get_mkv_info_fast, parse_cues, Demuxer, alloc_memory, free_memory } from './streaming_engine.js';
class MKVFetcher {
    constructor(type, source) {
        this.type = type;
        this.source = source;
        this.size = Infinity; // Default to Infinity to prevent 416 negative ranges!
    }

    async init() {
        if (this.type === 'file') {
            this.size = this.source.size;
            return;
        }

        try {
            // 1. Try the standard HEAD request first (The cleanest way)
            const res = await fetch(this.source, { method: 'HEAD' });
            const length = parseInt(res.headers.get('content-length'));
            if (length && !isNaN(length)) {
                this.size = length;
                return;
            }
        } catch (e) {
            console.warn("HEAD request failed, trying fallback...");
        }

        try {
            // 2. Fallback: 1-byte GET request
            const controller = new AbortController();
            const res = await fetch(this.source, {
                headers: { 'Range': 'bytes=0-0' },
                signal: controller.signal
            });
            const cr = res.headers.get('content-range');
            if (cr) {
                this.size = parseInt(cr.split('/')[1]);
            }
            controller.abort(); // Stop downloading immediately
        } catch (e) {
            console.warn("Could not fetch file size. Engine will run in blind mode.");
        }
    }

    async read(start, end, signal) {
        if (this.size !== Infinity && end > this.size) end = this.size;

        // CRITICAL FIX: Prevent bytes=0--1 which causes the 416 errors
        if (start >= end) return new Uint8Array(0);

        if (this.type === 'file') {
            return new Uint8Array(await this.source.slice(start, end).arrayBuffer());
        } else {
            const res = await fetch(this.source, {
                headers: { 'Range': `bytes=${start}-${end - 1}` },
                signal: signal
            });

            if (!res.ok) {
                if (res.status === 416) return new Uint8Array(0); // Hit the end of the file
                throw new Error(`HTTP Error ${res.status} for range ${start}-${end - 1}`);
            }
            return new Uint8Array(await res.arrayBuffer());
        }
    }

    // Add this inside the MKVFetcher class in mkv_lib.js
    async *stream(start, end, signal) {
        if (this.size !== Infinity && end > this.size) end = this.size;
        if (start >= end) return;

        let streamObj;
        if (this.type === 'file') {
            // Local files can be streamed using Blob.stream()
            streamObj = this.source.slice(start, end).stream();
        } else {
            const res = await fetch(this.source, {
                headers: { 'Range': `bytes=${start}-${end - 1}` },
                signal: signal
            });

            if (!res.ok) {
                if (res.status === 416) return; // Hit EOF
                throw new Error(`HTTP Error ${res.status} for range ${start}-${end - 1}`);
            }
            streamObj = res.body;
        }

        // Read the stream chunk-by-chunk as it arrives over the network
        const reader = streamObj.getReader();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                yield value; // Yield smaller Uint8Arrays immediately
            }
        } finally {
            reader.releaseLock();
        }
    }
}

// Helper to decode MKV Variable-Size Integers (VINTs) safely!
function readVintJS(buffer, offset, maxOffset) {
    if (offset >= maxOffset) return null;

    const firstByte = buffer[offset];
    let length = 0;

    if (firstByte & 0x80) length = 1;
    else if (firstByte & 0x40) length = 2;
    else if (firstByte & 0x20) length = 3;
    else if (firstByte & 0x10) length = 4;
    else if (firstByte & 0x08) length = 5;
    else if (firstByte & 0x04) length = 6;
    else if (firstByte & 0x02) length = 7;
    else if (firstByte & 0x01) length = 8;
    else return null;

    // CRITICAL: If the VINT is 4 bytes long, but we only downloaded 2 bytes so far,
    // return null! We will catch it again seamlessly on the next chunk.
    if (offset + length > maxOffset) return null;

    let value = firstByte & (0xFF >> length);
    for (let i = 1; i < length; i++) {
        value = (value * 256) + buffer[offset + i];
    }

    return { value: value, length: length };
}

class CoreEngine {
    constructor() {
        this.video = null; // No video tag at first!
        this.chunkSize = 5 * 1024 * 1024; // 5MB chunks
        this._resetState();
    }

    log(msg) {
        console.log("⚙️ Engine:", msg);
    }

    _resetState() {
        this.isFetching = false;
        if (this.abortController) this.abortController.abort();
        this.abortController = null;
        this.currentStreamId = (this.currentStreamId || 0) + 1;
        this.currentOffset = 0;
        this.cueMap = [];
        if (this.seekTimeout) clearTimeout(this.seekTimeout);
        this.seekTimeout = null;
        this.audioTracks = [];
        this.sourceBuffer = null;
    }

    attachVideo(videoElement) {
        this.video = videoElement;
        this.video.disableRemotePlayback = true;
        this.video.onseeking = () => this._onSeeking();
        this.video.ontimeupdate = () => this._onTimeUpdate();
        this.video.src = URL.createObjectURL(this.mediaSource);
        this.log("Video tag attached. Stream routed to screen.");
    }

    async preload(fetcher) {
        this._resetState();
        this.sourceInput = fetcher;
        await this.sourceInput.init(); // Does the 1-byte GET bypass

        this.log("Probing for MKV clusters (Dynamic Streamed Preload)...");

        const maxProbe = 50 * 1024 * 1024;
        let capacity = 2 * 1024 * 1024; // Start lightweight: 2MB
        
        const wasm = await init(); 
        let ptr = alloc_memory(capacity);
        let wasmHeap = new Uint8Array(wasm.memory.buffer, ptr, capacity);

        let currentSize = 0;
        let absoluteFileOffset = 0; 
        let clusterFound = false;

        // NEW: Wrap the stream in a while loop so we can restart it after a jump
        while (!clusterFound && absoluteFileOffset < this.sourceInput.size && currentSize < maxProbe) {
            const probeController = new AbortController();
            let jumped = false;

            try {
                // Fetch from our current absolute file offset to the end of the file
                for await (const chunk of this.sourceInput.stream(absoluteFileOffset, this.sourceInput.size, probeController.signal)) {

                    // 1. WASM Memory reallocation (Your zero-copy logic from earlier)
                    if (currentSize + chunk.length > capacity) {
                        let oldPtr = ptr;
                        let oldCapacity = capacity;
                        capacity = Math.max(capacity * 2, currentSize + chunk.length);
                        ptr = alloc_memory(capacity);
                        let freshBuffer = wasm.memory.buffer;
                        let oldView = new Uint8Array(freshBuffer, oldPtr, currentSize);
                        let newWasmHeap = new Uint8Array(freshBuffer, ptr, capacity);
                        newWasmHeap.set(oldView);
                        free_memory(oldPtr, oldCapacity);
                        wasmHeap = newWasmHeap;
                    } else if (wasmHeap.buffer.byteLength === 0) {
                        wasmHeap = new Uint8Array(wasm.memory.buffer, ptr, capacity);
                    }

                    // Write chunk DIRECTLY into Rust's memory
                    wasmHeap.set(chunk, currentSize);

                    let scanStart = Math.max(0, currentSize - 8); // Look back slightly further for safety
                    currentSize += chunk.length;
                    absoluteFileOffset += chunk.length; // Keep file position in sync

                    // Scan the newly added bytes
                    for (let i = scanStart; i < currentSize - 4; i++) {

                        // --- TRIPWIRE 1: THE VIDEO CLUSTER (The Finish Line) ---
                        if (wasmHeap[i] === 0x1F && wasmHeap[i + 1] === 0x43 &&
                            wasmHeap[i + 2] === 0xB6 && wasmHeap[i + 3] === 0x75) {
                            clusterFound = true;

                            // NEW: Save the exact network location of the video!
                            this.firstClusterOffset = absoluteFileOffset - currentSize + i;

                            probeController.abort(); // Stop downloading
                            break;
                        }

                        // --- TRIPWIRE 2: ATTACHMENTS (The Fonts to Skip) ---
                        if (wasmHeap[i] === 0x19 && wasmHeap[i + 1] === 0x41 &&
                            wasmHeap[i + 2] === 0xA4 && wasmHeap[i + 3] === 0x69) {

                            const vint = readVintJS(wasmHeap, i + 4, currentSize);

                            if (vint) {
                                // NEW: The "SeekHead" Trap Prevention!
                                // Ignore false positives and tiny attachments under 1MB.
                                if (vint.value < 1024 * 1024) continue;

                                const skipAmount = 4 + vint.length + vint.value;
                                this.log(`🎯 Attachments detected! Size: ${(vint.value / 1024 / 1024).toFixed(2)} MB. Initiating Jump...`);

                                const startOfBufferOffset = absoluteFileOffset - currentSize;
                                absoluteFileOffset = startOfBufferOffset + i + skipAmount;
                                currentSize = i;

                                jumped = true;
                                probeController.abort();
                                break;
                            }
                        }
                    }

                    if (clusterFound || jumped) break; // Exit the for-await loop
                    if (currentSize >= maxProbe) break; // RAM safety limit
                }
            } catch (err) {
                if (err?.name !== 'AbortError') throw err;
            }

            if (clusterFound) break; // We got the video, break the while loop!
        }

        if (!clusterFound) throw new Error("Could not find Video Track.");

        this.log("Parsing metadata via Zero-Copy Rust pointer...");

        this.initialHeaderData = wasmHeap.slice(0, currentSize);
        
        // 3. READ METADATA WITHOUT COPYING
        this.mkvHeader = get_mkv_info_fast(ptr, currentSize);
        
        // Now it is safe to free the pointer, Rust's memory addresses remain static
        free_memory(ptr, capacity); 
        
        const videoTrack = this.mkvHeader.tracks.find(t => t.track_type === "video");
        this.audioTracks = this.mkvHeader.tracks.filter(t => t.track_type === "audio");
        const audioTrack = this.audioTracks.length > 0 ? this.audioTracks[0] : null;

        if (this.mkvHeader.cues_position) {
            const pos = Number(this.mkvHeader.cues_position);
            const cuesData = await this.sourceInput.read(pos, this.sourceInput.size, null);
            this.cueMap = parse_cues(cuesData);
        }

        const audioId = audioTrack ? BigInt(audioTrack.track_number) : 0n;
        this.demuxer = new Demuxer(
            BigInt(videoTrack.track_number), audioId,
            videoTrack.width, videoTrack.height,
            this.mkvHeader.duration * 1000, videoTrack.codec_id
        );

        this.videoTrack = videoTrack;
        this.audioTrack = audioTrack;

        this.log("✅ Engine Preloaded & Warmed up! Waiting for video tag...");

        // --- 3. PREPARE THE BROWSER MSE ---
        const MSE = window.ManagedMediaSource || window.MediaSource;
        if (!MSE) return this.log("Error: MSE not supported.");

        this.mediaSource = new MSE();
        this.mediaSource.addEventListener('sourceopen', () => this._onSourceOpen());
    }

    async _onSourceOpen() {
        try {
            // This ONLY runs when the user clicks Play and attachVideo is called!
            let mime = `video/mp4; codecs="${this.videoTrack.codec_string}`;
            if (this.audioTrack) mime += `, ${this.audioTrack.codec_string}`;
            mime += `"`;

            this.sourceBuffer = this.mediaSource.addSourceBuffer(mime);
            this.sourceBuffer.mode = 'segments';
            this.mediaSource.duration = this.mkvHeader.duration;

            // Feed the data we already downloaded into the buffer!
            await this._appendToBuffer(this.demuxer.init(this.initialHeaderData));
            this.currentOffset = this.cueMap.length > 0
                ? Math.max(0, Number(this.cueMap[0].offset) - 100000)
                : (this.firstClusterOffset || 0);

            this.log("▶️ Stream routed to screen. Buffering clusters...");

            // Remove the leash limit from _streamLoop if you added one, 
            // since this now only runs when the video is actively playing!
            this._streamLoop();

        } catch (error) {
            console.error("Engine Crash:", error);
        }
    }

    async _streamLoop() {
        if (!this.sourceBuffer) return;

        let myStreamId = this.currentStreamId;
        if (this.isFetching || this.currentOffset >= this.sourceInput.size) return;
        this.isFetching = true;

        while (this.currentOffset < this.sourceInput.size && myStreamId === this.currentStreamId) {
            // If there's no video attached yet, just buffer 10 seconds and wait.
            let bufferedEnd = this.video ? this.video.currentTime : 0;

            for (let i = 0; i < this.sourceBuffer.buffered.length; i++) {
                let end = this.sourceBuffer.buffered.end(i);
                if (end > bufferedEnd) bufferedEnd = end;
            }

            let limit = this.video ? (bufferedEnd - this.video.currentTime) : bufferedEnd;
            if (limit > 30) break; // Don't download too far ahead

            this.abortController = new AbortController();
            try {
                let bytesProcessed = 0;
                
                for await (const chunkData of this.sourceInput.stream(this.currentOffset, this.currentOffset + this.chunkSize, this.abortController.signal)) {
                    if (myStreamId !== this.currentStreamId) break;

                    const isFinal = (this.currentOffset + bytesProcessed + chunkData.length) >= this.sourceInput.size;
                    
                    // 1. Instantly parse the chunk and grab the primitive integer (No Garbage Collection!)
                    const framesStaged = this.demuxer.parse_chunk(chunkData, isFinal);

                    // 2. THE GATEKEEPER: Only wake up the iPhone hardware decoder once per second
                    if (framesStaged >= 30 || isFinal) {
                        const segment = this.demuxer.get_mp4_segment();
                        
                        if (segment.length > 0 && this.sourceBuffer) {
                            await this._appendToBuffer(segment);
                            
                            // 3. THE MICRO-YIELD: Let the iOS UI thread breathe so the phone doesn't heat up
                            await new Promise(r => setTimeout(r, 0));
                        }
                    }
                    bytesProcessed += chunkData.length;
                }
                
                this.currentOffset += bytesProcessed;
            } catch (err) {
                if (err?.name === 'AbortError') break;
                else { console.error(err); break; }
            } finally {
                this.abortController = null;
            }
        }
        if (myStreamId === this.currentStreamId) this.isFetching = false;
    }

    _onTimeUpdate() {
        if (!this.sourceBuffer || !this.video) return;
        if (!this.video.paused && this.video.readyState <= 2) {
            for (let i = 0; i < this.sourceBuffer.buffered.length; i++) {
                let start = this.sourceBuffer.buffered.start(i);
                if (start > this.video.currentTime && start - this.video.currentTime < 0.5) {
                    this.video.currentTime = start + 0.01; break;
                }
            }
        }
        this._streamLoop();
    }

    _onSeeking() {
        if (!this.video) return;
        if (this.abortController) { this.abortController.abort(); this.abortController = null; }
        if (this.sourceBuffer?.updating) this.sourceBuffer.abort();
        if (this.seekTimeout) clearTimeout(this.seekTimeout);

        this.seekTimeout = setTimeout(async () => {
            this.currentStreamId++;
            if (this.demuxer) this.demuxer.reset();

            let bestCue = this.cueMap[0];
            for (let i = 0; i < this.cueMap.length; i++) {
                if (this.cueMap[i].time <= this.video.currentTime) bestCue = this.cueMap[i];
                else break;
            }

            this.currentOffset = bestCue ? Math.max(0, Number(bestCue.offset) - 100000) : 0;
            await new Promise(r => setTimeout(r, 300));
            this.isFetching = false;
            this._streamLoop();
        }, 500);
    }

    async switchAudioTrack(newTrackNumber) {
        this.log(`🎧 Initiating Audio Hot-Swap to Track ID: ${newTrackNumber}`);

        // 1. Kill the current network fetcher instantly
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.currentStreamId++; 

        // 2. Find the new track in our metadata
        const newAudioTrack = this.audioTracks.find(t => t.track_number === newTrackNumber);
        if (!newAudioTrack) {
            console.error("Track not found in metadata!");
            return;
        }
        this.audioTrack = newAudioTrack;

        // 3. THE MAGIC: Re-instantiate the WASM Demuxer
        this.demuxer = new Demuxer(
            BigInt(this.videoTrack.track_number), 
            BigInt(newAudioTrack.track_number),
            this.videoTrack.width, 
            this.videoTrack.height,
            this.mkvHeader.duration * 1000, 
            this.videoTrack.codec_id
        );

        // --- THE FIX IS HERE ---
        // If we aren't attached to the screen yet (Native Mode), stop here!
        // We updated the track internally, so it's ready when we DO attach.
        if (!this.sourceBuffer || !this.video) {
            this.log("Engine is in Scout Mode. Track updated internally. Ready for Hijack.");
            return;
        }

        // 4. Generate a brand new MP4 `moov` blueprint
        const newInitSegment = this.demuxer.init(this.initialHeaderData);

        // 5. Prepare the Browser's Hardware Decoder
        this.sourceBuffer.abort();
        let mime = `video/mp4; codecs="${this.videoTrack.codec_string}, ${newAudioTrack.codec_string}"`;
        if (typeof this.sourceBuffer.changeType === 'function') {
            this.sourceBuffer.changeType(mime);
        }

        // 6. Append the new Blueprint
        await this._appendToBuffer(newInitSegment);

        // 7. Flush old audio
        const currentTime = this.video.currentTime;
        if (this.sourceBuffer.buffered.length > 0) {
            this.sourceBuffer.remove(currentTime, this.mediaSource.duration);
            await new Promise(r => {
                this.sourceBuffer.addEventListener('updateend', r, {once: true});
            });
        }

        // 8. Trigger seek to resume
        this._onSeeking(); 
        this.log("✅ Audio Hot-Swap Complete!");
    }

    async _appendToBuffer(data) {
        return new Promise((resolve, reject) => {
            if (!this.sourceBuffer) return resolve();
            if (this.sourceBuffer.updating) {
                setTimeout(() => this._appendToBuffer(data).then(resolve).catch(reject), 50);
                return;
            }
            try {
                const onUpdate = () => { cleanup(); resolve(); };
                const onError = (e) => { cleanup(); reject(e); };
                const cleanup = () => {
                    this.sourceBuffer.removeEventListener('updateend', onUpdate);
                    this.sourceBuffer.removeEventListener('error', onError);
                };
                this.sourceBuffer.addEventListener('updateend', onUpdate);
                this.sourceBuffer.addEventListener('error', onError);
                this.sourceBuffer.appendBuffer(data);
            } catch (e) { reject(e); }
        });
    }
}

// --- EXPORTED SDK FUNCTIONS ---
const streamDictionary = new Map();
let isWasmLoaded = false;

export async function feed(url) {
    if (!isWasmLoaded) { await init(); isWasmLoaded = true; }
    if (streamDictionary.has(url)) return streamDictionary.get(url);

    console.log(`[SDK] Feeding stream: ${url}`);
    const fetcher = new MKVFetcher('url', url);
    const engine = new CoreEngine();
    await engine.preload(fetcher);

    streamDictionary.set(url, engine);
    return engine;
}

export async function playMKV(url, videoElement) {
    if (!streamDictionary.has(url)) {
        console.log(`[SDK] Stream wasn't fed yet. Feeding on the fly...`);
        await feed(url);
    }
    console.log(`[SDK] Attaching engine to video tag!`);
    const engine = streamDictionary.get(url);
    engine.attachVideo(videoElement);
}