-- 0022_signup_throttle :: down
-- Drop the signup velocity-cap table. Signup reverts to captcha-only gating.

DROP TABLE IF EXISTS signup_throttle;
