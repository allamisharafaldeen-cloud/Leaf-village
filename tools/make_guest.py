"""Turn a full 1696x2528 form picture (figure on flat grey) into the three files the app uses:
   guests/<id>-cut.webp  (figure only, 950 px tall)   guests/<id>-aura.webp (effects only, 1100 px tall)
   guests/<id>-face.jpg  (360x360 head crop from the original), plus GUEST_ART {ar, box} for index.html."""
import sys, json, numpy as np
from PIL import Image
from scipy import ndimage
from rembg import new_session, remove
S = new_session('isnet-anime')
import os
REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

def figure_mask(im):
    m = np.asarray(remove(im, session=S, only_mask=True)).astype(np.float32) / 255
    # keep the main body: connected parts that are big, drop specks
    lab, n = ndimage.label(m > .5)
    if n > 1:
        sizes = ndimage.sum(np.ones_like(m), lab, range(1, n + 1)); keep = np.zeros(n + 1, bool)
        keep[1:] = sizes >= max(4000, sizes.max() * .02)
        m = m * ndimage.binary_dilation(keep[lab], iterations=3)
    return m

def color_to_alpha(a, bg):
    """GIMP-style colour-to-alpha against a flat background: how far each pixel is from the grey, and its pure colour."""
    d = a - bg
    lim = np.where(d > 0, 255 - bg, bg)            # room to move in each channel
    alpha = np.clip((np.abs(d) / np.maximum(lim, 1)).max(axis=2), 0, 1)
    col = bg + d / np.maximum(alpha[..., None], 1e-4)
    return np.clip(col, 0, 255), alpha

def head_box(m):
    H, W = m.shape; on = m > .5
    ys, xs = np.where(on); y0, y1 = ys.min(), ys.max()
    torso = on[int(y0 + (y1 - y0) * .25): int(y0 + (y1 - y0) * .45)]
    tx = np.where(torso.any(axis=0))[0]; bodyc = int(np.median(np.where(torso)[1])) if tx.size else W // 2
    band = on[:, max(0, bodyc - 160): bodyc + 160]
    hy = int(np.where(band.any(axis=1))[0][0])       # top of the hair above the body's centre
    head_rows = on[hy: hy + 260, max(0, bodyc - 260): bodyc + 260]
    hx = int(np.median(np.where(head_rows)[1])) + max(0, bodyc - 260)
    figh = y1 - hy
    side = int(round(.184 * figh)); top = int(round(hy + .06 * side)); left = int(round(hx - side / 2))
    return left, top, side

HAND = {  # body outlines drawn by hand where an effect wraps around the figure (Zuko's fire dragon)
  'zuko': {'head': (875, 660)},
  'jotaro': {'head': (895, 190)}}

def hand_mask(shape, polys):
    from PIL import ImageDraw
    k = Image.new('L', (shape[1], shape[0]), 0); d = ImageDraw.Draw(k)
    for p in polys: d.polygon(p, fill=255)
    return ndimage.gaussian_filter(np.asarray(k).astype(np.float32) / 255, 3)

def build(fid, src):
    im = Image.open(src).convert('RGB'); a = np.asarray(im).astype(np.float32)
    bg = np.median(np.concatenate([a[:20, :20].reshape(-1, 3), a[:20, -20:].reshape(-1, 3), a[-20:, :20].reshape(-1, 3), a[-20:, -20:].reshape(-1, 3)]), axis=0)
    m = figure_mask(im)
    hd = HAND.get(fid)
    if hd and hd.get('polys'):
        m = m * hand_mask(m.shape, hd['polys'])
        if hd.get('fire'):
            R, G, B = a[..., 0], a[..., 1], a[..., 2]
            fire = (R > 215) & (B < 110) & (R - G > 25)
            m = m * (1 - ndimage.gaussian_filter(ndimage.binary_dilation(fire, iterations=2).astype(np.float32), 1.5))
            body = hand_mask(m.shape, hd['polys'][:1]) > .5
            blades = (hand_mask(m.shape, hd['polys'][1:]) > .5) & ~body
            mx = a.max(axis=2); sat = (mx - a.min(axis=2)) / np.maximum(mx, 1)
            m[blades & (sat > .3)] = 0                       # on the blades keep the steel, not the flames or their outlines
            bgish = np.abs(a - bg).max(axis=2) < 14
            m[bgish & ~blades] = 0                           # never the grey background
            m = ndimage.gaussian_filter(ndimage.binary_opening(m > .5, iterations=2).astype(np.float32), 1) * (m > .05)
        lab, n = ndimage.label(m > .5)
        if n > 1:
            sizes = ndimage.sum(np.ones_like(m), lab, range(1, n + 1)); keep = np.zeros(n + 1, bool); keep[1:] = sizes >= sizes.max() * .01
            m = m * ndimage.binary_dilation(keep[lab], iterations=2)
    ys, xs = np.where(m > .5); x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    w, h = x1 - x0, y1 - y0
    # cut: the figure with a soft edge
    alpha = np.clip((m - .08) / .84, 0, 1)
    cut = np.dstack([a, alpha * 255]).astype(np.uint8)[y0:y1, x0:x1]
    cut = Image.fromarray(cut, 'RGBA'); cut = cut.resize((round(w * 950 / h), 950), Image.LANCZOS)
    cut.save(f'{REPO}/guests/{fid}-cut.webp', quality=88, method=6)
    # aura: everything that isn't grey and isn't the figure
    col, al = color_to_alpha(a, bg)
    al = al * (1 - np.clip(m * 1.15, 0, 1)); al[al < .035] = 0
    ays, axs = np.where(al > .06)
    ax0, ax1, ay0, ay1 = min(axs.min(), x0), max(axs.max() + 1, x1), min(ays.min(), y0), max(ays.max() + 1, y1)
    aura = np.dstack([col, al * 255]).astype(np.uint8)[ay0:ay1, ax0:ax1]
    aura = Image.fromarray(aura, 'RGBA'); ah = ay1 - ay0; aw = ax1 - ax0
    aura.resize((round(aw * 1100 / ah), 1100), Image.LANCZOS).save(f'{REPO}/guests/{fid}-aura.webp', quality=82, method=6)
    box = [round((ax0 - x0) / w * 100, 2), round((ay0 - y0) / h * 100, 2), round(aw / w * 100, 2), round(ah / h * 100, 2)]
    # face: same framing as the first eleven
    left, top, side = head_box(m)
    side = 430                                   # the first eleven all use a 430 px square
    if hd and hd.get('head'): hx, hy = hd['head']; left, top = int(hx - side / 2), int(hy + 26)
    else: left = int(left + (left and 0) + (head_box(m)[2] - side) / 2)
    im.crop((left, top, left + side, top + side)).resize((360, 360), Image.LANCZOS).save(f'{REPO}/guests/{fid}-face.jpg', quality=90)
    return {'ar': round(w / h, 3), 'box': box}, (left, top, side)

if __name__ == '__main__':
    out = {}
    for arg in sys.argv[1:]:
        fid, src = arg.split('=')
        art, face = build(fid, src); out[fid] = art; print(fid, json.dumps(art), 'face', face, flush=True)
    print('GUEST_ART entries:', json.dumps(out))
