# -*- coding: utf-8 -*-
"""tools/subset-font.py — fonts/ibm-plex-mono-{400,500,600}.woff2 를 만든다.

왜 있나: 서브셋에 없는 글자를 css 의 unicode-range 가 **있다고 적어 두고 있었다**
(2026-09-03 발견). ₩ 와 → 가 그랬다. 파일이 어떻게 만들어졌는지 아무도 몰라서
'왜 여기만 격자가 어긋나지' 를 글꼴 밖에서 찾았다. 만드는 법을 여기 남긴다.

쓰는 법:  python tools/subset-font.py
          → fonts/*.woff2 를 다시 쓰고, css/app.css 에 붙일 unicode-range 를 찍는다

통화를 하나 더 받게 되면 js/util.js 의 SIGN 에 기호를 넣고 아래 KEEP 에도 넣은 뒤
이 스크립트를 다시 돌린다. 안 그러면 그 기호만 대체 글꼴로 떨어져 등폭이 깨진다.
"""
import os, subprocess, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, '.font-cache')          # 받아 둔 원본 (git 에 안 올라간다)
SRC = 'https://cdn.jsdelivr.net/gh/IBM/plex@v6.4.1/IBM-Plex-Mono/fonts/complete/ttf'
WEIGHTS = [('400', 'Regular'), ('500', 'Medium'), ('600', 'SemiBold')]

# ── 담을 글자 ──────────────────────────────────────────────────────────────
# ★예전 서브셋이 갖고 있던 229 자를 **그대로** 두고, 빠져 있던 것만 더한다.
#   안 쓰는 글리프(↑↓·소프트하이픈·™ 따위)를 함께 지우면 0.4KB 를 아끼지만
#   그건 부탁받지 않은 변경이다. 조합 악센트(U+0300~0323)는 특히 그렇다 —
#   지명이 NFD 로 들어오면 그게 필요한데, 그런 일은 데이터가 정하지 소스가 정하지 않는다.
BASE = [
    0x0000, 0x000D, (0x0020, 0x007E), (0x00A0, 0x00FF), 0x0131, (0x0152, 0x0153),
    (0x02BB, 0x02BC), 0x02C6, 0x02DA, 0x02DC, (0x0300, 0x0301), (0x0303, 0x0304),
    (0x0308, 0x0309), 0x0323, (0x2013, 0x2014), (0x2018, 0x201A), (0x201C, 0x201E), 0x2022,
    0x2026, (0x2032, 0x2033), (0x2039, 0x203A), 0x2044, 0x20AC, 0x2122, 0x2191, 0x2193,
    0x2212, 0x2215,
]
# ★빠져 있던 것 — 이것들이 없어서 등폭 격자가 깨졌다(2026-09-03).
ADD = [
    0x20A9,          # ₩  이 앱의 기본 통화. 없어서 대체 글꼴로 떨어졌고, 28px 에서
                     #    폭이 14.84 vs 숫자 16.25 라 뒤 숫자에 붙어 보였다
    0x2192,          # →  환율 쪽지: 'JPY → KRW 9.4'
    0x0E3F, 0x20AB, 0x20B1,   # ฿ ₫ ₱  js/util.js 의 SIGN 에 있는 나머지 기호
]

KEEP = [c for r in BASE + ADD for c in (range(r[0], r[1] + 1) if isinstance(r, tuple) else [r])]


def fetch(name):
    path = os.path.join(CACHE, name + '.ttf')
    if os.path.exists(path):
        return path
    os.makedirs(CACHE, exist_ok=True)
    url = '%s/IBMPlexMono-%s.ttf' % (SRC, name)
    print('  받는 중 %s' % url)
    urllib.request.urlretrieve(url, path)
    return path


def main():
    codes = sorted(set(KEEP))
    listfile = os.path.join(CACHE, 'keep.txt')
    os.makedirs(CACHE, exist_ok=True)
    with open(listfile, 'w') as f:
        f.write(','.join('U+%04X' % c for c in codes))

    for weight, name in WEIGHTS:
        out = os.path.join(ROOT, 'fonts', 'ibm-plex-mono-%s.woff2' % weight)
        before = os.path.getsize(out) if os.path.exists(out) else 0
        subprocess.run([sys.executable, '-m', 'fontTools.subset', fetch(name),
                        '--unicodes-file=' + listfile, '--flavor=woff2',
                        '--no-hinting',            # 예전 파일도 힌팅이 없었다
                        '--output-file=' + out], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print('  %s  %d → %d bytes' % (weight, before, os.path.getsize(out)))

    # ★css 에 적을 범위를 **파일에서 뽑아** 찍는다. 손으로 적으면 또 어긋난다.
    from fontTools.ttLib import TTFont
    got = sorted(TTFont(os.path.join(ROOT, 'fonts', 'ibm-plex-mono-400.woff2')).getBestCmap())
    parts, i = [], 0
    while i < len(got):
        j = i
        while j + 1 < len(got) and got[j + 1] == got[j] + 1:
            j += 1
        parts.append('U+%04X' % got[i] if i == j else 'U+%04X-%04X' % (got[i], got[j]))
        i = j + 1
    print('\ncss/app.css 의 unicode-range 에 이대로 넣는다:\n')
    print('  unicode-range: ' + ', '.join(parts) + ';')


if __name__ == '__main__':
    main()
