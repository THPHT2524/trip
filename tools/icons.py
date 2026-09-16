# -*- coding: utf-8 -*-
"""icons.py — 홈 화면 아이콘을 만든다. 그림이 바뀔 때만 한 번 돌린다.

    python tools/icons.py

★★**파비콘과 같은 그림**이다(index.html 의 data: svg). 새로 그리지 않는다 —
  세로 레일에 정거장 둘, 이 앱이 일정 화면에서 하는 바로 그 말이다. 탭에 뜨는 것과
  홈 화면에 앉는 것이 다른 그림이면 같은 앱으로 안 읽힌다.

★왜 손으로 그리나: SVG 를 PNG 로 굽는 도구를 하나 더 들이지 않으려고. 그림이
  네모 하나·선 하나·동그라미 둘이라 여덟 배로 그려 줄이는 것으로 충분하다
  (계단이 안 보인다). 도구가 늘면 그 도구가 낡는다.

★넉 장을 만든다. 쓰임이 저마다 달라서다:
    icon-192 · icon-512   android 목록. 모서리를 우리가 둥글린다(그대로 쓰인다)
    icon-maskable-512     android 이 제 모양으로 잘라 낸다 — 바탕을 끝까지 채우고
                          그림은 안쪽 72% 로 물린다(안전영역 밖은 잘려 나간다)
    apple-touch-icon      ios. 투명도 무시하고 제 스퀘어클로 자른다 — 그래서
                          모서리를 우리가 둥글리면 안 된다(둥근 것 위에 또 둥글려
                          귀퉁이가 패인다). 바탕을 끝까지 채우고 맡긴다
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'icons')

SS = 8                      # 여덟 배로 그려서 줄인다 — 이것이 계단을 지운다
BG   = (0x16, 0x30, 0x2B)   # --ink 소나무 잉크. 검정을 쓰지 않는다
RAIL = (0xC4, 0xD0, 0xCB)
DOT1 = (0x2E, 0x7D, 0x5B)   # 정거장 — 초록
DOT2 = (0x3B, 0x6E, 0xA5)   # 정거장 — 파랑


def draw(size, round_corners=True, inset=0.0):
    """32 칸짜리 원본을 size 픽셀에 그린다. inset 은 그림을 안으로 물리는 비율."""
    S = size * SS
    # ★알파로 그린다. 모서리를 둥글리면 그 바깥은 **비어야** 한다 — 처음에 검게 칠했더니
    #   밝은 배경의 안드로이드 목록에서 귀퉁이 넷이 검은 삼각으로 남았다.
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if round_corners:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 7 / 32), fill=BG + (255,))
    else:
        d.rectangle([0, 0, S, S], fill=BG + (255,))   # 자를 쪽이 따로 있다 — 끝까지 채운다

    # 32 칸 좌표 → 픽셀. inset 만큼 안으로 물리고 가운데에 둔다
    box = S * (1 - inset * 2)
    off = S * inset
    k = box / 32.0
    px = lambda v: off + v * k

    # 레일 — 선이 아니라 둥근 막대로 그린다(stroke-linecap:round 와 같은 모양)
    # ★★레일이 **가운데**다(x=16). 원래 파비콘은 11 에 두어 왼쪽에 세운 타임라인처럼
    #   보이게 했는데, 16px 에서는 안 보이던 그 치우침이 512px 에서는 실수로 읽혔다 —
    #   게다가 마스크는 가운데를 기준으로 잘라서 오른쪽 반이 통째로 빈 자리가 된다.
    #   파비콘도 같이 옮겼다(index.html·themore.html) — 두 그림은 한 그림이어야 한다.
    X = 16
    w = 2.5 * k
    d.rounded_rectangle([px(X) - w / 2, px(6) - w / 2, px(X) + w / 2, px(26) + w / 2],
                        radius=w / 2, fill=RAIL + (255,))

    # 정거장 둘. 레일 **뒤**에 그리지 않는다 — 덮어야 정거장으로 보인다
    for cy, col in ((11, DOT1), (22, DOT2)):
        r = 3.6 * k
        d.ellipse([px(X) - r, px(cy) - r, px(X) + r, px(cy) + r], fill=col + (255,))

    return img.resize((size, size), Image.LANCZOS)


def save(img, name):
    p = os.path.join(OUT, name)
    img.save(p, 'PNG', optimize=True)
    print('%-26s %6d bytes' % (name, os.path.getsize(p)))


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    save(draw(192), 'icon-192.png')
    save(draw(512), 'icon-512.png')
    # 잘려 나갈 것을 아는 장 — 바탕은 끝까지, 그림은 안쪽으로
    save(draw(512, round_corners=False, inset=0.14), 'icon-maskable-512.png')
    # ios 는 제가 자른다 — 우리가 둥글리지 않는다.
    # ★알파를 뺀다. ios 는 투명한 자리를 검게 깔아 버리므로 아예 안 주는 편이 낫다.
    save(draw(180, round_corners=False).convert('RGB'), 'apple-touch-icon.png')
