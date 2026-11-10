import sys, numpy as np, cv2, onnxruntime as ort
S = ort.InferenceSession('models/depth/onnx/model.onnx')
for k in sys.argv[1:]:
    im = cv2.imread(f'img/{k}.png')[:, :, ::-1]; h, w = im.shape[:2]
    x = cv2.resize(im, (518 * w // h // 14 * 14, 518)).astype(np.float32) / 255
    x = (x - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
    d = S.run(None, {'pixel_values': x.transpose(2, 0, 1)[None].astype(np.float32)})[0][0]
    d = (d - d.min()) / (d.max() - d.min()); d = cv2.resize(d, (w, h)); d = cv2.GaussianBlur(d, (0, 0), 3)
    cv2.imwrite(f'img/{k}_depth.png', (d * 255).astype(np.uint8)); print(k)
