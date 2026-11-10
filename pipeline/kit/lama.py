# Inpaint con LaMa su un ritaglio quadrato attorno al box, poi rimesso al suo posto.
import numpy as np, cv2, onnxruntime as ort, sys
S = ort.InferenceSession('models/lama/lama_fp32.onnx')
def inpaint(im, mask, box):
    x0, y0, x1, y1 = box
    crop = im[y0:y1, x0:x1]; m = mask[y0:y1, x0:x1]
    a = cv2.resize(crop, (512, 512), interpolation=cv2.INTER_AREA)[:, :, ::-1].astype(np.float32) / 255
    mm = (cv2.resize(m, (512, 512)) > 127).astype(np.float32)
    o = S.run(None, {'image': a.transpose(2, 0, 1)[None], 'mask': mm[None, None]})[0][0].transpose(1, 2, 0)
    if o.max() > 2: o = o / 255
    o = cv2.resize((np.clip(o, 0, 1)[:, :, ::-1] * 255).astype(np.uint8), (x1 - x0, y1 - y0), interpolation=cv2.INTER_CUBIC)
    soft = cv2.GaussianBlur(m, (0, 0), 3).astype(np.float32)[..., None] / 255
    out = im.copy(); out[y0:y1, x0:x1] = (o * soft + crop * (1 - soft)).astype(np.uint8)
    return out
