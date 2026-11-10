# pipeline/ · kit di produzione video (Python)

Questa cartella è la fonte unica degli strumenti generici usati dai thread di produzione.
Le regole di produzione stanno in `/mnt/project-files/standard-produzione.md`; le quote e i
fallback dei provider in `/mnt/project-files/api-gratuite/gerarchia-api.md`.

Prima del 10/11/2026 questi file venivano copiati in ogni `video-N/produzione/`: le copie
erano identiche byte per byte. Da qui in avanti si importano da qui e non si copiano.

| File | Cosa fa | Chiavi lette dall'ambiente |
|---|---|---|
| `kit/cf.py` | `gen(prompt, out, refs, w, h, model, steps, seed)`: immagini Cloudflare FLUX (`flux-2-klein-9b` con reference ≤512 px, `flux-2-dev`) | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` |
| `kit/hfimg.py` | `gen(...)`: riserva immagini su HF ZeroGPU FLUX.1-schnell | `HF_TOKEN` |
| `kit/gem.py` | `ask(text, images, video, json_out)`: QC Q1/Q2/Q3 con Gemini, fallback ad altri Gemini e a OpenRouter `:free` (solo immagini) | `GEMINI_API_KEY`, `OPENROUTER_API_KEY` |
| `kit/el.py` | `sfx(name, text, dur, ...)`: effetti sonori ElevenLabs; da riga di comando legge un JSON di job | `ELEVENLABS_API_KEY` |
| `kit/depth.py` | mappa di profondità Depth Anything v2 small (ONNX) per la parallasse 2.5D | nessuna (modello in `models/depth/`) |
| `kit/lama.py` | `inpaint(im, mask, box)`: toglie un personaggio da un'immagine approvata con LaMa ONNX | nessuna (modello in `models/lama/`) |

Uso da uno script di un video (cartella di lavoro = `video-N/produzione/`):

```python
import sys; sys.path.insert(0, '/home/user/open-higgsfield-ai/pipeline/kit')
import cf, gem
```

Restano nella cartella del video gli script che dipendono dal copione: `prompts.py`,
`q1.py`/`q3.py` (domande di QC), `tts.py` (voce e velocità per battuta), `render.py`, `mix.py`.
Un miglioramento a uno strumento generico si fa qui, con un commit, non nella copia di un video.
