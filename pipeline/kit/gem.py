# QC con Gemini; se sovraccarico o a quota esaurita: altri modelli Gemini, poi OpenRouter :free con visione (solo immagini)
import os,requests,base64,json,re,time
K=os.environ['GEMINI_API_KEY']; M='gemini-3.5-flash'
FALLBACK=['gemini-3.8-flash','gemini-3.5-flash','gemini-3.1-flash-lite']
OR=['google/gemma-4-31b-it:free','nvidia/nemotron-3.5-super-vl:free']
used=None
def _gem(model,body):
    for k in range(3):
        r=requests.post(f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={K}',json=body,timeout=300)
        if r.status_code==200 and 'candidates' in r.json(): return r.json()['candidates'][0]['content']['parts'][-1]['text']
        print('gem',model,r.status_code,flush=True)
        if r.status_code==429: return None
        time.sleep(8*(k+1))
def _or(model,text,images):
    c=[{'type':'image_url','image_url':{'url':'data:image/png;base64,'+base64.b64encode(open(p,'rb').read()).decode()}} for p in images]
    c.append({'type':'text','text':text+'\nAnswer with JSON only.'})
    r=requests.post('https://openrouter.ai/api/v1/chat/completions',headers={'Authorization':'Bearer '+os.environ['OPENROUTER_API_KEY']},
                    json={'model':model,'messages':[{'role':'user','content':c}]},timeout=300)
    if r.status_code!=200: print('or',model,r.status_code,r.text[:120],flush=True); return None
    return r.json()['choices'][0]['message']['content']
def _json(t):
    t=t.strip(); m=re.search(r'\{.*\}',t,re.S)
    return json.loads(m.group(0) if m else t)
def ask(text,images=(),video=None,json_out=True):
    global used
    parts=[]
    for p in images:
        mt='image/png' if p.endswith('.png') else 'image/jpeg'
        parts.append({'inline_data':{'mime_type':mt,'data':base64.b64encode(open(p,'rb').read()).decode()}})
    if video: parts.append({'inline_data':{'mime_type':'video/mp4','data':base64.b64encode(open(video,'rb').read()).decode()}})
    parts.append({'text':text})
    body={'contents':[{'parts':parts}]}
    if json_out: body['generationConfig']={'responseMimeType':'application/json'}
    for model in [M]+[m for m in FALLBACK if m!=M]:
        t=_gem(model,body)
        if t: used=model; return _json(t) if json_out else t
    if video: raise RuntimeError('nessun modello disponibile per il video')
    small=[]
    for p in images:   # riduce per OpenRouter
        import cv2; im=cv2.imread(p); s=1024/max(im.shape[:2]); q=p.rsplit('.',1)[0]+'_q.png'
        cv2.imwrite(q,cv2.resize(im,None,fx=s,fy=s)); small.append(q)
    for model in OR:
        t=_or(model,text,small)
        if t: used=model; [os.remove(q) for q in small]; return _json(t) if json_out else t
    raise RuntimeError('nessun modello QC disponibile')
