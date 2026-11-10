# CLAUDE.md · VIDEO CREATOR

Fonte unica delle regole operative di questo repo. README, memoria del progetto e
`pipeline/README.md` rimandano qui; se dicono altro, vale questo file.

## Scopo

VIDEO CREATOR è la fabbrica di video brevi di TAT (lancio di Istòs, serie «Luna Cava», spot):
da un'idea a un video finito e controllato, a costo zero. È uno strumento, non un prodotto da finire.
Due parti:
1. **Pipeline di produzione (Python, in `pipeline/` + cartelle `video-N/` nei file di progetto)**:
   è quella che produce davvero i video. L'AI disegna, il codice anima, ogni video passa i QC Q1-Q3.
2. **Studio web (Vite, in `src/` + `netlify/`)**: fork di Open-Higgsfield-AI con Director Mode
   (idea → package → keyframe → clip → montaggio nel browser). Dipende da crediti kie.ai/fal.ai,
   oggi quasi esauriti: è in manutenzione, non si sviluppa senza una richiesta di TAT.

## Mappa

| Percorso | Cosa |
|---|---|
| `src/main.js` | entry point dello studio web; router delle schede (library, image, video, cinema, director, lipsync) |
| `src/components/` | una scheda = un file (`*Studio.js`, `LibraryPage.js`) + modali |
| `src/lib/kie.js`, `api.js` | client kie.ai e backend Netlify; `models.js` catalogo modelli (modificato a mano) |
| `src/lib/director.js`, `voice.js`, `assemble.js`, `mediaStore.js` | Director Mode: package, voce Gemini/Edge, montaggio ffmpeg.wasm, IndexedDB |
| `netlify/functions/` | API `/api/*` (login PIN, crediti, libreria Airtable, create/status kie+fal, director). File con `_` = moduli condivisi |
| `netlify/edge-functions/media-download.js` | unica edge function attiva (`/download-media`) |
| `data/` | `director-system.md` (prompt del Director), `models.json`, `voices.json` letti dalle functions |
| `pipeline/kit/` | strumenti Python generici della produzione (vedi `pipeline/README.md`) |
| `electron/` | app desktop dell'upstream: parcheggiata, non funziona con il backend `/api` relativo |
| `/mnt/project-files/` (fuori dal repo) | `standard-produzione.md`, `api-gratuite/gerarchia-api.md`, `asset/<serie>/`, `video-N/`, `coordinamento/` |

## Comandi

```bash
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install --ignore-scripts   # dipendenze (senza scaricare Electron)
npm run dev        # Vite su :5173; /api e /.netlify/functions vanno al sito Netlify via proxy
npm run build      # build di produzione in dist/ (stessa che fa Netlify)
for f in netlify/functions/*.js; do node --check "$f"; done   # controllo sintassi delle functions
python3 -m py_compile pipeline/kit/*.py                         # controllo sintassi del kit
```

Non esistono test automatici né lint configurato: la verifica minima è `npm run build` senza errori
più, per le modifiche alla UI, una prova con Playwright che apra la scheda toccata
(le chiamate kie/Gemini si simulano con `page.route`, come fatto per Director Mode).

## Convenzioni

- Studio web: JavaScript vanilla, un componente = una funzione che restituisce un elemento DOM; Tailwind v4 via `@tailwindcss/vite` (tema in `src/styles/global.css`). Nessun framework nuovo.
- Netlify function: un file per endpoint in `netlify/functions/`, chiamata dal frontend come `/api/<nome>`; i moduli condivisi iniziano con `_`.
- Chiavi: lato server solo variabili d'ambiente Netlify; lato browser solo `localStorage` (`kie_key`, `gemini_key`, `cf_backend`). Mai una chiave nel codice o in un commit.
- Produzione: ogni video in `/mnt/project-files/video-N/` con `brief.md`, `copione-e-regia.md`, `produzione/` (script del video, `prompts.json`, `qc.json`), `finale/`. Asset riusabili in `asset/<serie>/`. Gli strumenti generici si importano da `pipeline/kit/`, non si copiano.
- Lingua: documenti e messaggi in italiano; codice e commit in inglese.

## Da non fare mai

- Usare modelli a pagamento (Seedance, Kling, Veo, Sora via crediti) o promettere animazione AI piena: budget zero, vedi `standard-produzione.md` §6. Motivo: i video 1 e 2 sono stati scartati per questo.
- Consegnare un video senza Q3 superato. Motivo: è la regola che rende i video pubblicabili.
- Rigenerare un personaggio dentro una scena invece di riusare l'asset approvato. Motivo: causa il drift visivo.
- Fare in automatico più versioni (30/15/6 s) di uno spot: prima si sceglie il formato dal contesto d'uso. Motivo: richiesta di TAT del 7/11, spreco di quote.
- Push su `main`, merge o deploy senza richiesta esplicita di TAT. Motivo: Netlify pubblica `main`.
- Lasciare attività programmate, loop o processi in background accesi a fine thread. Motivo: consumano calcolo senza produrre.

## Come si chiude un lavoro

Un lavoro è finito quando tutte queste cose sono vere:
1. `npm run build` passa (se è stato toccato `src/` o `netlify/`), oppure il video ha la riga di esito QC (se è una produzione).
2. Le modifiche sono su un branch con commit descrittivi e una PR aperta verso `main` del fork; niente file non tracciati lasciati in giro.
3. Gli script del video sono nella sua cartella `produzione/`, senza copie degli strumenti di `pipeline/kit/` e senza `__pycache__`.
4. Questo file, se una regola è cambiata, e la memoria del progetto (una riga di stato) sono aggiornati.
5. Nessun processo, monitor o attività programmata del thread è rimasto acceso.
