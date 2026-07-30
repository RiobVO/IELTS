-- 0022_signup_throttle :: up
-- Signup velocity-cap (BRIEF §11 anti-abuse): запоминаем по ХЕШУ IP факт каждой
-- попытки регистрации, чтобы ограничить флуд аккаунтов с одного адреса — поверх
-- captcha (которая fail-open до Cloudflare-ключей). SERVER-ONLY: пишет/читает
-- только signUp owner-путём, клиенту не нужно → RLS включён, гранты сняты (как
-- любая public-таблица, BRIEF §6.1). Не PII: храним sha256(ip), не сам адрес.

CREATE TABLE signup_throttle (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX signup_throttle_ip_created_idx ON signup_throttle (ip_hash, created_at);

ALTER TABLE signup_throttle ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON signup_throttle FROM anon, authenticated, PUBLIC;
