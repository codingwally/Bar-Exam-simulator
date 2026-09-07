import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Local only. Static hashes preserve the original probe's exact expressions and
// fixture operations; PGlite executes the inline assertion/summary/rollback
// mechanics. This is NOT a claim that the full Simulator engine passed staging.
const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.ASTRA_PGLITE_MODULE || '@electric-sql/pglite');
const sql = readFileSync(new URL('./test-astra-simulator-staging.sql', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const canonical = (value) => value.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('--')).join('\n');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const expected = [
  { type: "assert", label: "'migration helper installed'", hash: 'f67daf84b19e3d104874612ebfbc9a97c691d98220b2921d2a0f48d03bf83bed' },
  { type: "assert", label: "'private helper denies anonymous execution'", hash: '12893d9a7d8f666d52f68cc785f31e0ab0f6a74434c8d1d719d57187ed0e13a8' },
  { type: "assert", label: "'public authorizer remains service-only'", hash: '3389259e467179bcd0bdf84de69257753478f6a18f930c5efcc8905b5c49118f' },
  { type: "assert", label: "'introductory quota actually exhausted'", hash: '4ab9def7327e3649389c74f6f4e13dfdfacedc93d1ae7acad4437468c0f6f1b8' },
  { type: "assert", label: "'unpaid with exhausted credits denied'", hash: '957f5cf30677a7b52b97138d98ee398348ceb9ab41e6342a5194a8c5fed83134' },
  { type: "assert", label: "'Syllabus historical ownership retained'", hash: '14fd4817e9dac89e5549a5b0cf2a40cae771c0d4d97d92a3339df4e8d0735fa9' },
  { type: "denied", label: "'unpaid Simulator catalog denied'", hash: '0fb1f15aada029fcc2701ed30b23cf20c43a68bb1a3b10affb4665eafd1797cb' },
  { type: "assert", label: "'valid 24-hour pending proof admitted despite exhausted credits'", hash: '1fcddebd5ca8b76cb8d40f13980da02cfa23033fcfda2dd7adaa5cb6399bde99' },
  { type: "assert", label: "'outer authorizer accepts pending proof'", hash: '37d248845cb797d4249b920aeeba71af4e2a4db11ad1d0378620e83aa0108dd3' },
  { type: "assert", label: "'inner setup admits pending proof'", hash: '4ba47ec7be63a4c704764876ad6c5f34329724d42c9dff829541733ff666a34b' },
  { type: "assert", label: "'inner fixed start admits pending proof'", hash: 'd6a2d080536159878f43b07af7aba487b735e8387746b12fa1ad5f7e2f808fda' },
  { type: "assert", label: "'randomized start admission resumes existing fixed attempt'", hash: '6611080e25e6fdb8f6fd4e5f1296f6250a0edd5be8da53f1fb597d34a57cff22' },
  { type: "assert", label: "'post-deadline saved answer remains exact'", hash: 'ccf1535c53882aefbc50530206d6d76e718f491140d5659413aaf6cf3d9b4ef5' },
  { type: "assert", label: "'needs-information within original window admitted'", hash: 'edd0bab722df60a9dd7978090ec35e5bc3bbed8029d3d3740180de336b164661' },
  { type: "assert", label: "'manual submit remains available after target ends'", hash: '56d71e2222764e0f6c1d2e29935e181add6d87bf63095df5080c57649fbc7497' },
  { type: "assert", label: "'revoked provisional denied'", hash: 'd56f357a4cad472d364c522308b46a93412aee068266b53217377c5eb992af65' },
  { type: "denied", label: "'owned historical Simulator authorizer denied'", hash: '6d85a67d43cb2eb1ebc1c9e03b9e95258397189da122b30f938f9811146f8d15' },
  { type: "denied", label: "'revoked inner query ' || v_operation", hash: '1f4ee62c3f3e93bf3e8f68d47e2473b9ac09ee202651962ad10a8064e25f9bb7' },
  { type: "denied", label: "'revoked inner command ' || v_operation", hash: '8137768f4b6eff129ba6daea5379565fff6ddc5fa1a37a9f9ed4f01d549d8e1a' },
  { type: "denied", label: "'random start receipt cannot bypass revoked access'", hash: 'ee55e9916b61328b347dbe1b6e08e1222d4c1b425f1a94e5acc51c03ead0a1a5' },
  { type: "assert", label: "'denial does not change stored answer'", hash: 'db55b9a5870ad104abfd8fe7866ab76494d0087f417393735ccecde59a9f9e76' },
  { type: "assert", label: "'Syllabus historical access still retained after proof revocation'", hash: 'e8ca73b2a9342c829c4667034a40c13289eb4b00591be0b8fdba4dbb0f028046' },
  { type: "assert", label: "'expired 24-hour provisional denied'", hash: '4a8bc864d4814055667e8103635195a1dff2d76fedb1cca406909d79cbf40a27' },
  { type: "assert", label: "'rejected proof denied during former window'", hash: '2e5253840784d11981468de14001d63869ae072c06a85173277eea1c43f1be57' },
  { type: "assert", label: "'cancelled proof denied'", hash: 'd3705aeb7253ddbc15e6a3f37b8ab6580fd1b3557f29932fd4dfba28df41d137' },
  { type: "assert", label: "'current paid subscription admitted'", hash: 'e2956699f202bdfa8ab516cc6ad36f4e0c68a654cdd731b87e8cdf03ac4afe18' },
  { type: "assert", label: "'expired paid subscription denied despite owned attempt'", hash: 'af72e946663414271cb9802752fd69c0bd9330b0b905658070300770fdb2a449' },
  { type: "assert", label: "'current Founding Beta overrides expired subscription'", hash: '280486abea432d939de61f613fb31007d254aa434fb8d234a7ae16fc8d443571' },
  { type: "assert", label: "'expired Founding Beta denied'", hash: '8efbc49e111773684d72ae75661407648b9f13d83058204344873bffc4db84ae' },
  { type: "assert", label: "'unentitled beta role alone is not Founding Beta'", hash: 'a6497485674290c7aa02e7673fb373dbf0df9085455fe558a995b6d2965aa780' },
  { type: "assert", label: "'ordinary authorized admin admitted to consumer feature'", hash: 'f135d4e267bbf92790635f6db8523be4a0c3b9e0ad1272a02bf5294d3333fc75' },
  { type: "assert", label: "'ordinary admin did not gain management status'", hash: '232fbfcd49e44c347ce7a5fd4b0a46cb9207da9adafaac16e2eaf1be33ee1d31' },
  { type: "denied", label: "'ordinary admin cannot manage examinations'", hash: '0719824674415bb4db9553a4276bbbd49995cd0312c4856b352b89abd20d4eca' },
  { type: "assert", label: "'founder-only management function unchanged'", hash: 'b5bfc327904085be30caf1542b01d31e576f59999c72d700c16b10e8b0b0a9bb' },
];
const blocks = [...sql.matchAll(/^[ \t]*v_label := ([\s\S]*?);\n[\s\S]*?v_checks := v_checks \|\| jsonb_build_array\(jsonb_build_object\('label', v_label, 'passed', true\)\);/gm)];
const summary = sql.slice(sql.indexOf('  -- Duplicate labels'), sql.lastIndexOf('\nend;\n$matrix$;'));
let groups = 0;
function pass(label) { groups += 1; console.log('PASS ' + label); }

assert.doesNotMatch(canonical(sql), /\b(?:create|alter|drop|truncate|grant|revoke)\b/i);
assert.doesNotMatch(sql, /pg_temp\.|astra_simulator_checks/);
assert.match(sql, /\nbegin;\nset local statement_timeout = '45s';\nset local lock_timeout = '4s';/);
assert.match(sql, /select current_setting\('astra\.simulator_probe_summary', true\)::jsonb as simulator_probe_summary;\nrollback;\s*$/);
assert.equal((sql.match(/do \$matrix\$/g) || []).length, 1);
pass('rollback probe has no schema mutation or persistent assertion helpers');

assert.equal(blocks.length, expected.length);
for (const [index, block] of blocks.entries()) {
  const type = block[0].includes('v_message := null;') ? 'denied' : 'assert';
  const args = type === 'assert'
    ? [block[1], block[0].match(/if \(([\s\S]*?)\) is distinct from true then/)[1]]
    : [block[1], block[0].match(/execute ([\s\S]*?);\n\s*exception when others then/)[1],
      block[0].match(/if v_message is distinct from ([\s\S]*?) then/)[1]];
  assert.equal(type, expected[index].type);
  assert.equal(args[0], expected[index].label);
  assert.equal(hash(JSON.stringify({ type, args: args.map(canonical) })), expected[index].hash,
    'Original assertion changed: ' + expected[index].label);
}
assert.match(sql, /array\['resume','verdict','history'\]/);
assert.match(sql, /array\['heartbeat','save_response','flag_response','submit_attempt','request_ai_grading'\]/);
assert.equal(expected.length + 2 + 4, 40);
pass('all 34 original assertion expressions and 40 expanded checks preserved');

let fixture = sql.match(/do \$matrix\$[\s\S]*?\$matrix\$;/)[0];
for (const block of blocks) fixture = fixture.replace(block[0], '');
fixture = fixture.replace("  v_checks jsonb := '[]'::jsonb;\n  v_label text;\n  v_message text;\n", '').replace(summary, '');
// Real staging enforces both strict deadline and submitted-at provenance.
// Account for this explicit fixture correction, preserving the parity hash of
// every other original write/call rather than weakening the assertion matrix.
assert.ok(fixture.includes('start_request_key,deadline_at,submitted_at)'));
assert.ok(fixture.includes("v_prefix || '_subject',v_now+interval '12 minutes',v_now)"));
fixture = fixture.replace('start_request_key,deadline_at,submitted_at)', 'start_request_key)')
  .replace("v_prefix || '_subject',v_now+interval '12 minutes',v_now)", "v_prefix || '_subject')");
assert.equal(hash(canonical(fixture)), '4f7a6bde8159d7c84b7d4e055c952c6db3a503caf76342958a7f3cdb752f8b09');
pass('all original fixture writes, functional calls, and saved-answer checks preserved');

const db = new PGlite();
const declarations = "declare v_checks jsonb := '[]'::jsonb; v_label text; v_message text;";
const blockDo = (body, initialize = '') => 'do $local$ ' + declarations + ' begin ' + initialize + '\n' + body + '\nend $local$;';
const assertBlock = blocks.find((block) => !block[0].includes('v_message := null;'))[0];
const assertExpression = assertBlock.match(/if \(([\s\S]*?)\) is distinct from true then/)[1];
const assertion = (expression, label = 'local assertion') =>
  assertBlock.replace(blocks[0][1], () => "'" + label + "'").replace(assertExpression, () => expression);
const deniedSource = blocks.find((block) => block[0].includes('v_message := null;'))[0];
const deniedLabel = deniedSource.match(/v_label := ([\s\S]*?);/)[1];
const deniedExpression = deniedSource.match(/execute ([\s\S]*?);\n\s*exception when others then/)[1];
const denied = (expression) => deniedSource.replace(deniedLabel, "'local denial'").replace(deniedExpression, () => expression);
const expectedFailure = (statement, pattern = /ASTRA_SIMULATOR_TEST_FAILED/) =>
  assert.rejects(db.exec(statement), pattern);
const initialChecks = (count, duplicate = false) =>
  "v_checks := '" + JSON.stringify(Array.from({ length: count }, (_, index) =>
    ({ label: duplicate ? 'duplicate' : 'local ' + index, passed: true }))) + "'::jsonb;";
try {
  // Compile the entire actual DO body without resolving application dependencies.
  // Runtime engine behavior is deliberately left to the authorized staging run.
  const matrix = sql.match(/do \$matrix\$[\s\S]*?\$matrix\$;/)[0];
  const compileOnly = matrix
    .replace(/v_admin_hash text := .*?;/, "v_admin_hash text := 'local syntax only';")
    .replace('\nbegin\n', '\nbegin\n  if false then\n')
    .replace(/\nend;\n\$matrix\$;$/, '\n  end if;\nend;\n$matrix$;');
  await db.exec(compileOnly);
  pass('entire converted DO body compiles in disposable PostgreSQL');

  await db.exec(blockDo(assertion('true')));
  await expectedFailure(blockDo(assertion('false')));
  await expectedFailure(blockDo(assertion('null::boolean')));
  pass('actual inline assertions accept true and fail closed on false or null');

  const matching = "'do $failure$ begin raise exception ''EXAM_PREMIUM_REQUIRED''; end $failure$'";
  const wrong = "'do $failure$ begin raise exception ''UNEXPECTED_FAILURE''; end $failure$'";
  await db.exec(blockDo(denied(matching)));
  await expectedFailure(blockDo(denied(wrong)));
  await expectedFailure(blockDo(denied("'select true'")));
  await expectedFailure(blockDo(denied(matching) + '\n' + denied("'select true'")));
  pass('actual denial blocks require exact failure and never reuse a prior error');

  await expectedFailure(blockDo(summary, initialChecks(40, true)), /duplicate assertion labels/);
  await expectedFailure(blockDo(summary, initialChecks(39)), /incomplete assertion matrix/);
  pass('duplicate labels and incomplete matrices cannot publish success');

  await db.exec('create table local_probe_rollback_sentinel(value integer)');
  const catalog = async () => (await db.query(
    "select (select count(*) from pg_class)::integer as relations, (select count(*) from pg_proc)::integer as routines"
  )).rows[0];
  const beforeCatalog = await catalog();
  const rows = await db.exec('begin;\ninsert into local_probe_rollback_sentinel values(1);\n'
    + blockDo(summary, initialChecks(40)) + '\n'
    + "select current_setting('astra.simulator_probe_summary',true)::jsonb as simulator_probe_summary;\nrollback;");
  const result = rows.flatMap((entry) => entry.rows || []).find((row) => row.simulator_probe_summary)?.simulator_probe_summary;
  assert.equal(result?.ok, true);
  assert.equal(result?.passedCount, 40);
  assert.equal(result?.checks.length, 40);
  assert.equal(result?.transactionMode, 'rollback_only');
  assert.equal((await db.query('select count(*)::integer as count from local_probe_rollback_sentinel')).rows[0].count, 0);
  assert.deepEqual(await catalog(), beforeCatalog);
  assert.equal((await db.query("select nullif(current_setting('astra.simulator_probe_summary',true),'') as summary")).rows[0].summary, null);
  pass('40-check summary returned before rollback; rows, schema and session setting unchanged');

  console.log('PASS ' + groups + ' local probe contract/mechanics groups; full Simulator staging matrix not executed here');
} finally {
  await db.close();
}
