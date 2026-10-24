// Voice-over / dialogue synthesis with Gemini TTS (free daily quota, CORS-enabled,
// called straight from the browser with the user's own key).
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// Tried in order: when one is out of quota or returns no audio, the next one runs.
const TTS_MODELS = ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-2.5-flash-preview-tts'];

export const VOICES = {
    Charon: 'Charon — male, low, informative',
    Orus: 'Orus — male, firm',
    Fenrir: 'Fenrir — male, energetic',
    Puck: 'Puck — male, bright',
    Kore: 'Kore — female, firm',
    Aoede: 'Aoede — female, airy',
    Leda: 'Leda — female, youthful',
    Sulafat: 'Sulafat — female, warm',
};

export const getGeminiKey = () => localStorage.getItem('gemini_key') || '';
export const setGeminiKey = (key) => localStorage.setItem('gemini_key', String(key || '').trim());

function base64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

// Wraps raw 16-bit little-endian PCM in a WAV container.
function pcmToWav(pcm, sampleRate = 24000, channels = 1) {
    const header = new ArrayBuffer(44);
    const v = new DataView(header);
    const write = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    write(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); write(8, 'WAVE');
    write(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * channels * 2, true);
    v.setUint16(32, channels * 2, true); v.setUint16(34, 16, true);
    write(36, 'data'); v.setUint32(40, pcm.length, true);
    return new Blob([header, pcm], { type: 'audio/wav' });
}

/**
 * @param {string} text   line to speak
 * @param {object} opts   { voice, direction } — direction is a short delivery note, e.g. "calm, low"
 * @returns {Promise<Blob>} audio/wav
 */
export async function synthesizeSpeech(text, { voice = 'Charon', direction = '' } = {}) {
    const key = getGeminiKey();
    if (!key) throw new Error('Add your free Gemini API key in the Audio panel to generate voices.');
    const prompt = direction ? `Read this aloud (${direction}). Say only the text:\n${text}` : text;
    let lastError = 'No audio returned.';
    for (const model of TTS_MODELS) {
        const res = await fetch(`${GEMINI_BASE}/${model}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    responseModalities: ['AUDIO'],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
                },
            }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            lastError = data.error?.message || `Gemini TTS failed (${res.status})`;
            if (res.status === 400 || res.status === 403) break; // bad key or request: other models will fail the same way
            continue;
        }
        const audio = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData;
        if (!audio?.data) continue;
        const bytes = base64ToBytes(audio.data);
        const mime = String(audio.mimeType || '').toLowerCase();
        if (mime.includes('wav')) return new Blob([bytes], { type: 'audio/wav' });
        const rate = Number(mime.match(/rate=(\d+)/)?.[1]) || 24000;
        return pcmToWav(bytes, rate);
    }
    throw new Error(lastError);
}

export function audioDuration(blob) {
    return new Promise((resolve) => {
        const audio = new Audio();
        audio.preload = 'metadata';
        audio.onloadedmetadata = () => { resolve(Number.isFinite(audio.duration) ? audio.duration : 0); URL.revokeObjectURL(audio.src); };
        audio.onerror = () => resolve(0);
        audio.src = URL.createObjectURL(blob);
    });
}
