-- 0018_auth_provider_google :: down
-- Reverts the trigger clamp to the 0005 list (no google) and shrinks the
-- auth_provider enum back to (email, apple, facebook). Postgres cannot DROP an
-- enum value, so the type is recreated; any profile rows on 'google' fall back to
-- 'email' (this is a behaviour/shape revert — db:down is destructive by design
-- and must NEVER run against real Supabase, where google attribution is real).

-- 1) Restore the 0005 handle_new_user() body (clamp without 'google').
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provider text;
  v_code     text;
  v_ref      text;
  v_inviter  uuid;
BEGIN
  v_provider := COALESCE(NEW.raw_app_meta_data ->> 'provider', 'email');
  IF v_provider NOT IN ('email', 'apple', 'facebook') THEN
    v_provider := 'email';
  END IF;

  v_code := upper(substr(translate(gen_random_uuid()::text, '-', ''), 1, 10));

  v_ref := NEW.raw_user_meta_data ->> 'ref_code';
  IF v_ref IS NOT NULL AND trim(v_ref) <> '' THEN
    SELECT id INTO v_inviter
    FROM public.profile
    WHERE referral_code = v_ref
    LIMIT 1;
    IF v_inviter = NEW.id THEN
      v_inviter := NULL;
    END IF;
  END IF;

  INSERT INTO public.profile (id, email, auth_provider, display_name, referral_code, referred_by)
  VALUES (
    NEW.id,
    NEW.email,
    v_provider::auth_provider,
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1)),
    v_code,
    v_inviter
  )
  ON CONFLICT (id) DO NOTHING;

  IF v_inviter IS NOT NULL THEN
    BEGIN
      INSERT INTO public.referral (inviter_id, invitee_id, code, status)
      SELECT
        v_inviter,
        NEW.id,
        upper(substr(translate(gen_random_uuid()::text, '-', ''), 1, 12)),
        'registered'
      WHERE NOT EXISTS (
        SELECT 1 FROM public.referral WHERE invitee_id = NEW.id
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'handle_new_user: referral insert skipped for invitee %: %',
        NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

-- 2) Shrink auth_provider back to (email, apple, facebook). Drop the column
-- default first (it is 'email'::auth_provider, bound to the old type), fold any
-- 'google' rows into 'email', recreate the type, re-point the column, restore the
-- default, drop the old type.
ALTER TABLE public.profile ALTER COLUMN auth_provider DROP DEFAULT;
UPDATE public.profile SET auth_provider = 'email' WHERE auth_provider = 'google';
ALTER TYPE auth_provider RENAME TO auth_provider_old;
CREATE TYPE auth_provider AS ENUM ('email', 'apple', 'facebook');
ALTER TABLE public.profile
  ALTER COLUMN auth_provider TYPE auth_provider
  USING auth_provider::text::auth_provider;
ALTER TABLE public.profile ALTER COLUMN auth_provider SET DEFAULT 'email';
DROP TYPE auth_provider_old;
