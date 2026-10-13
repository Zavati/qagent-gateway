import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getObservationUiCapabilities } from '../src/ui/observationUiCapabilitiesClient.js';
test('A05 missing binding refuses without public fallback', async () => { await assert.rejects(() => getObservationUiCapabilities({}, 'UI_CAPTURE'), { code: 'UI_SERVICE_UNAVAILABLE' }); });
test('A05 old consumer HTML/404 is diagnosed', async () => { await assert.rejects(() => getObservationUiCapabilities({ OBSERVATION_SERVICE: { fetch: async () => new Response('old', { status: 404 }) } }, 'UI_CAPTURE'), { code: 'UI_SERVICE_CAPABILITY_MISMATCH' }); });
test('A06 failed consumer has bounded timeout, no live fallback', async () => { await assert.rejects(() => getObservationUiCapabilities({ OBSERVATION_SERVICE: { fetch: () => new Promise(() => { }) } }, 'UI_CAPTURE'), { code: 'UI_SERVICE_TIMEOUT' }); });
test('A05 oversized consumer response is bounded', async () => { await assert.rejects(() => getObservationUiCapabilities({ OBSERVATION_SERVICE: { fetch: async () => new Response('x'.repeat(20000), { headers: { 'content-type': 'application/json' } }) } }, 'UI_CAPTURE'), { code: 'UI_SERVICE_CAPABILITY_MISMATCH' }); });
