begin;

-- A question is identified by its immutable version and ordinal. Identical
-- wording at different ordinals is valid (for example, a Professor may use
-- repeated placeholders while testing or deliberately repeat instructions).
-- Keep the prompt digest for integrity checks, but do not treat it as a
-- uniqueness key.
alter table public.exam_room_questions
  drop constraint if exists exam_room_questions_question_version_id_prompt_hash_key;

commit;
