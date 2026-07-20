-- 0006_payments :: down
-- Drops the payment table (its policy, grants, and index go with it) and the two
-- enums it introduced. Reverses 0006 exactly; no other object is touched.
DROP TABLE IF EXISTS payment;
DROP TYPE  IF EXISTS payment_status;
DROP TYPE  IF EXISTS payment_provider;
