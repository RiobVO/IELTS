-- 0005_referral_linking :: down
-- Restore public.handle_new_user() to the exact 0002 version (no ref handling,
-- original profile insert). NOTE: this restores trigger BEHAVIOUR only — it does
-- NOT unwind any profile.referred_by links or referral rows already written
-- while 0005 was applied (that is historical data and is left intact).

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provider text;
  v_code     text;
BEGIN
  -- Provider from the auth metadata; fall back to email, clamp to our enum.
  v_provider := COALESCE(NEW.raw_app_meta_data ->> 'provider', 'email');
  IF v_provider NOT IN ('email', 'apple', 'facebook') THEN
    v_provider := 'email';
  END IF;

  -- Short unique-ish referral code derived from a fresh uuid (no extension).
  v_code := upper(substr(translate(gen_random_uuid()::text, '-', ''), 1, 10));

  INSERT INTO public.profile (id, email, auth_provider, display_name, referral_code)
  VALUES (
    NEW.id,
    NEW.email,
    v_provider::auth_provider,
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1)),
    v_code
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;
