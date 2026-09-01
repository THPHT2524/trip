/* Supabase 접속 정보.
   ★card-dashboard 와 **같은 프로젝트**다. 무료 플랜이 프로젝트를 둘까지만 주기 때문이고,
     우리 표는 public 이 아니라 `trip` 스키마에 따로 있다(supabase/SETUP.md 참고).
     그래서 이 값이 card-dashboard/js/supabase-config.js 와 같은 것이 정상이다.

   이 키는 브라우저에 노출되도록 설계된 공개 키다(실제 방어선은 trip 스키마 표들의 RLS).
   ⚠ Secret key(service_role)는 RLS 를 우회하므로 절대 여기 넣지 말 것. */
const SUPABASE_URL = 'https://slakyumsnufoywxrdhhx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_5xTTEUeViqzY1JgFLv0z6A_NAVJZcUz';
