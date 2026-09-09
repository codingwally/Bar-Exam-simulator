import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { TokenVerifier } from 'livekit-server-sdk';
import worker from './index.mjs';
import { createStudyRoomAdmission } from './study-room-admission.mjs';
import { createStudyRoomHandlers } from './study-room-routes.mjs';
import { createStudyRoomJoinCredential, requireStudyRoomAdministratorPresence,
  revokeStudyRoomParticipantToken, studyRoomParticipantIdentity, resolveStudyRoomSlot, STUDY_ROOM_SLOTS } from './study-room-core.mjs';
const env = {STUDY_ROOM_ENABLED:'true',STUDY_ROOM_NAME:'study-admission-test',LIVEKIT_URL:'wss://admission-test.livekit.cloud',
 LIVEKIT_API_KEY:'test-key',LIVEKIT_API_SECRET:'only-local-test-secret-with-entropy'};
const user={id:'11111111-1111-4111-8111-111111111111'};
const catalog={schemaVersion:1,maxRooms:24,rooms:STUDY_ROOM_SLOTS.map(r=>({roomKey:r.roomKey,label:r.label,
 audience:r.roomKey==='5'?'admin':r.roomKey==='2'?'approval':'all',revision:1,accessRevision:1}))};
const slot=resolveStudyRoomSlot(env,'2',{catalog});
const identity=await studyRoomParticipantIdentity(env,user.id);
const target='sr_abcdefghijklmnopqrstuvwx';
const record=()=>({requestId:randomUUID(),identity,roomKey:'2',accessRevision:1,status:'approved',version:1,
 expiresAt:new Date(Date.now()+600000).toISOString(),notBefore:new Date(Date.now()-1000).toISOString()});
const options={catalog,getCatalog:async()=>catalog};
const rejects=(fn,code)=>assert.rejects(fn,e=>e.code===code);

test('pending admission, absent dependency, or self-hosted revocation fails before media lookup/token signing',async()=>{
 let calls=0;
 const roomService={async listRooms(){calls++;return[];},async createRoom(){calls++;}};
 for(const extra of [{},{authorizeAdmission:async()=>{throw Object.assign(new Error('pending'),{code:'STUDY_ROOM_APPROVAL_REQUIRED'});}},
  {authorizeAdmission:async()=>({version:1,expiresAt:'invalid'})}]) {
  await assert.rejects(()=>createStudyRoomJoinCredential(env,user,'2','Partner',{...options,roomService,...extra}));
  assert.equal(calls,0);
 }
 await rejects(()=>createStudyRoomJoinCredential({...env,LIVEKIT_URL:'wss://selfhost.example.test'},user,'2','Partner',
  {...options,roomService,authorizeAdmission:async()=>record()}),'STUDY_ROOM_REVOCATION_UNAVAILABLE');
 assert.equal(calls,0);
});

test('real signed token rechecks the exact admission version and preserves Library media source limits',async()=>{
 for(const roomKey of ['1','2']) {
  const calls=[];const admission=record();const name=resolveStudyRoomSlot(env,roomKey,{catalog}).roomName;
  const roomService={async listRooms(){return[{name,maxParticipants:12,numParticipants:0}];}};
  const result=await createStudyRoomJoinCredential(env,user,roomKey,'Partner',{...options,roomService,
   authorizeAdmission:async(s,n,v)=>{calls.push([s.roomKey,n,v]);return admission;}});
  assert.deepEqual(calls,[[roomKey,'Partner',undefined],[roomKey,'Partner',1]]);
  const decoded=await new TokenVerifier(env.LIVEKIT_API_KEY,env.LIVEKIT_API_SECRET).verify(result.participantToken);
  assert.equal(decoded.video.room,name);assert.equal(decoded.video.roomJoin,true);
  assert.deepEqual(decoded.video.canPublishSources,roomKey==='1'?['camera','screen_share']:['camera','microphone','screen_share','screen_share_audio']);
  assert.ok(decoded.exp-decoded.nbf<=600);
 }
 let passes=0;
 await rejects(()=>createStudyRoomJoinCredential(env,user,'2','Partner',{...options,
  roomService:{async listRooms(){return[{name:slot.roomName,maxParticipants:12,numParticipants:0}];}},
  authorizeAdmission:async()=>{if(passes++)throw Object.assign(new Error('revoked'),{code:'STUDY_ROOM_APPROVAL_REQUIRED'});return record();}}),'STUDY_ROOM_APPROVAL_REQUIRED');
});

test('provider presence is exact active room identity, never a browser assertion',async()=>{
 const calls=[];const roomService={async getParticipant(name,id){calls.push([name,id]);return{identity:id,state:2};}};
 assert.deepEqual(await requireStudyRoomAdministratorPresence(env,user.id,'2',{...options,isAdministrator:true,roomService}),{identity,roomName:slot.roomName});
 assert.deepEqual(calls,[[slot.roomName,identity]]);
 for(const participant of [{identity,state:0},{identity,state:3},{identity:target,state:2},null]) {
  await rejects(()=>requireStudyRoomAdministratorPresence(env,user.id,'2',{...options,isAdministrator:true,
   roomService:{async getParticipant(){return participant;}}}),'STUDY_ROOM_ADMIN_NOT_PRESENT');
 }
 await rejects(()=>requireStudyRoomAdministratorPresence(env,user.id,'2',{...options,isAdministrator:false,roomService}),'STUDY_ROOM_ADMIN_REQUIRED');
});

test('revocation uses supported SDK bigint options and an immutable retry cutoff',async()=>{
 const calls=[];const revokedAt=new Date(Date.now()-30000).toISOString();
 const roomService={async removeParticipant(...args){calls.push(args);}};
 await revokeStudyRoomParticipantToken(env,'2',target,{...options,roomService,revokedAt});
 await revokeStudyRoomParticipantToken(env,'2',target,{...options,roomService,revokedAt});
 assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0][2].revokeTokenTs,BigInt(Math.floor(Date.parse(revokedAt)/1000)));
 assert.equal(calls[0][0],slot.roomName);assert.equal(calls[0][1],target);
});

test('admission service binds actors, normalizes names, requires platform admin presence, and hides internal confirmation',async()=>{
 const calls=[];let presenceCalls=0;
 const service=createStudyRoomAdmission({rpc:async(_env,args)=>{calls.push(args.p_command);return{ok:true,admission:record()};},
  presence:async()=>{presenceCalls++;return{identity};}});
 await service.command(env,user,{operation:'request',roomKey:'2',accessRevision:1,commandId:randomUUID(),nickname:'  Partner  ',actor:'FORGED',identity:target},options);
 assert.equal(calls[0].actor,user.id);assert.equal(calls[0].identity,identity);assert.equal(calls[0].nickname,'Partner');
 await rejects(()=>service.command(env,user,{operation:'list',roomKey:'2',accessRevision:1,presence:{identity}},options),'STUDY_ROOM_ADMIN_REQUIRED');
 assert.equal(presenceCalls,0);
 await service.command(env,user,{operation:'list',roomKey:'2',accessRevision:1},{...options,isAdministrator:true});assert.equal(presenceCalls,1);
 assert.equal(calls.at(-1).presence.identity,identity);
 await rejects(()=>service.command(env,user,{operation:'confirm_revocation',roomKey:'2',accessRevision:1},{...options,isAdministrator:true}),'STUDY_ROOM_OPERATION_UNSUPPORTED');
 await rejects(()=>service.command(env,user,{operation:'status',roomKey:'2',accessRevision:9},options),'STUDY_ROOM_CONFIG_CONFLICT');
});

test('durable deny precedes provider; uncertainty retries original cutoff and confirmation follows success only',async()=>{
 const calls=[];let failed=true;const admission={...record(),status:'denied',identity:target};const revokedAt=new Date().toISOString();
 const service=createStudyRoomAdmission({rpc:async(_env,{p_command:p})=>{calls.push(p.operation);return p.operation==='confirm_revocation'?{ok:true}:{ok:true,admission,revokeRequired:true,revokedAt};},
  presence:async()=>({identity}),revokeToken:async(_env,key,id,o)=>{calls.push('provider');assert.equal(o.revokedAt,revokedAt);assert.equal(id,target);if(failed)throw new Error('provider outage');}});
 const command={operation:'deny',roomKey:'2',accessRevision:1,commandId:randomUUID(),requestId:admission.requestId,expectedVersion:1};
 await assert.rejects(()=>service.command(env,user,command,{...options,isAdministrator:true}),/provider outage/);
 assert.deepEqual(calls,['deny','provider']);failed=false;await service.command(env,user,command,{...options,isAdministrator:true});
 assert.deepEqual(calls,['deny','provider','deny','provider','confirm_revocation']);
 const noProvider=createStudyRoomAdmission({rpc:async()=>({ok:true,admission,revokeRequired:false}),revokeToken:async()=>assert.fail('Pending cancel must not require provider traffic')});
 await noProvider.command(env,user,{operation:'cancel',roomKey:'2',accessRevision:1,commandId:randomUUID()},options);
});

test('route authenticates before admission actor budget; anonymous never reaches it; actor is fourth argument',async()=>{
 const calls=[];let signedIn=true;
 const handlers=createStudyRoomHandlers({authenticate:async()=>{calls.push('auth');return signedIn?user:null;},
  rateLimit:async(_req,_env,scope,actor)=>{calls.push('rate');assert.equal(scope,'admission');assert.equal(actor.id,user.id);},
  authorizeAdmin:async()=>({authorized:false}),authorizeMember:async()=>({allowed:true,basis:'signed_in'}),
  readCatalog:async()=>catalog,parseJson:async()=>({operation:'status',roomKey:'2',accessRevision:1}),
  admissionRpc:async(_env,{p_command:p})=>{assert.equal(p.actor,user.id);return{ok:true,admission:null};},
  respond:result=>result});
 const request=new Request('https://worker.test/study-room/admission',{method:'POST'});
 assert.deepEqual(await handlers.admission(request,env),{ok:true,admission:null});assert.deepEqual(calls,['auth','rate']);
 calls.length=0;signedIn=false;await rejects(()=>handlers.admission(request,env),'STUDY_ROOM_SIGN_IN_REQUIRED');assert.deepEqual(calls,['auth']);
});

test('actual Worker keeps120 requests per actor and permits100 students behind one school IP',async()=>{
 const previous=globalThis.fetch;let actor;let calls=0;
 globalThis.fetch=async(input,init={})=>{
  const url=new URL(String(input));
  if(url.pathname==='/auth/v1/user')return Response.json({id:actor,is_anonymous:false,app_metadata:{provider:'email'}});
  if(url.pathname==='/rest/v1/rpc/admin_authorization_context')return Response.json({authorized:false,role:'student'});
  if(url.pathname==='/rest/v1/rpc/study_room_catalog_v2')return Response.json(catalog);
  if(url.pathname==='/rest/v1/rpc/study_room_admission_v1'){
   const body=JSON.parse(init.body);assert.equal(body.p_command.actor,actor);assert.equal(body.p_command.operation,'status');calls++;
   return Response.json({ok:true,admission:null});
  }
  assert.fail('Unexpected network endpoint: '+url.pathname);
 };
 const localEnv={...env,ALLOWED_ORIGIN:'https://duediligence.ph',SUPABASE_URL:'https://project.test',SUPABASE_SERVICE_ROLE_KEY:'inert-service',GUEST_USAGE_HMAC_KEY:'inert-rate-key'};
 const request=()=>worker.fetch(new Request('https://worker.test/study-room/admission',{method:'POST',headers:{Origin:'https://duediligence.ph',Authorization:'Bearer local-test-session','CF-Connecting-IP':'203.0.113.230','Content-Type':'application/json'},
  body:JSON.stringify({operation:'status',roomKey:'2',accessRevision:1})}),localEnv);
 try {
  for(let n=0;n<100;n++){actor=randomUUID();assert.equal((await request()).status,200);}
  actor=randomUUID();for(let n=0;n<120;n++)assert.equal((await request()).status,200);
  assert.equal((await request()).status,429);assert.equal(calls,220);
  actor=randomUUID();assert.equal((await request()).status,200,'One exhausted actor must not block another student on the same IP');
 }finally{globalThis.fetch=previous;}
});
