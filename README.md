# VIDEO CREATOR · studio web e kit di produzione

Fork di [Open-Higgsfield-AI](https://github.com/Autom8AI/Open-Higgsfield-AI) usato come fabbrica di video brevi.

- **Studio web** (`src/`, `netlify/`): schede Image, Video, Cinema, Lip Sync, Library e **Director Mode**
  (idea → package di produzione → keyframe → clip → montaggio nel browser). Backend: kie.ai e fal.ai
  tramite Netlify Functions, libreria su Airtable.
- **Kit di produzione** (`pipeline/`): strumenti Python gratuiti (Cloudflare FLUX, Gemini QC,
  ElevenLabs SFX, Depth Anything, LaMa) usati dai thread che producono i video.

Regole, struttura e comandi: **[CLAUDE.md](CLAUDE.md)**.

```bash
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install --ignore-scripts
npm run dev     # sviluppo
npm run build   # build di produzione in dist/
```

Licenza MIT, come l'upstream. Crediti: progetto originale di Anil Matcha e contributori.
