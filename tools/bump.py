#!/usr/bin/env python3
# 캐시 버전을 올린다 — 무빌드·무의존.  python tools/bump.py
#
# 왜 필요한가: vercel.json 이 /js·/css·/fonts 를 **immutable(1년)** 로 준다.
# 같은 ?v 를 둔 채 파일만 고치면 **이미 그 버전을 받아간 브라우저는 영원히 옛 파일을 쓴다.**
# card-dashboard 에서 실제로 겪은 사고다(v=145 안에서 CSS 를 세 번 고쳐 폰에 옛 CSS 가 고착).
#
# 손대는 곳이 넷이라 손으로 하면 반드시 하나를 빠뜨린다:
#   ① index.html 의 ?v=N        (css·js 태그 전부)
#   ② css/app.css 의 @font-face ?v=N
#   ③ sw.js 의 const V = N      (캐시 이름)
#   ④ sw.js 의 SHELL 목록 ?v=N  (프리캐시할 URL)
#   ⑤ _stub*.html (로그인 없이 보는 실험대) — index.html 의 사본이라 같이 안 뜨면 뒤처진다
#
# ★★⑤는 2026-10-27에 들어왔다. 손으로 뜨고 있었는데 **일곱 판이나 뒤처져 있었다**
#   (_stub.html v=532 · _stub-off.html v=526 vs index v=539). 위 머리말이 경고하는
#   "손으로 하면 반드시 하나를 빠뜨린다" 가 여기서 그대로 났다 — 더 나쁜 것은, 뒤처진
#   실험대는 **틀린 것을 보여 주면서도 멀쩡해 보인다**는 점이다. 디자인 점검을 그걸로
#   하면 이미 고친 것을 또 고치거나, 지금 깨진 것을 못 본다.
#
# ★★그리고 SHELL 에 **줄이 있는지**까지 본다(2026-09-10, shell_gap 참고). ④는 적혀
#   있는 줄의 번호만 갈아 끼우므로, 자산을 하나 더하면서 SHELL 에 안 적으면 잡히지 않는다.
#
# ★★②는 뒤늦게 들어왔다(2026-09-04). 글꼴 URL 에만 버전이 없어서, **글꼴을 고쳐도
#   이미 앱을 연 적 있는 브라우저에는 1년 동안 안 갔다** — 위 머리말이 경고하는 바로
#   그 사고가 글꼴에서 나 있었다. 서브셋에 ₩ 를 넣고 나서야 드러났다.
#
# ★자산 지문(assets-sha)도 함께 적는다. 자산이 바뀌었는데 ?v 를 안 올렸으면 check 가 막는다.
#   .gitattributes 가 줄바꿈을 LF 로 고정하므로 맥·윈도우·CI 에서 같은 값이 나온다
#   (card-dashboard 는 그 고정이 없어서 윈도우에서 지문이 어긋났다).
import hashlib, os, re, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# ?v 를 쓰는 HTML 이 둘이다 — /themore 를 더하면서 늘었다.
# 하나만 올리면 다른 쪽이 옛 버전을 가리키고, check 가 "?v 가 서로 다릅니다" 로 막는다.
PAGES = [os.path.join(ROOT, "index.html"), os.path.join(ROOT, "themore.html")]
INDEX = PAGES[0]
SW = os.path.join(ROOT, "sw.js")
# css 도 ?v 를 쓴다 — @font-face 의 글꼴 URL. 페이지와 같은 번호로 올라가야 한다.
CSS = os.path.join(ROOT, "css", "app.css")
BUMPED = PAGES + [CSS]

# ── 실험대 ──────────────────────────────────────────────────────────────
# index.html 의 사본에 db.js 만 가짜로 갈아 끼운 것. 앱의 나머지는 전부 진짜다.
# ★**있는 것만 다시 뜬다.** 갓 클론한 데서 없는 파일을 만들어 내지는 않는다 —
#   .gitignore 가 _stub* 를 빼 두었으므로 이건 각자의 로컬 물건이다.
# ★꼬리에 붙는 script 가 변종을 가른다. 그것만 지켜서 몸통을 새로 뜬다.
STUBS = {
    "_stub.html": "",
    # home_shape RPC 가 아직 없는 상태(= supabase/home.sql 을 안 돌린 상태)
    "_stub-norpc.html": """<script>
(function(){
  var w = setInterval(function(){
    if (typeof DB === 'undefined' || !DB.trips) return;
    clearInterval(w);
    DB.trips.shape = async function(){ return null; };
  }, 0);
})();
</script>
""",
    # 끊긴 상태 — 목록이 사본으로 물러나는지 본다. ?live 를 붙이면 평소대로 돈다.
    "_stub-off.html": """<script>
(function(){
  var wait = setInterval(function(){
    if (typeof DB === 'undefined' || !DB.trips) return;
    clearInterval(wait);
    if (!location.search.includes('live')) {
      DB.trips.list = async function(){ throw new Error('Failed to fetch'); };
      DB.trips.shape = async function(){ return null; };
    }
  }, 0);
})();
</script>
""",
}


def restub(new):
    """index.html 을 떠서 _stub*.html 을 다시 만든다. 다시 뜬 파일 이름을 돌려준다."""
    made = []
    src = read(INDEX)
    # ?t 는 캐시 무력화다 — 실험대는 고치는 족족 보여야 하므로 ?v 만으로는 모자라다
    stamp = str(int(time.time()))
    body = re.sub(r"\?v=(\d+)", lambda m: "?v=%s&t=%s" % (m.group(1), stamp), src)
    body = body.replace("/js/db.js?v=%d&t=%s" % (new, stamp), "/_stub-db.js?t=%s" % stamp)
    assert "_stub-db.js" in body, "db.js 를 못 바꿨다 — index.html 의 태그가 바뀌었는지 보라"
    for name, tail in STUBS.items():
        p = os.path.join(ROOT, name)
        if not os.path.exists(p):
            continue
        write(p, body + tail)
        made.append(name)
    return made


read = lambda p: open(p, encoding="utf-8", newline="").read()


def write(p, s):
    open(p, "w", encoding="utf-8", newline="").write(s)


def versioned():
    """?v 가 붙어 나가는 자산 = 버전이 안 바뀌면 갱신이 안 되는 파일들."""
    out = []
    for page in PAGES:
        for m in re.finditer(r'(?:src|href)="/((?:js|css)/[^"?]+)\?v=', read(page)):
            out.append(os.path.join(ROOT, m.group(1)))
    # 글꼴도 ?v 로 나간다 — 지문에 안 넣으면 '자산이 바뀌었는데 안 올렸다' 를 못 잡는다
    for m in re.finditer(r"url\('\.\./(fonts/[^'?]+)\?v=", read(CSS)):
        out.append(os.path.join(ROOT, m.group(1)))
    return sorted(set(out))


def shell_gap():
    """페이지가 싣는데 SHELL 에 없는 자산. **비어 있어야 한다.**

    ★★이 검사가 없어서 `/js/fx.js` 가 열 달 넘게 빠져 있었다(2026-09-10 발견).
      위 ④는 SHELL 에 **이미 적힌** 줄의 ?v 만 갈아 끼운다 — 줄이 아예 없으면
      갈아 끼울 것도 없으니 아무도 안 막았다. 자산을 하나 더할 때 index.html 과
      sw.js 두 곳을 고쳐야 하는데, 손으로 하는 두 곳은 반드시 하나가 빠진다.
    ★조용히 지나가는 것이 이 사고의 성질이다: fetch 핸들러가 받아온 것을 캐시에
      넣어 주므로 온라인으로 한 번만 열면 채워진다. 드러나는 자리는 **버전을 올린
      직후 처음 여는 곳이 오프라인일 때**뿐이라, 정작 서비스워커를 둔 이유인
      그 상황에서만 깨진다.
    ★버전이 없는 것(vendor·maplibre css)도 센다. 오프라인에서 없으면 똑같이 죽는다.
    ★아이콘과 manifest 도 센다(2026-09-17). 홈 화면에서 여는 앱이 되면서 늘었는데,
      그중 아이콘 셋은 **페이지가 아니라 manifest 가** 가리킨다 — 페이지만 훑으면
      절반을 놓치므로 manifest 안의 icons 도 같이 읽는다."""
    want = []
    for page in PAGES:
        for m in re.finditer(r'(?:src|href)="(/(?:js|css|fonts|icons)/[^"]+|/manifest\.json)"',
                             read(page)):
            want.append(m.group(1))
    # ★manifest 가 가리키는 아이콘은 페이지에 안 적힌다 — 여기서만 나온다
    mf = os.path.join(ROOT, "manifest.json")
    if os.path.exists(mf):
        want += re.findall(r'"src"\s*:\s*"(/[^"]+)"', read(mf))
    body = read(SW).split("const SHELL")[1].split("];")[0]
    have = set(re.findall(r"'(/[^']+)'", body))
    return [u for u in sorted(set(want)) if u not in have]


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
    sw = read(SW)

    cur = sorted({int(v) for p in BUMPED for v in re.findall(r"\?v=(\d+)", read(p))})
    if len(cur) != 1:
        print("FAIL - HTML·CSS 의 ?v 가 서로 다릅니다: %s" % cur)
        print("       (부분 범프 사고다 — 손으로 맞춘 뒤 다시 돌리세요)")
        return 1
    # ★올리기 **전에** 본다 — 여기서 막히면 파일이 하나도 안 바뀐 채로 끝난다.
    gap = shell_gap()
    if gap:
        print("FAIL - 페이지가 싣는데 sw.js 의 SHELL 에 없는 자산:")
        for u in gap:
            print("         %s" % u)
        print("       (오프라인에서 이 파일만 안 옵니다 — SHELL 에 줄을 넣고 다시 돌리세요)")
        return 1

    old = cur[0]
    new = old + 1

    for p in BUMPED:
        write(p, read(p).replace("?v=%d" % old, "?v=%d" % new))
    sw = re.sub(r"^const V = \d+;", "const V = %d;" % new, sw, count=1, flags=re.M)
    sw = re.sub(r"\?v=\d+", "?v=%d" % new, sw)
    write(SW, sw)

    sha = assets_sha()
    if re.search(r"//\s*assets-sha:[0-9a-f]{12}", sw):
        sw = re.sub(r"//\s*assets-sha:[0-9a-f]{12}", "// assets-sha:" + sha, sw, count=1)
    else:
        sw = sw.replace("const V = %d;" % new,
                        "const V = %d;   // assets-sha:%s" % (new, sha), 1)
    write(SW, sw)

    # 실제로 맞았는지 되읽어 확인한다 — 고쳐 놓고 안 맞으면 소용이 없다
    sw2 = read(SW)
    ok = (all({int(v) for v in re.findall(r"\?v=(\d+)", read(p))} == {new} for p in BUMPED)
          and {int(v) for v in re.findall(r"\?v=(\d+)", sw2)} == {new}
          and re.search(r"const V = %d;" % new, sw2))
    if not ok:
        print("FAIL - 올린 뒤에도 셋이 어긋납니다. 직접 확인하세요.")
        return 1

    made = restub(new)

    print("PASS - v=%d -> v=%d · assets-sha:%s · 자산 %d개%s"
          % (old, new, sha, len(versioned()),
             " · 실험대 %d개 다시 뜸" % len(made) if made else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
