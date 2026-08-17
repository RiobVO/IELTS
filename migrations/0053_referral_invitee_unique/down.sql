-- 0053_referral_invitee_unique :: down
ALTER TABLE referral DROP CONSTRAINT IF EXISTS referral_invitee_id_key;
