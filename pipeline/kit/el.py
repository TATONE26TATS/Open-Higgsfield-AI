import os, sys, json, requests
from concurrent.futures import ThreadPoolExecutor
K=os.environ['ELEVENLABS_API_KEY']
def sfx(name,text,dur=None,infl=0.5,loop=False,folder='sfx'):
    out=f'{folder}/{name}.mp3'
    if os.path.exists(out): return
    body={'text':text,'prompt_influence':infl}
    if dur: body['duration_seconds']=dur
    if loop: body['loop']=True
    r=requests.post('https://api.elevenlabs.io/v1/sound-generation',headers={'xi-api-key':K},json=body,timeout=180)
    if r.status_code!=200: print(name,r.status_code,r.text[:200]); return
    open(out,'wb').write(r.content); print(name,'ok',flush=True)
if __name__=='__main__':
    jobs=json.load(open(sys.argv[1]))
    with ThreadPoolExecutor(3) as ex: list(ex.map(lambda j: sfx(**j),jobs))
