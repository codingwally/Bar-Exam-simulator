/** Actual service/SQL organizer journey with accelerated time. No media, provider or email pass is implied. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile, readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createRehearsalRuntime } from './serve-debate-rehearsal.mjs';
import { timerDisplay } from '../worker/debate-domain.mjs';

export async function runOrganizerRehearsal(runtime, { mode = 'complete' } = {}) {
  if (!['setup','complete'].includes(mode)) throw new Error('Choose setup or complete rehearsal.');
  const began=performance.now(), realStartedAt=new Date().toISOString(), virtualStart=runtime.now(), steps=[], checks=[], exports=[];
  const host=runtime.actors[0], speakers=runtime.actors.slice(1,7), observer=runtime.actors[9], panel=runtime.actors.slice(7,9);
  let eventId=null, matchId=null, nextMatchId=null;
  const check=(name,condition,details={})=>{assert.ok(condition,name);checks.push({name,status:'PASS',...details});};
  const command=async(name,payload={},actor=host,overrides={})=>{
    const before=eventId?await runtime.store.read(eventId):null;
    const result=await runtime.service.execute({actor,eventId,command:name,payload,expectedRevision:before?.revision||0,idempotencyKey:`rehearsal-${randomUUID()}`,...overrides});
    eventId ||= result.event.id;
    steps.push({number:steps.length+1,command:name,actorId:actor.id,matchId:payload.matchId||null,receiptId:result.receipt.id,revision:result.receipt.revision,atMs:runtime.now()});
    return result;
  };
  const reject=async(name,payload,actor,code)=>{await assert.rejects(command(name,payload,actor),error=>error.code===code);checks.push({name:`${name} correctly denied: ${code}`,status:'PASS'});};
  const savedMatch=async()=> (await runtime.store.read(eventId)).matches[matchId];
  const summary=()=>({kind:'ACCELERATED_SOFTWARE_REHEARSAL',mode,storeMode:runtime.manifest.storeMode,sourceHashes:runtime.manifest.sourceHashes,
    eventId,matchId,nextMatchId,realStartedAt,realFinishedAt:new Date().toISOString(),actualDurationMs:Math.round(performance.now()-began),simulatedDurationMs:runtime.now()-virtualStart,
    steps,checks,exports,claims:{actualSql:runtime.manifest.storeMode==='pglite',realMedia:false,physicalDevice:false,endurance90Minutes:false,capacity100:false,realEmailDelivery:false,publicDeployment:false},
    gaps:['No physical or provider media was connected; private media isolation and moving/audio quality remain unverified.','Virtual time is accelerated and is not the required 90-minute endurance run.','No real browser/device matrix or 100-person provider load was performed.','Mail is intentionally disabled; local failed outbox evidence is not provider acceptance or inbox delivery.','Local draft SQL is not hosted Postgres concurrent-connection, applied-migration or deployment evidence.']});
  try {
    await command('create_event',{title:`V3 complete local rehearsal ${new Date().toISOString()}`,description:'Synthetic accounts; actual service and local SQL. No physical microphone, media provider, paid service or real email is exercised.',rehearsal:true});
    for(const actor of runtime.actors.slice(1)){
      const role=speakers.includes(actor)?'debater':panel.includes(actor)?'judge':'observer';
      const invite=await command('create_invite',{role,boundAccountId:actor.id});
      await command('claim_invite',{secret:invite.receipt.result.secret},actor,{expectedRevision:undefined});
      await command('check_in',{},actor);await command('admit_member',{memberId:actor.id});
    }
    const a=await command('confirm_roster',{name:'Affirmative local team',speakerIds:speakers.slice(0,3).map(a=>a.id),captainId:speakers[0].id});
    const n=await command('confirm_roster',{name:'Negative local team',speakerIds:speakers.slice(3).map(a=>a.id),captainId:speakers[3].id});
    const teamIds={affirmative:a.receipt.result.teamId,negative:n.receipt.result.teamId},motionIds=[];
    for(const [index,text] of ['This house would publish open learning materials.','This house would improve access to community libraries.','This house would expand public legal education.','This house would prioritize accessible digital government services.','This house would support school-based civic discussion.'].entries()){
      const motion=await command('add_motion',{title:`Rehearsal motion ${index+1}`,text});motionIds.push(motion.receipt.result.motionId);
    }
    const first=await command('create_match',{title:'Quick Match — six speakers and one neutral judge',motionId:motionIds[0],teamIds,judgeIds:[host.id]});matchId=first.receipt.result.matchId;
    const second=await command('create_match',{title:'Next formal match — three-judge panel',motionId:motionIds[1],teamIds,judgeIds:[host.id,...panel.map(a=>a.id)]});nextMatchId=second.receipt.result.matchId;
    await command('draw_sides',{matchId,swap:false});
    for(const target of [matchId,nextMatchId]){
      const current=(await runtime.store.read(eventId)).matches[target];
      await command('acknowledge_rules',{matchId:target,ruleVersion:current.ruleVersion},speakers[0]);await command('acknowledge_rules',{matchId:target,ruleVersion:current.ruleVersion},speakers[3]);
      for(const actor of speakers)await command('check_in',{matchId:target},actor);
      for(const actor of speakers)await command('record_device_check',{matchId:target,memberId:actor.id,microphone:false,camera:false,accommodation:'Software-only rehearsal: physical microphone/audio not tested. The neutral official records this explicit test accommodation.'});
    }
    const observerBefore=await runtime.service.snapshot({actor:observer,eventId});
    check('Unreleased motions remain private from observer',observerBefore.event.motions.length===0);
    check('Five distinct prepared motions are saved',(await runtime.store.read(eventId)).motions&&Object.keys((await runtime.store.read(eventId)).motions).length===5);
    const ready=await command('readiness',{matchId});check('Readiness reflects explicit software-only accommodations',ready.receipt.result.ready===true);
    if(mode==='setup'){
      const result=summary();result.state='READY_FOR_INTERACTIVE_REHEARSAL';await writeFile(path.join(runtime.outputDir,`setup-${eventId}.json`),JSON.stringify(result,null,2));return result;
    }
    await command('start_match',{matchId});
    await command('send_message',{matchId,channel:'team:affirmative',text:'PRIVATE_REHEARSAL_A_STRATEGY'},speakers[0]);
    await command('send_message',{matchId,channel:'team:negative',text:'PRIVATE_REHEARSAL_N_STRATEGY'},speakers[3]);
    const otherTeam=await runtime.service.snapshot({actor:speakers[3],eventId});check('Opposing team authorized snapshot excludes private team messages',!JSON.stringify(otherTeam).includes('PRIVATE_REHEARSAL_A_STRATEGY'));
    await command('share_evidence',{matchId,title:'Rehearsal evidence reference',description:'Synthetic link text only; the backend must not fetch it.',sourceUrl:'https://example.test/rehearsal-source'},speakers[0]);
    for(;;){
      let match=await savedMatch();if(match.phase==='deliberation')break;
      const stage=match.runOfShow[match.currentStageIndex];check(`${stage.id} loads READY without silently starting`,match.timer?.state==='READY');
      await command('claim_clock',{matchId,timerVersion:match.timer.version});match=await savedMatch();
      await command('timer',{matchId,type:'START',timerVersion:match.timer.version});
      if(stage.id==='stage-01'){
        await runtime.advance(1234);match=await savedMatch();await command('timer',{matchId,type:'PAUSE',timerVersion:match.timer.version});
        const paused=(await savedMatch()).timer.elapsedBeforeRunMs;await runtime.advance(5000);check('Paused clock retains elapsed time',(await savedMatch()).timer.elapsedBeforeRunMs===paused);
        match=await savedMatch();await command('timer',{matchId,type:'RESUME',timerVersion:match.timer.version});
      }
      await runtime.advance(stage.durationMs+1000);match=await savedMatch();check(`${stage.id} crosses zero without auto-advance`,timerDisplay(match.timer,runtime.now()).overtime&&match.timer.state==='RUNNING');
      await command('claim_clock',{matchId,timerVersion:match.timer.version});match=await savedMatch();await command('finish_stage',{matchId,timerVersion:match.timer.version});
      await command('next_stage',{matchId});
    }
    const finished=await savedMatch();check('All14 required speaking stages persisted as completed attempts',finished.attempts.filter(a=>a.stageId.startsWith('stage-')&&a.state==='FINISHED').length===14);
    check('Preparation and closing break are separate completed attempts',finished.attempts.some(a=>a.stageId==='preparation'&&a.state==='FINISHED')&&finished.attempts.some(a=>a.stageId==='closing-break'&&a.state==='FINISHED'));
    const scorecard={speakers:Object.fromEntries(['A1','A2','A3','N1','N2','N3'].map(seat=>[seat,{evidence:seat[0]==='A'?25:20,delivery:30,questioning:15,responding:15}])),closing:{affirmative:15,negative:12}};
    await command('save_draft',{matchId,scorecard,notes:'CONFIDENTIAL_REHEARSAL_JUDGE_DRAFT'});
    const observerDraft=await runtime.service.snapshot({actor:observer,eventId});check('Observer cannot read private judge draft',!JSON.stringify(observerDraft).includes('CONFIDENTIAL_REHEARSAL_JUDGE_DRAFT'));
    await command('open_ballots',{matchId});await reject('submit_ballot',{matchId,scorecard,confirmed:true},speakers[0],'FORBIDDEN');
    await command('submit_ballot',{matchId,scorecard,confirmed:true});await command('close_ballots',{matchId});
    await command('open_poll',{matchId});await reject('vote',{matchId,side:'negative'},host,'FORBIDDEN');
    await command('vote',{matchId,side:'affirmative'},observer);await command('withdraw_vote',{matchId},observer);await command('vote',{matchId,side:'negative'},observer);
    await command('close_poll',{matchId});const poll=await command('publish_poll',{matchId});check('One observer revision/withdrawal preserves one current audience vote',poll.receipt.result.result.validVotes===1&&poll.receipt.result.result.winner==='negative');
    await command('nominate_award',{matchId,nomineeId:'A2',reason:'Clear support and responsive questions in this software fixture.'});
    await command('publish_result',{matchId});await reject('finalize_result',{matchId},host,'CORRECTION_WINDOW_OPEN');
    await runtime.advance(900000);const final=await command('finalize_result',{matchId});const finalMatch=final.event.matches.find(m=>m.id===matchId),result=finalMatch.resultVersions.at(-1);
    check('Official winner is independent from Audience Choice',result.winner==='affirmative'&&poll.receipt.result.result.winner==='negative');check('Finalized Best Debater award comes from judge nomination',result.awards.bestDebater.winners[0]==='A2');
    for(const [kind,format] of [['rules','pdf'],['scorecard','pdf'],['result','pdf'],['event_report','pdf'],['csv','csv'],['certificate','pdf']]){
      const created=await command('create_export',{matchId,kind,format,...(kind==='certificate'?{participantId:speakers[1].id,awardKey:'bestDebater'}:{})});await runtime.service.processOutbox({eventId,limit:20});
      const state=await runtime.store.read(eventId),job=state.jobs[created.receipt.result.jobId];
      if(job.status==='completed'){
        const authorized=await runtime.service.authorizeDownload({actor:host,eventId,downloadId:job.id});const bytes=await readFile(path.resolve(runtime.outputDir,authorized.storageKey));
        check(`${kind} export has real locally generated bytes`,bytes.length>0);
        if(format==='pdf')check(`${kind} output has a real PDF header`,bytes.subarray(0,5).toString()==='%PDF-');
        await assert.rejects(runtime.service.authorizeDownload({actor:observer,eventId,downloadId:job.id}),error=>/FORBIDDEN|NOT_FOUND/.test(error.code));
        exports.push({kind,status:'PASS',filename:authorized.filename,mimeType:authorized.mimeType,storageKey:authorized.storageKey,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),resultVersion:authorized.document.resultVersion||null});
      }else exports.push({kind,status:'UNVERIFIED',error:job.error,jobId:job.id});
    }
    const mail=await command('send_results',{matchId,recipientIds:[observer.id],confirmed:true,previewConfirmed:true});await runtime.service.processOutbox({eventId,limit:20});
    const mailState=await runtime.store.read(eventId);check('Disabled outbound email fails honestly without touching finalized results',mail.receipt.result.jobIds.every(id=>mailState.jobs[id].status==='failed'&&mailState.jobs[id].error==='LOCAL_REHEARSAL_MAIL_DISABLED')&&mailState.matches[matchId].resultVersions.at(-1).state==='FINAL');
    const prior=JSON.stringify((await savedMatch()).resultVersions), priorAttempts=JSON.stringify((await savedMatch()).attempts);
    await command('advance_match',{matchId,nextMatchId});await command('start_match',{matchId:nextMatchId});
    const after=await runtime.store.read(eventId);check('Next formal match starts with independent identity/state and preserves prior result/attempts',after.activeMatchId===nextMatchId&&after.matches[nextMatchId].judgeIds.length===3&&JSON.stringify(after.matches[matchId].resultVersions)===prior&&JSON.stringify(after.matches[matchId].attempts)===priorAttempts);
    const report=summary();report.state=exports.every(e=>e.status==='PASS')?'SOFTWARE_JOURNEY_PASS':'SOFTWARE_JOURNEY_WITH_EXPORT_GAPS';report.finalResult={id:result.id,state:result.state,winner:result.winner,revision:result.revision,awards:result.awards};
    await writeFile(path.join(runtime.outputDir,`organizer-rehearsal-${eventId}.json`),JSON.stringify(report,null,2));
    await runtime.log({kind:'ORGANIZER_REHEARSAL_FINISHED',eventId,matchId,nextMatchId,state:report.state,checks:checks.length,actualDurationMs:report.actualDurationMs,simulatedDurationMs:report.simulatedDurationMs,physicalMedia:false,endurance90Minutes:false});return report;
  }catch(error){const report=summary();report.state='FAILED';report.failure={code:error.code||error.name,message:error.message};await writeFile(path.join(runtime.outputDir,`organizer-rehearsal-failed-${eventId||'setup'}.json`),JSON.stringify(report,null,2));throw error;}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const option=name=>process.argv.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3);
  const runtime=await createRehearsalRuntime({storeMode:option('store')||'pglite',outputDir:option('output')});
  try{const report=await runOrganizerRehearsal(runtime);process.stdout.write(`${JSON.stringify({state:report.state,eventId:report.eventId,matchId:report.matchId,nextMatchId:report.nextMatchId,steps:report.steps.length,checks:report.checks.length,exports:report.exports.map(e=>({kind:e.kind,status:e.status})),actualDurationMs:report.actualDurationMs,simulatedDurationMs:report.simulatedDurationMs,outputDir:runtime.outputDir,storeMode:runtime.manifest.storeMode,physicalMedia:false,endurance90Minutes:false})}\n`);if(report.state!=='SOFTWARE_JOURNEY_PASS')process.exitCode=1;}finally{await runtime.close();}
}
