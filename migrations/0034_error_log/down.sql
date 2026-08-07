-- 0034_error_log :: down
-- Drop the self-hosted error sink. Monitoring reverts to console.error / Vercel logs
-- (and Sentry if a DSN is set).

DROP TABLE IF EXISTS error_log;
