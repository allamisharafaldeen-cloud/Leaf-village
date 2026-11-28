"""Build the friends' copy of the Leaf Village into open/ (served at .../Leaf-village/open/).

Same app, three differences, all switched on by window.LEAF_OPEN:
  * its own storage (IndexedDB names and every localStorage key get an "open:" prefix), so it never touches
    Sharaf's village even on his own phone, and no sync or notifications (everything stays on the device);
  * no pictures of Sharaf: rank figures become glowing rank crests on scenery, the forms are hidden, new icon and
    launch screens, no rank-up videos;
  * its own service worker and cache names, so the two copies never clear each other's caches.

Run after any change to the app:   python3 tools/build_open.py
The art only needs Pillow. tests/unit/open.test.mjs fails if open/ is older than the app's source files."""
import hashlib, json, math, os, re, shutil, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT = os.path.join(ROOT, 'open')
SOURCES = ['index.html', 'platform.js', 'leaf-engine.js', 'leaf-merge.js', 'sw.js', 'manifest.webmanifest', 'tools/build_open.py']
BG = (12, 20, 15)
FONT = os.path.join(ROOT, 'tools', 'fonts', 'DelaGothicOne.ttf')

def source_hash():
    h = hashlib.sha256()
    for f in SOURCES:
        h.update(f.encode()); h.update(open(os.path.join(ROOT, f), 'rb').read())
    return h.hexdigest()[:16]

def rgb(hexc): hexc = hexc.lstrip('#'); return tuple(int(hexc[i:i + 2], 16) for i in (0, 2, 4))
def mix(a, b, t): return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))

def crest(size, color):
    """A round village crest: rank-coloured ring, dark face, gold rim and a leaf. Transparent outside."""
    S = size * 4; c = rgb(color); im = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    cx = cy = S / 2; R = S * .46
    d.ellipse((cx - R, cy - R, cx + R, cy + R), fill=mix(c, (255, 255, 255), .15) + (255,))
    r2 = R * .86; d.ellipse((cx - r2, cy - r2, cx + r2, cy + r2), fill=(233, 196, 106, 255))
    r3 = R * .81; d.ellipse((cx - r3, cy - r3, cx + r3, cy + r3), fill=mix(c, BG, .72) + (255,))
    # the leaf: two arcs, tilted 40 degrees, with a midrib and veins
    L = R * 1.1; pts = []
    for k in range(0, 61):
        t = k / 60; x = (t - .5) * L; y = math.sin(t * math.pi) * L * .27; pts.append((x, -y))
    for k in range(60, -1, -1):
        t = k / 60; x = (t - .5) * L; y = math.sin(t * math.pi) * L * .27; pts.append((x, y))
    a = math.radians(-40); rot = lambda p: (cx + p[0] * math.cos(a) - p[1] * math.sin(a), cy + p[0] * math.sin(a) + p[1] * math.cos(a))
    d.polygon([rot(p) for p in pts], fill=mix(c, (255, 255, 255), .55) + (255,))
    d.line([rot((-L * .62, 0)), rot((L * .5, 0))], fill=mix(c, BG, .35) + (255,), width=int(S * .018))
    for k in range(1, 5):
        x = -L * .5 + k * L * .2
        for s in (-1, 1): d.line([rot((x, 0)), rot((x + L * .1, s * L * .14))], fill=mix(c, BG, .35) + (255,), width=int(S * .01))
    return im.resize((size, size), Image.LANCZOS)

def glow(size, color, alpha=.75):
    w, h = size; c = rgb(color); g = Image.new('L', (w, h), 0); d = ImageDraw.Draw(g)
    r = min(w, h) * .38; cx, cy = w / 2, h * .42
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=int(255 * alpha)); g = g.filter(ImageFilter.GaussianBlur(min(w, h) * .12))
    im = Image.new('RGBA', (w, h), mix(c, (255, 255, 255), .25) + (0,)); im.putalpha(g); return im

def cover(src, size):
    im = Image.open(src).convert('RGB'); W, H = size; s = max(W / im.width, H / im.height)
    im = im.resize((math.ceil(im.width * s), math.ceil(im.height * s)), Image.LANCZOS)
    x, y = (im.width - W) // 2, (im.height - H) // 2; return im.crop((x, y, x + W, y + H))

def rank_colors():
    h = open(os.path.join(ROOT, 'index.html')).read(); block = h[h.index('const RANK_LOOK = {'):]; block = block[:block.index('};')]
    out = {}
    for m in re.finditer(r"'([a-z-]+)':\s*\{color:'(#[0-9a-f]{6})'(?:[^}]*?walls:\[([^\]]*)\])?", block):
        out[m.group(1)] = (m.group(2), re.findall(r"'([^']+)'", m.group(3) or ''))
    return out

SCENERY = ['wp-konoha-classic', 'wp-genin-1', 'wp-chunin-2', 'wp-myoboku', 'wp-valley', 'wp-konoha-dusk', 'wp-uchiha', 'wp-iron', 'wp-sand', 'wp-rock']

def build_ranks():
    looks = rank_colors(); os.makedirs(os.path.join(OUT, 'ranks'), exist_ok=True)
    files = sorted(os.listdir(os.path.join(ROOT, 'ranks'))); n = 0
    for f in files:
        m = re.match(r'([a-z-]+?)(-face|-cut(?:-v\d)?|-aura)?\.(jpg|webp)$', f)
        if not m: continue
        rid, kind = m.group(1), m.group(2) or ''
        color, walls = looks.get(rid, ('#3e9150', []))
        src = Image.open(os.path.join(ROOT, 'ranks', f)); W, H = src.size; dst = os.path.join(OUT, 'ranks', f)
        if kind == '':
            wall = (walls or [SCENERY[sum(map(ord, rid)) % len(SCENERY)]])[0]
            cover(os.path.join(ROOT, 'media', wall + '.jpg'), (W, H)).save(dst, quality=84)
        elif kind == '-face':
            bg = Image.new('RGB', (W, H), mix(rgb(color), BG, .78)); g = glow((W, H), color, .9).convert('RGBA')
            bg = Image.alpha_composite(bg.convert('RGBA'), g); k = crest(int(W * .82), color)
            bg.alpha_composite(k, ((W - k.width) // 2, (H - k.height) // 2)); bg.convert('RGB').save(dst, quality=88)
        elif kind.startswith('-cut'):
            im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); k = crest(int(min(W * .9, H * .55)), color)
            im.alpha_composite(k, ((W - k.width) // 2, int(H * .42 - k.height / 2))); im.save(dst, quality=90, method=6)
        else:
            glow((W, H), color, .6).save(dst, quality=80, method=6)
        n += 1
    return n

def build_icons():
    os.makedirs(os.path.join(OUT, 'icons'), exist_ok=True)
    big = Image.new('RGBA', (512, 512), BG + (255,)); big.alpha_composite(glow((512, 512), '#3e9150', .9).resize((512, 512)))
    k = crest(360, '#3e9150'); big.alpha_composite(k, (76, 76))
    for s, name in ((512, 'icon-512.png'), (192, 'icon-192.png'), (180, 'icon-180.png')):
        big.convert('RGB').resize((s, s), Image.LANCZOS).save(os.path.join(OUT, 'icons', name), optimize=True)
    return big

def build_splash(icon):
    os.makedirs(os.path.join(OUT, 'splash'), exist_ok=True)
    names = re.findall(r'href="splash/(splash-(\d+)x(\d+)\.png)"', open(os.path.join(ROOT, 'index.html')).read())
    for name, w, h in names:
        w, h = int(w), int(h); s = min(w, h); im = Image.new('RGB', (w, h), BG); d = ImageDraw.Draw(im)
        isz = int(s * .3); ic = icon.convert('RGB').resize((isz, isz), Image.LANCZOS)
        m = Image.new('L', (isz, isz), 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, isz - 1, isz - 1), radius=int(isz * .22), fill=255)
        cx, cy = w // 2, int(h * .44); im.paste(ic, (cx - isz // 2, cy - isz // 2), m)
        try: f = ImageFont.truetype(FONT, int(s * .075))
        except OSError: f = ImageFont.load_default()
        d.text((cx, cy + isz // 2 + int(s * .07)), 'The Leaf Village', font=f, fill=(229, 237, 225), anchor='mt')
        im.quantize(colors=128).save(os.path.join(OUT, 'splash', name), optimize=True)
    return len(names)

OPEN_HEAD = """<script>/* the friends' copy: its own storage keys, so it never reads or writes the main app's */
window.LEAF_OPEN = true;
(function(){ try{ var P='open:', S=Storage.prototype, g=S.getItem, s=S.setItem, r=S.removeItem;
  S.getItem=function(k){ return g.call(this, P+k); }; S.setItem=function(k,v){ return s.call(this, P+k, v); }; S.removeItem=function(k){ return r.call(this, P+k); };
}catch(e){} })();</script>
"""

def build_text():
    h = open(os.path.join(ROOT, 'index.html')).read()
    h = h.replace('<head>', '<head>\n' + OPEN_HEAD, 1)
    h = h.replace('<meta name="description" content="Sharaf\'s training and study tracker.">', '<meta name="description" content="A Naruto-style training, study and sleep tracker.">')
    assert 'LEAF_OPEN = true' in h
    open(os.path.join(OUT, 'index.html'), 'w').write(h)
    for f in ('platform.js', 'leaf-engine.js', 'leaf-merge.js', 'manifest.webmanifest'):
        shutil.copy(os.path.join(ROOT, f), os.path.join(OUT, f))
    for d in ('senseis',):
        shutil.copytree(os.path.join(ROOT, d), os.path.join(OUT, d), dirs_exist_ok=True)
    os.makedirs(os.path.join(OUT, 'media'), exist_ok=True)
    for f in os.listdir(os.path.join(ROOT, 'media')):
        if f.startswith('wp-'): shutil.copy(os.path.join(ROOT, 'media', f), os.path.join(OUT, 'media', f))
    # the comeback scene shows Sharaf: a quiet dusk over the village instead
    cover(os.path.join(ROOT, 'media', 'wp-konoha-dusk.jpg'), Image.open(os.path.join(ROOT, 'media', 'comeback.jpg')).size).save(os.path.join(OUT, 'media', 'comeback.jpg'), quality=84)

def build_sw():
    s = open(os.path.join(ROOT, 'sw.js')).read()
    s = '\n'.join(l for l in s.split('\n') if 'OPEN-SKIP' not in l)
    s = s.replace("const CACHE = 'leaf-' + VERSION;", "const CACHE = 'leafopen-' + VERSION;").replace("const CINE_CACHE = 'leaf-cine';", "const CINE_CACHE = 'leafopen-cine';")
    s = s.replace("const FONT_CACHE = 'leaf-fonts';", "const FONT_CACHE = 'leafopen-fonts';").replace("k.startsWith('leaf-')", "k.startsWith('leafopen-')")
    assert s.count('leafopen-') >= 4 and "startsWith('leaf-')" not in s
    a = s.index('const FILES = ['); b = s.index('];', a)
    old = re.findall(r'"([^"]+)"', s[a:b]); keep = [f for f in old if f == './' or os.path.exists(os.path.join(OUT, f))]
    s = s[:a] + 'const FILES = [\n' + ',\n'.join(json.dumps(f) for f in keep) + '\n' + s[b:]
    hv = hashlib.sha256()
    for f in sorted(keep):
        if f != './': hv.update(open(os.path.join(OUT, f), 'rb').read())
    s = re.sub(r"const VERSION = '[^']*';", f"const VERSION = '{hv.hexdigest()[:10]}';", s)
    open(os.path.join(OUT, 'sw.js'), 'w').write(s)
    return len(keep), len(old)

if __name__ == '__main__':
    if os.path.isdir(OUT): shutil.rmtree(OUT)
    os.makedirs(OUT)
    build_text(); n = build_ranks(); icon = build_icons(); sp = build_splash(icon); keep = build_sw()
    open(os.path.join(OUT, '.source-hash'), 'w').write(source_hash() + '\n')
    print(f'open/ built: {n} rank pictures, {sp} launch screens, {keep[0]} of {keep[1]} cached files, source {source_hash()}')
