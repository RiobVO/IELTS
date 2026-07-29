-- 0018_auth_provider_google :: up
-- Google is a launch OAuth provider (the auth UI offers a Google button), so the
-- auth_provider enum + the handle_new_user() clamp must STORE it as 'google'
-- instead of collapsing every non-(email|apple|facebook) provider to 'email'
-- (which lost Google attribution). ADD VALUE runs inside the migrator's implicit
-- transaction: PG12+ allows it because 'google' is not used in any DML here — the
-- trigger's `::auth_provider` cast resolves at trigger-execution time, not now.

ALTER TYPE auth_provider ADD VALUE IF NOT EXISTS 'google';

-- Re-author handle_new_user() (the 0005 referral-linking version) with 'google'
-- added to the provider clamp. CREATE OR REPLACE only — the on_auth_user_created
-- trigger from 0002 already binds to this function.
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
  -- Provider from the auth metadata; fall back to email, clamp to our enum.
  v_provider := COALESCE(NEW.raw_app_meta_data ->> 'provider', 'email');
  IF v_provider NOT IN ('email', 'apple', 'facebook', 'google') THEN
    v_provider := 'email';
  END IF;

  -- Short unique-ish referral code derived from a fresh uuid (no extension).
  v_code := upper(substr(translate(gen_random_uuid()::text, '-', ''), 1, 10));

  -- Inviter's shared link code, if the signup carried one (BRIEF §4.9).
  v_ref := NEW.raw_user_meta_data ->> 'ref_code';
  IF v_ref IS NOT NULL AND trim(v_ref) <> '' THEN
    SELECT id INTO v_inviter
    FROM public.profile
    WHERE referral_code = v_ref
    LIMIT 1;

    -- Block self-referral (BRIEF §11). A non-match leaves v_inviter NULL.
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

  -- Open the referral row only for a valid, different inviter; guarded so a
  -- replayed signup never duplicates the invitee's row. referral.code is a
  -- fresh per-row id (UNIQUE), distinct from the shared link code above.
  IF v_inviter IS NOT NULL THEN
    -- The referral row is a non-essential perk: it must NEVER abort the auth
    -- user's signup. Guard only this INSERT (the profile INSERT above stays
    -- unguarded on purpose — a user without a profile is broken and SHOULD
    -- abort). So a referral.code collision or any future constraint degrades
    -- to a warning instead of blocking account creation.
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
