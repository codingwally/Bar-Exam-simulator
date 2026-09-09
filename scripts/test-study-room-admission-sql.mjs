import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
const require = createRequire(new URL('../worker/package.json', import.meta.url));
const { PGlite } = require(process.env.ASTRA_PGLITE_MODULE || '@electric-sql/pglite');
const read = async path => (await readFile(new URL(`../${path}`, import.meta.url), 'utf8')).replaceAll('\r\n','\n');
const base = await read('supabase/migrations/20260908144814_astra_study_room_persisted_catalog.sql');
const draft = await read('supabase/migrations/20260909080143_study_room_admission_v3.sql');
assert.equal(draft,await read('worker/study-room-admission-schema-draft.sql'),'Reviewed draft and CLI-generated migration must match');
const source = await read('supabase/migrations/20260730_005_phase4_access_subscriptions.sql');
const start = source.indexOf('create or replace function public.admin_authorization_context(');
const helper = source.slice(start,source.indexOf('\n$$;',start)+4).replace("if v_role not in ('admin', 'founder_admin', 'super_admin') then", "if v_role is null or v_role not in ('admin', 'founder_admin', 'super_admin') then");
const users = Object.fromEntries(['member','other','admin','admin2','unknown'].map((role,i)=>[role,`ad000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`]));
const identities = Object.fromEntries(Object.keys(users).map((role,i)=>[role,`sr_${String(i+1).padStart(24,'0')}`]));

test('real Study Room admission SQL: constrained service transport and serialized decisions', async t => {
 const db = new PGlite();
 const scalar = async (sql,args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
 async function rpc(command, role='service_role') {
   await db.exec(`begin; set local role ${role}`);
   try { const result=await scalar('select public.study_room_admission_v1($1::jsonb)',[command]); await db.exec('commit'); return result; }
   catch(e) { await db.exec('rollback'); throw e; }
 }
 const cmd=(operation,who='member',extra={})=>({operation,actor:users[who],identity:identities[who],roomKey:'2',accessRevision:2,
   ...(!['status','list','authorize'].includes(operation)?{commandId:randomUUID()}:{}),
   ...(['list','admit','deny','reinstate','revoke'].includes(operation)?{presence:{identity:identities[who],roomKey:'2',accessRevision:2,checkedAt:new Date().toISOString()}}:{}),...extra});
 const reject=(command,code,message,role)=>assert.rejects(()=>rpc(command,role),e=>e.code===code&&(!message||e.message===message));
 const request=()=>rpc(cmd('request','member',{nickname:'Study partner'}));
 const decision=(operation,row,who='admin',extra={})=>cmd(operation,who,{requestId:row.requestId,expectedVersion:row.version,...extra});
 try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema private; grant usage on schema private to service_role;
    create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');
    create table public.user_roles(user_id uuid primary key references auth.users(id),role text);
    create table public.admin_capabilities(user_id uuid references auth.users(id),capability text,revoked_at timestamptz);
    ${helper}
    revoke all on function public.admin_authorization_context(uuid) from public,anon,authenticated;
    grant execute on function public.admin_authorization_context(uuid) to service_role;`);
  for(const [role,id] of Object.entries(users)) {
   await db.query('insert into auth.users(id) values($1)',[id]);
   if(role!=='unknown') await db.query('insert into public.user_roles values($1,$2)',[id,role.startsWith('admin')?'admin':'student']);
  }
  await db.exec(base);
  const prior = await scalar("select pg_get_functiondef('public.admin_authorization_context(uuid)'::regprocedure)");
  await db.exec(draft);
  assert.equal(await scalar("select pg_get_functiondef('public.admin_authorization_context(uuid)'::regprocedure)"),prior);
  await db.query("select public.study_room_configure_v2($1,'update','2','Room 1','approval',1)",[users.admin]);
  await t.test('v2 audience supports approval, keeps All default and Inner Chamber private; v1 unchanged',async()=>{
   assert.match(await scalar("select pg_get_functiondef('private.study_room_configure_v1(uuid,text,text,text,text,integer)'::regprocedure)"),/\('admin','paid','all'\)/);
   assert.equal(await scalar("select column_default from information_schema.columns where table_schema='private' and table_name='study_room_catalog' and column_name='audience'"),"'all'::text");
   await assert.rejects(()=>db.query("select public.study_room_configure_v2($1,'update','5','Inner Chamber','approval',1)",[users.admin]),e=>e.code==='PT400');
   await reject(cmd('status','member',{roomKey:'5',accessRevision:1}),'42501','STUDY_ROOM_ADMIN_ROOM_REQUIRED');
  });
  await t.test('unauthenticated SQL access is denied, all tables force RLS without direct grants',async()=>{
   for(const role of ['anon','authenticated']) await reject(cmd('status'),'42501',null,role);
   for(const table of ['study_room_admissions','study_room_admission_commands']) {
    const r=(await db.query("select relrowsecurity,relforcerowsecurity,relacl::text acl from pg_class where oid=$1::regclass",[`private.${table}`])).rows[0];
    assert.equal(r.relrowsecurity,true);assert.equal(r.relforcerowsecurity,true);assert.match(r.acl,/^\{postgres=[a-zA-Z]+\/postgres\}$/);
    await db.exec('begin; set local role service_role');
    await assert.rejects(()=>db.query(`select * from private.${table}`),e=>e.code==='42501'); await db.exec('rollback');
   }
  });
  let pending,approved;
  await t.test('actor-bound pending request is idempotent and never authorizes media',async()=>{
   const command=cmd('request','member',{nickname:'Study partner'}); pending=(await rpc(command)).admission;
   assert.equal(pending.status,'pending'); assert.equal(pending.version,1);
   assert.deepEqual(await rpc(command),await rpc(command));
   await reject({...command,nickname:'Changed'},'PT409','STUDY_ROOM_COMMAND_CONFLICT');
   assert.equal((await rpc(cmd('authorize','member',{nickname:'Study partner'}))).allowed,false);
   assert.equal((await rpc(cmd('status','other'))).admission,null);
   await reject(cmd('status','other',{identity:identities.member}),'42501','STUDY_ROOM_ADMISSION_FORBIDDEN');
  });
  await t.test('fresh platform admin and exact recent presence are mandatory',async()=>{
   for(const who of ['member','unknown']) await reject(cmd('list',who),'42501','STUDY_ROOM_ADMIN_NOT_PRESENT');
   for(const presence of [null,{identity:identities.admin,roomKey:'3',accessRevision:2,checkedAt:new Date().toISOString()},
    {identity:identities.admin,roomKey:'2',accessRevision:2,checkedAt:new Date(Date.now()-60_000).toISOString()}])
    await reject(cmd('list','admin',{presence}),'42501','STUDY_ROOM_ADMIN_NOT_PRESENT');
   assert.equal((await rpc(cmd('list','admin'))).queue[0].requestId,pending.requestId);
   await db.query("update public.user_roles set role='student' where user_id=$1",[users.admin2]);
   await reject(cmd('list','admin2'),'42501','STUDY_ROOM_ADMIN_NOT_PRESENT');
   await db.query("update public.user_roles set role='admin' where user_id=$1",[users.admin2]);
  });
  await t.test('competing serialized administrators cannot overwrite the first decision',async()=>{
   // PGlite uses one connection. These represent both outcomes at the SQL lock boundary;
   // hosted multi-connection scheduling and LiveKit presence remain integration checks.
   const first=decision('admit',pending); approved=(await rpc(first)).admission;
   assert.equal(approved.status,'approved'); assert.equal(approved.version,2);
   await reject(decision('deny',pending,'admin2'),'PT409','STUDY_ROOM_ADMISSION_CONFLICT');
   assert.equal((await rpc(first)).admission.version,2);
   assert.equal((await rpc(cmd('authorize','member',{nickname:'Study partner',expectedVersion:2}))).allowed,true);
   assert.equal((await rpc(cmd('authorize','member',{nickname:'Study partner',expectedVersion:1}))).allowed,false);
  });
  await t.test('revocation blocks fresh tokens before provider call, with durable retry and cutoff',async()=>{
   const command=decision('deny',approved); const result=await rpc(command);
   assert.equal(result.revokeRequired,true);assert.equal(result.admission.revokePending,true);
   assert.equal((await rpc(cmd('authorize'))).allowed,false);
   assert.deepEqual(await rpc(command),result);
   await reject(decision('reinstate',result.admission),'PT409');
   await rpc({...command,operation:'confirm_revocation'});
   const renewed=(await rpc(decision('reinstate',result.admission))).admission;
   assert.equal(renewed.status,'cancelled');
   const waiting=(await request()).admission; approved=(await rpc(decision('admit',waiting))).admission;
   assert.equal((await rpc(cmd('authorize'))).allowed,false,'one-minute provider buffer cannot be bypassed by readmission');
   await db.exec("update private.study_room_admissions set not_before=clock_timestamp()-interval '1 second'");
   assert.equal((await rpc(cmd('authorize'))).allowed,true);
  });
  await t.test('generation changes invalidate old requests and protect private room policies',async()=>{
   await db.query("select public.study_room_configure_v2($1,'update','2','Room 1','all',2)",[users.admin]);
   await reject(cmd('authorize'),'PT409','STUDY_ROOM_CONFIG_CONFLICT');
   assert.equal((await rpc(cmd('authorize','member',{accessRevision:3,nickname:'Partner'}))).allowed,true);
   await db.query("select public.study_room_configure_v2($1,'update','2','Room 1','approval',3)",[users.admin]);
  });
  await t.test('cancel, expiry and per-actor repeat limits do not suppress a shared school IP',async()=>{
   const c=(op,who='member',extra={})=>cmd(op,who,{accessRevision:4,...extra});
   for(let i=0;i<3;i++) {assert.equal((await rpc(c('request','member',{nickname:'Partner'}))).admission.status,'pending'); await rpc(c('cancel'));}
   await reject(c('request','member',{nickname:'Partner'}),'PT429','STUDY_ROOM_REQUEST_LIMIT');
   assert.equal((await rpc(c('request','other',{nickname:'Another partner'}))).admission.status,'pending');
   await db.exec("update private.study_room_admissions set expires_at=clock_timestamp()-interval '1 second' where status='pending'");
   assert.equal((await rpc(c('status','other'))).admission.status,'expired');
   assert.equal((await rpc(c('request','other',{nickname:'Another partner'}))).admission.status,'pending');
  });
  await t.test('unknown existing participant removal cannot stale-rejoin, explicit reinstatement adopts actor safely',async()=>{
   const command=cmd('revoke','admin',{roomKey:'3',accessRevision:1,targetIdentity:identities.unknown,presence:{identity:identities.admin,roomKey:'3',accessRevision:1,checkedAt:new Date().toISOString()}});
   const result=await rpc(command);
   assert.equal((await rpc(cmd('authorize','unknown',{roomKey:'3',accessRevision:1}))).allowed,false);
   await rpc({...command,operation:'confirm_revocation'});
   await rpc({...decision('reinstate',result.admission),roomKey:'3',accessRevision:1,presence:command.presence});
   await db.exec("update private.study_room_admissions set not_before=clock_timestamp()-interval '1 second'");
   assert.equal((await rpc(cmd('authorize','unknown',{roomKey:'3',accessRevision:1,nickname:'Partner'}))).allowed,true);
  });
  await t.test('old decisions cannot hide pending users; pagination is bounded and waiting capacity is enforced',async()=>{
   await db.query(`insert into private.study_room_admissions(room_key,access_revision,user_id,identity,nickname,status,expires_at,requested_at)
     select 2,4,$1,'sr_'||lpad((1000+n)::text,24,'0'),'Bulk fixture','denied',clock_timestamp()+interval '1 hour',clock_timestamp()-interval '1 day'
     from generate_series(1,105) n`,[users.member]);
   const list=(page)=>cmd('list','admin',{accessRevision:4,page,presence:{identity:identities.admin,roomKey:'2',accessRevision:4,checkedAt:new Date().toISOString()}});
   const first=await rpc(list(0));const second=await rpc(list(1));
   assert.equal(first.queue.length,100);assert.equal(first.hasMore,true);assert.equal(first.queue[0].status,'pending');
   assert.equal(second.hasMore,false);assert.equal(first.queue.length+second.queue.length,first.total);
   assert.equal(new Set([...first.queue,...second.queue].map(r=>r.requestId)).size,first.total);
   await reject(list(-1),'PT400');
   await db.query(`insert into private.study_room_admissions(room_key,access_revision,user_id,identity,nickname,status,expires_at)
     select 2,4,$1,'sr_'||lpad((2000+n)::text,24,'0'),'Bulk fixture','pending',clock_timestamp()+interval '15 minutes'
     from generate_series(1,49) n`,[users.member]);
   await reject(cmd('request','unknown',{accessRevision:4,nickname:'New partner'}),'PT429','STUDY_ROOM_WAITING_CAPACITY');
   const filled=await rpc(list(0));assert.equal(filled.queue.filter(r=>r.status==='pending').length,50);
  });
 } finally {await db.close();}
});
