// Director Mode: idea + constraints → structured Delivery Package (JSON),
// plus the helpers that turn a package shot into model-ready prompts.
import SYSTEM_PROMPT from '../../data/director-system.md?raw';
import { CAMERA_MAP, LENS_MAP, buildNanoBananaPrompt } from './promptUtils.js';

const KIE_CHAT_PATH = '/gpt-5-2/v1/chat/completions';
const FOCALS = [8, 14, 24, 35, 50, 85];
const APERTURES = ['f/1.4', 'f/4', 'f/11'];
const PIPELINES = ['i2v', 't2v', 'i2v+extend', 'lipsync'];

// Video models offered by Director Mode, mapped onto ids kie.js understands.
export const DIRECTOR_VIDEO_MODELS = {
    'seedance-2.0': { id: 'seedance-v2.0-i2v', name: 'Seedance 2.0', durations: [5, 10, 15] },
    'kling': { id: 'kling-v2.1-pro-i2v', name: 'Kling 2.1 Pro', durations: [5, 10] },
    'veo3-fast': { id: 'veo3-fast-image-to-video', name: 'Veo 3 Fast', durations: [8] },
    'wan': { id: 'wan2.5-image-to-video', name: 'Wan', durations: [5, 10] },
    'sora-2': { id: 'sora-2-image-to-video', name: 'Sora 2', durations: [10, 15] },
};

export const KEYFRAME_MODEL = 'nano-banana-2';
export const KEYFRAME_EDIT_MODEL = 'nano-banana-2-edit';
export const MAX_REFERENCES = 14;

export function buildBrief({ idea, duration, aspect, tone, style, audience }) {
    const lines = [`IDEA:\n${String(idea || '').trim()}`];
    const constraints = [
        duration && `target duration: ${duration} seconds`,
        aspect && `format: ${aspect}`,
        tone && `tone: ${tone}`,
        style && `visual style / aesthetic reference: ${style}`,
        audience && `audience: ${audience}`,
    ].filter(Boolean);
    if (constraints.length) lines.push(`CONSTRAINTS:\n- ${constraints.join('\n- ')}`);
    return lines.join('\n\n');
}

// Calls the LLM through the content-factory backend when logged in,
// otherwise directly on kie.ai with the user's key.
export async function requestPackage(brief) {
    let raw;
    if (localStorage.getItem('cf_backend')) {
        const res = await fetch('/.netlify/functions/director', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ brief }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.error) throw new Error(json.error || `Director request failed (${res.status})`);
        raw = json.content;
    } else {
        const key = window.__KIE_KEY__ || localStorage.getItem('kie_key');
        if (!key) throw new Error('API Key missing. Please set your kie.ai key in Settings.');
        // Dev requests go through the vite proxy (see vite.config.mjs)
        const base = import.meta.env.DEV ? '' : 'https://api.kie.ai';
        const res = await fetch(`${base}${KIE_CHAT_PATH}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
                messages: [
                    { role: 'system', content: [{ type: 'text', text: SYSTEM_PROMPT }] },
                    { role: 'user', content: [{ type: 'text', text: brief }] },
                ],
                reasoning_effort: 'high',
            }),
        });
        const text = await res.text();
        let data = {};
        try { data = JSON.parse(text); } catch { /* empty */ }
        if (!res.ok) throw new Error(data.error?.message || data.msg || `Kie chat request failed (${res.status})`);
        raw = data.choices?.[0]?.message?.content;
    }
    if (!raw) throw new Error('The director model returned an empty answer.');
    return parsePackage(raw);
}

// Extracts the JSON object from the model answer (tolerates fences or wrapper tags).
export function parsePackage(raw) {
    const text = String(raw);
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('The director model did not return a JSON package.');
    let parsed;
    try {
        parsed = JSON.parse(text.slice(start, end + 1));
    } catch (error) {
        throw new Error(`Could not parse the production package: ${error.message}`);
    }
    return normalizePackage(parsed);
}

const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value) => (value == null ? '' : String(value));

function closestKey(value, keys) {
    const needle = asText(value).toLowerCase();
    if (!needle) return keys[0];
    const exact = keys.find(k => k.toLowerCase() === needle);
    if (exact) return exact;
    const partial = keys.find(k => needle.includes(k.toLowerCase()) || k.toLowerCase().includes(needle));
    if (partial) return partial;
    const words = needle.split(/[^a-z0-9]+/).filter(w => w.length > 2);
    let best = keys[0];
    let bestScore = 0;
    for (const key of keys) {
        const score = words.filter(w => key.toLowerCase().includes(w)).length;
        if (score > bestScore) { best = key; bestScore = score; }
    }
    return best;
}

function closestNumber(value, options) {
    const n = parseFloat(value);
    if (!Number.isFinite(n)) return options[Math.floor(options.length / 2)];
    return options.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));
}

function normalizeAperture(value) {
    const n = parseFloat(asText(value).replace(/^f\//i, ''));
    if (!Number.isFinite(n)) return 'f/4';
    return APERTURES.reduce((a, b) => (Math.abs(parseFloat(b.slice(2)) - n) < Math.abs(parseFloat(a.slice(2)) - n) ? b : a));
}

export function snapDuration(seconds, modelKey) {
    const model = DIRECTOR_VIDEO_MODELS[modelKey] || DIRECTOR_VIDEO_MODELS['seedance-2.0'];
    return closestNumber(seconds, model.durations);
}

export function normalizePackage(pkg) {
    const cameras = Object.keys(CAMERA_MAP);
    const lenses = Object.keys(LENS_MAP);
    const characters = asArray(pkg.characters).map((c, i) => ({
        id: asText(c.id) || `c${i + 1}`,
        name: asText(c.name) || `Character ${i + 1}`,
        look: asText(c.look),
        wardrobe: asText(c.wardrobe),
        expressions: asText(c.expressions),
        arc: asText(c.arc),
        reference_prompt: asText(c.reference_prompt),
        references: asArray(c.references).filter(Boolean).slice(0, MAX_REFERENCES),
    }));
    const characterIds = new Set(characters.map(c => c.id));
    const shots = asArray(pkg.shots).map((s, i) => {
        const model = DIRECTOR_VIDEO_MODELS[s.model] ? s.model : 'seedance-2.0';
        return {
            id: asText(s.id) || String(i + 1),
            scene: asText(s.scene),
            duration_s: Number(s.duration_s) || 5,
            shot_type: asText(s.shot_type),
            camera: closestKey(s.camera, cameras),
            lens: closestKey(s.lens, lenses),
            focal: closestNumber(s.focal, FOCALS),
            aperture: normalizeAperture(s.aperture),
            movement: asText(s.movement),
            characters: asArray(s.characters).map(asText).filter(id => characterIds.has(id)),
            keyframe_prompt: asText(s.keyframe_prompt),
            motion_prompt: asText(s.motion_prompt),
            negative: asText(s.negative),
            pipeline: PIPELINES.includes(s.pipeline) ? s.pipeline : 'i2v',
            model,
            dialogue: asText(s.dialogue),
            keyframe_url: asText(s.keyframe_url),
            video_url: asText(s.video_url),
        };
    });
    const format = pkg.format || {};
    return {
        title: asText(pkg.title) || 'Untitled',
        logline: asText(pkg.logline),
        thesis: asText(pkg.thesis),
        viewer_contract: {
            feel: asText(pkg.viewer_contract?.feel),
            understand: asText(pkg.viewer_contract?.understand),
            remember: asText(pkg.viewer_contract?.remember),
        },
        format: {
            aspect_ratio: asText(format.aspect_ratio) || '16:9',
            duration_s: Number(format.duration_s) || shots.reduce((t, s) => t + s.duration_s, 0),
            structure: asText(format.structure),
        },
        beats: asArray(pkg.beats).map(b => ({ t: asText(b.t), beat: asText(b.beat), density: asText(b.density) })),
        characters,
        color_script: asArray(pkg.color_script).map(c => ({
            scene: asText(c.scene), palette: asText(c.palette), temperature: asText(c.temperature), lighting: asText(c.lighting),
        })),
        scenes: asArray(pkg.scenes).map((s, i) => ({
            id: asText(s.id) || `s${i + 1}`,
            title: asText(s.title),
            function: asText(s.function),
            duration_s: Number(s.duration_s) || 0,
            transition: asText(s.transition),
            emotion_in: asText(s.emotion_in),
            emotion_out: asText(s.emotion_out),
            pipeline: PIPELINES.includes(s.pipeline) ? s.pipeline : 'i2v',
        })),
        shots,
        audio: {
            voiceover: asArray(pkg.audio?.voiceover).map(v => ({ shot: asText(v.shot), text: asText(v.text), timing: asText(v.timing) })),
            music: asArray(pkg.audio?.music).map(m => ({ t: asText(m.t), cue: asText(m.cue) })),
            sound_design: asArray(pkg.audio?.sound_design).map(asText),
            lipsync: asArray(pkg.audio?.lipsync).map(l => ({ shot: asText(l.shot), mode: asText(l.mode), model: asText(l.model) })),
        },
        execution_notes: asArray(pkg.execution_notes).map(asText),
    };
}

export function shotCharacters(pkg, shot) {
    return shot.characters.map(id => pkg.characters.find(c => c.id === id)).filter(Boolean);
}

// Ordered reference images for a shot: each character's references in the
// order the shot lists them, capped at the model limit.
export function shotReferences(pkg, shot) {
    return shotCharacters(pkg, shot).flatMap(c => c.references).slice(0, MAX_REFERENCES);
}

export function keyframePrompt(pkg, shot) {
    const people = shotCharacters(pkg, shot)
        .map(c => `${c.name}: ${[c.look, c.wardrobe].filter(Boolean).join(', ')}`)
        .join('; ');
    const color = pkg.color_script.find(c => c.scene === shot.scene);
    const base = [
        shot.keyframe_prompt,
        people && `Characters (keep identical to the reference images): ${people}`,
        color && [color.palette, color.temperature, color.lighting].filter(Boolean).join(', '),
    ].filter(Boolean).join('. ');
    const prompt = buildNanoBananaPrompt(base, shot.camera, shot.lens, shot.focal, shot.aperture);
    return shot.negative ? `${prompt}. Avoid: ${shot.negative}` : prompt;
}

export function motionPrompt(pkg, shot) {
    return [
        shot.motion_prompt,
        shot.movement && `Camera: ${shot.movement}`,
        shot.characters.length && 'Keep every character\'s face, hair and wardrobe identical to the first frame',
        shot.dialogue && `On-screen line: "${shot.dialogue}"`,
        shot.negative && `Avoid: ${shot.negative}`,
    ].filter(Boolean).join('. ');
}

export function characterSheetPrompt(character) {
    return [
        character.reference_prompt || `${character.name}, ${character.look}, ${character.wardrobe}`,
        'character reference sheet, neutral front-facing pose, even soft studio light, plain light grey background, full head and shoulders visible, photorealistic, sharp focus',
    ].join(', ');
}

// ── Persistence ─────────────────────────────────────────────────────────────
const STORE_KEY = 'director_projects';

export function loadProjects() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { return []; }
}

export function saveProject(project) {
    const projects = loadProjects().filter(p => p.id !== project.id);
    projects.unshift({ ...project, updatedAt: Date.now() });
    localStorage.setItem(STORE_KEY, JSON.stringify(projects.slice(0, 30)));
}

export function deleteProject(id) {
    localStorage.setItem(STORE_KEY, JSON.stringify(loadProjects().filter(p => p.id !== id)));
}

// ── Export: the 9-section Delivery Package as Markdown ──────────────────────
export function packageToMarkdown(pkg) {
    const out = [];
    const table = (head, rows) => {
        out.push(`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`);
        rows.forEach(r => out.push(`| ${r.map(c => asText(c).replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`));
        out.push('');
    };
    out.push(`# ${pkg.title}`, '');
    out.push('## 1. Logline + Core Thesis', '', `**Logline:** ${pkg.logline}`, '', `**Thesis:** ${pkg.thesis}`, '');
    out.push(`Viewer contract: feel ${pkg.viewer_contract.feel} · understand ${pkg.viewer_contract.understand} · remember ${pkg.viewer_contract.remember}`, '');
    out.push('## 2. Narrative Architecture + Beat Sheet', '', `${pkg.format.structure} · ${pkg.format.duration_s}s · ${pkg.format.aspect_ratio}`, '');
    table(['Time', 'Beat', 'Density'], pkg.beats.map(b => [b.t, b.beat, b.density]));
    out.push('## 3. Scene-by-Scene Breakdown', '');
    table(['Scene', 'Function', 'Duration', 'Transition', 'Emotion', 'Pipeline'],
        pkg.scenes.map(s => [`${s.id} ${s.title}`, s.function, `${s.duration_s}s`, s.transition, `${s.emotion_in} → ${s.emotion_out}`, s.pipeline]));
    out.push('## 4. Shot List', '');
    table(['#', 'Scene', 'Dur', 'Type', 'Camera', 'Lens', 'Focal', 'Aperture', 'Movement', 'Pipeline', 'Model'],
        pkg.shots.map(s => [s.id, s.scene, `${s.duration_s}s`, s.shot_type, s.camera, s.lens, `${s.focal}mm`, s.aperture, s.movement, s.pipeline, DIRECTOR_VIDEO_MODELS[s.model]?.name || s.model]));
    out.push('## 5. Character & Visual Continuity Bible', '');
    pkg.characters.forEach(c => out.push(`### ${c.name} (${c.id})`, '', `- Look: ${c.look}`, `- Wardrobe: ${c.wardrobe}`, `- Expressions: ${c.expressions}`, `- Arc: ${c.arc}`, ''));
    table(['Scene', 'Palette', 'Temperature', 'Lighting'], pkg.color_script.map(c => [c.scene, c.palette, c.temperature, c.lighting]));
    out.push('## 6. Multi-Image Reference Strategy', '');
    pkg.characters.forEach(c => out.push(`- **${c.name}**: generate the character sheet first (\`${KEYFRAME_MODEL}\`), then attach it as reference #1 to every shot that lists ${c.id}.`, `  - Sheet prompt: ${characterSheetPrompt(c)}`));
    out.push('', 'Reference order per shot follows the order of the shot\'s character list.', '');
    out.push('## 7. Audio & Lip-Sync Direction', '');
    table(['Shot', 'Voice-over', 'Timing'], pkg.audio.voiceover.map(v => [v.shot, v.text, v.timing]));
    table(['Time', 'Music cue'], pkg.audio.music.map(m => [m.t, m.cue]));
    pkg.audio.sound_design.forEach(s => out.push(`- ${s}`));
    pkg.audio.lipsync.forEach(l => out.push(`- Lip-sync shot ${l.shot}: ${l.mode} → ${l.model}`));
    out.push('', '## 8. Prompt Pack', '');
    pkg.shots.forEach(s => {
        const refs = shotCharacters(pkg, s).map(c => c.name).join(', ');
        out.push(`### Shot ${s.id}`, '', `Keyframe (${refs ? `${KEYFRAME_EDIT_MODEL}, refs: ${refs}` : KEYFRAME_MODEL}):`, '', '```', keyframePrompt(pkg, s), '```', '',
            `Motion (${DIRECTOR_VIDEO_MODELS[s.model]?.name || s.model}, ${snapDuration(s.duration_s, s.model)}s, ${pkg.format.aspect_ratio}):`, '', '```', motionPrompt(pkg, s), '```', '');
    });
    out.push('## 9. Technical Execution Notes', '');
    pkg.execution_notes.forEach((n, i) => out.push(`${i + 1}. ${n}`));
    out.push('');
    return out.join('\n');
}
