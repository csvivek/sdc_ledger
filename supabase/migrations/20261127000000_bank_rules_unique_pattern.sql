-- One rule per narration text. The app already refuses a second rule for the
-- same text; this makes the database refuse it too (for example two Saves at
-- the same moment, or an edit that turns one rule into a copy of another).
-- Text is compared the way rules match: case and extra spaces ignored.
--
-- Apply only after removing the existing duplicates, or this fails.
create unique index bank_rules_pattern_unique
  on public.bank_rules (upper(regexp_replace(btrim(pattern), '\s+', ' ', 'g')), match_type);
