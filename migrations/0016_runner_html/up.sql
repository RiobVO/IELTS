-- Sanitized full HTML of the interactive exam runner (real Cambridge file with
-- answer keys stripped, audio rehosted, submit-bridge injected). NULL = legacy
-- test imported before the iframe-wrapper track (served by the old runner).
ALTER TABLE content_item ADD COLUMN runner_html text;
