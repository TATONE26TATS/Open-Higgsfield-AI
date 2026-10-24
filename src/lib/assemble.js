// Browser-side media helpers for Director Mode: fetching generated clips,
// grabbing last frames (for Extend) and assembling the final film with ffmpeg.wasm.
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

const CORE_BASE = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm';

// Output sizes per aspect ratio (720p class keeps wasm encoding time reasonable).
const SIZES = {
    '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [720, 720], '4:3': [960, 720], '3:4': [720, 960],
};
const FPS = 24;

// Generated media lives on third-party CDNs; fall back to the same-origin
// download proxy (netlify/edge-functions/media-download.js) when CORS blocks it.
export async function fetchMedia(url) {
    if (url.startsWith('blob:') || url.startsWith('data:')) return (await fetch(url)).blob();
    try {
        const res = await fetch(url);
        if (res.ok) return await res.blob();
    } catch { /* CORS or network: try the proxy */ }
    const res = await fetch(`/download-media?url=${encodeURIComponent(url)}`);
    if (!res.ok) throw new Error(`Could not download media (${res.status}).`);
    return res.blob();
}

function loadVideo(blob) {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'auto';
        video.muted = true;
        video.playsInline = true;
        video.onloadedmetadata = () => resolve(video);
        video.onerror = () => reject(new Error('Could not read the video file.'));
        video.src = URL.createObjectURL(blob);
    });
}

export async function videoDuration(blob) {
    const video = await loadVideo(blob);
    const d = video.duration;
    URL.revokeObjectURL(video.src);
    return Number.isFinite(d) ? d : 0;
}

// Returns the last frame of a clip as a JPEG blob, used as the first frame of its extension.
export async function lastFrame(blob) {
    const video = await loadVideo(blob);
    await new Promise((resolve, reject) => {
        video.onseeked = resolve;
        video.onerror = () => reject(new Error('Could not seek the video.'));
        video.currentTime = Math.max(0, video.duration - 0.05);
    });
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    URL.revokeObjectURL(video.src);
    return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not capture the frame.'))), 'image/jpeg', 0.95));
}

let ffmpegPromise;
function getFFmpeg() {
    if (!ffmpegPromise) {
        ffmpegPromise = (async () => {
            const ffmpeg = new FFmpeg();
            await ffmpeg.load({
                coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
                wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
            });
            return ffmpeg;
        })().catch((error) => { ffmpegPromise = null; throw error; });
    }
    return ffmpegPromise;
}

async function hasAudioStream(ffmpeg, name) {
    let found = false;
    const onLog = ({ message }) => { if (/Stream #.*Audio:/.test(message)) found = true; };
    ffmpeg.on('log', onLog);
    await ffmpeg.exec(['-hide_banner', '-i', name]).catch(() => {});
    ffmpeg.off('log', onLog);
    return found;
}

async function run(ffmpeg, args) {
    const code = await ffmpeg.exec(args);
    if (code !== 0) throw new Error(`ffmpeg failed (exit ${code}) on: ${args.slice(-1)[0]}`);
}

/**
 * Assembles the film.
 * @param {object} p
 * @param {{blob: Blob, duration: number, keepAudio: boolean}[]} p.segments  clips in timeline order
 * @param {{blob: Blob, start: number}[]} p.voice   voice-over lines placed at `start` seconds
 * @param {{blob: Blob, volume: number}|null} p.music  bed under the whole film, looped and faded
 * @param {string} p.aspect
 * @param {(stage: string, ratio: number) => void} [p.onProgress]
 * @returns {Promise<Blob>} video/mp4
 */
export async function assembleFilm({ segments, voice = [], music = null, aspect = '16:9', onProgress = () => {} }) {
    if (!segments.length) throw new Error('No clips to assemble.');
    onProgress('Loading the editor (first time ~30 MB)…', 0);
    const ffmpeg = await getFFmpeg();
    const [w, h] = SIZES[aspect] || SIZES['16:9'];
    const steps = segments.length + 2;
    let step = 0;
    const onFfProgress = ({ progress }) => onProgress(null, Math.min(1, (step + Math.max(0, Math.min(1, progress))) / steps));
    ffmpeg.on('progress', onFfProgress);
    const written = [];
    const write = async (name, data) => { await ffmpeg.writeFile(name, data instanceof Blob ? await fetchFile(data) : data); written.push(name); };

    try {
        // 1. Normalise every clip to the same size, fps and audio layout.
        const list = [];
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            onProgress(`Conforming clip ${i + 1}/${segments.length}…`, step / steps);
            const src = `src${i}.mp4`;
            const out = `seg${i}.mp4`;
            await write(src, seg.blob);
            const useOwnAudio = seg.keepAudio && await hasAudioStream(ffmpeg, src);
            const dur = seg.duration.toFixed(3);
            const vf = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p`;
            const args = ['-i', src];
            if (!useOwnAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
            args.push('-t', dur, '-vf', vf, '-map', '0:v:0', '-map', useOwnAudio ? '0:a:0' : '1:a:0',
                '-af', 'aresample=48000,aformat=channel_layouts=stereo', '-shortest',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', out);
            await run(ffmpeg, args);
            written.push(out);
            await ffmpeg.deleteFile(src);
            list.push(`file '${out}'`);
            step++;
        }

        // 2. Concatenate (same codec parameters, so no re-encode).
        onProgress('Joining clips…', step / steps);
        await write('list.txt', new TextEncoder().encode(list.join('\n')));
        await run(ffmpeg, ['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'joined.mp4']);
        written.push('joined.mp4');
        step++;

        // 3. Mix voice-over and music over the clip audio.
        const total = segments.reduce((t, s) => t + s.duration, 0);
        if (!voice.length && !music) {
            const data = await ffmpeg.readFile('joined.mp4');
            return new Blob([data.buffer], { type: 'video/mp4' });
        }
        onProgress('Mixing voice and music…', step / steps);
        const args = ['-i', 'joined.mp4'];
        const filters = [];
        const mixInputs = ['[0:a]'];
        for (let i = 0; i < voice.length; i++) {
            const name = `vo${i}.wav`;
            await write(name, voice[i].blob);
            args.push('-i', name);
            const ms = Math.max(0, Math.round(voice[i].start * 1000));
            filters.push(`[${i + 1}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[v${i}]`);
            mixInputs.push(`[v${i}]`);
        }
        if (music) {
            await write('music', music.blob);
            args.push('-stream_loop', '-1', '-i', 'music');
            const idx = voice.length + 1;
            const fadeOut = Math.max(0, total - 2.5).toFixed(2);
            filters.push(`[${idx}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${total.toFixed(2)},volume=${music.volume},afade=t=in:d=1.5,afade=t=out:st=${fadeOut}:d=2.5[mus]`);
            mixInputs.push('[mus]');
        }
        filters.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=first:normalize=0,alimiter=limit=0.95[aout]`);
        args.push('-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[aout]',
            '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', 'film.mp4');
        await run(ffmpeg, args);
        written.push('film.mp4');
        const data = await ffmpeg.readFile('film.mp4');
        onProgress('Done', 1);
        return new Blob([data.buffer], { type: 'video/mp4' });
    } finally {
        ffmpeg.off('progress', onFfProgress);
        for (const name of written) await ffmpeg.deleteFile(name).catch(() => {});
    }
}
