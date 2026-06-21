-- Verbatim question-panel HTML for the exam runner (real-IELTS rendering).
-- Holds the original question markup (instructions, sub-headings, tables) with
-- <span class="q-slot"> placeholders in place of inputs. Nullable: NULL means the
-- runner falls back to the atomized question list. Grading is unaffected
-- (it stays number -> answer_key, independent of how questions are rendered).
ALTER TABLE passage ADD COLUMN questions_html text;
