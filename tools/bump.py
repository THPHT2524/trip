#!/usr/bin/env python3
# 캐시 버전을 올린다 — 무빌드·무의존.  python tools/bump.py
#
# 왜 필요한가: vercel.json 이 /js·/css·/fonts 를 **immutable(1년)** 로 준다.
# 같은 ?v 를 둔 채 파일만 고치면 **이미 그 버전을 받아간 브라우저는 영원히 옛 파일을 쓴다.**
# card-dashboard 에서 실제로 겪은 사고다(v=145 안에서 CSS 를 세 번 고쳐 폰에 옛 CSS 가 고착).
#
# 손대는 곳이 셋이라 손으로 하면 반드시 하나를 빠뜨린다:
#   ① index.html 의 ?v=N        (css·js 태그 전부)
#   ② sw.js 의 const V = N      (캐시 이름)
#   ③ sw.js 의 SHELL 목록 ?v=N  (프리캐시할 URL)
#
# ★자산 지문(assets-sha)도 함께 적는다. 자산이 바뀌었는데 ?v 를 안 올렸으면 check 가 막는다.
#   .gitattributes 가 줄바꿈을 LF 로 고정하므로 맥·윈도우·CI 에서 같은 값이 나온다
#   (card-dashboard 는 그 고정이 없어서 윈도우에서 지문이 어긋났다).
import hashlib, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, "index.html")
SW = os.path.join(ROOT, "sw.js")

read = lambda p: open(p, encoding="utf-8", newline="").read()


def write(p, s):
    open(p, "w", encoding="utf-8", newline="").write(s)


def versioned():
    """?v 가 붙어 나가는 자산 = 버전이 안 바뀌면 갱신이 안 되는 파일들."""
    idx = read(INDEX)
    out = []
    for m in re.finditer(r'(?:src|href)="/((?:js|css)/[^"?]+)\?v=', idx):
        out.append(os.path.join(ROOT, m.group(1)))
    return sorted(set(out))


def assets_sha():
    h = hashlib.sha256()
    for p in versioned():
        h.update(os.path.basename(p).encode())
        h.update(b":")
        # 줄바꿈을 LF 로 맞춰서 해싱한다 — 어느 OS 에서 돌려도 같은 값이 나오게
        b = open(p, "rb").read().replace(b"\r\n", b"\n")
        h.update(hashlib.sha256(b).hexdigest().encode())
        h.update(b"\n")
    return h.hexdigest()[:12]


def main():
    idx, sw = read(INDEX), read(SW)

    cur = sorted({int(v) for v in re.findall(r"\?v=(\d+)", idx)})
    if len(cur) != 1:
        print("FAIL - index.html 의 ?v 가 서로 다릅니다: %s" % cur)
        print("       (부분 범프 사고다 — 손으로 맞춘 뒤 다시 돌리세요)")
        return 1
    old = cur[0]
    new = old + 1

    idx = idx.replace("?v=%d" % old, "?v=%d" % new)
    sw = re.sub(r"^const V = \d+;", "const V = %d;" % new, sw, count=1, flags=re.M)
    sw = re.sub(r"\?v=\d+", "?v=%d" % new, sw)
    write(INDEX, idx)
    write(SW, sw)

    sha = assets_sha()
    if re.search(r"//\s*assets-sha:[0-9a-f]{12}", sw):
        sw = re.sub(r"//\s*assets-sha:[0-9a-f]{12}", "// assets-sha:" + sha, sw, count=1)
    else:
        sw = sw.replace("const V = %d;" % new,
                        "const V = %d;   // assets-sha:%s" % (new, sha), 1)
    write(SW, sw)

    # 셋이 실제로 맞았는지 되읽어 확인한다 — 고쳐 놓고 안 맞으면 소용이 없다
    idx2, sw2 = read(INDEX), read(SW)
    ok = ({int(v) for v in re.findall(r"\?v=(\d+)", idx2)} == {new}
          and {int(v) for v in re.findall(r"\?v=(\d+)", sw2)} == {new}
          and re.search(r"const V = %d;" % new, sw2))
    if not ok:
        print("FAIL - 올린 뒤에도 셋이 어긋납니다. 직접 확인하세요.")
        return 1

    print("PASS - v=%d -> v=%d · assets-sha:%s · 자산 %d개"
          % (old, new, sha, len(versioned())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
