import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

// Actual customer functions with a small DOM/transport fixture, not browser QA.
const source=readFileSync(new URL('../assets/phase2-experience.js',import.meta.url),'utf8');
test('embedded199 checkout uses activation-based captured term copy without backdating to proof time',()=>{
  assert.match(source,/days begin after payment verification and activation/);
  assert.doesNotMatch(source,/payment date shown on your proof determines the 30-day term/);
  assert.ok((source.match(/<p class="dd2-proof-term">\$\{escapeHtml\(termCopy\)\}<\/p>/g)||[]).length>=2);
});
test('late-proof asset versions, service-worker shell and ordered database bundle agree',()=>{
  const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
  const index=read('index.html'),sw=read('service-worker.js'),admin=read('admin/index.html');
  for(const name of ['pricing-checkout-safety','phase2-experience','feature-loader']) {
    const url=index.match(new RegExp('src="(assets/'+name+'\\.js\\?[^\"]+)"'))?.[1]?.replaceAll('&amp;','&');
    assert.ok(url);assert.ok(sw.includes("'/"+url+"'"),name+' shell URL must match the deployed page');
  }
  assert.match(index,/pricing-checkout-safety\.js[^\"]+review=astra-late-offer-20260908-r1/);
  assert.match(index,/phase2-experience\.js[^\"]+review=astra-late-offer-20260908-r1/);
  assert.match(admin,/admin\.js[^\"]+review=astra-late-offer-20260908-r1/);
  assert.match(sw,/duediligence-shell-astra-late-proof-20260908-r1/);
  const contract=read('scripts/astra-release-database-contract.mjs');
  const names=[...contract.match(/ASTRA_MIGRATIONS = Object\.freeze\(\[([\s\S]*?)\]\)/)[1].matchAll(/'([^']+\.sql)'/g)].map(match=>match[1]);
  assert.equal(names.length,16);
  assert.equal(names.at(-1),'20260908105314_astra_internal_payment_fixture_mail_isolation.sql');
  for(const prerequisite of ['20260907120200_astra_payment_invalidation.sql','20260907130002_astra_late_payment_review.sql','20260907133129_astra_149_binding_compatibility.sql']) {
    assert.ok(names.includes(prerequisite));
    assert.ok(names.indexOf(prerequisite)<names.indexOf('20260907143119_astra_late_149_binding_reconciliation.sql'));
  }
  assert.match(index,/phase2-experience\.js[^"]+analytics=astra-analytics-browser-20260908-r1/);
  assert.match(index,/feature-loader\.js[^"]+source=astra-simulator-source-20260908-r1/);
});
function named(name) {
  const start=source.search(new RegExp(`^  (?:async )?function ${name}\\(`,'m'));
  assert.ok(start>=0);
  const next=source.slice(start+1).search(/^  (?:async )?function /m);
  assert.ok(next>=0);
  return source.slice(start,start+next+1);
}
function harness() {
  const nodes=new Map(),calls=[];
  const node=(id)=>{
    if(!nodes.has(id)) nodes.set(id,{id,innerHTML:'',hidden:false,disabled:false,
      addEventListener(type,fn){this[type]=fn;},remove(){nodes.delete(this.id);},
      append(child){nodes.set(child.id,child);},querySelector(){return node('dd2-late-proof-submit');}});
    return nodes.get(id);
  };
  const file=new File(['receipt bytes'],'original-proof.png',{type:'image/png'});
  const draft={userId:'owner-a',plan:{versionId:'old149',name:'Earlier offer',priceCentavos:14900,checkoutOpen:false},
    method:{versionId:'oldbpi'},proof:{file}};
  const state={user:{id:'owner-a'},session:{access_token:'fixture'},latePaymentReviewDraft:draft,
    nativeView:'pricing',nativeViewSequence:1,nativeViewMode:'route',paymentQrReady:false,
    selectedPricingPlan:{versionId:'new199',priceCentavos:19900},selectedPaymentMethod:{versionId:'newbpi'}};
  const context=vm.createContext({state,FormData,
    document:{getElementById:node,createElement:()=>node('new-panel')},
    global:{DueDiligencePhase4:{refreshAccess:async()=>({entitlementEndsAt:'2030-01-01T00:00:00Z'})},toast(){}},
    escapeHtml:String,formatPhp:(v)=>`PHP ${v/100}`,validCommercialProof:()=>null,
    unlimitedFeatureActionContext:()=>null,unlimitedFeatureAccessActive:()=>false,
    nativeWorkerRequest:async(path,options)=>{calls.push({path,form:options.body});return {payment:{offerReviewRequired:true,provisionalAccessExpiresAt:null},message:'Proof saved for review; no provisional or paid access granted.'};},
    setStatus(){},isRegularSubscriptionPlan:()=>false,manilaDate:String,
  });
  vm.runInContext(`${named('renderLatePaymentReview')}\n${named('submitCommercialPayment')}\nglobalThis.render=renderLatePaymentReview;`,context);
  return {state,context,node,calls,draft};
}

test('retained earlier proof submits original IDs without QR reload or new-price rebinding',async()=>{
  const h=harness();h.context.render();
  assert.match(h.node('dd2-late-payment-review').innerHTML,/PHP 149/);
  await h.node('dd2-late-proof-submit').click({preventDefault(){}});
  assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].form.get('planVersionId'),'old149');
  assert.equal(h.calls[0].form.get('paymentChannelVersionId'),'oldbpi');
  assert.equal(h.calls[0].form.get('paymentReviewContract'),'late-offer-review-v1');
  assert.equal(h.calls[0].form.get('proof'),h.draft.proof.file);
  assert.equal(h.calls[0].form.has('paymentDate'),false);
  assert.equal(h.calls[0].form.has('transactionReference'),false);
  assert.match(h.node('dd2-late-payment-review').innerHTML,/Earlier payment needs review/);
  assert.doesNotMatch(h.node('dd2-late-payment-review').innerHTML,/Provisional access through|2030/);
  assert.equal(h.state.latePaymentReviewDraft,null);
});

test('an owner change cannot submit or show another account historical proof draft',async()=>{
  const h=harness();h.context.render();
  const click=h.node('dd2-late-proof-submit').click;
  h.state.user={id:'owner-b'};
  await click({preventDefault(){}});
  assert.equal(h.calls.length,0);
  h.context.render();assert.equal(h.state.latePaymentReviewDraft,null);
});

test('new checkout retains an earlier proof with a still-cacheable older safety helper',()=>{
  const file={name:'old-proof.png'},plan={versionId:'old149',priceCentavos:14900},method={versionId:'oldbpi'};
  const state={user:{id:'owner-a'},selectedPricingPlan:plan,selectedPaymentMethod:method,
    selectedPaymentProof:{file,planVersionId:'old149',paymentMethodVersionId:'oldbpi'}};
  const pricingCheckoutSafety={reconcileProof:(proof,p,m)=>({matched:proof?.planVersionId===p && proof?.paymentMethodVersionId===m})};
  const context=vm.createContext({state,pricingCheckoutSafety});
  vm.runInContext(`${named('captureHistoricalPaymentProof')}\nglobalThis.capture=captureHistoricalPaymentProof;`,context);
  const draft=context.capture();
  assert.equal(draft.proof.file,file);assert.equal(draft.plan.priceCentavos,14900);
  plan.priceCentavos=19900;assert.equal(draft.plan.priceCentavos,14900);
  state.selectedPaymentMethod={versionId:'newbpi'};assert.equal(context.capture(),null);
});
