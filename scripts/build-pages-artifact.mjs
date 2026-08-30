import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(repositoryRoot, '.pages-dist');
const requireFromWorker = createRequire(path.join(repositoryRoot, 'worker/package.json'));

const BACKGROUND_PROCESSOR_VERSION = '0.7.2';
const MEDIAPIPE_TASKS_VISION_VERSION = '0.10.14';
const MEDIAPIPE_LICENSE_SHA256 = '8707EEF0533987EFC5B155D64761EEB6E20793F50B9BD1A68DAD1CF4719D0ED8';
const MEDIAPIPE_MODEL_FILE = 'selfie_segmenter-float16-2023-05-07.tflite';
const MEDIAPIPE_MODEL_SHA256 = '191AC9529AE506EE0BEEFA6B2C945A172DAB9D07D1E802A290A4E4038226658B';
const MEDIAPIPE_WASM_FILES = Object.freeze({
  'vision_wasm_internal.js': '9440CF0CC0CEA21800E31581EC32AEEDCC5FBF9DF4509796BBC7D3F99E52AB9C',
  'vision_wasm_internal.wasm': 'F82A8E6C05E08A44CC9F9E7EC5F845935BCBB1B1500EBE8C2F4812FB4E2917DC',
  'vision_wasm_nosimd_internal.js': 'ABE9B6FBEAF86FCB53A5EDCE3926C82CCB0619E18FED4D9D9CE561EE7F55E054',
  'vision_wasm_nosimd_internal.wasm': '38B61FEAB2FD7934E05CBE9F68BAA308978A5E3B7F85C1913BB8AE89B8EF8B97',
});

if (path.dirname(outputRoot) !== repositoryRoot || path.basename(outputRoot) !== '.pages-dist') {
  throw new Error('Refusing to build outside the repository .pages-dist directory.');
}

const featurePreviewFiles = Object.freeze([
  'anchor-cases.png',
  'bar-easy.png',
  'bar-feels.png',
  'chairs-cases.png',
  'doctrines.png',
  'mock-bar.png',
  'quorum.png',
  'retainer.png',
  'subject-matter.png',
  'verdict.png',
].map((name) => `assets/feature-previews/${name}`));

const communityIconFiles = Object.freeze([
  'thumbs-up.svg',
  'chat-circle.svg',
  'share-fat.svg',
  'bookmark-simple.svg',
  'camera.svg',
  'image.svg',
  'paper-plane-tilt.svg',
  'magnifying-glass.svg',
  'arrows-clockwise.svg',
  'eye-slash.svg',
  'caret-right.svg',
  'x.svg',
  'dots-three.svg',
  'LICENSE.txt',
].map((name) => `assets/icons/community/${name}`));

const navigationIconFiles = Object.freeze([
  'house.svg',
  'layout-grid.svg',
  'file-text.svg',
  'bookmark.svg',
  'users.svg',
  'bell.svg',
  'book-open.svg',
  'compass.svg',
  'book-open-check.svg',
  'pen-line.svg',
  'timer.svg',
  'circle-user-round.svg',
  'door-open.svg',
  'tag.svg',
  'headphones.svg',
  'hand.svg',
  'mic.svg',
  'monitor-up.svg',
  'pin.svg',
  'settings.svg',
  'LICENSE.txt',
].map((name) => `assets/icons/navigation/${name}`));

const studyRoomPreviewFiles = Object.freeze([
  'assets/study-room-preview.css',
  'assets/study-room-preview.js',
  'assets/study-room-live.css',
  'assets/study-room-live.js',
  'assets/study-room-backgrounds.js',
  'assets/study-room/virtual-background-due-diligence-branded.webp',
  'assets/study-room/dimasalang-library.webp',
  'assets/study-room/participant-2-tropical.webp',
  'assets/study-room/participant-3-bedroom.webp',
  'assets/study-room/participant-4-condo.webp',
]);

const publicFiles = Object.freeze([
  'index.html',
  'study-room/index.html',
  'CNAME',
  'favicon.svg',
  'manifest.webmanifest',
  'robots.txt',
  'sitemap.xml',
  'admin/index.html',
  'admin/admin.css',
  'admin/admin-observatory.css',
  'admin/pricing-editor.css',
  'admin/admin.js',
  'admin/pricing-editor.js',
  'admin/examination-room-admin.css',
  'admin/examination-room-admin.js',
  'admin/subscription-actions-core.js',
  'admin-pulse/index.html',
  'admin-pulse/pulse.css',
  'admin-pulse/google-identity.js',
  'admin-pulse/pulse.js',
  'admin-pulse/manifest.webmanifest',
  '.well-known/assetlinks.json',
  'assets/exam-session-controller.js',
  'assets/phase2-config.js',
  'assets/pricing-renderer.css',
  'assets/pricing-renderer.js',
  'assets/maintenance-gate.js',
  'assets/auth-session-storage.js',
  'assets/private-beta-session.js',
  'assets/private-beta-landing.css',
  'assets/due-diligence-controls.css',
  'assets/quorum-first-shell.css',
  'assets/quorum-first-shell.js',
  'assets/private-beta-landing.js',
  'assets/feature-loader.js',
  'assets/subscription-cta.css',
  'assets/subscription-cta.js',
  'assets/private-workspace.js',
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
  ...featurePreviewFiles,
  ...communityIconFiles,
  ...navigationIconFiles,
  ...studyRoomPreviewFiles,
  'assets/phase2-experience.js',
  'assets/profile-photo.js',
  'assets/pedro-navigation.js',
  'assets/pedro.css',
  'assets/pedro.js',
  'assets/phase2.css',
  'assets/phase3-analytics.js',
  'assets/phase4-experience.js',
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
  'assets/admin/judicial-observatory-bg.png',
  'assets/duediligence-2026.css',
  'assets/duediligence-2026.js',
  'assets/lex-forum.css',
  'assets/lex-forum.js',
  'assets/payments/bpi-instapay-149.png',
  'offline.html',
  'service-worker.js',
]);

const qrHashes = Object.freeze({
  'assets/payments/bpi-instapay-149.png':
    '00DF8567B0068B980D2135BCC74DD2963E8398AE472209E9C84F89F6B0F3C1B9',
});

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

async function copyPublicFile(relativePath) {
  const source = path.join(repositoryRoot, relativePath);
  const destination = path.join(outputRoot, relativePath);
  if (!(await stat(source)).isFile()) {
    throw new Error(`Public artifact source is not a file: ${relativePath}`);
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { force: true });
}

async function requirePackageVersion(packageName, expectedVersion) {
  const packagePath = path.join(
    repositoryRoot,
    'worker/node_modules',
    ...packageName.split('/'),
    'package.json',
  );
  const packageManifest = JSON.parse(await readFile(packagePath, 'utf8'));
  if (packageManifest.version !== expectedVersion) {
    throw new Error(`${packageName} must be pinned to ${expectedVersion}; found ${packageManifest.version || 'unknown'}.`);
  }
}

async function copyVerifiedFile(
  source,
  destination,
  expectedHash,
  label,
  { canonicalizeTextLineEndings = false } = {},
) {
  const sourceContents = await readFile(source);
  const contents = canonicalizeTextLineEndings
    ? Buffer.from(sourceContents.toString('utf8').replace(/\r\n/gu, '\n'), 'utf8')
    : sourceContents;
  const actualHash = sha256(contents);
  if (actualHash !== expectedHash) {
    throw new Error(`${label} failed its pinned SHA-256 verification.`);
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, contents);
}

async function buildStudyRoomBackgroundRuntime() {
  await Promise.all([
    requirePackageVersion('@livekit/track-processors', BACKGROUND_PROCESSOR_VERSION),
    requirePackageVersion('@mediapipe/tasks-vision', MEDIAPIPE_TASKS_VISION_VERSION),
  ]);
  const { build } = requireFromWorker('esbuild');
  const liveKitGlobalShim = {
    name: 'due-diligence-livekit-global',
    setup(context) {
      context.onResolve({ filter: /^livekit-client$/ }, () => ({
        path: 'livekit-client-global',
        namespace: 'due-diligence-livekit-global',
      }));
      context.onLoad({
        filter: /.*/,
        namespace: 'due-diligence-livekit-global',
      }, () => ({
        loader: 'js',
        contents: `
          const fallbackLogger = {
            debug: (...args) => globalThis.console?.debug?.(...args),
            error: (...args) => globalThis.console?.error?.(...args),
            getLevel: () => 2,
            info: (...args) => globalThis.console?.info?.(...args),
            log: (...args) => globalThis.console?.log?.(...args),
            methodFactory: () => (...args) => globalThis.console?.log?.(...args),
            setDefaultLevel: () => {},
            setLevel: () => {},
            trace: (...args) => globalThis.console?.debug?.(...args),
            warn: (...args) => globalThis.console?.warn?.(...args),
          };
          export function getLogger(...args) {
            return globalThis.LivekitClient?.getLogger?.(...args) || fallbackLogger;
          }
        `,
      }));
    },
  };

  await build({
    stdin: {
      contents: `
        import {
          BackgroundProcessor as LiveKitBackgroundProcessor,
          supportsBackgroundProcessors,
          supportsModernBackgroundProcessors,
        } from '@livekit/track-processors';

        const MANDATORY_IMAGE_PATH = '/assets/study-room/virtual-background-due-diligence-branded.webp';
        const POLICY = 'due-diligence-mandatory-virtual-background-no-raw-first-frame';

        function BackgroundProcessor(options = {}, name) {
          const {
            mode: _requestedMode,
            imagePath: _requestedImagePath,
            blurRadius: _requestedBlurRadius,
            backgroundDisabled: _requestedDisabled,
            ...processorOptions
          } = options;
          const processor = LiveKitBackgroundProcessor({
            ...processorOptions,
            mode: 'virtual-background',
            imagePath: MANDATORY_IMAGE_PATH,
          }, name);

          // @livekit/track-processors 0.7.2 normally emits an unsegmented
          // first-frame preview. It is useful for general UX but violates the
          // Study Room's mandatory-background policy. Suppress that preview
          // before LocalVideoTrack.setProcessor initializes the transformer.
          const transformer = processor.transformer;
          const transformFrame = transformer.transform.bind(transformer);
          transformer.transform = (frame, controller) => {
            transformer.isFirstFrame = false;
            return transformFrame(frame, controller);
          };
          transformer.isFirstFrame = false;
          return processor;
        }

        globalThis.LivekitTrackProcessors = Object.freeze({
          VERSION: '${BACKGROUND_PROCESSOR_VERSION}',
          POLICY,
          MANDATORY_IMAGE_PATH,
          BackgroundProcessor,
          supportsBackgroundProcessors,
          supportsModernBackgroundProcessors,
        });
      `,
      resolveDir: path.join(repositoryRoot, 'worker'),
      sourcefile: 'due-diligence-livekit-track-processors-entry.js',
      loader: 'js',
    },
    outfile: path.join(outputRoot, 'assets/vendor/livekit-track-processors.iife.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2022'],
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    plugins: [liveKitGlobalShim],
    banner: {
      js: `/* @livekit/track-processors ${BACKGROUND_PROCESSOR_VERSION}; @mediapipe/tasks-vision ${MEDIAPIPE_TASKS_VISION_VERSION}; Apache-2.0 */`,
    },
  });
}

async function copyStudyRoomBackgroundAssets() {
  const outputVendorRoot = path.join(outputRoot, 'assets/vendor');
  const outputMediaPipeRoot = path.join(outputVendorRoot, 'mediapipe');
  const mediaPipeSourceRoot = path.join(
    repositoryRoot,
    'worker/node_modules/@mediapipe/tasks-vision',
  );
  const modelSource = path.join(
    repositoryRoot,
    'assets/vendor/mediapipe',
    MEDIAPIPE_MODEL_FILE,
  );

  await mkdir(outputMediaPipeRoot, { recursive: true });
  await Promise.all([
    copyVerifiedFile(
      modelSource,
      path.join(outputMediaPipeRoot, MEDIAPIPE_MODEL_FILE),
      MEDIAPIPE_MODEL_SHA256,
      'MediaPipe Selfie Segmenter model',
    ),
    cp(
      path.join(repositoryRoot, 'assets/vendor/mediapipe/PROVENANCE.txt'),
      path.join(outputMediaPipeRoot, 'PROVENANCE.txt'),
      { force: true },
    ),
    cp(
      path.join(repositoryRoot, 'worker/node_modules/@livekit/track-processors/LICENSE'),
      path.join(outputVendorRoot, 'livekit-track-processors.LICENSE.txt'),
      { force: true },
    ),
    copyVerifiedFile(
      path.join(repositoryRoot, 'assets/vendor/mediapipe/LICENSE.txt'),
      path.join(outputMediaPipeRoot, 'LICENSE.txt'),
      MEDIAPIPE_LICENSE_SHA256,
      'MediaPipe Apache-2.0 license',
      { canonicalizeTextLineEndings: true },
    ),
    ...Object.entries(MEDIAPIPE_WASM_FILES).map(([fileName, expectedHash]) => copyVerifiedFile(
      path.join(mediaPipeSourceRoot, 'wasm', fileName),
      path.join(outputMediaPipeRoot, 'wasm', fileName),
      expectedHash,
      `MediaPipe runtime ${fileName}`,
    )),
  ]);
}

async function listFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path.join(directory, entry.name), relative));
    } else if (entry.isFile()) {
      files.push(relative);
    } else {
      throw new Error(`Public artifact contains an unsupported filesystem entry: ${relative}`);
    }
  }
  return files.sort();
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await Promise.all(publicFiles.map(copyPublicFile));
await mkdir(path.join(outputRoot, 'assets/vendor'), { recursive: true });
await Promise.all([
  cp(
    path.join(repositoryRoot, 'worker/node_modules/livekit-client/dist/livekit-client.umd.js'),
    path.join(outputRoot, 'assets/vendor/livekit-client.umd.js'),
    { force: true },
  ),
  cp(
    path.join(repositoryRoot, 'worker/node_modules/livekit-client/LICENSE'),
    path.join(outputRoot, 'assets/vendor/livekit-client.LICENSE.txt'),
    { force: true },
  ),
  buildStudyRoomBackgroundRuntime(),
  copyStudyRoomBackgroundAssets(),
]);
await writeFile(path.join(outputRoot, '.nojekyll'), '', 'utf8');

for (const [relativePath, expectedHash] of Object.entries(qrHashes)) {
  const actualHash = sha256(await readFile(path.join(outputRoot, relativePath)));
  if (actualHash !== expectedHash) {
    throw new Error(`${relativePath} does not match the approved payment QR pixels.`);
  }
}

const files = await listFiles(outputRoot);
const forbidden = files.filter((file) => (
  /(^|\/)(content|worker|supabase|scripts|docs|node_modules|\.git)(\/|$)/i.test(file)
  || (/\.(json|sql|mjs|csv)$/i.test(file) && file !== '.well-known/assetlinks.json')
));
if (forbidden.length) {
  throw new Error(`Private repository material entered the Pages artifact: ${forbidden.join(', ')}`);
}

const textFiles = files.filter((file) => /\.(?:html|js|css|svg|txt|json|webmanifest|xml)$/i.test(file));
const searchableArtifact = (
  await Promise.all(textFiles.map((file) => readFile(path.join(outputRoot, file), 'utf8')))
).join('\n');

if (/content\/question-bank|website-upload\.json|DueDiligenceWebsiteQuestionBank/i.test(searchableArtifact)) {
  throw new Error('The Pages artifact still references the private question corpus.');
}

const corpus = JSON.parse(
  await readFile(path.join(repositoryRoot, 'content/question-bank/website-upload.json'), 'utf8'),
);
for (const record of corpus.records.slice(0, 8)) {
  for (const field of ['Essay Question', 'Suggested Answer', 'Legal Basis / Provision']) {
    const sample = String(record[field] || '').trim().slice(0, 120);
    if (sample.length >= 40 && searchableArtifact.includes(sample)) {
      throw new Error(`Curated ${field} content leaked into the Pages artifact.`);
    }
  }
}

console.log(`Built sanitized GitHub Pages artifact with ${files.length} files.`);
for (const file of files) console.log(`- ${file}`);
