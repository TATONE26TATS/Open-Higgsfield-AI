# Riserva immagini: HF ZeroGPU FLUX.1-schnell (quota GPU giornaliera gratuita)
import os, shutil
from gradio_client import Client
_c = None
def gen(prompt, out, refs=(), w=1344, h=768, seed=0, steps=4):
    global _c
    if _c is None: _c = Client('black-forest-labs/FLUX.1-schnell', token=os.environ['HF_TOKEN'], verbose=False)
    try:
        r = _c.predict(prompt=prompt, seed=seed, randomize_seed=False, width=w, height=h, num_inference_steps=steps, api_name='/infer')
    except Exception as e:
        print(out, 'FAIL', str(e)[:300], flush=True); return False
    p = r[0]['path'] if isinstance(r[0], dict) else r[0]
    from PIL import Image
    Image.open(p).convert('RGB').save(out); print(out, 'ok', flush=True); return True
