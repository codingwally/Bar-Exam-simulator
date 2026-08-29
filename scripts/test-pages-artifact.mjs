import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, ['scripts/build-pages-artifact.mjs'], {
  cwd: root,
  stdio: 'pipe',
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
for (const { file, source } of publicTextSources) {
  assert.doesNotMatch(
    source,
    /gemini|generativelanguage(?:\.googleapis\.com)?|generative language/i,
    `${file} must not disclose the private application provider`,
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
  'admin/examination-room-admin.css',
  'admin/examination-room-admin.js',
  'assets/private-beta-session.js',
  'assets/private-beta-landing.css',
  'assets/due-diligence-controls.css',
  'assets/private-beta-landing.js',
  'assets/feature-loader.js',
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
  'assets/icons/navigation/mic.svg',
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
  'assets/payments/bpi-instapay-149.png',
]) {
  assert.ok(files.includes(required), `${required} must ship in the Pages artifact`);
}

assert.ok(files.includes('.nojekyll'));
assert.ok(files.every((file) => !/(^|\/)(content|worker|supabase|scripts|docs)(\/|$)/i.test(file)));
assert.ok(files.every((file) => !/\.(json|sql|mjs|csv)$/i.test(file)));
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
const phase2Config = await readFile(path.join(output, 'assets/phase2-config.js'), 'utf8');
const maintenanceGate = await readFile(path.join(output, 'assets/maintenance-gate.js'), 'utf8');
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
assert.match(index, /id="site-header"[\s\S]*id="site-menu-toggle"[\s\S]*>Home<[\s\S]*>Study Features<[\s\S]*Quick Drills[\s\S]*Doctrine Review[\s\S]*Syllabus-Based Review[\s\S]*Bar Question Practice[\s\S]*Bar Exam Simulation[\s\S]*Analytics[\s\S]*>Profile<[\s\S]*Plans &amp; Pricing[\s\S]*>Support/);
assert.match(index, /id="dd2-header-role-button"[\s\S]*id="dd2-header-exam-button"[\s\S]*>Examination Room<[\s\S]*id="dd-study-room-trigger"[\s\S]*>Study Room<[\s\S]*id="dd2-header-pricing-button"[\s\S]*>Plans &amp; Pricing</);
assert.match(index, /id="dd-study-room-dialog" role="dialog" aria-modal="true"/);
assert.match(index, /You won&rsquo;t have to study alone\./);
assert.match(index, /phase2-experience\.js[^"\n]*pricing=study-room-recovery-20260829-1/);
assert.doesNotMatch(index, /href=["']\/study-room\//i);
assert.match(studyRoomPage, /<title>Study Room — Due Diligence<\/title>/);
assert.match(studyRoomPage, /Admin test room/);
assert.match(studyRoomPage, /camera and microphone remain off/i);
assert.match(studyRoomPage, /assets\/vendor\/livekit-client\.umd\.js\?v=2\.22\.1/);
assert.match(studyRoomPage, /study-room-backgrounds\.js\?v=study-room-mandatory-background-20260829-1/);
assert.match(studyRoomPage, /study-room-live\.js\?v=study-room-four-rooms-20260829-1/);
assert.match(studyRoomLive, /\/admin\/study-room\/access/);
assert.match(studyRoomLive, /\/admin\/study-room\/rooms/);
assert.match(studyRoomLive, /\/admin\/study-room\/join/);
assert.match(studyRoomLive, /\/admin\/study-room\/moderate/);
assert.doesNotMatch(studyRoomLive, /operation:\s*['"]mute['"]/);
assert.match(studyRoomLive, /operation:\s*'rename'/);
assert.doesNotMatch(studyRoomLive, /Mute for room/i);
assert.match(studyRoomLive, /Mute for me/);
assert.match(studyRoomLive, /Block locally/);
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
assert.ok(!files.includes('assets/free-trial-five-daily.js'));
assert.match(phase2Config, /maintenance:\s*Object\.freeze\(\{/);
assert.match(phase2Config, /unlockPath:\s*'\/maintenance\/unlock'/);
assert.match(phase2Config, /statusPath:\s*'\/maintenance\/status'/);
assert.match(phase2Config, /assets\/maintenance-gate\.js\?v=maintenance-lock-20260821-3/);
assert.match(maintenanceGate, /We are improving Due Diligence\./);
assert.match(maintenanceGate, /maintenance\.unlockPath/);
assert.match(maintenanceGate, /maintenance\.statusPath/);
assert.doesNotMatch(maintenanceGate, /\b0802\b/);
assert.match(robots, /Disallow: \/admin\//);
assert.match(robots, /Sitemap: https:\/\/duediligence\.ph\/sitemap\.xml/);
assert.match(sitemap, /<loc>https:\/\/duediligence\.ph\/<\/loc>/);
assert.doesNotMatch(sitemap, /\/admin\//);

console.log('Sanitized GitHub Pages artifact tests passed.');
