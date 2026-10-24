// Director Mode — idea → Delivery Package → storyboard → keyframes → clips.
import { kie } from '../lib/kie.js';
import { AuthModal } from './AuthModal.js';
import { CAMERA_MAP, LENS_MAP } from '../lib/promptUtils.js';
import {
    DIRECTOR_VIDEO_MODELS, KEYFRAME_MODEL, KEYFRAME_EDIT_MODEL, MAX_REFERENCES,
    buildBrief, requestPackage, normalizePackage, snapDuration,
    shotReferences, keyframePrompt, motionPrompt, characterSheetPrompt,
    loadProjects, saveProject, deleteProject, packageToMarkdown,
    shotClips, extendRemaining,
} from '../lib/director.js';
import { VOICES, synthesizeSpeech, getGeminiKey, setGeminiKey } from '../lib/voice.js';
import { fetchMedia, lastFrame, videoDuration, assembleFilm } from '../lib/assemble.js';
import { putBlob, getBlob, deleteBlob, deleteByPrefix } from '../lib/mediaStore.js';

const FOCALS = [8, 14, 24, 35, 50, 85];
const APERTURES = ['f/1.4', 'f/4', 'f/11'];
const PIPELINES = ['i2v', 't2v', 'i2v+extend', 'lipsync'];
const ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const DURATIONS = [15, 30, 60, 90, 120];
const MAX_EXTENSIONS = 4;

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const options = (list, selected, label = (v) => v) => list.map(v => `<option value="${esc(v)}" ${String(v) === String(selected) ? 'selected' : ''}>${esc(label(v))}</option>`).join('');

function hasCredentials() {
    return !!(localStorage.getItem('kie_key') || localStorage.getItem('cf_backend') || window.__KIE_KEY__);
}

function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const slug = (text) => String(text || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project';

export function DirectorStudio() {
    const container = document.createElement('div');
    container.className = 'w-full h-full overflow-y-auto bg-app-bg text-white';

    let project = null;            // { id, brief, pkg, edit: { musicName, musicVolume, filmAt } }
    const media = {};              // IndexedDB blob key → object URL, for players
    let assembleStatus = null;     // { stage, ratio } while the film is being assembled
    const busy = new Set();        // keys like 'kf:3', 'vid:3', 'sheet:c1', 'package'
    const errors = {};             // same keys → message
    let batchRunning = false;
    let draft = { duration: 60, aspect: '16:9' }; // brief form values, kept across re-renders

    const persist = () => { if (project) saveProject(project); };

    // Blob keys in IndexedDB, scoped to the project.
    const voKey = (i) => `${project.id}:vo:${i}`;
    const dlgKey = (shotId) => `${project.id}:dlg:${shotId}`;
    const musicKey = () => `${project.id}:music`;
    const filmKey = () => `${project.id}:film`;

    async function setMedia(key, blob) {
        if (media[key]) URL.revokeObjectURL(media[key]);
        if (blob) { await putBlob(key, blob); media[key] = URL.createObjectURL(blob); }
        else { await deleteBlob(key); delete media[key]; }
    }

    // Loads the stored audio/film blobs of the open project into object URLs.
    async function loadMedia() {
        Object.keys(media).forEach(k => { URL.revokeObjectURL(media[k]); delete media[k]; });
        if (!project) return;
        project.edit = { musicName: '', musicVolume: 0.25, filmAt: 0, ...(project.edit || {}) };
        const keys = [
            ...project.pkg.audio.voiceover.map((_, i) => voKey(i)),
            ...project.pkg.shots.filter(s => s.dialogue).map(s => dlgKey(s.id)),
            musicKey(), filmKey(),
        ];
        for (const key of keys) {
            const blob = await getBlob(key).catch(() => null);
            if (blob) media[key] = URL.createObjectURL(blob);
        }
        render();
    }

    function openProject(next) {
        project = next;
        if (project) project.pkg = normalizePackage(project.pkg);
        render();
        loadMedia();
    }

    // ── Rendering ──────────────────────────────────────────────────────────
    function render() {
        const scrollTop = container.scrollTop;
        container.innerHTML = project ? boardView() : briefView();
        container.scrollTop = scrollTop;
    }

    function briefView() {
        const saved = loadProjects();
        const generating = busy.has('package');
        return `
        <div class="max-w-3xl mx-auto px-4 md:px-6 py-10 md:py-16">
            <div class="mb-3 text-xs font-bold text-white/40 tracking-[0.2em] uppercase">Director Mode</div>
            <h1 class="text-3xl md:text-5xl font-black tracking-tight leading-tight mb-3">From idea to finished film.</h1>
            <p class="text-secondary mb-8">Describe the idea. The director writes the beat sheet, shot list with Cinema Studio parameters, character bible and prompt pack, then generates every keyframe and clip for you.</p>

            <form data-form="brief" class="bg-[#141414] border border-white/10 rounded-3xl p-5 md:p-6 flex flex-col gap-4">
                <label class="flex flex-col gap-2">
                    <span class="text-[10px] font-bold text-muted uppercase tracking-widest">Idea</span>
                    <textarea name="idea" rows="5" required placeholder="A lighthouse keeper discovers the light has been signalling to someone for 40 years…" class="bg-black/40 border border-white/5 rounded-2xl px-4 py-3 text-white placeholder:text-muted focus:outline-none focus:border-primary/50 resize-y">${esc(draft.idea)}</textarea>
                </label>
                <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <label class="flex flex-col gap-2">
                        <span class="text-[10px] font-bold text-muted uppercase tracking-widest">Duration</span>
                        <select name="duration" class="bg-black/40 border border-white/5 rounded-xl px-3 py-2.5 text-white">${options(DURATIONS, draft.duration, v => `${v}s`)}</select>
                    </label>
                    <label class="flex flex-col gap-2">
                        <span class="text-[10px] font-bold text-muted uppercase tracking-widest">Format</span>
                        <select name="aspect" class="bg-black/40 border border-white/5 rounded-xl px-3 py-2.5 text-white">${options(ASPECTS, draft.aspect)}</select>
                    </label>
                    <label class="flex flex-col gap-2 col-span-2 md:col-span-1">
                        <span class="text-[10px] font-bold text-muted uppercase tracking-widest">Tone</span>
                        <input name="tone" value="${esc(draft.tone)}" placeholder="e.g. melancholic, tense" class="bg-black/40 border border-white/5 rounded-xl px-3 py-2.5 text-white placeholder:text-muted">
                    </label>
                    <label class="flex flex-col gap-2 col-span-2">
                        <span class="text-[10px] font-bold text-muted uppercase tracking-widest">Visual style / reference</span>
                        <input name="style" value="${esc(draft.style)}" placeholder="e.g. Villeneuve, desaturated teal, 70mm" class="bg-black/40 border border-white/5 rounded-xl px-3 py-2.5 text-white placeholder:text-muted">
                    </label>
                    <label class="flex flex-col gap-2 col-span-2 md:col-span-1">
                        <span class="text-[10px] font-bold text-muted uppercase tracking-widest">Audience</span>
                        <input name="audience" value="${esc(draft.audience)}" placeholder="e.g. YouTube, adults" class="bg-black/40 border border-white/5 rounded-xl px-3 py-2.5 text-white placeholder:text-muted">
                    </label>
                </div>
                ${errors.package ? `<div class="text-sm text-red-400">${esc(errors.package)}</div>` : ''}
                <div class="flex flex-wrap gap-3 items-center">
                    <button type="submit" ${generating ? 'disabled' : ''} class="bg-primary text-black font-black px-6 py-3 rounded-2xl hover:shadow-glow transition-all disabled:opacity-50">
                        ${generating ? 'Directing… (can take a minute)' : 'Generate production package'}
                    </button>
                    <label class="text-sm font-bold text-secondary hover:text-white cursor-pointer">
                        Import JSON<input type="file" accept="application/json,.json" data-action="import" class="hidden">
                    </label>
                </div>
            </form>

            ${saved.length ? `
            <div class="mt-10">
                <div class="text-[10px] font-bold text-muted uppercase tracking-widest mb-3">Saved projects</div>
                <div class="flex flex-col gap-2">
                    ${saved.map(p => `
                    <div class="flex items-center justify-between bg-[#141414] border border-white/5 rounded-2xl px-4 py-3">
                        <button data-action="open-project" data-id="${esc(p.id)}" class="text-left flex-1 min-w-0">
                            <div class="font-bold truncate">${esc(p.pkg?.title)}</div>
                            <div class="text-xs text-muted truncate">${esc(p.pkg?.shots?.length || 0)} shots · ${esc(p.pkg?.format?.duration_s || '')}s · ${esc(p.pkg?.logline || '')}</div>
                        </button>
                        <button data-action="delete-project" data-id="${esc(p.id)}" class="text-muted hover:text-red-400 text-xs font-bold ml-4">Delete</button>
                    </div>`).join('')}
                </div>
            </div>` : ''}
        </div>`;
    }

    function boardView() {
        const pkg = project.pkg;
        const missingKeyframes = pkg.shots.filter(s => s.pipeline !== 't2v' && !s.keyframe_url).length;
        const missingClips = pkg.shots.filter(s => !s.video_url).length;
        return `
        <div class="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8 flex flex-col gap-8">
            <div class="flex flex-wrap items-start justify-between gap-4">
                <div class="min-w-0">
                    <button data-action="back" class="text-xs font-bold text-muted hover:text-white mb-2">← All projects</button>
                    <h1 class="text-2xl md:text-4xl font-black tracking-tight">${esc(pkg.title)}</h1>
                    <div class="text-sm text-secondary mt-1">${esc(pkg.format.duration_s)}s · ${esc(pkg.format.aspect_ratio)} · ${esc(pkg.shots.length)} shots · ${esc(pkg.format.structure)}</div>
                </div>
                <div class="flex flex-wrap gap-2">
                    <button data-action="batch-keyframes" ${batchRunning || !missingKeyframes ? 'disabled' : ''} class="bg-primary text-black font-black text-sm px-4 py-2.5 rounded-xl disabled:opacity-40">Generate ${missingKeyframes} keyframes</button>
                    <button data-action="batch-clips" ${batchRunning || !missingClips ? 'disabled' : ''} class="bg-white text-black font-black text-sm px-4 py-2.5 rounded-xl disabled:opacity-40">Animate ${missingClips} clips</button>
                    <button data-action="export-md" class="border border-white/10 font-bold text-sm px-4 py-2.5 rounded-xl hover:bg-white/5">Export package</button>
                    <button data-action="export-json" class="border border-white/10 font-bold text-sm px-4 py-2.5 rounded-xl hover:bg-white/5">JSON</button>
                </div>
            </div>
            ${batchRunning ? '<div class="text-sm text-primary font-bold">Batch running… you can keep editing other shots.</div>' : ''}

            <section class="grid md:grid-cols-3 gap-4">
                <div class="md:col-span-2 bg-[#141414] border border-white/5 rounded-3xl p-5">
                    <div class="text-[10px] font-bold text-muted uppercase tracking-widest mb-2">Logline</div>
                    <p class="text-lg font-bold mb-3">${esc(pkg.logline)}</p>
                    <div class="text-[10px] font-bold text-muted uppercase tracking-widest mb-1">Thesis</div>
                    <p class="text-secondary mb-3">${esc(pkg.thesis)}</p>
                    <div class="grid grid-cols-3 gap-3 text-sm">
                        <div><div class="text-[10px] font-bold text-muted uppercase">Feel</div>${esc(pkg.viewer_contract.feel)}</div>
                        <div><div class="text-[10px] font-bold text-muted uppercase">Understand</div>${esc(pkg.viewer_contract.understand)}</div>
                        <div><div class="text-[10px] font-bold text-muted uppercase">Remember</div>${esc(pkg.viewer_contract.remember)}</div>
                    </div>
                </div>
                <div class="bg-[#141414] border border-white/5 rounded-3xl p-5 max-h-72 overflow-y-auto">
                    <div class="text-[10px] font-bold text-muted uppercase tracking-widest mb-2">Beat sheet</div>
                    ${pkg.beats.map(b => `<div class="text-sm mb-2"><span class="font-mono text-primary">${esc(b.t)}</span> ${esc(b.beat)}</div>`).join('')}
                </div>
            </section>

            <section>
                <div class="flex items-baseline justify-between mb-3">
                    <h2 class="text-lg font-black">Characters</h2>
                    <span class="text-xs text-muted">References are attached in order to every shot the character appears in (max ${MAX_REFERENCES}).</span>
                </div>
                <div class="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
                    ${pkg.characters.map(characterCard).join('') || '<div class="text-sm text-muted">No recurring characters.</div>'}
                </div>
            </section>

            <section>
                <h2 class="text-lg font-black mb-3">Shots</h2>
                <div class="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
                    ${pkg.shots.map(shotCard).join('')}
                </div>
            </section>

            ${audioSection()}

            ${pkg.execution_notes.length ? `
            <section class="bg-[#141414] border border-white/5 rounded-3xl p-5">
                <h2 class="text-lg font-black mb-3">Execution notes</h2>
                <ol class="list-decimal ml-5 text-sm text-secondary flex flex-col gap-1">${pkg.execution_notes.map(n => `<li>${esc(n)}</li>`).join('')}</ol>
            </section>` : ''}
        </div>`;
    }

    function characterCard(c) {
        const key = `sheet:${c.id}`;
        return `
        <div class="bg-[#141414] border border-white/5 rounded-3xl p-4 flex flex-col gap-3">
            <div>
                <div class="font-black">${esc(c.name)} <span class="text-xs text-muted font-mono">${esc(c.id)}</span></div>
                <div class="text-xs text-secondary mt-1">${esc(c.look)}</div>
                <div class="text-xs text-muted mt-1">${esc(c.wardrobe)}</div>
            </div>
            <div class="flex flex-wrap gap-2">
                ${c.references.map((url, i) => `
                <div class="relative w-16 h-16 rounded-xl overflow-hidden border border-white/10 group">
                    <img src="${esc(url)}" class="w-full h-full object-cover" alt="">
                    <span class="absolute top-0.5 left-0.5 text-[10px] font-black bg-black/70 rounded px-1">${i + 1}</span>
                    <button data-action="remove-ref" data-char="${esc(c.id)}" data-index="${i}" class="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 text-xs font-bold">Remove</button>
                </div>`).join('')}
                ${busy.has(key) ? '<div class="w-16 h-16 rounded-xl border border-white/10 flex items-center justify-center text-[10px] text-muted animate-pulse">…</div>' : ''}
            </div>
            ${errors[key] ? `<div class="text-xs text-red-400">${esc(errors[key])}</div>` : ''}
            <div class="flex gap-2">
                <button data-action="gen-sheet" data-char="${esc(c.id)}" ${busy.has(key) ? 'disabled' : ''} class="flex-1 border border-white/10 text-xs font-bold px-3 py-2 rounded-xl hover:bg-white/5 disabled:opacity-40">Generate sheet</button>
                <label class="flex-1 text-center border border-white/10 text-xs font-bold px-3 py-2 rounded-xl hover:bg-white/5 cursor-pointer">
                    Upload<input type="file" accept="image/*" multiple data-action="upload-ref" data-char="${esc(c.id)}" class="hidden">
                </label>
            </div>
        </div>`;
    }

    function shotCard(s) {
        const pkg = project.pkg;
        const kfKey = `kf:${s.id}`;
        const vidKey = `vid:${s.id}`;
        const refs = shotReferences(pkg, s);
        const model = DIRECTOR_VIDEO_MODELS[s.model];
        const select = (field, list, label) => `<select data-field="${field}" data-shot="${esc(s.id)}" class="bg-black/40 border border-white/5 rounded-lg px-2 py-1.5 text-xs text-white min-w-0">${options(list, s[field], label)}</select>`;
        const media = s.video_url
            ? `<video src="${esc(s.video_url)}" controls loop playsinline class="w-full h-full object-cover"></video>`
            : s.keyframe_url
                ? `<img src="${esc(s.keyframe_url)}" class="w-full h-full object-cover" alt="">`
                : `<div class="w-full h-full flex items-center justify-center text-xs text-muted p-4 text-center">${busy.has(kfKey) ? 'Generating keyframe…' : 'No keyframe yet'}</div>`;
        return `
        <div class="bg-[#141414] border border-white/5 rounded-3xl overflow-hidden flex flex-col">
            <div class="relative bg-black" style="aspect-ratio:${esc(pkg.format.aspect_ratio.replace(':', '/'))}">
                ${media}
                <div class="absolute top-2 left-2 flex gap-1">
                    <span class="text-[10px] font-black bg-black/70 rounded px-1.5 py-0.5">#${esc(s.id)}</span>
                    <span class="text-[10px] font-bold bg-black/70 rounded px-1.5 py-0.5">${esc(s.scene)}</span>
                    <span class="text-[10px] font-bold bg-primary/80 text-black rounded px-1.5 py-0.5">${esc(s.pipeline)}</span>
                </div>
                ${s.extensions.length ? `<span class="absolute top-2 right-2 text-[10px] font-black bg-black/70 rounded px-1.5 py-0.5">+${s.extensions.length} ext</span>` : ''}
                ${busy.has(vidKey) ? `<div class="absolute inset-0 bg-black/60 flex items-center justify-center text-xs font-bold animate-pulse">${esc(progressNote[vidKey] || 'Animating…')}</div>` : ''}
            </div>
            <div class="p-4 flex flex-col gap-3">
                <div class="text-sm font-bold">${esc(s.shot_type)} <span class="text-muted font-normal">· ${esc(s.movement)}</span></div>
                <div class="grid grid-cols-2 gap-2">
                    ${select('camera', Object.keys(CAMERA_MAP))}
                    ${select('lens', Object.keys(LENS_MAP))}
                    ${select('focal', FOCALS, v => `${v}mm`)}
                    ${select('aperture', APERTURES)}
                    ${select('model', Object.keys(DIRECTOR_VIDEO_MODELS), v => DIRECTOR_VIDEO_MODELS[v].name)}
                    ${select('pipeline', PIPELINES)}
                </div>
                <label class="flex flex-col gap-1">
                    <span class="text-[10px] font-bold text-muted uppercase tracking-widest">Keyframe</span>
                    <textarea data-field="keyframe_prompt" data-shot="${esc(s.id)}" rows="3" class="bg-black/40 border border-white/5 rounded-xl px-3 py-2 text-xs text-white resize-y">${esc(s.keyframe_prompt)}</textarea>
                </label>
                <label class="flex flex-col gap-1">
                    <span class="text-[10px] font-bold text-muted uppercase tracking-widest">Motion · ${esc(snapDuration(s.duration_s, s.model))}s on ${esc(model?.name)}</span>
                    <textarea data-field="motion_prompt" data-shot="${esc(s.id)}" rows="3" class="bg-black/40 border border-white/5 rounded-xl px-3 py-2 text-xs text-white resize-y">${esc(s.motion_prompt)}</textarea>
                </label>
                ${s.dialogue ? `<div class="text-xs text-secondary">“${esc(s.dialogue)}”</div>` : ''}
                <details class="text-xs text-muted">
                    <summary class="cursor-pointer font-bold">Compiled prompts · ${refs.length} reference${refs.length === 1 ? '' : 's'}</summary>
                    <div class="mt-2 whitespace-pre-wrap">${esc(keyframePrompt(pkg, s))}</div>
                    <div class="mt-2 whitespace-pre-wrap">${esc(motionPrompt(pkg, s))}</div>
                </details>
                ${errors[kfKey] ? `<div class="text-xs text-red-400">${esc(errors[kfKey])}</div>` : ''}
                ${errors[vidKey] ? `<div class="text-xs text-red-400">${esc(errors[vidKey])}</div>` : ''}
                <div class="flex gap-2">
                    <button data-action="gen-keyframe" data-shot="${esc(s.id)}" ${busy.has(kfKey) || s.pipeline === 't2v' ? 'disabled' : ''} class="flex-1 border border-white/10 text-xs font-bold px-3 py-2 rounded-xl hover:bg-white/5 disabled:opacity-40">${s.keyframe_url ? 'Redo keyframe' : 'Keyframe'}</button>
                    <button data-action="gen-video" data-shot="${esc(s.id)}" ${busy.has(vidKey) || (s.pipeline !== 't2v' && !s.keyframe_url) ? 'disabled' : ''} class="flex-1 bg-white text-black text-xs font-black px-3 py-2 rounded-xl disabled:opacity-40">${s.pipeline === 'lipsync' && s.dialogue ? (s.video_url ? 'Redo lip-sync' : 'Lip-sync') : (s.video_url ? 'Redo clip' : 'Animate')}</button>
                    ${s.video_url ? `<button data-action="extend" data-shot="${esc(s.id)}" ${busy.has(vidKey) || s.extensions.length >= MAX_EXTENSIONS ? 'disabled' : ''} title="Continue this shot from its last frame" class="border border-white/10 text-xs font-bold px-3 py-2 rounded-xl hover:bg-white/5 disabled:opacity-40">+ Extend</button>` : ''}
                    ${s.video_url ? `<a href="${esc(s.video_url)}" target="_blank" rel="noopener" download class="border border-white/10 text-xs font-bold px-3 py-2 rounded-xl hover:bg-white/5">↓</a>` : ''}
                </div>
            </div>
        </div>`;
    }

    function audioSection() {
        const pkg = project.pkg;
        const edit = project.edit || { musicVolume: 0.25 };
        const key = getGeminiKey();
        const lines = pkg.audio.voiceover;
        const dialogueShots = pkg.shots.filter(s => s.pipeline === 'lipsync' && s.dialogue);
        const missingVoices = lines.filter((_, i) => !media[voKey(i)]).length;
        const readyShots = pkg.shots.filter(s => s.video_url).length;
        const player = (k) => media[k] ? `<audio src="${media[k]}" controls class="h-8 w-full md:w-56"></audio>` : '<span class="text-xs text-muted">no audio yet</span>';
        return `
        <section class="grid lg:grid-cols-2 gap-4">
            <div class="bg-[#141414] border border-white/5 rounded-3xl p-5 flex flex-col gap-4">
                <div class="flex items-baseline justify-between gap-3">
                    <h2 class="text-lg font-black">Voice</h2>
                    <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" class="text-xs text-muted hover:text-white">Free Gemini key →</a>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <input data-action="gemini-key" type="password" value="${key ? '••••••••' : ''}" placeholder="Gemini API key" class="bg-black/40 border border-white/5 rounded-xl px-3 py-2 text-xs text-white placeholder:text-muted">
                    <select data-action="voice-name" class="bg-black/40 border border-white/5 rounded-xl px-3 py-2 text-xs text-white">${options(Object.keys(VOICES), pkg.audio.voice.name, v => VOICES[v])}</select>
                    <input data-action="voice-direction" value="${esc(pkg.audio.voice.direction)}" placeholder="Delivery, e.g. calm, low" class="bg-black/40 border border-white/5 rounded-xl px-3 py-2 text-xs text-white placeholder:text-muted">
                </div>
                ${errors.voices ? `<div class="text-xs text-red-400">${esc(errors.voices)}</div>` : ''}
                <div class="flex flex-col gap-2 max-h-80 overflow-y-auto">
                    ${lines.map((l, i) => `
                    <div class="flex flex-col md:flex-row md:items-center gap-2 border-b border-white/5 pb-2">
                        <div class="flex-1 text-sm"><span class="font-mono text-primary text-xs">#${esc(l.shot)}</span> ${esc(l.text)}</div>
                        ${player(voKey(i))}
                        <button data-action="gen-voice" data-index="${i}" ${busy.has(`vo:${i}`) ? 'disabled' : ''} class="text-xs font-bold text-secondary hover:text-white disabled:opacity-40">${busy.has(`vo:${i}`) ? '…' : (media[voKey(i)] ? 'Redo' : 'Generate')}</button>
                        <label class="text-xs font-bold text-secondary hover:text-white cursor-pointer">Upload<input type="file" accept="audio/*" data-action="upload-voice" data-index="${i}" class="hidden"></label>
                    </div>`).join('') || '<div class="text-sm text-muted">No voice-over in this package.</div>'}
                    ${dialogueShots.map(s => `
                    <div class="flex flex-col md:flex-row md:items-center gap-2 border-b border-white/5 pb-2">
                        <div class="flex-1 text-sm"><span class="font-mono text-primary text-xs">#${esc(s.id)} lip-sync</span> “${esc(s.dialogue)}”</div>
                        ${player(dlgKey(s.id))}
                        <label class="text-xs font-bold text-secondary hover:text-white cursor-pointer">Upload<input type="file" accept="audio/*" data-action="upload-dialogue" data-shot="${esc(s.id)}" class="hidden"></label>
                    </div>`).join('')}
                </div>
                <button data-action="gen-voices" ${!missingVoices || busy.has('voices') ? 'disabled' : ''} class="self-start bg-white text-black font-black text-sm px-4 py-2.5 rounded-xl disabled:opacity-40">${busy.has('voices') ? 'Generating voices…' : `Generate ${missingVoices} voice line${missingVoices === 1 ? '' : 's'}`}</button>
            </div>

            <div class="bg-[#141414] border border-white/5 rounded-3xl p-5 flex flex-col gap-4">
                <h2 class="text-lg font-black">Music & final edit</h2>
                <div class="flex flex-col gap-2">
                    <div class="flex flex-wrap items-center gap-3">
                        <label class="border border-white/10 text-xs font-bold px-3 py-2 rounded-xl hover:bg-white/5 cursor-pointer">${media[musicKey()] ? 'Replace music' : 'Add music'}<input type="file" accept="audio/*" data-action="upload-music" class="hidden"></label>
                        ${media[musicKey()] ? `<span class="text-xs text-secondary truncate max-w-[12rem]">${esc(edit.musicName)}</span><button data-action="remove-music" class="text-xs text-muted hover:text-red-400 font-bold">Remove</button>` : '<span class="text-xs text-muted">Royalty-free track, e.g. from Pixabay Music or the YouTube Audio Library</span>'}
                    </div>
                    ${media[musicKey()] ? `
                    <label class="flex items-center gap-3 text-xs text-secondary">Music level
                        <input data-action="music-volume" type="range" min="0.05" max="1" step="0.05" value="${esc(edit.musicVolume)}" class="flex-1 accent-[#ff2d2d]">
                        <span>${Math.round(edit.musicVolume * 100)}%</span>
                    </label>` : ''}
                    ${pkg.audio.music.length ? `<div class="text-xs text-muted">Cues: ${pkg.audio.music.map(m => `${esc(m.t)} ${esc(m.cue)}`).join(' · ')}</div>` : ''}
                </div>
                <div class="text-xs text-muted">${readyShots}/${pkg.shots.length} shots have clips. Shots without a clip are skipped; voice lines are placed at the start of their shot.</div>
                ${errors.assemble ? `<div class="text-xs text-red-400">${esc(errors.assemble)}</div>` : ''}
                ${assembleStatus ? `
                <div class="flex flex-col gap-1">
                    <div class="text-xs font-bold">${esc(assembleStatus.stage)}</div>
                    <div class="h-2 bg-black/40 rounded-full overflow-hidden"><div data-assemble-bar class="h-full bg-primary transition-all" style="width:${Math.round(assembleStatus.ratio * 100)}%"></div></div>
                </div>` : ''}
                <button data-action="assemble" ${!readyShots || assembleStatus ? 'disabled' : ''} class="self-start bg-primary text-black font-black text-sm px-4 py-2.5 rounded-xl disabled:opacity-40">${media[filmKey()] ? 'Re-assemble film' : 'Assemble film'}</button>
                ${media[filmKey()] ? `
                <video src="${media[filmKey()]}" controls playsinline class="w-full rounded-2xl bg-black" style="aspect-ratio:${esc(pkg.format.aspect_ratio.replace(':', '/'))}"></video>
                <a href="${media[filmKey()]}" download="${esc(slug(pkg.title))}.mp4" class="self-start border border-white/10 text-sm font-bold px-4 py-2.5 rounded-xl hover:bg-white/5">Download MP4</a>` : ''}
            </div>
        </section>`;
    }

    // ── Actions ────────────────────────────────────────────────────────────
    const findShot = (id) => project.pkg.shots.find(s => s.id === id);
    const findChar = (id) => project.pkg.characters.find(c => c.id === id);

    function withCredentials(retry) {
        if (hasCredentials()) return true;
        AuthModal(retry);
        return false;
    }

    async function run(key, task) {
        busy.add(key);
        delete errors[key];
        render();
        try {
            await task();
        } catch (error) {
            console.error('[Director]', key, error);
            errors[key] = error.message || String(error);
        } finally {
            busy.delete(key);
            persist();
            render();
        }
    }

    async function generatePackage(form) {
        const data = Object.fromEntries(new FormData(form).entries());
        draft = data;
        if (!String(data.idea || '').trim()) return;
        if (!withCredentials(() => generatePackage(form))) return;
        const brief = buildBrief(data);
        await run('package', async () => {
            const pkg = await requestPackage(brief);
            if (!pkg.shots.length) throw new Error('The package came back without shots. Try again or add more detail.');
            project = { id: `dir_${Date.now()}`, brief: data, pkg };
        });
        if (project) loadMedia();
    }

    function generateKeyframe(shotId) {
        const shot = findShot(shotId);
        if (!shot || !withCredentials(() => generateKeyframe(shotId))) return Promise.resolve();
        return run(`kf:${shotId}`, async () => {
            const pkg = project.pkg;
            const prompt = keyframePrompt(pkg, shot);
            const refs = shotReferences(pkg, shot);
            const aspect_ratio = pkg.format.aspect_ratio;
            const res = refs.length
                ? await kie.generateI2I({ model: KEYFRAME_EDIT_MODEL, prompt, images_list: refs, image_url: refs[0], aspect_ratio })
                : await kie.generateImage({ model: KEYFRAME_MODEL, prompt, aspect_ratio });
            if (!res?.url) throw new Error('No image returned.');
            shot.keyframe_url = res.url;
            shot.video_url = '';
            shot.extensions = [];
        });
    }

    const progressNote = {};       // busy key → short status shown on the card

    function videoParams(shot) {
        const model = DIRECTOR_VIDEO_MODELS[shot.model] || DIRECTOR_VIDEO_MODELS['seedance-2.0'];
        return {
            model: model.id,
            prompt: motionPrompt(project.pkg, shot),
            aspect_ratio: project.pkg.format.aspect_ratio,
            duration: snapDuration(shot.duration_s, shot.model),
        };
    }

    async function dialogueAudio(shot) {
        let blob = await getBlob(dlgKey(shot.id)).catch(() => null);
        if (!blob) {
            blob = await synthesizeSpeech(shot.dialogue, { voice: project.pkg.audio.voice.name, direction: project.pkg.audio.voice.direction });
            await setMedia(dlgKey(shot.id), blob);
        }
        return blob;
    }

    // Grabs the last frame of the shot's latest clip and animates it again.
    async function appendExtension(shot, key) {
        const clips = shotClips(shot);
        progressNote[key] = `Extending (${clips.length + 1})…`;
        render();
        const frame = await lastFrame(await fetchMedia(clips[clips.length - 1]));
        const frameUrl = await kie.uploadFile(new File([frame], `shot-${shot.id}-frame-${clips.length}.jpg`, { type: 'image/jpeg' }));
        const params = videoParams(shot);
        const res = await kie.generateI2V({
            ...params,
            prompt: `Continue the same continuous shot seamlessly from this exact frame, no cut, same lighting and camera direction. ${params.prompt}`,
            image_url: frameUrl,
        });
        if (!res?.url) throw new Error('No video returned for the extension.');
        shot.extensions.push(res.url);
        persist();
    }

    function generateClip(shotId) {
        const shot = findShot(shotId);
        if (!shot || !withCredentials(() => generateClip(shotId))) return Promise.resolve();
        const key = `vid:${shotId}`;
        return run(key, async () => {
            shot.extensions = [];
            if (shot.pipeline === 'lipsync' && shot.dialogue && shot.keyframe_url) {
                progressNote[key] = 'Voicing the line…';
                render();
                const audio = await dialogueAudio(shot);
                const audioUrl = await kie.uploadFile(new File([audio], `dialogue-${shot.id}.wav`, { type: audio.type || 'audio/wav' }));
                progressNote[key] = 'Lip-syncing…';
                render();
                const res = await kie.processLipSync({ image_url: shot.keyframe_url, audio_url: audioUrl, prompt: shot.motion_prompt });
                if (!res?.url) throw new Error('No lip-sync video returned.');
                shot.video_url = res.url;
                return;
            }
            progressNote[key] = 'Animating…';
            render();
            const params = videoParams(shot);
            const res = shot.pipeline === 't2v' || !shot.keyframe_url
                ? await kie.generateVideo(params)
                : await kie.generateI2V({ ...params, image_url: shot.keyframe_url });
            if (!res?.url) throw new Error('No video returned.');
            shot.video_url = res.url;
            persist();
            if (shot.pipeline === 'i2v+extend') {
                while (extendRemaining(shot) > 0 && shot.extensions.length < MAX_EXTENSIONS) {
                    await appendExtension(shot, key);
                }
            }
        }).finally(() => { delete progressNote[key]; });
    }

    function extendShot(shotId) {
        const shot = findShot(shotId);
        if (!shot?.video_url || !withCredentials(() => extendShot(shotId))) return;
        const key = `vid:${shotId}`;
        run(key, () => appendExtension(shot, key)).finally(() => { delete progressNote[key]; render(); });
    }

    async function generateVoice(i) {
        const line = project.pkg.audio.voiceover[i];
        if (!line) return;
        const { name, direction } = project.pkg.audio.voice;
        delete errors.voices;
        await run(`vo:${i}`, async () => {
            await setMedia(voKey(i), await synthesizeSpeech(line.text, { voice: name, direction }));
        });
        if (errors[`vo:${i}`]) errors.voices = errors[`vo:${i}`];
    }

    async function generateAllVoices() {
        if (!getGeminiKey()) { errors.voices = 'Add your free Gemini API key first.'; render(); return; }
        delete errors.voices;
        busy.add('voices');
        render();
        for (let i = 0; i < project.pkg.audio.voiceover.length; i++) {
            if (media[voKey(i)]) continue;
            await generateVoice(i);
            if (errors.voices) break;
        }
        busy.delete('voices');
        render();
    }

    async function assemble() {
        const pkg = project.pkg;
        delete errors.assemble;
        assembleStatus = { stage: 'Downloading clips…', ratio: 0 };
        render();
        try {
            const segments = [];
            const shotStart = {};
            let t = 0;
            const shots = pkg.shots.filter(s => s.video_url);
            for (let i = 0; i < shots.length; i++) {
                const shot = shots[i];
                shotStart[shot.id] = t;
                for (const url of shotClips(shot)) {
                    assembleStatus = { stage: `Downloading clip ${segments.length + 1}…`, ratio: 0 };
                    render();
                    const blob = await fetchMedia(url);
                    const duration = await videoDuration(blob) || snapDuration(shot.duration_s, shot.model);
                    segments.push({ blob, duration, keepAudio: shot.pipeline === 'lipsync' });
                    t += duration;
                }
            }
            const voice = [];
            for (let i = 0; i < pkg.audio.voiceover.length; i++) {
                const start = shotStart[pkg.audio.voiceover[i].shot];
                const blob = await getBlob(voKey(i)).catch(() => null);
                if (blob && start !== undefined) voice.push({ blob, start: start + 0.3 });
            }
            const musicBlob = await getBlob(musicKey()).catch(() => null);
            const film = await assembleFilm({
                segments,
                voice,
                music: musicBlob ? { blob: musicBlob, volume: project.edit.musicVolume } : null,
                aspect: pkg.format.aspect_ratio,
                onProgress: (stage, ratio) => {
                    assembleStatus = { stage: stage || assembleStatus.stage, ratio };
                    const bar = container.querySelector('[data-assemble-bar]');
                    if (stage) render();
                    else if (bar) bar.style.width = `${Math.round(ratio * 100)}%`;
                },
            });
            await setMedia(filmKey(), film);
            project.edit.filmAt = Date.now();
            persist();
        } catch (error) {
            console.error('[Director] assemble', error);
            errors.assemble = error.message || String(error);
        } finally {
            assembleStatus = null;
            render();
        }
    }

    async function storeUpload(key, file) {
        if (!file) return;
        await setMedia(key, file);
        render();
    }

    function generateSheet(charId) {
        const character = findChar(charId);
        if (!character || !withCredentials(() => generateSheet(charId))) return;
        run(`sheet:${charId}`, async () => {
            const res = await kie.generateImage({ model: KEYFRAME_MODEL, prompt: characterSheetPrompt(character), aspect_ratio: '1:1' });
            if (!res?.url) throw new Error('No image returned.');
            character.references = [res.url, ...character.references].slice(0, MAX_REFERENCES);
        });
    }

    function uploadReferences(charId, files) {
        const character = findChar(charId);
        if (!character || !files.length || !withCredentials(() => uploadReferences(charId, files))) return;
        run(`sheet:${charId}`, async () => {
            for (const file of files) {
                if (character.references.length >= MAX_REFERENCES) break;
                character.references.push(await kie.uploadFile(file));
            }
        });
    }

    async function runBatch(kind) {
        const shots = kind === 'keyframes'
            ? project.pkg.shots.filter(s => s.pipeline !== 't2v' && !s.keyframe_url)
            : project.pkg.shots.filter(s => !s.video_url && (s.pipeline === 't2v' || s.keyframe_url));
        if (!shots.length) {
            if (kind === 'clips') alert('Generate the keyframes first.');
            return;
        }
        if (!withCredentials(() => runBatch(kind))) return;
        const what = kind === 'keyframes' ? 'keyframe images' : 'video clips';
        if (!confirm(`Generate ${shots.length} ${what}? Each one uses kie.ai credits.`)) return;
        batchRunning = true;
        render();
        // Sequential on purpose: keeps credit usage predictable and avoids rate limits.
        for (const shot of shots) {
            if (kind === 'keyframes') await generateKeyframe(shot.id);
            else await generateClip(shot.id);
        }
        batchRunning = false;
        render();
    }

    function importJson(file) {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(reader.result);
                const pkg = normalizePackage(data.pkg || data);
                project = { id: data.id || `dir_${Date.now()}`, brief: data.brief || {}, pkg, edit: data.edit };
                persist();
                render();
                loadMedia();
            } catch (error) {
                alert(`Invalid package file: ${error.message}`);
            }
        };
        reader.readAsText(file);
    }

    // ── Events (delegated, so they survive re-renders) ─────────────────────
    container.addEventListener('submit', (e) => {
        if (e.target.matches('[data-form="brief"]')) {
            e.preventDefault();
            generatePackage(e.target);
        }
    });

    container.addEventListener('click', (e) => {
        const el = e.target.closest('[data-action]');
        if (!el || el.disabled || el.type === 'file') return;
        const { action, shot, char, id, index } = el.dataset;
        if (action === 'back') { project = null; render(); }
        else if (action === 'open-project') openProject(loadProjects().find(p => p.id === id) || null);
        else if (action === 'delete-project') { if (confirm('Delete this project?')) { deleteProject(id); deleteByPrefix(`${id}:`).catch(() => {}); render(); } }
        else if (action === 'extend') extendShot(shot);
        else if (action === 'gen-voice') generateVoice(Number(index)).then(render);
        else if (action === 'gen-voices') generateAllVoices();
        else if (action === 'remove-music') { project.edit.musicName = ''; persist(); setMedia(musicKey(), null).then(render); }
        else if (action === 'assemble') assemble();
        else if (action === 'gen-keyframe') generateKeyframe(shot);
        else if (action === 'gen-video') generateClip(shot);
        else if (action === 'gen-sheet') generateSheet(char);
        else if (action === 'remove-ref') { findChar(char).references.splice(Number(index), 1); persist(); render(); }
        else if (action === 'batch-keyframes') runBatch('keyframes');
        else if (action === 'batch-clips') runBatch('clips');
        else if (action === 'export-md') download(`${slug(project.pkg.title)}-package.md`, packageToMarkdown(project.pkg), 'text/markdown');
        else if (action === 'export-json') download(`${slug(project.pkg.title)}.json`, JSON.stringify(project, null, 2), 'application/json');
    });

    container.addEventListener('change', (e) => {
        const el = e.target;
        if (el.dataset.action === 'import' && el.files?.[0]) importJson(el.files[0]);
        else if (el.dataset.action === 'upload-ref') uploadReferences(el.dataset.char, Array.from(el.files || []));
        else if (el.dataset.action === 'upload-voice') storeUpload(voKey(Number(el.dataset.index)), el.files?.[0]);
        else if (el.dataset.action === 'upload-dialogue') storeUpload(dlgKey(el.dataset.shot), el.files?.[0]);
        else if (el.dataset.action === 'upload-music' && el.files?.[0]) { project.edit.musicName = el.files[0].name; persist(); storeUpload(musicKey(), el.files[0]); }
        else if (el.dataset.action === 'gemini-key') { if (!el.value.includes('•')) setGeminiKey(el.value); render(); }
        else if (el.dataset.action === 'voice-name') { project.pkg.audio.voice.name = el.value; persist(); }
        else if (el.dataset.action === 'voice-direction') { project.pkg.audio.voice.direction = el.value; persist(); }
        else if (el.dataset.action === 'music-volume') { project.edit.musicVolume = Number(el.value); persist(); render(); }
        else if (el.dataset.field && el.dataset.shot && el.tagName === 'SELECT') {
            const shot = findShot(el.dataset.shot);
            shot[el.dataset.field] = el.dataset.field === 'focal' ? Number(el.value) : el.value;
            persist();
            render();
        }
    });

    // Prompt edits: update state without re-rendering so the caret stays put.
    let saveTimer;
    container.addEventListener('input', (e) => {
        const el = e.target;
        if (el.tagName !== 'TEXTAREA' || !el.dataset.field || !el.dataset.shot) return;
        findShot(el.dataset.shot)[el.dataset.field] = el.value;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(persist, 400);
    });

    render();
    return container;
}
