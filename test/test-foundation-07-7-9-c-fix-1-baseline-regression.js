import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const repo = await readFile(new URL('../src/repositories/testDataBindingRepository.js', import.meta.url), 'utf8');
assert.match(repo, /FROM test_data_bindings/);
assert.doesNotMatch(repo, /FROM endpoint_test_data_bindings/);
assert.doesNotMatch(repo, /INSERT INTO endpoint_test_data_bindings/);
assert.match(repo, /scope_type AS scopeType/);

const planner = await readFile(new URL('../src/intelligence/testDataPlanner.js', import.meta.url), 'utf8');
assert.match(planner, /qagent\.test-data-planner\.v1\.2\.2/);
assert.match(planner, /testDataPolicy\.js/);

const context = await readFile(new URL('../src/intelligence/catalogContextBuilder.js', import.meta.url), 'utf8');
assert.match(context, /qagent\.catalog-context-builder\.v1\.8/);
assert.match(context, /scopeType/);

await access(new URL('../migrations/0014_foundation_07_7_8_c_scope_hierarchy.sql', import.meta.url));
const migration14 = await readFile(new URL('../migrations/0014_foundation_07_7_8_c_scope_hierarchy.sql', import.meta.url), 'utf8');
assert.match(migration14, /CREATE TABLE test_data_bindings/);
assert.match(migration14, /scope_type TEXT NOT NULL CHECK \(scope_type IN \('PROJECT', 'ENVIRONMENT', 'ENDPOINT'\)\)/);

const resultsClient = await readFile(new URL('../src/services/resultsReadClient.js', import.meta.url), 'utf8');
assert.match(resultsClient, /RESULTS_SERVICE/);
const router = await readFile(new URL('../src/routing/gatewayRouter.js', import.meta.url), 'utf8');
assert.match(router, /consoleAutomationSummaryGet/);

console.log('Foundation 07.7.9-C FIX-1 baseline regression guard: PASS');
