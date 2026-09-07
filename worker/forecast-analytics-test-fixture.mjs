// Isolated PostgreSQL fixture; only external Auth/access prerequisites are local
// stubs. All attempts, canonical results, scopes, journals and quotas use the real
// checked-in migrations/functions. Missing PGlite is an error, never a skipped test.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createForecastAttemptStore } from './forecast-attempt-store.mjs';
import { BAR_FORECAST_SUBJECTS, forecastSetId } from './bar-forecast-core.mjs';

export const OWNER = '11111111-1111-4111-8111-111111111111';
export const OTHER = '22222222-2222-4222-8222-222222222222';
export const USER = { id: OWNER, email: 'scope-owner@example.test', email_confirmed_at: '2026-09-01T00:00:00Z' };
export const MIGRATION = '20260907091138_astra_forecast_analytics_scope_exports.sql';
export async function fixture() {
  const { PGlite } = await import(process.env.PGLITE_MODULE_PATH ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    insert into auth.users values('${OWNER}','${USER.email}','${USER.email_confirmed_at}'),('${OTHER}','other@example.test','2026-09-01T00:00:00Z');
    create table public.dd2026_bar_forecast_consents(user_id uuid,consent_version text);
    insert into public.dd2026_bar_forecast_consents select id,'2026-09-01' from auth.users;
    create table public.scope_fixture_access(owner_id uuid primary key,allowed boolean not null);
    insert into public.scope_fixture_access values('${OWNER}',true),('${OTHER}',true);
    create function public.dd2026_bar_forecast_access_allowed(uuid) returns boolean language sql stable as 'select coalesce((select allowed from public.scope_fixture_access where owner_id=$1),false)';
    grant usage on schema public,auth to service_role;
    grant select on public.dd2026_bar_forecast_consents,public.scope_fixture_access to service_role;
    revoke all on auth.users from public,anon,authenticated,service_role;`);
  for (const name of ['20260907060650_astra_forecast_attempts.sql','20260907064532_astra_forecast_result_exports.sql',MIGRATION]) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
  }
  const rpc = async (_env, name, args) => {
    if (!/^dd2026_forecast_[a-z_]+$/u.test(name)) throw new Error('Unsafe fixture RPC');
    const entries = Object.entries(args);
    await db.exec('set role service_role');
    try { return (await db.query(`select public.${name}(${entries.map(([key], i) => `${key}=>$${i + 1}`).join(',')}) value`, entries.map(([, value]) => value))).rows[0].value; }
    finally { await db.exec('reset role'); }
  };
  const store = createForecastAttemptStore({ rpc });
  async function accept({ ownerId = OWNER, subject = BAR_FORECAST_SUBJECTS[0], classified = true, long = false } = {}) {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: `scope-fixture-${i + 1}`, number: i + 1, subject, title: `Local scope verification ${i + 1}`,
      checksum: String(i + 1).padStart(64, '0'),
      payloadCanonical: JSON.stringify(classified && i < 18 ? { syllabus_unit_id: i < 9 ? 'FIX-I' : 'FIX-II', syllabus_unit: i < 9 ? 'First saved unit' : 'Second saved unit', syllabus_topic: i % 2 ? 'Second saved topic' : 'First saved topic' } : { number: i + 1 }),
      prompt: `Question ${i + 1}: Apply the controlling rule to the decisive material facts.`,
      suggestedAnswer: `Suggested answer ${i + 1}: The rule governs because its legal elements are supported by the material facts.`,
      legalBasis: 'Local fixture authority for rendering and aggregation tests only.',
      controllingDoctrine: 'Apply each legal element to the decisive material facts.', jurisprudence: 'Local fixture reference', citation: 'Local fixture source',
      userAnswer: long && i === 0 ? `${'These material facts establish the controlling legal elements and support the requested conclusion. '.repeat(55)}End of long first answer.`
        : `Answer ${i + 1}: The material facts establish the controlling legal elements and support the requested conclusion. ${i === 19 ? 'Final answer twenty: ₱149, Señor Niño, café.' : ''}`,
    }));
    return (await store.accept({}, { ownerId, clientAttemptId: crypto.randomUUID(), subject, setId: await forecastSetId(rows), rowsWithAnswers: rows })).attempt;
  }
  async function complete(options = {}) {
    const attempt = await accept(options);
    for (let batch = 0; batch < 5; batch++) {
      const claim = await store.claim({}, { attemptId: attempt.id });
      await store.checkpoint({}, claim, { results: claim.rows.map((row) => ({ questionId: row.id, score: options.score ?? 4,
        grammar: { score: 3, corrections: [] }, issueSpotting: { score: 4.5, identified: [], missed: [] } })) });
    }
    return (await store.finalize({}, attempt.id)).attempt;
  }
  const snapshot = (args = {}) => rpc({}, 'dd2026_forecast_analytics_snapshot', { p_actor_user_id: OWNER, p_request_id: crypto.randomUUID(), ...args });
  return { db, rpc, store, accept, complete, snapshot, close: () => db.close() };
}
