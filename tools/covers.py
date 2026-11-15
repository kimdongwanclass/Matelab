# 교재 표지 이미지(img/covers/*.webp, 가로 420px)를 mate-books 저장소에서 다시 만든다.
# 국어(ko·k2) = common/lineup_covers 라인업 앞표지(E안), 영어(gb·ps·ws) = english-vocab/make_book.py 교재 1쪽 표지.
# WordMaster(wm)는 원장이 준 사진(외부 교재)이라 이 도구로 만들지 않는다.
# 사용: (mate-books에서 english-vocab/setup.sh 한 번) → python3 tools/covers.py /home/claude/mate-books
import os, sys, subprocess, pathlib
MB = sys.argv[1] if len(sys.argv) > 1 else "/home/claude/mate-books"
OUT = pathlib.Path(__file__).resolve().parent.parent / "img" / "covers"; OUT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, f"{MB}/common")
import pymupdf as fitz, lineup_covers as L, cover_designs as cd
from cover import MM
from PIL import Image
def save(pix, k):
    pix.save("/tmp/_cov.png"); im = Image.open("/tmp/_cov.png").convert("RGB")
    im.resize((420, round(im.height * 420 / im.width)), Image.LANCZOS).save(OUT / f"{k}.webp", quality=82); print(k)
for area, title, sub, col in L.LINEUP["국어"]:
    k = {"고전 어휘 0630": "ko", "필수 어휘 1114": "k2"}.get(title)
    if k:
        p = fitz.open().new_page(width=210 * MM, height=297 * MM)
        cd.design_e(p, dict(title=title, sub=sub, color=col, subj="국어", area=area, lab=L.LAB["국어"]),
                    mode="bottom", sc=L.PASTEL["국어"], ink=cd.shade(col, 0.55))
        save(p.get_pixmap(dpi=110), k)
for st, k in [("gibon", "gb"), ("pilsu", "ps"), ("wanseong", "ws")]:
    subprocess.run(["python3", "make_book.py", "--stage", st, "--from", "1", "--to", "1", "--out", f"/tmp/_cov_{st}"],
                   cwd=f"{MB}/english-vocab", check=True)
    save(fitz.open(f"/tmp/_cov_{st}.pdf")[0].get_pixmap(dpi=150), k)
