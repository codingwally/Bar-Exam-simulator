-- Expose the roster-bound student email to the trusted Examination Room
-- session context so successful submissions can send the student an answer-only
-- copy without trusting a client-supplied recipient.

do $migration$
declare
  fn text;
begin
  select pg_get_functiondef('examination_room_v1.api_student(text,jsonb)'::regprocedure)
  into fn;

  if position('student_email text;' in fn) = 0 then
    fn := replace(
      fn,
      'student_number text;' || chr(10) || '  grading_alias text;',
      'student_number text;' || chr(10) || '  student_email text;' || chr(10) || '  grading_alias text;'
    );

    fn := replace(
      fn,
      'si.external_student_id,' || chr(10) || '      er.grading_alias,',
      'si.external_student_id,' || chr(10) || '      si.email_normalized,' || chr(10) || '      er.grading_alias,'
    );
    fn := replace(
      fn,
      'student_number,' || chr(10) || '      grading_alias,',
      'student_number,' || chr(10) || '      student_email,' || chr(10) || '      grading_alias,'
    );

    fn := replace(
      fn,
      'si.external_student_id,' || chr(10) || '    er.grading_alias,',
      'si.external_student_id,' || chr(10) || '    si.email_normalized,' || chr(10) || '    er.grading_alias,'
    );
    fn := replace(
      fn,
      'student_number,' || chr(10) || '    grading_alias,',
      'student_number,' || chr(10) || '    student_email,' || chr(10) || '    grading_alias,'
    );
  end if;

  if position('''studentEmail'', student_email' in fn) = 0 then
    fn := replace(
      fn,
      '''yearLevel'', year_level' || chr(10) || '      ),' || chr(10) || '      ''privacyConsent''',
      '''yearLevel'', year_level' || chr(10) || '      ),' || chr(10) || '      ''studentEmail'', student_email,' || chr(10) || '      ''privacyConsent'''
    );
  end if;

  if position('student_email text;' in fn) = 0
     or position('''studentEmail'', student_email' in fn) = 0 then
    raise exception 'api_student email-context patch anchors were not found';
  end if;

  execute fn;
end
$migration$;

revoke all on function examination_room_v1.api_student(text, jsonb) from public, anon, authenticated, service_role;
