/* config.js — 배포 환경 설정. Supabase 익명 입력 저장용.
 * anon/publishable 키는 공개용이며, RLS로 insert만 허용됩니다(조회·수정·삭제 불가). */
window.SUPABASE_CONFIG = {
  url: "https://uzokxlmbjlrgpjuwapsc.supabase.co",
  anonKey: "sb_publishable_DUDz7rnd2vQGoTxR089kXw_8ujnWVpY",
  table: "calc_logs",
};
