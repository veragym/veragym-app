-- ============================================================================
-- PT 수업일지 자동 연결 (A안)
-- ----------------------------------------------------------------------------
-- 문제:
--   process_session / confirm_session_status 가 수업 완료 시 무조건
--   workout_logs 를 INSERT 하기 때문에, 트레이너가 미리 작성해둔 일지가
--   schedule_id = NULL 인 orphan 으로 남고 빈 일지가 하나 더 만들어진다.
--
-- 해결:
--   완료/노쇼 처리 시 (trainer_id, member_id, sched_date) 가 일치하는
--   미연결(schedule_id IS NULL) workout_log 가 있으면 그 행을 UPDATE 하여
--   schedule_id 를 채우고, 없을 때만 새 행을 INSERT 한다.
--
-- 모호성 처리:
--   같은 키로 미연결 일지가 여러 개일 때 우선순위
--     1) notes 가 비어있지 않은 일지 (작성된 일지)
--     2) created_at DESC (가장 최근 작성)
--
-- 반환 JSON 에 log_linked (true=기존 일지 매칭, false=신규 생성) 추가
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) process_session  (트레이너/관리자 "예정 → 완료/노쇼" 직접 처리)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_session(p_schedule_id uuid, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_sched      schedules%ROWTYPE;
  v_prod       pt_products%ROWTYPE;
  v_next       pt_products%ROWTYPE;
  v_log_id     UUID;
  v_log_linked BOOLEAN := FALSE;
  v_sess_num   INT;
BEGIN
  SELECT * INTO v_sched FROM schedules WHERE id = p_schedule_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'schedule_not_found');
  END IF;
  IF v_sched.status != 'scheduled' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_processed', 'current_status', v_sched.status);
  END IF;
  IF p_action NOT IN ('completed','noshow') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_action');
  END IF;

  IF v_sched.type = 'PT' THEN
    IF v_sched.pt_product_id IS NOT NULL THEN
      SELECT * INTO v_prod FROM pt_products WHERE id = v_sched.pt_product_id FOR UPDATE;
    ELSE
      SELECT * INTO v_prod FROM pt_products
      WHERE member_id = v_sched.member_id
        AND status = 'active' AND remaining_sessions > 0
      ORDER BY contract_date ASC LIMIT 1 FOR UPDATE;
    END IF;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_active_pt_product');
    END IF;
    IF v_prod.remaining_sessions <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_remaining_sessions',
        'pt_product_id', v_prod.id, 'remaining_sessions', v_prod.remaining_sessions);
    END IF;

    v_sess_num := v_prod.total_sessions - v_prod.remaining_sessions + 1;

    UPDATE pt_products SET remaining_sessions = remaining_sessions - 1 WHERE id = v_prod.id;

    IF v_prod.remaining_sessions <= 1 THEN
      UPDATE pt_products SET status = 'done', is_active = FALSE WHERE id = v_prod.id;
      SELECT * INTO v_next FROM pt_products
      WHERE member_id = v_prod.member_id AND id != v_prod.id
        AND status IN ('pending', 'active') AND remaining_sessions > 0
      ORDER BY contract_date ASC LIMIT 1 FOR UPDATE;
      IF FOUND THEN
        IF v_next.status = 'pending' THEN
          UPDATE pt_products SET status = 'active', is_active = TRUE WHERE id = v_next.id;
        END IF;
        UPDATE schedules
        SET pt_product_id = v_next.id
        WHERE member_id = v_sched.member_id
          AND type = 'PT' AND status = 'scheduled'
          AND (pt_product_id = v_prod.id OR pt_product_id IS NULL);
      END IF;
    END IF;
  END IF;

  -- 상태 + 회차번호 저장
  UPDATE schedules
  SET status = p_action, session_number = v_sess_num
  WHERE id = p_schedule_id;

  -- ── workout_log 자동 연결 또는 신규 생성 ────────────────────────────────
  v_log_id := NULL;
  IF v_sched.type IN ('PT', 'SPT') THEN
    -- (1) 미리 작성된 미연결 일지가 있는지 탐색
    SELECT id INTO v_log_id
    FROM workout_logs
    WHERE schedule_id IS NULL
      AND trainer_id   = v_sched.trainer_id
      AND member_id    = v_sched.member_id
      AND session_date = v_sched.sched_date
      AND is_deleted   = FALSE
    ORDER BY
      (CASE WHEN notes IS NOT NULL AND length(btrim(notes)) > 0 THEN 0 ELSE 1 END),
      created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_log_id IS NOT NULL THEN
      -- (2a) 기존 일지에 schedule_id 연결 + noshow 플래그 동기화
      UPDATE workout_logs
      SET schedule_id = p_schedule_id,
          is_noshow   = (p_action = 'noshow')
      WHERE id = v_log_id;
      v_log_linked := TRUE;
    ELSE
      -- (2b) 미연결 일지가 없으면 빈 일지 신규 생성 (기존 동작)
      INSERT INTO workout_logs (trainer_id, member_id, session_date, schedule_id, is_noshow, is_deleted)
      VALUES (v_sched.trainer_id, v_sched.member_id, v_sched.sched_date, p_schedule_id,
              (p_action = 'noshow'), FALSE)
      RETURNING id INTO v_log_id;
      v_log_linked := FALSE;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok',                      true,
    'action',                  p_action,
    'session_number',          v_sess_num,
    'pt_product_id',           CASE WHEN v_sched.type = 'PT' THEN v_prod.id ELSE NULL END,
    'remaining_sessions',      CASE WHEN v_sched.type = 'PT' THEN v_prod.remaining_sessions - 1 ELSE NULL END,
    'next_contract_activated', CASE WHEN v_sched.type = 'PT' THEN (v_next.id IS NOT NULL) ELSE FALSE END,
    'workout_log_id',          v_log_id,
    'log_linked',              v_log_linked,
    'member_id',               v_sched.member_id,
    'sched_date',              v_sched.sched_date,
    'trainer_id',              v_sched.trainer_id
  );
END;
$function$;


-- ----------------------------------------------------------------------------
-- 2) confirm_session_status  (회원 확인 단계 "pending_complete/noshow → 확정")
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_session_status(p_schedule_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_sched      schedules%ROWTYPE;
  v_new_status TEXT;
  v_log_id     UUID;
  v_log_linked BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_sched FROM schedules WHERE id = p_schedule_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'schedule_not_found');
  END IF;
  IF v_sched.status NOT IN ('pending_complete','pending_noshow') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending', 'current_status', v_sched.status);
  END IF;

  IF v_sched.status = 'pending_complete' THEN
    v_new_status := 'completed';
  ELSE
    v_new_status := 'noshow';
  END IF;

  UPDATE schedules SET status = v_new_status WHERE id = p_schedule_id;

  -- ── workout_log 자동 연결 또는 신규 생성 ────────────────────────────────
  v_log_id := NULL;
  IF v_sched.type IN ('PT', 'SPT') THEN
    SELECT id INTO v_log_id
    FROM workout_logs
    WHERE schedule_id IS NULL
      AND trainer_id   = v_sched.trainer_id
      AND member_id    = v_sched.member_id
      AND session_date = v_sched.sched_date
      AND is_deleted   = FALSE
    ORDER BY
      (CASE WHEN notes IS NOT NULL AND length(btrim(notes)) > 0 THEN 0 ELSE 1 END),
      created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_log_id IS NOT NULL THEN
      UPDATE workout_logs
      SET schedule_id = p_schedule_id,
          is_noshow   = (v_new_status = 'noshow')
      WHERE id = v_log_id;
      v_log_linked := TRUE;
    ELSE
      INSERT INTO workout_logs (trainer_id, member_id, session_date, schedule_id, is_noshow, is_deleted)
      VALUES (v_sched.trainer_id, v_sched.member_id, v_sched.sched_date, p_schedule_id,
              (v_new_status = 'noshow'), FALSE)
      RETURNING id INTO v_log_id;
      v_log_linked := FALSE;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok',              true,
    'new_status',      v_new_status,
    'workout_log_id',  v_log_id,
    'log_linked',      v_log_linked,
    'member_id',       v_sched.member_id,
    'sched_date',      v_sched.sched_date,
    'trainer_id',      v_sched.trainer_id
  );
END;
$function$;


-- ============================================================================
-- 적용 후 점검 SQL (선택)
-- ----------------------------------------------------------------------------
-- 현재 남아있는 orphan(미연결) 일지 확인:
--   SELECT id, trainer_id, member_id, session_date, length(coalesce(notes,'')) AS notes_len
--   FROM workout_logs
--   WHERE schedule_id IS NULL AND is_deleted = FALSE
--   ORDER BY session_date DESC;
--
-- 같은 schedule 에 일지가 2개 이상 매달려 있는 중복(이전에 발생한 빈 일지 포함):
--   SELECT schedule_id, count(*) FROM workout_logs
--   WHERE schedule_id IS NOT NULL AND is_deleted = FALSE
--   GROUP BY schedule_id HAVING count(*) > 1;
-- ============================================================================
