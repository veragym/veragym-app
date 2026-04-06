-- 회원 앱에서 자기 루틴의 share_code를 안전하게 조회하는 RPC
-- member_routines 테이블에 anon RLS가 없어 직접 조회 불가하므로 SECURITY DEFINER로 우회

CREATE OR REPLACE FUNCTION member_get_share_code(p_token TEXT, p_routine_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_member_id UUID;
  v_share_code TEXT;
BEGIN
  -- 토큰으로 회원 확인
  SELECT id INTO v_member_id
    FROM members
   WHERE token = p_token
     AND is_active = true
   LIMIT 1;

  IF v_member_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- 해당 회원의 루틴에서만 share_code 조회
  SELECT share_code INTO v_share_code
    FROM member_routines
   WHERE id = p_routine_id
     AND member_id = v_member_id;

  RETURN v_share_code;
END;
$$;
