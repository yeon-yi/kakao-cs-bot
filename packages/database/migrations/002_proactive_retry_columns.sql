-- 002_proactive_retry_columns.sql
-- proactive_messages 에 재시도/에러 추적 컬럼 추가.
-- ProactiveRepository.markFailed() 가 참조하는 attempts, last_error 컬럼이 초기 스키마에 누락되어
-- Android 봇 재시도 로직이 500 에러로 멈추는 문제를 해결한다.

ALTER TABLE proactive_messages
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text;

-- scheduled_at 컬럼은 이미 ALTER 로 추가되었으나 초기 스키마엔 없었음. 멱등 보정.
ALTER TABLE proactive_messages
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz DEFAULT NOW();
