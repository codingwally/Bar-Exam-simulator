import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedReleaseSha = process.env.GITHUB_SHA
  || '0123456789abcdef0123456789abcdef01234567';
execFileSync(process.execPath, ['scripts/build-pages-artifact.mjs'], {
  cwd: root,
  stdio: 'pipe',
  env: { ...process.env, GITHUB_SHA: expectedReleaseSha },
});

async function walk(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path.join(directory, entry.name), relative));
    else files.push(relative);
  }
  return files.sort();
}

const output = path.join(root, '.pages-dist');
const files = await walk(output);
const publicTextFiles = files.filter((file) => /\.(?:css|html|js|svg|txt|webmanifest|xml)$/i.test(file));
const publicTextSources = await Promise.all(publicTextFiles.map(async (file) => ({
  file,
  source: await readFile(path.join(output, file), 'utf8'),
})));
const syntheticQaPayload = /(?:SYNTHETIC-UI-(?:\d{1,3}|\$\{)|Synthetic interface-test question\s+(?:\d{1,3}|\$\{)|Mock Permit\s+(?:\d{1,3}|\$\{)|local-preview-token|Synthetic UI QA Harness|__DD_BAR_FORECAST_SYNTHETIC_QA__)/iu;
for (const { file, source } of publicTextSources) {
  assert.doesNotMatch(
    source,
    /gemini|generativelanguage(?:\.googleapis\.com)?|generative language/i,
    `${file} must not disclose the private application provider`,
  );
  assert.doesNotMatch(
    source,
    syntheticQaPayload,
    `${file} must not contain the synthetic Forecast QA harness or its mock content`,
  );
}
for (const required of [
  'index.html',
  'study-room/index.html',
  'CNAME',
  'favicon.svg',
  'manifest.webmanifest',
  'robots.txt',
  'sitemap.xml',
  'admin/index.html',
  'admin/pricing-editor.css',
  'admin/pricing-editor.js',
  'admin/examination-room-admin.css',
  'admin/examination-room-admin.js',
  'admin-pulse/index.html',
  'admin-pulse/pulse.css',
  'admin-pulse/google-identity.js',
  'admin-pulse/pulse.js',
  'admin-pulse/manifest.webmanifest',
  '.well-known/assetlinks.json',
  '.well-known/duediligence-release.txt',
  'assets/private-beta-session.js',
  'assets/pricing-renderer.css',
  'assets/pricing-renderer.js',
  'assets/private-beta-landing.css',
  'assets/due-diligence-controls.css',
  'assets/private-beta-landing.js',
  'assets/feature-loader.js',
  'assets/bar-forecast.css',
  'assets/bar-forecast.js',
  'assets/bar-forecast/forecast-workspace-preview.webp',
  'assets/subscription-cta.css',
  'assets/subscription-cta.js',
  'assets/study-room-preview.css',
  'assets/study-room-preview.js',
  'assets/study-room-live.css',
  'assets/study-room-live.js',
  'assets/study-room-backgrounds.js',
  'assets/vendor/livekit-client.umd.js',
  'assets/vendor/livekit-client.LICENSE.txt',
  'assets/vendor/livekit-track-processors.iife.js',
  'assets/vendor/livekit-track-processors.LICENSE.txt',
  'assets/vendor/mediapipe/LICENSE.txt',
  'assets/vendor/mediapipe/PROVENANCE.txt',
  'assets/vendor/mediapipe/selfie_segmenter-float16-2023-05-07.tflite',
  'assets/vendor/mediapipe/wasm/vision_wasm_internal.js',
  'assets/vendor/mediapipe/wasm/vision_wasm_internal.wasm',
  'assets/vendor/mediapipe/wasm/vision_wasm_nosimd_internal.js',
  'assets/vendor/mediapipe/wasm/vision_wasm_nosimd_internal.wasm',
  'assets/study-room/virtual-background-due-diligence-branded.webp',
  'assets/study-room/dimasalang-library.webp',
  'assets/study-room/participant-2-tropical.webp',
  'assets/study-room/participant-3-bedroom.webp',
  'assets/study-room/participant-4-condo.webp',
  'assets/maintenance-gate.js',
  'assets/quorum-first-shell.css',
  'assets/quorum-first-shell.js',
  'assets/profile-photo.js',
  'assets/pedro-navigation.js',
  'assets/pedro.css',
  'assets/pedro.js',
  'assets/private-workspace.js',
  'assets/icons/navigation/door-open.svg',
  'assets/icons/community/image.svg',
  'assets/icons/navigation/hand.svg',
  'assets/icons/navigation/mic.svg',
  'assets/icons/navigation/monitor-up.svg',
  'assets/icons/navigation/pin.svg',
  'assets/icons/navigation/settings.svg',
  'assets/icons/navigation/circle-check.svg',
  'assets/icons/navigation/cloud-upload.svg',
  'assets/icons/navigation/shield-check.svg',
  'examination-room/index.html',
  'examination-room/professor.css',
  'examination-room/professor.js',
  'examination-room/student.html',
  'examination-room/student.css',
  'examination-room/media-capture.js',
  'examination-room/student.js',
  'examination-room/offline-grading.html',
  'examination-room/offline-grading.css',
  'examination-room/offline-grading.js',
  'examination-room/offline-grading-core.js',
  'examination-room/api.js',
  'examination-room/view-models.js',
  'assets/feature-previews/mock-bar.png',
  'assets/feature-previews/subject-matter.png',
  'assets/feature-previews/verdict.png',
  'assets/icons/community/thumbs-up.svg',
  'assets/icons/community/chat-circle.svg',
  'assets/icons/community/share-fat.svg',
  'assets/icons/community/bookmark-simple.svg',
  'assets/icons/community/LICENSE.txt',
  'assets/examinations.css',
  'assets/examinations.js',
  'assets/auxiliary-writing-diagnostics.css',
  'assets/auxiliary-writing-diagnostics.js',
  'assets/study-workspace.css',
  'assets/study-workspace.js',
  'assets/brand/apple-touch-icon.png',
  'assets/brand/favicon.ico',
  'assets/brand/favicon-16.png',
  'assets/brand/favicon-32.png',
  'assets/brand/favicon-48.png',
  'assets/brand/icon-192.png',
  'assets/brand/icon-512.png',
  'assets/brand/logo1-master.png',
  'assets/brand/social-card-1200x630.png',
  'assets/brand/signin-intro.mp4',
  'assets/payments/bpi-instapay-199-qr.png',
  'assets/payments/bpi-mark.png',
  'assets/pricing-checkout-safety.js',
]) {
  assert.ok(files.includes(required), `${required} must ship in the Pages artifact`);
}
assert.equal(
  await readFile(path.join(output, '.well-known/duediligence-release.txt'), 'utf8'),
  `${expectedReleaseSha}\n`,
  'The served release marker must contain only the exact build SHA and one newline.',
);
assert.ok(
  !files.includes('assets/payments/bpi-instapay-149.png'),
  'the retired 149-peso QR must not remain publicly addressable in the Pages artifact',
);

assert.ok(files.includes('.nojekyll'));
assert.ok(files.every((file) => !/(^|\/)(content|worker|supabase|scripts|docs)(\/|$)/i.test(file)));
assert.ok(files.every((file) => !/local-preview|qa-harness|synthetic-ui/i.test(file)));
assert.equal(files.includes('content/duediligence-2026/bar-forecast.json'), false);
assert.ok(files.every((file) => (
  !/\.(json|sql|mjs|csv)$/i.test(file) || file === '.well-known/assetlinks.json'
)));
assert.ok(files.every((file) => !/^assets\/private-beta\/.+\.(?:avif|webp|jpe?g)$/i.test(file)));
assert.ok(!files.includes('assets/phase2-law-library.jpg'));

const index = await readFile(path.join(output, 'index.html'), 'utf8');
const studyRoomPage = await readFile(path.join(output, 'study-room/index.html'), 'utf8');
const studyRoomLive = await readFile(path.join(output, 'assets/study-room-live.js'), 'utf8');
const studyRoomBackgrounds = await readFile(path.join(output, 'assets/study-room-backgrounds.js'), 'utf8');
const liveKitClient = await readFile(path.join(output, 'assets/vendor/livekit-client.umd.js'));
const liveKitTrackProcessors = await readFile(
  path.join(output, 'assets/vendor/livekit-track-processors.iife.js'),
  'utf8',
);
const mediaPipeModel = await readFile(
  path.join(output, 'assets/vendor/mediapipe/selfie_segmenter-float16-2023-05-07.tflite'),
);
const mediaPipeLicense = await readFile(
  path.join(output, 'assets/vendor/mediapipe/LICENSE.txt'),
  'utf8',
);
const mediaPipeProvenance = await readFile(
  path.join(output, 'assets/vendor/mediapipe/PROVENANCE.txt'),
  'utf8',
);
const expectedMediaPipeRuntimeHashes = Object.freeze({
  'vision_wasm_internal.js': '9440CF0CC0CEA21800E31581EC32AEEDCC5FBF9DF4509796BBC7D3F99E52AB9C',
  'vision_wasm_internal.wasm': 'F82A8E6C05E08A44CC9F9E7EC5F845935BCBB1B1500EBE8C2F4812FB4E2917DC',
  'vision_wasm_nosimd_internal.js': 'ABE9B6FBEAF86FCB53A5EDCE3926C82CCB0619E18FED4D9D9CE561EE7F55E054',
  'vision_wasm_nosimd_internal.wasm': '38B61FEAB2FD7934E05CBE9F68BAA308978A5E3B7F85C1913BB8AE89B8EF8B97',
});
const examinations = await readFile(path.join(output, 'assets/examinations.js'), 'utf8');
const featureLoader = await readFile(path.join(output, 'assets/feature-loader.js'), 'utf8');
const barForecast = await readFile(path.join(output, 'assets/bar-forecast.js'), 'utf8');
const barForecastStyles = await readFile(path.join(output, 'assets/bar-forecast.css'), 'utf8');
const barForecastPreview = await readFile(
  path.join(output, 'assets/bar-forecast/forecast-workspace-preview.webp'),
);
const phase2Config = await readFile(path.join(output, 'assets/phase2-config.js'), 'utf8');
const maintenanceGate = await readFile(path.join(output, 'assets/maintenance-gate.js'), 'utf8');
const adminPulsePage = await readFile(path.join(output, 'admin-pulse/index.html'), 'utf8');
const adminPulseStyles = await readFile(path.join(output, 'admin-pulse/pulse.css'), 'utf8');
const adminPulseGoogleIdentity = await readFile(
  path.join(output, 'admin-pulse/google-identity.js'),
  'utf8',
);
const adminPulseScript = await readFile(path.join(output, 'admin-pulse/pulse.js'), 'utf8');
const adminPulseManifest = JSON.parse(
  await readFile(path.join(output, 'admin-pulse/manifest.webmanifest'), 'utf8'),
);
const adminPulseAssetLinks = JSON.parse(
  await readFile(path.join(output, '.well-known/assetlinks.json'), 'utf8'),
);
const serviceWorker = await readFile(path.join(output, 'service-worker.js'), 'utf8');
const robots = await readFile(path.join(output, 'robots.txt'), 'utf8');
const sitemap = await readFile(path.join(output, 'sitemap.xml'), 'utf8');
const publicBackendUrl = 'https://duediligence-api.wallyesteban1993.workers.dev';
assert.ok(index.includes(publicBackendUrl));
assert.ok(phase2Config.includes(publicBackendUrl));
assert.doesNotMatch(`${index}\n${phase2Config}`, /gemini|generativelanguage/i);
assert.doesNotMatch(index, /content\/question-bank|website-upload\.json|DueDiligenceWebsiteQuestionBank/i);
assert.doesNotMatch(index, /const BAR_QUESTIONS\s*=\s*\{/);
assert.doesNotMatch(index, /PH Bar Essay Trainer|Advanced Pro Repository/);
assert.match(index, /<title>Due Diligence — Philippine Bar Exam Simulator<\/title>/);
assert.match(index, /<html lang="en-PH">/);
assert.match(index, /id="private-beta-landing"/);
assert.match(index, /<h1 id="pb-pillars-title">Prepare with purpose\.<\/h1>/);
assert.equal((index.match(/id="site-header"/g) || []).length, 1);
assert.match(index, /id="site-header"[\s\S]*id="site-menu-toggle"[\s\S]*>Home<[\s\S]*>Study Features<[\s\S]*2026 Bar Forecast[\s\S]*Quick Drills[\s\S]*Doctrine Review[\s\S]*Syllabus-Based Review[\s\S]*Bar Question Practice[\s\S]*Bar Exam Simulation[\s\S]*Analytics[\s\S]*>Profile<[\s\S]*Plans &amp; Pricing[\s\S]*>Support/);
assert.match(index, /id="dd2-header-role-button"[\s\S]*id="dd2-header-exam-button"[\s\S]*>Examination Room<[\s\S]*id="dd-study-room-trigger"[\s\S]*>Study Room<[\s\S]*id="dd2-header-pricing-button"[\s\S]*>Plans &amp; Pricing</);
assert.match(index, /id="dd-study-room-dialog" role="dialog" aria-modal="true"/);
assert.match(index, /You won&rsquo;t have to study alone\./);
assert.match(index, /phase2\.css[^"\n]*pricing=regular-checkout-r1[\s\S]*pricing-renderer\.js\?v=regular-checkout-r1[\s\S]*pricing-checkout-safety\.js\?v=regular-checkout-r1[\s\S]*phase2-experience\.js[^"\n]*pricing=regular-checkout-r1/);
assert.doesNotMatch(index, /20260914|2026-09-14/u, 'Public cache keys must not reveal the private cutover date.');
assert.doesNotMatch(index, /href=["']\/study-room\//i);
assert.match(studyRoomPage, /<title>Study Room — Due Diligence<\/title>/);
assert.match(studyRoomPage, /Authorized testers can join open rooms/);
assert.match(studyRoomPage, /camera and microphone remain off/i);
assert.match(studyRoomPage, /assets\/vendor\/livekit-client\.umd\.js\?v=2\.22\.1/);
assert.match(studyRoomPage, /study-room-backgrounds\.js\?v=study-room-optional-background-20260829-1/);
assert.match(studyRoomPage, /study-room-live\.js\?v=study-room-meet-layout-20260831-5/);
assert.match(studyRoomPage, /id="sr-toggle-backdrop"[\s\S]*aria-pressed="false"/u);
assert.match(studyRoomLive, /\/study-room\/access/);
assert.match(studyRoomLive, /\/study-room\/rooms/);
assert.match(studyRoomLive, /\/study-room\/join/);
assert.match(studyRoomLive, /\/study-room\/moderate/);
assert.match(studyRoomLive, /\/admin\/study-room\/rooms/);
assert.doesNotMatch(studyRoomLive, /operation:\s*['"]mute['"]/);
assert.match(studyRoomLive, /operation:\s*'rename'/);
assert.doesNotMatch(studyRoomLive, /Mute for room/i);
assert.match(studyRoomLive, /Mute for me/);
assert.match(studyRoomLive, /Block locally/);
assert.match(studyRoomLive, /width:\s*640,[\s\S]*height:\s*360,[\s\S]*frameRate:\s*15/u);
assert.match(studyRoomLive, /maxBitrate:\s*450_000,[\s\S]*simulcast:\s*true/u);
assert.match(studyRoomLive, /dynacast:\s*true/u);
assert.match(studyRoomLive, /registerTextStreamHandler/u);
assert.match(studyRoomLive, /setScreenShareEnabled/u);
assert.match(studyRoomLive, /dd\.studyRoom\.handRaised/u);
assert.match(studyRoomLive, /function toggleBackdrop\(/u);
assert.match(studyRoomBackgrounds, /DueDiligenceStudyRoomMandatoryBackground/);
assert.match(studyRoomBackgrounds, /virtual-background-due-diligence-branded\.webp/);
assert.match(studyRoomBackgrounds, /mode:\s*'virtual-background'/);
assert.doesNotMatch(studyRoomBackgrounds, /background-blur|switchTo\(|mode:\s*'disabled'/);
assert.match(
  studyRoomBackgrounds,
  /track = await liveKit\.createLocalVideoTrack[\s\S]*await track\.setProcessor\(processor, true\)[\s\S]*assertProcessedTrack\(track, processor\)[\s\S]*publication = await participant\.publishTrack/,
  'the raw camera track must be processed and verified before publication',
);
assert.match(liveKitTrackProcessors, /LivekitTrackProcessors/);
assert.match(liveKitTrackProcessors, /0\.7\.2/);
assert.match(liveKitTrackProcessors, /due-diligence-mandatory-virtual-background-no-raw-first-frame/);
assert.match(liveKitTrackProcessors, /virtual-background-due-diligence-branded\.webp/);
assert.doesNotMatch(liveKitTrackProcessors, /require\s*\(/);
assert.ok(
  Buffer.byteLength(liveKitTrackProcessors) > 100_000,
  'the locally bundled official background processor must not be an empty shim',
);
assert.ok(
  Buffer.byteLength(liveKitTrackProcessors) < 1_000_000,
  'the background bundle must reuse the existing LiveKit global instead of bundling a second client',
);
{
  class TestImage {
    set src(value) {
      this.currentSrc = value;
      this.onload?.();
    }
  }
  class TestVideoFrame {}
  const runtimeContext = {
    console: {
      debug() {},
      error() {},
      info() {},
      log() {},
      warn() {},
    },
    createImageBitmap: async () => ({}),
    document: {
      createElement: () => ({ getContext: () => ({}) }),
    },
    HTMLCanvasElement: class TestCanvas {},
    Image: TestImage,
    MediaStreamTrackGenerator: class TestTrackGenerator {},
    MediaStreamTrackProcessor: class TestTrackProcessor {},
    OffscreenCanvas: class TestOffscreenCanvas {},
    VideoFrame: TestVideoFrame,
  };
  vm.runInNewContext(liveKitTrackProcessors, runtimeContext, {
    filename: 'livekit-track-processors.iife.js',
  });
  const effects = runtimeContext.LivekitTrackProcessors;
  const mandatoryProcessor = effects.BackgroundProcessor({
    mode: 'disabled',
    imagePath: '/unapproved-background.webp',
    blurRadius: 100,
    backgroundDisabled: true,
  });
  assert.equal(mandatoryProcessor.mode, 'virtual-background');
  assert.equal(
    mandatoryProcessor.transformer.options.imagePath,
    '/assets/study-room/virtual-background-due-diligence-branded.webp',
  );
  assert.equal(mandatoryProcessor.transformer.options.blurRadius, undefined);
  assert.equal(mandatoryProcessor.transformer.options.backgroundDisabled, undefined);
  assert.equal(mandatoryProcessor.transformer.isFirstFrame, false);
  mandatoryProcessor.transformer.isFirstFrame = true;
  const invalidFrame = { closed: false, close() { this.closed = true; } };
  await mandatoryProcessor.transformer.transform(invalidFrame, { enqueue() {} });
  assert.equal(mandatoryProcessor.transformer.isFirstFrame, false);
  assert.equal(invalidFrame.closed, true);
}
assert.equal(mediaPipeModel.byteLength, 249_537);
assert.equal(
  createHash('sha256').update(mediaPipeModel).digest('hex').toUpperCase(),
  '191AC9529AE506EE0BEEFA6B2C945A172DAB9D07D1E802A290A4E4038226658B',
);
assert.match(mediaPipeLicense, /Apache License[\s\S]*Version 2\.0, January 2004/);
assert.equal(
  createHash('sha256').update(mediaPipeLicense).digest('hex').toUpperCase(),
  '8707EEF0533987EFC5B155D64761EEB6E20793F50B9BD1A68DAD1CF4719D0ED8',
);
assert.match(mediaPipeProvenance, /google-ai-edge\/mediapipe\/blob\/v0\.10\.14\/LICENSE/);
for (const [fileName, expectedHash] of Object.entries(expectedMediaPipeRuntimeHashes)) {
  const runtime = await readFile(path.join(output, 'assets/vendor/mediapipe/wasm', fileName));
  assert.equal(
    createHash('sha256').update(runtime).digest('hex').toUpperCase(),
    expectedHash,
    `${fileName} must match the pinned MediaPipe 0.10.14 runtime`,
  );
}
assert.doesNotMatch(`${studyRoomPage}\n${studyRoomLive}`, /LIVEKIT_API_SECRET|LIVEKIT_API_KEY\s*=|participant_token[^\n]*(?:localStorage|sessionStorage)|roomAdmin/);
assert.ok(liveKitClient.byteLength > 500_000, 'the reviewed LiveKit browser client must ship locally');
assert.ok(!files.includes('assets/study-room/virtual-background-due-diligence-office.webp'));
assert.doesNotMatch(index, />The Academy<|>The Commons<|>BarBound<|>The Docket</);
assert.doesNotMatch(index, /class="pb-chamber-index"/);
assert.doesNotMatch(index, /class="pb-pillar-grid"|class="pb-pillar-card"/);
assert.doesNotMatch(index, /class="pb-hero"|class="pb-summary"|class="pb-rail"/);
assert.doesNotMatch(index, /A platform to express|Practice the reasoning\. Refine the writing\.|Explore Due Diligence|Learn How It Works|Pause Motion/i);
assert.match(index, /id="authenticated-app-shell" hidden inert/);
assert.match(index, /loadProtectedQuestion/);
assert.match(index, /Authentication is required before an examination question is displayed/);
assert.match(examinations, /data-exam-setup=[\s\S]*Review &amp; Begin/);
assert.match(examinations, /const isBarFeels = state\.setup\.track === 'bar_feels';[\s\S]*\? 'strict'/);
assert.doesNotMatch(examinations, /function subjectWritingGuide\(|Writing approach|Take a clear position on the legal issue/i);
assert.match(examinations, /Improved model response/);
assert.doesNotMatch(examinations, /id="dd-upload-timer"/);
assert.doesNotMatch(featureLoader, /assets\/free-trial-five-daily\.js/);
assert.match(featureLoader, /'subject-matter': '#subject-matter'/);
assert.match(featureLoader, /forecast:\s*Object\.freeze\([\s\S]*assets\/bar-forecast\.css[\s\S]*assets\/bar-forecast\.js/);
assert.match(barForecast, /const ENDPOINT = '\/admin\/dd2026\/bar-forecast'/);
assert.match(barForecast, /operation:\s*'status'/);
assert.match(barForecast, /operation:\s*'accept', version:\s*CONSENT_VERSION/);
assert.match(barForecast, /operation:\s*'start', subject:\s*subjectName/);
assert.match(barForecast, /operation:\s*'submit'[\s\S]*answers:\s*submittedAnswers/);
for (const exactNoticeCopy of [
  'Notice & Disclaimer',
  'This pilot program is designed to train issue-spotting skills using question sets aligned with historical exam patterns, cases associated with the 2026 Bar Chairperson, and independent legal research.',
  'By proceeding, you acknowledge and agree to the following:',
  'Not Official Material',
  'All forecast questions and study content are independently created. They are not official Supreme Court questions, leaks, or confidential materials.',
  'No Warranties or Guarantees',
  'Topic predictions are instructional aids, not an exact science. Predicted topics do not guarantee or promise appearance in the 2026 Bar Examinations.',
  'Educational Use Only',
  'Suggested answers, feedback, and scoring may contain errors and do not constitute legal advice.',
  'Authoritative Sources',
  'Official Supreme Court Bar bulletins, syllabi, statutes, rules, and controlling jurisprudence remain the sole authoritative references.',
]) assert.ok(barForecast.includes(exactNoticeCopy), `public artifact must preserve exact notice copy: ${exactNoticeCopy}`);
assert.match(barForecast, /const accept = makeButton\('I Understand & Agree'/);
assert.match(barForecast, /const decline = makeButton\('Decline'\)/);
assert.match(barForecast, /decline\.addEventListener\('click', \(\) => closeForecast\(\)\)/);
assert.match(barForecast, /actions\.append\(decline, accept\)/);
assert.doesNotMatch(barForecast, /bar-forecast-disclaimer|Accept and choose a subject|Return to preview/);
assert.match(barForecast, /const MAX_ANSWER_CHARACTERS = 6000/);
assert.match(barForecast, /editor\.contentEditable = 'true'/);
assert.match(barForecast, /state\.flaggedQuestions = new Set\(\)/);
assert.match(barForecast, /renderPromptHighlights/);
assert.doesNotMatch(barForecast, /AI-assisted|editorial indicators/i);
assert.match(barForecast, /appendResultSection\(body, 'Question', state\.questions\[index\]\?\.prompt/);
assert.doesNotMatch(barForecast, /\bALAC\b|legal[_ ]basis|controlling[_ ]doctrine|prediction score|transparent rubric/i);
assert.doesNotMatch(barForecast, /localStorage|sessionStorage/);
assert.match(barForecastStyles, /@keyframes bf26-radiate/);
assert.match(barForecastStyles, /\.bf26-page\s*\{[\s\S]*height:\s*100dvh/);
assert.match(barForecastStyles, /\.bf26-editor-toolbar/);
assert.ok(files.includes('assets/icons/navigation/flag.svg'));
assert.equal(
  createHash('sha256').update(barForecastPreview).digest('hex').toUpperCase(),
  '8D3A68F68AD252EB88AB8DABDFF2A57DC41EF603A7948A79917EF73DE9BBD4B3',
  'the approved Forecast workspace preview must remain unchanged',
);
assert.ok(!files.includes('assets/free-trial-five-daily.js'));
assert.match(phase2Config, /maintenance:\s*Object\.freeze\(\{/);
assert.match(phase2Config, /unlockPath:\s*'\/maintenance\/unlock'/);
assert.match(phase2Config, /statusPath:\s*'\/maintenance\/status'/);
assert.match(phase2Config, /assets\/maintenance-gate\.js\?v=maintenance-lock-20260821-3/);
assert.match(maintenanceGate, /We are improving Due Diligence\./);
assert.match(maintenanceGate, /maintenance\.unlockPath/);
assert.match(maintenanceGate, /maintenance\.statusPath/);
assert.doesNotMatch(maintenanceGate, /\b0802\b/);
assert.match(adminPulsePage, /<title>Due Diligence Pulse<\/title>/);
assert.match(adminPulsePage, /name="apple-mobile-web-app-capable" content="yes"/);
assert.match(adminPulsePage, /name="apple-mobile-web-app-title" content="DD Pulse"/);
assert.match(adminPulsePage, /id="google-button-label"/);
assert.match(adminPulsePage, /Share[\s\S]*Add to Home Screen[\s\S]*open[\s\S]*Select your Google email[\s\S]*Enable important notifications/i);
assert.match(adminPulsePage, /id="google-signin-container"/);
assert.match(adminPulsePage, /id="google-signin-fallback"[\s\S]*id="google-button-label"[\s\S]*Continue with Google in browser/);
assert.match(adminPulsePage, /src="https:\/\/accounts\.google\.com\/gsi\/client" async defer/);
assert.match(adminPulsePage, /google-identity\.js\?v=admin-pulse-google-id-token-20260830-1/);
assert.doesNotMatch(adminPulsePage, /auth-cookie-storage\.js/);
assert.match(adminPulsePage, /New subscriber/);
assert.match(adminPulsePage, /Home Wall post/);
assert.match(adminPulsePage, /Support request/);
assert.match(adminPulsePage, /Currently using Due Diligence/);
assert.match(adminPulsePage, /New sign-in/);
assert.doesNotMatch(adminPulsePage, /type=["']password["']|two-factor|2FA|access code|device approval/i);
assert.match(adminPulseStyles, /backdrop-filter:\s*blur\(18px\)/);
assert.match(adminPulseStyles, /--pulse-gold:\s*#d2aa55/);
assert.match(adminPulseScript, /\/admin\/session/);
assert.match(adminPulseScript, /\/admin\/pulse\/snapshot/);
assert.match(adminPulseScript, /\/admin\/pulse\/push-subscription/);
assert.match(adminPulseScript, /ADMIN_PULSE_CALLBACK_PATH = '\/admin-pulse\/\?auth=callback'/);
assert.match(adminPulseScript, /GOOGLE_WEB_CLIENT_ID = '601805240028-vgnu9dv3egpm7n6musiveujfp3c9vs5q\.apps\.googleusercontent\.com'/);
assert.match(adminPulseScript, /google\.accounts\.id\.initialize\(\{/);
assert.match(adminPulseScript, /google\.accounts\.id\.renderButton\(container/);
assert.match(adminPulseScript, /ux_mode:\s*'popup'/);
assert.match(adminPulseScript, /itp_support:\s*true/);
assert.match(adminPulseScript, /callback:\s*\(response\) => handleGoogleCredential\(response, nonce\.raw, generation\)/);
assert.match(adminPulseScript, /state\.googleNonce\?\.raw !== rawNonce[\s\S]*state\.googleNonce = null/);
assert.match(adminPulseScript, /async function startGoogleOAuthFallback\(\)/);
assert.match(adminPulseScript, /if \(isIosDevice\(\)\)[\s\S]*direct button inside the installed iPhone app/);
assert.match(adminPulseScript, /signInWithOAuth\(\{/);
assert.match(adminPulseScript, /#enable-notifications'\)\.addEventListener\('click', enableImportantNotifications\)/);
assert.match(adminPulseScript, /Notification\.requestPermission\(\)/);
assert.match(
  adminPulseScript,
  /async function enableImportantNotifications\(\)[\s\S]*if \(isIosDevice\(\) && !isStandaloneApp\(\)\)[\s\S]*return;[\s\S]*Notification\.requestPermission\(\)/,
);
assert.match(adminPulseScript, /userVisibleOnly:\s*true/);
assert.match(adminPulseScript, /operation:\s*'remove'/);
assert.match(adminPulseScript, /subscription\.unsubscribe\(\)/);
assert.match(adminPulseScript, /function isIosDevice\(\)/);
assert.match(adminPulseScript, /function isStandaloneApp\(\)/);
assert.match(adminPulseScript, /const showSafariGuide = isIosSafariBrowser\(\);[\s\S]*#ios-install-guide'\)\.hidden = !showSafariGuide/);
assert.match(adminPulseScript, /add Pulse to the Home Screen and open the installed app/i);
assert.doesNotMatch(adminPulseScript, /service_role|SUPABASE_SERVICE_ROLE|VAPID_PRIVATE|google-services\.json/i);
assert.match(adminPulseGoogleIdentity, /cryptoProvider\.getRandomValues\(bytes\)/);
assert.match(adminPulseGoogleIdentity, /cryptoProvider\.subtle\.digest\('SHA-256', encoded\)/);
assert.match(adminPulseGoogleIdentity, /signInWithIdToken\(\{/);
assert.match(adminPulseGoogleIdentity, /nonce:\s*rawNonce/);
assert.doesNotMatch(
  `${adminPulsePage}\n${adminPulseScript}\n${adminPulseGoogleIdentity}`,
  /document\.cookie|auth-cookie-storage|DueDiligenceAdminPulseAuthStorage/,
);

{
  const identityContext = {
    TextEncoder,
    Uint8Array,
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    crypto: webcrypto,
  };
  identityContext.window = identityContext;
  vm.runInNewContext(adminPulseGoogleIdentity, identityContext, {
    filename: 'admin-pulse/google-identity.js',
  });
  const identity = identityContext.DueDiligenceAdminPulseGoogleIdentity;
  const nonce = await identity.createNonce();
  assert.equal(Buffer.from(nonce.raw, 'base64').byteLength, 32);
  assert.match(nonce.hashed, /^[a-f0-9]{64}$/);
  assert.equal(
    nonce.hashed,
    createHash('sha256').update(nonce.raw).digest('hex'),
    'GIS receives the SHA-256 nonce while Supabase receives the raw nonce',
  );

  let idTokenCall = null;
  const expectedResult = { data: { session: { access_token: 'test-session' } }, error: null };
  const exchangeResult = await identity.exchangeCredential({
    client: {
      auth: {
        async signInWithIdToken(value) {
          idTokenCall = value;
          return expectedResult;
        },
      },
    },
    credential: 'google-id-token',
    rawNonce: nonce.raw,
  });
  assert.equal(exchangeResult, expectedResult);
  assert.equal(idTokenCall.provider, 'google');
  assert.equal(idTokenCall.token, 'google-id-token');
  assert.equal(idTokenCall.nonce, nonce.raw);
  await assert.rejects(
    identity.exchangeCredential({ client: { auth: {} }, credential: '', rawNonce: '' }),
    /not configured|verifiable credential/,
  );
  assert.equal(identity.shouldOfferRedirectFallback({ isIos: false, gisAvailable: false }), true);
  assert.equal(identity.shouldOfferRedirectFallback({ isIos: true, gisAvailable: false }), false);
  assert.equal(identity.shouldOfferRedirectFallback({ isIos: false, gisAvailable: true }), false);
}
assert.equal(adminPulseManifest.id, '/admin-pulse/');
assert.equal(adminPulseManifest.start_url, '/admin-pulse/');
assert.equal(adminPulseManifest.scope, '/admin-pulse/');
assert.equal(adminPulseManifest.display, 'standalone');
assert.equal(adminPulseManifest.icons.some((icon) => icon.sizes === '512x512'), true);
assert.equal(adminPulseAssetLinks[0]?.target?.package_name, 'ph.duediligence.admin');
assert.deepEqual(adminPulseAssetLinks[0]?.relation, ['delegate_permission/common.handle_all_urls']);
assert.match(
  adminPulseAssetLinks[0]?.target?.sha256_cert_fingerprints?.[0] || '',
  /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/,
);
assert.doesNotMatch(
  JSON.stringify(adminPulseAssetLinks),
  /REPLACE_WITH_THE_RELEASE_SIGNING_CERTIFICATE_SHA256_FINGERPRINT/,
);
for (const eventType of ['new_subscriber', 'home_wall_post', 'support_request', 'user_active', 'new_sign_in']) {
  assert.match(serviceWorker, new RegExp(`${eventType}: Object\\.freeze`));
}
assert.match(serviceWorker, /self\.addEventListener\('push'/);
assert.match(serviceWorker, /self\.addEventListener\('notificationclick'/);
assert.match(serviceWorker, /ADMIN_PULSE_NOTIFICATION_OPENED/);
assert.match(serviceWorker, /payload\?\.data[\s\S]*data\.eventType[\s\S]*data\.eventId/);
assert.doesNotMatch(serviceWorker, /payload\?\.(?:title|body|summary|email|name)/);
assert.match(robots, /Disallow: \/admin\//);
assert.match(robots, /Disallow: \/admin-pulse\//);
assert.match(robots, /Sitemap: https:\/\/duediligence\.ph\/sitemap\.xml/);
assert.match(sitemap, /<loc>https:\/\/duediligence\.ph\/<\/loc>/);
assert.doesNotMatch(sitemap, /\/admin\//);

console.log('Sanitized GitHub Pages artifact tests passed.');
