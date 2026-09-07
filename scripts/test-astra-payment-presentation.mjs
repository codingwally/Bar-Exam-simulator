import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { normalizePhase4AdminAction, PaymentValidationError } from '../worker/payment-core.mjs';
import { subscriptionReceiptContent } from '../worker/subscription-receipt.mjs';
import { paymentEmailText } from '../worker/commercial-entry.mjs';

const admin = readFileSync(new URL('../admin/admin.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../worker/index.mjs', import.meta.url), 'utf8');
const paymentId = '44444444-4444-4444-8444-444444444444';
const request = (status, extra = {}) => ({
  action: 'payment_review', targetId: paymentId, reason: 'Reviewed the exact private proof.',
  requestKey: 'astra_payment_review_fixture_1', payload: { status, ...extra },
});
const named = (source, name, indent = '  ') => {
  const start = source.search(new RegExp(`^${indent}(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `${name} exists`);
  const rest = source.slice(start + 1);
  const next = rest.search(new RegExp(`^${indent}(?:async )?function [A-Za-z]`, 'm'));
  assert.ok(next >= 0, `${name} has an identifiable following function`);
  return source.slice(start, start + next + 1);
};
const actionSource = ['requiresDestructiveConfirmation','openAction','confirmAction']
  .map((name) => named(admin,name)).join('\n');
const invalidationCodes=admin.match(/  const PAYMENT_INVALIDATION_NO_CHANGE_CODES = new Set\([\s\S]*?\);/)[0];

function adminHarness() {
  const nodes = new Map();
  const node = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, {
      value:'',checked:false,hidden:false,disabled:false,required:false,textContent:'',
      classList:{add(){},remove(){}},showModal(){},
      closest(){return this.label ||= {hidden:false};},
      addEventListener(type,listener){this.listeners ||= {};this.listeners[type]=listener;},
      set innerHTML(value) {
        this.markup=value;
        if(value.includes('id="action-status"')) {
          const selected=value.match(/<option value="([^"]+)" selected>/)?.[1] || 'approved';
          node('#action-status').value=selected;
        }
      },
      get innerHTML(){return this.markup || '';},
    });
    return nodes.get(selector);
  };
  const messages=[],calls=[];
  let failures=0,keys=0;
  const state={action:null,actionInFlight:false,operational:new Map(),section:'payments'};
  const context=vm.createContext({
    state,$:node,subscriptionActions:null,
    history:{state:null,pushState(){}},location:{href:'https://example.invalid/admin/payments'},
    actionField:(label,id,value='')=>`<label>${label}<input id="${id}" value="${value}"></label>`,
    escapeHtml:String,number:String,localDateTimeValue:()=>'',isoFromLocalInput:(value)=>value ? new Date(value).toISOString() : null,
    uuidKey:()=>`astra_payment_review_key_${++keys}`,toast:(message)=>messages.push(message),
    api:async(path,body)=>{
      calls.push({path,body:JSON.parse(JSON.stringify(body))});
      if(failures-->0) throw new Error('Response lost; decision unconfirmed.');
      return {data:{payment:{id:paymentId,status:body.payload.status},subscriberReceipt:{status:'sent'}}};
    },
    cancelActionDialog(){},renderSection:async()=>{},
  });
  vm.runInContext(`${invalidationCodes}\n${actionSource}\nglobalThis.openPayment=openAction;globalThis.confirmPayment=confirmAction;`,context);
  return {node,state,messages,calls,context,failNext(){failures++;},
    open(status){context.openPayment('payment_review',paymentId,{
      status,entitlementMode:'rolling_days',activationBased:true,requiresVerifiedPaidAt:false,planName:'Owner plan',
    });},
    confirm(){return context.confirmPayment({preventDefault(){}});},
  };
}

test('payment normalization omits verified evidence for nonapproval without parsing invalid date input',()=>{
  for(const status of ['rejected','needs_information']) {
    for(const verifiedPaidAt of [undefined,null,'', 'not-a-date','2026-09-01T00:00:00Z']) {
      assert.deepEqual(normalizePhase4AdminAction(request(status,{verifiedPaidAt})).payload,{status});
    }
  }
  assert.deepEqual(normalizePhase4AdminAction(request('approved')).payload,{status:'approved'});
  assert.throws(()=>normalizePhase4AdminAction({...request('rejected'),reason:'no'}),/Reason/);
});

test('Payments renders three reachable review decisions and truthful activation details',async()=>{
  const buttons=[];
  const context=vm.createContext({
    loadPhase4Operational:async()=>({items:[{id:paymentId,status:'pending',plan_code:'early_access_beta',trusted_amount_php:149,entitlementMode:'rolling_days',durationDays:30,activatedAt:'2026-09-07T06:00:00Z'}]}),
    loadOperational:async()=>({items:[]}),loadAdministratorIdentityDirectory:async()=>({items:[]}),
    heading:()=>'',table:(headers,rows)=>JSON.stringify({headers,rows}),paymentNotificationLabel:()=>({}),
    number:String,escapeHtml:String,dateTime:String,commercialPlanLabel:()=> 'Owner-authored plan',commercialPaymentLabel:String,
    actionButton:(label,action,id,payload)=>{buttons.push({label,action,id,payload});return {value:`<button>${label}</button>`};},
  });
  vm.runInContext(`${named(admin,'renderPayments')}\nglobalThis.render=renderPayments;`,context);
  const html=await context.render({});
  assert.deepEqual(buttons.filter(b=>b.action==='payment_review').map(b=>b.label),['Approve subscription','Needs information','Decline']);
  assert.equal(buttons[0].payload.requiresVerifiedPaidAt,false);
  assert.match(html,/Not recorded/);assert.match(html,/Activated 2026-09-07T06:00:00Z/);
});

test('Decline and Needs information require explicit confirmation and a reason, but no payment timestamp',async()=>{
  for(const status of ['rejected','needs_information']) {
    const h=adminHarness();h.open(status);
    assert.equal(h.node('#action-status').value,status);
    assert.equal(h.node('#action-confirmation').hidden,false);
    assert.equal(h.node('#action-paid-at').closest('label').hidden,true);
    h.node('#action-reason').value='Proof reviewed carefully';
    await h.confirm();assert.equal(h.calls.length,0);
    h.node('#action-confirm-risk').checked=true;
    h.node('#action-reason').value='no';await h.confirm();assert.equal(h.calls.length,0);
    h.node('#action-reason').value='Proof reviewed carefully';
    h.node('#action-paid-at').value='not-a-date';await h.confirm();
    assert.equal(h.calls.length,1);assert.equal(h.calls[0].body.payload.status,status);
    assert.equal('verifiedPaidAt' in h.calls[0].body.payload,false);
  }
});

test('Lost-response retries keep the same key and cannot silently change decision or reason',async()=>{
  const h=adminHarness();h.open('rejected');h.failNext();
  h.node('#action-reason').value='Proof reviewed carefully';h.node('#action-confirm-risk').checked=true;
  await h.confirm();assert.equal(h.calls.length,1);
  h.node('#action-status').value='approved';await h.confirm();assert.equal(h.calls.length,1);
  h.node('#action-status').value='rejected';h.node('#action-reason').value='A different reason';
  await h.confirm();assert.equal(h.calls.length,1);
  h.node('#action-reason').value='Proof reviewed carefully';await h.confirm();assert.equal(h.calls.length,2);
  assert.deepEqual(h.calls[0].body,h.calls[1].body);
});

test('Current approval accepts omitted verified-paid evidence and does not substitute upload time',async()=>{
  const h=adminHarness();h.open('approved');h.node('#action-reason').value='Proof amount and beneficiary verified';
  h.node('#action-confirm-risk').checked=true;await h.confirm();
  assert.equal(h.calls.length,1);assert.equal('verifiedPaidAt' in h.calls[0].body.payload,false);
  assert.match(h.node('#action-warning').textContent,/starts the 30-day purchased term now/);
});

test('Proof invalidation has a separate destructive confirmation and preserves its retry key and reason',async()=>{
  const normalized=normalizePhase4AdminAction({...request('approved',{subscriptionId:paymentId,expiresAt:'2000-01-01'}),action:'payment_invalidate'});
  assert.deepEqual(normalized.payload,{});
  const h=adminHarness();h.context.openPayment('payment_invalidate',paymentId,{studentName:'Fixture',planName:'Plan',amountPhp:149});
  assert.equal(h.node('#action-confirmation').hidden,false);
  assert.match(h.node('#action-warning').textContent,/Independent access, proof, and history are preserved/);
  h.node('#action-reason').value='This proof is invalid';await h.confirm();assert.equal(h.calls.length,0);
  h.node('#action-confirm-risk').checked=true;h.failNext();await h.confirm();
  assert.equal(h.calls.length,1);assert.equal(h.node('#action-reason').readOnly,true);
  assert.match(h.node('#action-warning').textContent,/Outcome not confirmed/);
  h.node('#action-reason').value='Changed text must not alter the original request';await h.confirm();
  assert.equal(h.calls.length,2);assert.deepEqual(h.calls[0].body,h.calls[1].body);
  const source=readFileSync(new URL('../admin/subscription-actions-core.js',import.meta.url),'utf8');
  const module={exports:{}};vm.runInNewContext(source,{module});
  const actions=module.exports.actionsForSubscription({subscription_id:paymentId,subscription_status:'cancelled',subscription_source:'invalidated_payment'},'founder_admin');
  assert.equal(actions.some(action=>action.operation==='restore'),false);
});

test('Customer receipt separates activation, purchased segment, and optional verified payment evidence',()=>{
  const fixture={payment:{
    id:paymentId,planVersionId:paymentId,planCode:'early_access_beta',planName:'Owner-authored name',
    amountCentavos:14900,durationDays:30,entitlementMode:'rolling_days',
    activatedAt:'2026-09-07T06:00:00Z',reviewedAt:'2026-09-07T06:00:00Z',
    purchasedStartsAt:'2026-10-07T06:00:00Z',purchasedEndsAt:'2026-11-06T06:00:00Z',
  },subscription:{startsAt:'2026-08-01T00:00:00Z',expiresAt:'2027-01-01T00:00:00Z'}};
  const result=subscriptionReceiptContent(fixture);
  assert.match(result.text,/Term: 30 days from access start/);
  assert.match(result.text,/Activated: September 7, 2026 at 2:00 PM/);
  assert.match(result.text,/Access begins: October 7, 2026 at 2:00 PM/);
  assert.match(result.text,/Access through: November 6, 2026 at 2:00 PM/);
  assert.doesNotMatch(result.text,/Verified payment time|2027|from verified payment/);
  assert.match(result.html,/Owner-authored name/);
  const withEvidence=subscriptionReceiptContent({...fixture,payment:{...fixture.payment,verifiedPaidAt:'2026-09-06T01:00:00Z'}});
  assert.match(withEvidence.text,/Verified payment time: September 6, 2026 at 9:00 AM/);
  const missing=subscriptionReceiptContent({payment:{id:paymentId,planVersionId:paymentId},subscription:fixture.subscription});
  assert.match(missing.text,/Approved: Not available/);assert.doesNotMatch(missing.text,/2027|August 1/);
});

test('Verifier email explains activation without demanding fabricated payment evidence',()=>{
  const result=paymentEmailText({payment:{id:paymentId,planCode:'early_access_beta',planVersionId:paymentId,amountCentavos:14900,durationDays:30,entitlementMode:'rolling_days',submittedAt:'2026-09-07T06:00:00Z'},proof:{name:'proof.png',type:'image/png',size:10},proofHash:'fixture'});
  assert.match(result,/30 days from access start after approval/);
  assert.match(result,/only if shown on the proof; never infer/);
  assert.doesNotMatch(result,/Enter that timestamp/);
});

test('Manual Admin plan preview uses published names, amounts, and durations without fixed-date assumptions',()=>{
  const elements=[];
  const document={createElement(tag){const element={tag,children:[],append(...children){this.children.push(...children);},addEventListener(){}};elements.push(element);return element;}};
  const state={subscriptionPlans:[{planCode:'future_owner_plan',name:'Owner future name',priceCentavos:24900,durationDays:45}]};
  const context=vm.createContext({state,document,number:String,updateActionContext(){},selectedPlan:()=> 'future_owner_plan',planDisplayName:String});
  vm.runInContext(`${named(admin,'appendPlanOptions')}\n${named(admin,'proposedAccessDescription')}\nglobalThis.append=appendPlanOptions;globalThis.describe=proposedAccessDescription;`,context);
  const container={append(){}};context.append(container,{});
  assert.ok(elements.some(element=>element.textContent==='Owner future name'));
  assert.ok(elements.some(element=>element.textContent==='₱249'));
  assert.ok(elements.some(element=>/45-day published plan/.test(element.textContent || '')));
  assert.match(context.describe('subscription_change',{operation:'complimentary'}),/45-day server-calculated term/);
  assert.match(context.describe('subscription_change',{operation:'replace_plan'}),/preserves an existing finite expiry/);
  assert.doesNotMatch(admin,/EARLY_ACCESS_PLAN|October 1, 2026|2026-10-01/);
});

test('Payment Worker maps safe validation errors and preserves the idempotency key',async()=>{
  const source=named(worker,'handlePhase4AdminAction','');
  const responses=[
    [400,'PAYMENT_EXISTING_ENTITLEMENT_REQUIRES_REVIEW: fixture','PAYMENT_EXISTING_ENTITLEMENT_REQUIRES_REVIEW',409],
    [400,'Payment request is no longer reviewable','PAYMENT_REVIEW_STALE',409],
    [400,'Request key conflict','PAYMENT_REVIEW_CONFLICT',409],
    [400,'verifiedPaidAt cannot be in the future','INVALID_PAYMENT_REVIEW',400],
    [400,'Founder access required','ADMIN_FORBIDDEN',403],
    [500,'Private diagnostic must not escape','PAYMENT_REVIEW_UNCONFIRMED',503],
  ];
  for(const [http,message,expectedCode,expectedStatus] of responses) {
    let captured;
    const context=vm.createContext({
      enforceAdminRateLimit:async()=>{},requireAdministrator:async()=>({id:paymentId}),
      normalizePhase4AdminAction,parseBoundedJson:async()=>request('rejected',{verifiedPaidAt:'not-a-date'}),
      configuredSupabaseUrl:()=>new URL('https://example.invalid'),URL,
      fetch:async(url,options)=>{captured=JSON.parse(options.body);return {ok:false,status:http,json:async()=>({message})};},
      isAuthoritativeRpcRejectionStatus:(status)=>status>=400&&status<500,
      markRpcOutcome:(error)=>error,PaymentValidationError,
    });
    vm.runInContext(`${source}\nglobalThis.handle=handlePhase4AdminAction;`,context);
    await assert.rejects(context.handle({}, {SUPABASE_SERVICE_ROLE_KEY:'fixture'},null,null,{}),(error)=>{
      assert.equal(error.code,expectedCode);assert.equal(error.status,expectedStatus);
      assert.doesNotMatch(error.message,/Private diagnostic/);return true;
    });
    assert.deepEqual(captured.p_payload,{status:'rejected'});
    assert.equal(captured.p_request_key,'astra_payment_review_fixture_1');
  }
});

test('Invalidation Worker sends no client-selected subscription and maps fail-closed states',async()=>{
  for(const [message,code] of [
    ['The subscriber receipt is currently being delivered','PAYMENT_RECEIPT_IN_FLIGHT'],
    ['This payment has an active refund workflow','PAYMENT_REFUND_IN_PROGRESS'],
    ['Only an approved payment can be marked invalid','PAYMENT_INVALIDATION_CONFLICT'],
    ['The linked subscription changed after approval','PAYMENT_INVALIDATION_UNSAFE'],
  ]) {
    let captured,url;
    const context=vm.createContext({
      enforceAdminRateLimit:async()=>{},requireAdministrator:async()=>({id:paymentId}),
      normalizePhase4AdminAction,parseBoundedJson:async()=>({...request('approved',{subscriptionId:'UNTRUSTED'}),action:'payment_invalidate'}),
      configuredSupabaseUrl:()=>new URL('https://example.invalid'),URL,
      fetch:async(target,options)=>{url=String(target);captured=JSON.parse(options.body);return {ok:false,status:400,json:async()=>({message})};},
      isAuthoritativeRpcRejectionStatus:()=>true,markRpcOutcome:(error)=>error,PaymentValidationError,
    });
    vm.runInContext(`${named(worker,'handlePhase4AdminAction','')}\nglobalThis.handle=handlePhase4AdminAction;`,context);
    await assert.rejects(context.handle({}, {SUPABASE_SERVICE_ROLE_KEY:'fixture'},null,null,{}),(error)=>error.code===code&&error.status===409);
    assert.match(url,/phase4_admin_invalidate_payment$/);
    assert.equal('p_payload' in captured,false);assert.equal(captured.p_payment_request_id,paymentId);
    assert.equal(JSON.stringify(captured).includes('UNTRUSTED'),false);
  }
});
