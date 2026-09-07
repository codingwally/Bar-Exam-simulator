import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import worker,{resetAuthenticatedUserTokenCacheForTest} from './index.mjs';

const origin='https://duediligence.ph',supabase='https://astra-support-test.supabase.co';
const userId='71111111-1111-4111-8111-111111111111';
const privateMessage='PRIVATE REPORT: My legal analysis and account details belong in the protected queue.';
const privateAnswer='PRIVATE ANSWER: No. The parties absolutely simulated this agreement.';
const privateUrl='https://example.invalid/private-evidence?reference=PRIVATE_SOURCE';
const verifiedEmail='private-reporter@example.invalid',unverifiedEmail='unverified-reply@example.invalid';
const bankUrl=`${origin}/content/question-bank/astra-support-privacy.json`;
const bank={records:Array.from({length:320},(_,index)=>({
  'Question ID':index===0?'CIV-2024-Q01':`ASTRA-${index}`,Subject:'Civil Law',
  'Essay Question':'Was the simulated contract valid?', 'Suggested Answer':'No. The simulated contract was void.',
  'Legal Basis / Provision':'Civil Code, Article 1409', 'Source URL':'https://elibrary.judiciary.gov.ph/',
}))};
const baseEnv={ALLOWED_ORIGIN:origin,OUTBOUND_EMAIL_MODE:'enabled',PRIVATE_BETA_GATE_ENABLED:'false',
  REQUIRE_AUTHENTICATED_SUBMISSIONS:'true',GUEST_USAGE_HMAC_KEY:'astra-local-support-rate-key-1234567890',
  SUPABASE_URL:supabase,SUPABASE_SERVICE_ROLE_KEY:'local-fixture-service',
  SUPPORT_NOTIFICATION_EMAIL_MODE:'enabled',SUPPORT_NOTIFICATION_EMAIL_FROM:'Due Diligence Support <support@duediligence.ph>',
  SUPPORT_NOTIFICATION_EMAIL_TO:'attacker@example.invalid',RESEND_API_KEY:'local-fixture-resend',WEBSITE_BANK_URL:bankUrl};
const routes=[
  {name:'Support',path:'/support',storage:'/rest/v1/support_requests',body:{category:'technical',message:privateMessage,replyEmail:unverifiedEmail}},
  {name:'Legacy Community report',path:'/forum/reports',storage:'/rest/v1/rpc/forum_create_report',body:{
    targetType:'post',targetId:'72222222-2222-4222-8222-222222222222',category:'misinformation',explanation:privateMessage}},
  {name:'Community report',path:'/quorum/command',storage:'/rest/v1/rpc/forum_quorum_command_v2',body:{operation:'create_report',payload:{
    targetType:'entry',targetId:'qe_aaaaaaaaaaaaaaaaaaaa',category:'misinformation',explanation:privateMessage}}},
  {name:'Answer correction',path:'/corrections',storage:'/rest/v1/question_corrections',body:{questionId:'CIV-2024-Q01',subject:'Civil Law',
    correctionType:'suggested_answer',proposedCorrection:privateAnswer,explanation:privateMessage,sourceUrls:[privateUrl]}},
];
let sequence=0;
function request(path,body){sequence+=1;return new Request(`https://worker.example${path}`,{method:'POST',headers:{Origin:origin,
  Authorization:`Bearer local-support-${sequence}`,'Content-Type':'application/json','CF-Connecting-IP':`198.51.100.${sequence}`},body:JSON.stringify(body)});}

test('committed Support notification configuration remains suppressed in production and staging',()=>{
  for(const name of ['wrangler.toml','wrangler.staging.toml'])assert.match(readFileSync(new URL(name,import.meta.url),'utf8'),/^SUPPORT_NOTIFICATION_EMAIL_MODE\s*=\s*"suppressed"\s*$/m);
});
for(const route of routes)for(const scenario of ['success','storage_failure','provider_failure','provider_network_failure','suppressed']){
  test(`${route.name}: ${scenario} preserves private data and original stored-response status`,async(t)=>{
    resetAuthenticatedUserTokenCacheForTest();const originalFetch=globalThis.fetch,calls=[];
    globalThis.fetch=async(input,init={})=>{
      const target=String(input);
      if(target.endsWith('/auth/v1/user'))return Response.json({id:userId,email:verifiedEmail});
      if(target===bankUrl)return Response.json(bank);
      if(target===supabase+route.storage){calls.push({kind:'storage',body:JSON.parse(init.body)});
        if(scenario==='storage_failure')return Response.json({message:'Controlled storage failure'},{status:503});
        return route.storage.includes('/rpc/')?Response.json({id:'73333333-3333-4333-8333-333333333333',reportId:'qx_bbbbbbbbbbbbbbbbbbbb',status:'pending'}):new Response(null,{status:201});}
      if(target==='https://api.resend.com/emails'){calls.push({kind:'notification',body:JSON.parse(init.body)});
        if(scenario==='provider_network_failure')throw new Error('Controlled provider failure');
        return scenario==='provider_failure'?Response.json({message:'Controlled provider failure'},{status:503}):Response.json({id:'local-notification'});}
      throw new Error(`Unexpected local-only fetch: ${target}`);
    };
    t.after(()=>{globalThis.fetch=originalFetch;resetAuthenticatedUserTokenCacheForTest();});
    const response=await worker.fetch(request(route.path,route.body),{...baseEnv,SUPPORT_NOTIFICATION_EMAIL_MODE:scenario==='suppressed'?'suppressed':'enabled'});
    const payload=await response.json(),mail=calls.filter(x=>x.kind==='notification');
    assert.equal(calls[0]?.kind,'storage');
    if(scenario==='storage_failure'){assert.ok(response.status>=400);assert.equal(payload.ok,false);assert.equal(mail.length,0);return;}
    assert.equal(response.status,201);assert.equal(payload.ok,true);
    assert.ok(JSON.stringify(calls[0].body).includes(privateMessage),'Full report remains in protected storage');
    if(route.path==='/support')assert.equal(calls[0].body.reply_email,unverifiedEmail,'Separate customer reply record is not removed');
    if(scenario==='suppressed'){assert.equal(mail.length,0);return;}
    assert.deepEqual(calls.map(x=>x.kind),['storage','notification']);
    const notification=mail[0].body;assert.deepEqual(notification.to,['support@duediligence.ph']);
    assert.deepEqual(Object.keys(notification).sort(),['from','html','subject','text','to']);
    assert.match(notification.html, /Private internal notification/);
    assert.match(notification.html, /href="https:\/\/duediligence\.ph\/admin\/"/);
    assert.equal(Object.hasOwn(notification,'reply_to'),false);
    assert.match(notification.text,/Authorized review: https:\/\/duediligence\.ph\/admin\//);
    const serialized=JSON.stringify(notification);
    for(const sensitive of [privateMessage,privateAnswer,privateUrl,verifiedEmail,unverifiedEmail,userId,
      route.body.targetId,route.body.payload?.targetId].filter(Boolean))assert.equal(serialized.includes(sensitive),false,`No private notification value: ${sensitive}`);
  });
}

test('unsupported provider public error is neutral while internal model selection remains operational',async(t)=>{
  const originalFetch=globalThis.fetch,models=[];let released=0;
  globalThis.fetch=async(input)=>{const target=String(input);
    if(target.endsWith('/rest/v1/rpc/reserve_guest_grade'))return Response.json({allowed:true,reservation_id:'74444444-4444-4444-8444-444444444444',remaining:2,consumed:0});
    if(target.endsWith('/rest/v1/rpc/release_guest_grade')){released+=1;return Response.json(null);}
    if(target===bankUrl)return Response.json(bank);
    if(target.startsWith('https://generativelanguage.googleapis.com/')){models.push(target);return Response.json({error:{status:'NOT_FOUND',message:'Model not found or not supported for generateContent'}},{status:404});}
    throw new Error(`Unexpected local provider test fetch: ${target}`);
  };
  t.after(()=>{globalThis.fetch=originalFetch;});
  const response=await worker.fetch(new Request('https://worker.example/',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',
    'CF-Connecting-IP':'198.51.100.240','User-Agent':'AstraLocalTest/1','X-Guest-Device-ID':'astra_private_provider_123456789012345',
    'X-Request-ID':'astra_provider_neutral_error_123456789012345'},body:JSON.stringify({questionId:'CIV-2024-Q01',studentAnswer:'No. Under Article1409, an absolutely simulated contract is void. The agreement was simulated; therefore it is void.'})}),
    {...baseEnv,REQUIRE_AUTHENTICATED_SUBMISSIONS:'false',GEMINI_API_KEY:'local-test-key',GEMINI_MODEL:'gemini-local-test',GEMINI_GROUNDING_ENABLED:'false'});
  const payload=await response.json();assert.equal(response.status,503);assert.equal(payload.error.code,'UNSUPPORTED_MODEL');
  assert.equal(payload.error.message,'The assessment service is currently unavailable. Please try again later.');
  assert.doesNotMatch(JSON.stringify(payload),/gemini|google|openai|claude/i);
  assert.ok(models.some(x=>x.includes('gemini-local-test')),'Actual configured model identifier is retained');assert.equal(released,1);
});
