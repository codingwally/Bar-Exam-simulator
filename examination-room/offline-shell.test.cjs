const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const serviceWorker = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const studentScript = fs.readFileSync(path.join(__dirname, 'student.js'), 'utf8');
const studentHtml = fs.readFileSync(path.join(__dirname, 'student.html'), 'utf8');
const offlineGradingHtml = fs.readFileSync(path.join(__dirname, 'offline-grading.html'), 'utf8');
const { CACHE_VERSION, SHELL } = vm.runInNewContext(
  `${serviceWorker}\n;({ CACHE_VERSION, SHELL });`,
  { self: { addEventListener() {} } },
  { timeout: 1000 },
);
const origin = 'https://offline-shell.test';

function localAssets(html, pagePath) {
  return [...html.matchAll(/<(script|link)\b[^>]*>/gi)].flatMap(([tag, name]) => {
    if (name.toLowerCase() === 'link' && !/\brel=["']stylesheet["']/i.test(tag)) return [];
    const attribute = tag.match(/\b(?:src|href)=["']([^"']+)["']/i);
    if (!attribute) return [];
    const url = new URL(attribute[1].replaceAll('&amp;', '&'), `${origin}${pagePath}`);
    return url.origin === origin ? [url] : [];
  });
}

test('student registers the Examination Room service worker without blocking startup', () => {
  const registration = studentScript.match(/navigator\.serviceWorker\.register\('([^']+)'\)\s*\.catch\(function \(\) \{/);
  assert.ok(registration, 'service-worker registration handles rejection without blocking startup');
  const registrationUrl = new URL(registration[1], origin);
  assert.equal(registrationUrl.origin, origin);
  assert.equal(registrationUrl.pathname, '/service-worker.js');
  assert.deepEqual([...registrationUrl.searchParams.keys()], ['v']);
  const version = registrationUrl.searchParams.get('v');
  assert.ok(version, 'registration has a cache-busting version');
  assert.equal(CACHE_VERSION, `duediligence-shell-${version}`);
  const studentAsset = localAssets(studentHtml, '/examination-room/student.html')
    .find((url) => url.pathname === '/examination-room/student.js');
  assert.ok(studentAsset, 'the student entry script is loaded by its page');
  assert.equal(studentAsset.searchParams.get('v'), version);
});

test('service worker precaches the complete local student examination shell', () => {
  const pages = [
    {
      pathname: '/examination-room/student.html',
      html: studentHtml,
      requiredAssets: [
        '/examination-room/student.css',
        '/examination-room/view-models.js',
        '/examination-room/api.js',
        '/examination-room/media-capture.js',
        '/examination-room/student.js',
        '/assets/phase2-config.js',
        '/assets/private-beta-session.js',
      ],
    },
    {
      pathname: '/examination-room/offline-grading.html',
      html: offlineGradingHtml,
      requiredAssets: [
        '/examination-room/offline-grading.css',
        '/examination-room/offline-grading-core.js',
        '/examination-room/offline-grading.js',
      ],
    },
  ];
  for (const page of pages) {
    assert.ok(SHELL.includes(page.pathname), `${page.pathname} is cached`);
    const assets = localAssets(page.html, page.pathname);
    for (const requiredAsset of page.requiredAssets) {
      assert.ok(assets.some((url) => url.pathname === requiredAsset), `${requiredAsset} is loaded by ${page.pathname}`);
    }
    for (const url of assets) {
      const asset = url.pathname + url.search;
      assert.ok(SHELL.includes(asset), `${page.pathname} loads the exact cached asset ${asset}`);
      assert.ok(fs.existsSync(path.join(root, url.pathname)), `${asset} exists locally`);
    }
  }
});

test('offline student navigation uses its cached application before the generic offline page', () => {
  const examBranch = serviceWorker.indexOf("if ([EXAMINATION_STUDENT_SHELL, EXAMINATION_OFFLINE_GRADER].includes(url.pathname))");
  const cachedStudent = serviceWorker.indexOf('caches.match(url.pathname)', examBranch);
  const genericOffline = serviceWorker.indexOf("caches.match('/offline.html')", cachedStudent);

  assert.ok(examBranch >= 0);
  assert.ok(cachedStudent > examBranch);
  assert.ok(genericOffline > cachedStudent);
});
