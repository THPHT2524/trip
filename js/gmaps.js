/* gmaps.js — 구글맵 링크를 읽고 쓴다. 네트워크는 타지 않는다(단축 링크만 api/gmaps.js 가 맡는다).

   이 앱이 구글맵 JS API 를 안 쓰는 이유가 이 파일이다. 공유 링크에 이미 장소명과 좌표가
   들어 있으므로, 그것만 뽑으면 **결제 계정도 API 키도 Places 호출 비용도 필요 없다.**

   ★★가장 중요한 함정: URL 의 `@lat,lng` 는 **지도 중심**이지 핀 위치가 아니다.
     그것을 좌표로 쓰면 핀에서 수백 미터 벗어난다. 진짜 좌표는 `data=` 안의 `!3d`/`!4d` 다.
     여기서는 `!3d`/`!4d` 를 먼저 찾고, 없을 때만 `@` 를 쓰되 approx 로 표시해 화면이 그렇게 적게 한다.

   ★공식 API 가 아니라 URL 형식에 기댄 파싱이다. 구글이 형식을 바꾸면 깨진다 —
     그때는 parse() 가 null 을 내고 사람이 장소명을 손으로 적는다. **자동 채움은 편의지 필수가 아니다.**

   ★여기서 나온 name 은 **남이 지은 문자열**이다(McDonald's 처럼 홑따옴표가 들어온다).
     화면에 넣는 쪽이 반드시 이스케이프한다 — 이 파일은 값만 돌려준다. */
const GM = (function () {

  /* 단축 링크 — 리다이렉트를 따라가야 전체 URL 이 나오는데 브라우저에서는 CORS 에 막힌다.
     서버(api/gmaps.js)가 대신 따라간다. */
  const SHORT = /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//i;
  /* 전체 URL — 이건 브라우저에서 바로 파싱한다. 서버를 부르지 않는다. */
  const FULL  = /^https?:\/\/((www\.|maps\.)?google\.[a-z.]{2,6}|maps\.google\.[a-z.]{2,6})\//i;

  const num = s => { const n = parseFloat(s); return Number.isFinite(n) ? n : null; };

  /* 좌표 한 쌍을 그대로 붙여넣은 경우도 받는다: "34.6873, 135.5259" */
  const PAIR = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

  /* ★사람이 읽을 이름이 아닌 것들. `?q=place_id:ChIJ...` 형태가 실제로 온다 —
     그대로 두면 장소명 칸에 `place_id:ChIJN1t_...` 가 박힌다(2026-09-01에 그렇게 나왔다). */
  const NOT_A_NAME = /^(place_id:|ftid=|0x[0-9a-f]+:)/i;

  function needsServer(s) { return SHORT.test(s || ''); }

  /* /place/<이름>/ 에서 장소명. `+` 는 공백이고 나머지는 퍼센트 인코딩이다. */
  function placeName(u) {
    const m = /\/maps\/place\/([^/?#]+)/.exec(u);
    if (!m) return null;
    let s = m[1].replace(/\+/g, ' ');
    try { s = decodeURIComponent(s); } catch (e) { /* 깨진 인코딩이면 원문을 쓴다 */ }
    s = s.trim();
    // 좌표만 들어 있는 place 세그먼트("34.68,135.52")는 이름이 아니다
    return (!s || PAIR.test(s) || NOT_A_NAME.test(s)) ? null : s;
  }

  /* 진짜 핀 좌표. data= 안의 !3d/!4d.
     ★`!8m2!3d..!4d..` 가 그 장소의 표준 블록이라 먼저 본다. 길찾기 URL 처럼 !3d 쌍이
       여럿인 경우 아무거나 집으면 엉뚱한 지점이 된다. */
  function pinAt(u) {
    let m = /!8m2!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(u)
         || /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(u);
    return m ? { lat: num(m[1]), lng: num(m[2]) } : null;
  }

  /* 지도 중심. 핀이 없을 때만 쓰고 approx 로 표시한다. */
  function centerAt(u) {
    const m = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(u);
    return m ? { lat: num(m[1]), lng: num(m[2]) } : null;
  }

  /* ?q= · ?query= · ?destination= 에 좌표나 이름이 오는 형태 */
  function fromQuery(u) {
    const m = /[?&](?:q|query|destination)=([^&#]+)/.exec(u);
    if (!m) return null;
    let v = m[1].replace(/\+/g, ' ');
    try { v = decodeURIComponent(v); } catch (e) {}
    const p = PAIR.exec(v);
    if (p) return { lat: num(p[1]), lng: num(p[2]), name: null };
    v = v.trim();
    return { lat: null, lng: null, name: (!v || NOT_A_NAME.test(v)) ? null : v };
  }

  /* 붙여넣은 것 하나를 { name, lat, lng, approx, url } 로.
     못 읽으면 null — 부르는 쪽은 그때 손입력으로 물러난다.
     단축 링크면 { needsServer: true } 만 돌려준다(여기서는 펼칠 수 없다). */
  function parse(input) {
    const s = String(input || '').trim();
    if (!s) return null;

    // 좌표만 붙여넣었다
    const pair = PAIR.exec(s);
    if (pair) {
      const p = { lat: num(pair[1]), lng: num(pair[2]) };
      return GEO.ok(p) ? { name: null, lat: p.lat, lng: p.lng, approx: false, url: null } : null;
    }

    if (needsServer(s)) return { needsServer: true, url: s };
    if (!FULL.test(s)) return null;

    const name = placeName(s);
    let at = pinAt(s), approx = false;
    if (!GEO.ok(at)) { at = centerAt(s); approx = !!at; }

    let qn = null;
    if (!GEO.ok(at) || !name) {
      const q = fromQuery(s);
      if (q) {
        if (!GEO.ok(at) && q.lat != null) { at = { lat: q.lat, lng: q.lng }; approx = false; }
        qn = q.name;
      }
    }

    const lat = GEO.ok(at) ? at.lat : null;
    const lng = GEO.ok(at) ? at.lng : null;
    const nm = name || qn || null;

    // 이름도 좌표도 못 건졌으면 파싱에 실패한 것이다
    if (nm == null && lat == null) return null;
    return { name: nm, lat, lng, approx: lat == null ? false : approx, url: s };
  }

  /* 두 지점 길찾기 — 이 URL 하나가 트리플의 '거리 표기 → 길찾기' 를 공짜로 재현한다. */
  function dirUrl(a, b) {
    if (!GEO.ok(a) || !GEO.ok(b)) return null;
    return 'https://www.google.com/maps/dir/?api=1'
         + '&origin=' + a.lat + ',' + a.lng
         + '&destination=' + b.lat + ',' + b.lng;
  }

  /* 한 지점 열기. 저장해 둔 원본 링크가 있으면 **그것을 쓴다** —
     파싱이 틀렸어도 사람이 붙여넣은 것은 맞는 곳을 가리키기 때문이다. */
  function placeUrl(item) {
    if (item && item.map_url) return item.map_url;
    if (!GEO.ok(item)) return null;
    const q = item.lat + ',' + item.lng;
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  }

  return { needsServer, parse, dirUrl, placeUrl };
})();

if (typeof module !== 'undefined') {                      // tools/test-pure.js 용
  if (typeof GEO === 'undefined') global.GEO = require('./geo.js');
  module.exports = GM;
}
