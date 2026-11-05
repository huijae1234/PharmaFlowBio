// Supabase 연결 정보 (plan 001 3단계). 공개 키는 화면에 들어가도 되는 키다:
// 로그인하지 않으면 아무것도 읽지 못하고, 쓰기는 역할을 확인하는 함수로만 된다 (ADR 0002, supabase/migrations/0003_rls.sql).
// 관리자 키(service_role·secret)는 여기에 절대 넣지 않는다.
export const SUPABASE_URL = "https://gmqkonmuiznvemggcmav.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_HfuXVcktMLTn9g8Sgc6vYQ_dpfmzk29";
