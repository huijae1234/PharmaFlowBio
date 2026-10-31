# 발표/index.html과 그 파일이 부르는 css·js·그림·글꼴·구조도를 한 HTML에 넣는다(원본은 안 바꿈).
# 실행: python 발표/bundle_deck.py 발표 발표/PharmaFlow-발표.html  (발표/ 파일을 고친 뒤 다시 실행)
import base64, re, sys
from pathlib import Path

src = Path(sys.argv[1])
out = Path(sys.argv[2])
MIME = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
        '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.gif': 'image/gif'}

def data_uri(rel):
    p = src / rel
    return f"data:{MIME[p.suffix.lower()]};base64," + base64.b64encode(p.read_bytes()).decode()

html = (src / 'index.html').read_text(encoding='utf-8')
css = (src / 'deck.css').read_text(encoding='utf-8')
css = re.sub(r'url\((["\']?)(fonts/[^)"\']+)\1\)', lambda m: f'url({data_uri(m.group(2))})', css)
js = (src / 'deck.js').read_text(encoding='utf-8')

html, n_css = re.subn(r'<link[^>]*href="deck\.css"[^>]*>', lambda m: f'<style>\n{css}\n</style>', html)
html, n_js = re.subn(r'<script[^>]*src="deck\.js"[^>]*>\s*</script>', lambda m: f'<script>\n{js}\n</script>', html)
html, n_img = re.subn(r'src="(images/[^"]+)"', lambda m: f'src="{data_uri(m.group(1))}"', html)

# 구조도(3MB)는 두 장에서 쓰므로 한 번만 넣고, 열 때 blob 주소로 두 iframe에 연결한다.
erd_files = set(re.findall(r'<iframe[^>]*src="([^"]+\.html)"', html))
loader = []
for i, f in enumerate(sorted(erd_files)):
    b64 = base64.b64encode((src / f).read_bytes()).decode()
    html = html.replace(f'src="{f}"', f'data-embed="{i}"')
    loader.append(f'"{i}":"{b64}"')
boot = ('<script>(()=>{const E={' + ','.join(loader) + '};'
        'const U={};for(const k in E){const b=atob(E[k]),a=new Uint8Array(b.length);'
        'for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);'
        'U[k]=URL.createObjectURL(new Blob([a],{type:"text/html"}));}'
        'document.querySelectorAll("iframe[data-embed]").forEach(f=>f.src=U[f.dataset.embed]);})();</script>')
html = html.replace('</body>', boot + '\n</body>', 1)

left = re.findall(r'(?:src|href)="(?!data:|https?:|#|mailto:)([^"]+)"', html)
assert n_css == 1 and n_js == 1, (n_css, n_js)
assert not left, left  # 바깥 파일을 부르는 주소가 남으면 안 된다
out.write_text(html, encoding='utf-8')
print(f'css {n_css}, js {n_js}, 그림 {n_img}, 구조도 {len(erd_files)} → {out} ({out.stat().st_size/1e6:.1f}MB)')
