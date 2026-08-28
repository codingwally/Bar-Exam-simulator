import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeLiveKitServiceUrl,
  releaseSmokeRoomName,
} from './livekit-credentials-smoke.mjs';

test('normalizes a browser LiveKit URL to its HTTPS service origin', () => {
  assert.equal(
    normalizeLiveKitServiceUrl('wss://due-diligence.livekit.cloud/path?token=discarded'),
    'https://due-diligence.livekit.cloud',
  );
});

test('rejects an insecure LiveKit release endpoint', () => {
  assert.throws(
    () => normalizeLiveKitServiceUrl('ws://due-diligence.livekit.cloud'),
    /must use wss:\/\/ or https:\/\//u,
  );
});

test('builds an isolated and bounded release smoke room name', () => {
  assert.equal(
    releaseSmokeRoomName({ target: 'staging', runId: '123456789', runAttempt: '2' }),
    'dd-sr-smoke-staging-123456789-2',
  );
  assert.throws(
    () => releaseSmokeRoomName({ target: 'preview', runId: '123', runAttempt: '1' }),
    /staging or production/u,
  );
});
