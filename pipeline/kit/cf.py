import os, sys, json, base64, requests
A=os.environ['CLOUDFLARE_ACCOUNT_ID']; T=os.environ['CLOUDFLARE_API_TOKEN']
def gen(prompt,out,refs=(),w=1344,h=768,model='flux-2-klein-9b',steps=None,seed=None):
    url=f'https://api.cloudflare.com/client/v4/accounts/{A}/ai/run/@cf/black-forest-labs/{model}'
    files={'prompt':(None,prompt),'width':(None,str(w)),'height':(None,str(h))}
    if steps: files['steps']=(None,str(steps))
    if seed is not None: files['seed']=(None,str(seed))
    for i,r in enumerate(refs): files[f'input_image_{i}']=(os.path.basename(r),open(r,'rb'),'image/png')
    r=requests.post(url,headers={'Authorization':'Bearer '+T},files=files,timeout=300)
    try: j=r.json()
    except Exception: print(out,'HTTP',r.status_code,r.text[:300]); return False
    if not j.get('success'): print(out,'FAIL',str(j)[:400]); return False
    open(out,'wb').write(base64.b64decode(j['result']['image'])); print(out,'ok',flush=True); return True
if __name__=='__main__':
    gen(sys.argv[1],sys.argv[2],sys.argv[3:])
