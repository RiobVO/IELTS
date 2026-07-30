-- 0020_payment_expiry :: down
-- Drop the pending-expiry column. Behaviour reverts to pending-applies-forever.

ALTER TABLE public.payment
  DROP COLUMN IF EXISTS expires_at;
