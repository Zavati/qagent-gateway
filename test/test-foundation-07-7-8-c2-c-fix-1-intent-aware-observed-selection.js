import assert from 'node:assert/strict';
import { applyTestDataPlannerV1, TEST_DATA_PLANNER_VERSION } from '../src/intelligence/testDataPlanner.js';

const context = {
  endpoint: { endpointId: 'cep_leave', normalizedPath: '/leave/leave-requests', method: 'POST' },
  environments: [{ environmentId: 'env_stg', name: 'STG' }],
  schemas: [{
    direction: 'REQUEST',
    schema: {
      type: 'object',
      required: ['empNumber', 'leaveTypeId', 'fromDate', 'toDate', 'duration', 'comment'],
      properties: {
        empNumber: { type: 'integer' },
        leaveTypeId: { type: 'integer' },
        fromDate: { type: 'string', format: 'date' },
        toDate: { type: 'string', format: 'date' },
        duration: { type: 'object', required: ['type'], properties: { type: { type: 'string' } } },
        comment: { type: 'string' },
      },
    },
  }],
  testData: { configuredBindings: [] },
};

const observedTestData = {
  contractVersion: 'qagent.observed-test-data-metadata.v1',
  values: [
    ['$.empNumber', 'INTEGER'],
    ['$.leaveTypeId', 'INTEGER'],
    ['$.duration.type', 'STRING'],
  ].map(([selector, valueType]) => ({
    environmentId: 'env_stg', target: 'BODY', selector, valueType,
    observationCount: 5, successCount: 5, clientErrorCount: 0, serverErrorCount: 0,
    lastSeenAt: '2026-08-31T02:00:00.000Z',
  })),
  samples: [{
    environmentId: 'env_stg', encoding: 'JSON', observationCount: 5, successCount: 5,
    clientErrorCount: 0, serverErrorCount: 0, lastSeenAt: '2026-08-31T02:00:00.000Z',
    selectors: [
      { target: 'BODY', selector: '$.empNumber', valueType: 'INTEGER' },
      { target: 'BODY', selector: '$.leaveTypeId', valueType: 'INTEGER' },
      { target: 'BODY', selector: '$.duration.type', valueType: 'STRING' },
      { target: 'BODY', selector: '$.fromDate', valueType: 'STRING' },
      { target: 'BODY', selector: '$.toDate', valueType: 'STRING' },
      { target: 'BODY', selector: '$.comment', valueType: 'STRING' },
    ],
  }],
};

function scenario(id, {
  title,
  objective,
  category = 'NEGATIVE',
  status = 400,
  body = {},
  needsData = true,
} = {}) {
  return {
    scenarioId: id,
    title: title || id,
    objective: objective || title || id,
    category,
    priority: 'HIGH', confidence: 'MEDIUM',
    grounding: { level: 'INFERRED', rationale: [], evidenceRefs: [], schemaRefs: [] },
    preconditions: [], authRequirement: 'NONE',
    request: { pathParams: {}, query: {}, headers: {}, body },
    assertions: [{ type: 'STATUS', expectedStatusCodes: [status] }],
    extract: [],
    automationHints: {
      needsData,
      reviewRequired: false,
      reasons: needsData ? ['O formato do body é modelado, mas seus valores precisam ser fornecidos por massa de teste controlada.'] : [],
    },
  };
}

function planOne(scenarioValue, contextValue = context, options = {}) {
  return applyTestDataPlannerV1(
    { title: 'Intent-aware', objective: 'Intent-aware', assumptions: [], scenarios: [scenarioValue] },
    contextValue,
    { observedTestData, ...options },
  );
}

assert.equal(TEST_DATA_PLANNER_VERSION, 'qagent.test-data-planner.v1.2.2');

// Invalid reference: keep a valid observed baseline for unrelated fields, but never reuse
// a successful leaveTypeId for the field whose intent is explicitly "non-existent".
const invalidLeaveType = planOne(scenario('invalid_leave_type', {
  title: 'Requisição de licença com tipo de licença inválido',
  objective: 'Verificar erro ao enviar um tipo de licença que não existe.',
  category: 'DATA_VARIATION',
  body: {
    empNumber: 7,
    leaveTypeId: 999999,
    fromDate: '2026-09-01',
    toDate: '2026-09-02',
    duration: { type: 'full_day' },
    comment: 'negative test',
  },
}));
const invalidLeaveBindings = invalidLeaveType.plansByScenarioId.invalid_leave_type.bindings;
assert.equal(invalidLeaveBindings.some((item) => item.selector === '$.leaveTypeId'), false);
assert.equal(invalidLeaveBindings.find((item) => item.selector === '$.empNumber')?.source, 'OBSERVED');
assert.equal(invalidLeaveBindings.find((item) => item.selector === '$.duration.type')?.source, 'OBSERVED');
assert.equal(invalidLeaveBindings.find((item) => item.selector === '$.comment')?.source, 'GENERATED');
assert.equal(invalidLeaveType.diagnostics.intentAwareScenarioCount, 1);
assert.equal(invalidLeaveType.diagnostics.intentTargetCount, 1);
assert.equal(invalidLeaveType.diagnostics.intentBlockedObservedCount, 1);
assert.equal(invalidLeaveType.diagnostics.intentBlockedGeneratedCount, 0);
assert.ok(invalidLeaveType.diagnostics.intentTargets.includes('invalid_leave_type:BODY:$.leaveTypeId:INVALID_REFERENCE'));
assert.equal(invalidLeaveType.output.scenarios[0].automationHints.needsData, true);
assert.equal(invalidLeaveType.output.scenarios[0].automationHints.reviewRequired, true);
assert.match(invalidLeaveType.output.scenarios[0].automationHints.reasons.join(' '), /Scenario Intent.*leaveTypeId.*INVALID_REFERENCE/i);

// Direct selector naming is deterministic too: an invalid empNumber must not reuse a successful employee reference.
const invalidEmpNumber = planOne(scenario('invalid_emp_number', {
  title: 'Requisição com empNumber inválido',
  objective: 'Validar erro para empNumber inválido.',
  body: {
    empNumber: 999999, leaveTypeId: 3, fromDate: '2026-09-01', toDate: '2026-09-02',
    duration: { type: 'full_day' }, comment: 'negative employee',
  },
}));
assert.equal(invalidEmpNumber.plansByScenarioId.invalid_emp_number.bindings.some((item) => item.selector === '$.empNumber'), false);
assert.equal(invalidEmpNumber.plansByScenarioId.invalid_emp_number.bindings.find((item) => item.selector === '$.leaveTypeId')?.source, 'OBSERVED');
assert.ok(invalidEmpNumber.diagnostics.intentTargets.includes('invalid_emp_number:BODY:$.empNumber:INVALID_VALUE'));

// Invalid dates: normal DATE generators would create valid values and contradict the scenario.
// They are therefore blocked until a real mutation strategy exists. Valid unrelated baseline remains.
const invalidDates = planOne(scenario('invalid_dates', {
  title: 'Requisição de licença com datas inválidas',
  objective: 'Validar erro quando as datas de início e fim são inválidas.',
  body: {
    empNumber: 7,
    leaveTypeId: 3,
    fromDate: '2026-09-01',
    toDate: '2026-09-02',
    duration: { type: 'full_day' },
    comment: 'negative dates',
  },
}));
const invalidDateBindings = invalidDates.plansByScenarioId.invalid_dates.bindings;
assert.equal(invalidDateBindings.some((item) => item.selector === '$.fromDate'), false);
assert.equal(invalidDateBindings.some((item) => item.selector === '$.toDate'), false);
assert.equal(invalidDateBindings.find((item) => item.selector === '$.leaveTypeId')?.source, 'OBSERVED');
assert.equal(invalidDateBindings.find((item) => item.selector === '$.duration.type')?.source, 'OBSERVED');
assert.equal(invalidDates.diagnostics.intentTargetCount, 2);
assert.equal(invalidDates.diagnostics.intentBlockedGeneratedCount, 2);
assert.ok(invalidDates.diagnostics.intentTargets.includes('invalid_dates:BODY:$.fromDate:INVALID_VALUE'));
assert.ok(invalidDates.diagnostics.intentTargets.includes('invalid_dates:BODY:$.toDate:INVALID_VALUE'));

// "Missing required fields" is domain-level wording, not a license-type mutation. Do not
// falsely classify leaveTypeId merely because the request itself is a leave request.
const missingFields = planOne(scenario('missing_fields', {
  title: 'Requisição de licença com campos obrigatórios ausentes',
  objective: 'Verificar o comportamento sem os campos obrigatórios.',
  body: {},
  needsData: false,
}));
assert.equal(missingFields.diagnostics.intentTargetCount, 1);
assert.ok(missingFields.diagnostics.intentTargets.includes('missing_fields:BODY:$:OMIT_REQUIRED_FIELDS'));
assert.equal(missingFields.diagnostics.intentBlockedAutoBindingCount, 0);
assert.equal(missingFields.diagnostics.intentTargets.some((item) => item.includes('$.leaveTypeId')), false);

// Authorization isolation: body stays valid and can use OBSERVED; only authentication is absent.
const unauthorized = planOne(scenario('unauthorized', {
  title: 'Requisição de licença sem autenticação',
  objective: 'Validar que a API bloqueia uma requisição válida sem autenticação.',
  category: 'AUTHORIZATION',
  status: 401,
  body: {
    empNumber: 7,
    leaveTypeId: 3,
    fromDate: '2026-09-01',
    toDate: '2026-09-02',
    duration: { type: 'full_day' },
    comment: 'valid baseline',
  },
}));
const unauthorizedBindings = unauthorized.plansByScenarioId.unauthorized.bindings;
assert.equal(unauthorized.diagnostics.intentTargetCount, 0);
assert.equal(unauthorizedBindings.find((item) => item.selector === '$.leaveTypeId')?.source, 'OBSERVED');
assert.equal(unauthorizedBindings.find((item) => item.selector === '$.duration.type')?.source, 'OBSERVED');

// Explicit QA configuration remains authoritative. It may intentionally provide the invalid
// value, so the planner must not second-guess it with the heuristic intent guard.
const explicitContext = structuredClone(context);
explicitContext.testData.configuredBindings = [{
  bindingId: 'tdb_invalid_leave', scopeType: 'ENDPOINT', environmentId: 'env_stg',
  target: 'BODY', selector: '$.leaveTypeId', sourceType: 'FIXED', valueType: 'INTEGER',
  generatorKind: null, generatorConfig: {}, secretConfigured: false,
}];
const explicitInvalid = planOne(scenario('explicit_invalid_leave', {
  title: 'Tipo de licença inválido',
  objective: 'Enviar leaveTypeId inexistente configurado pelo QA.',
  body: { leaveTypeId: 999999 },
}), explicitContext);
assert.equal(explicitInvalid.plansByScenarioId.explicit_invalid_leave.bindings.find((item) => item.selector === '$.leaveTypeId')?.source, 'FIXED');
assert.equal(explicitInvalid.diagnostics.intentBlockedAutoBindingCount, 0);


// Production reproduction: intent detection must run even when Semantic Guard left
// needsData=false and the AI returned an empty body. The intent target itself makes
// the scenario eligible for deterministic planning/review.
const employeeContext = {
  endpoint: { endpointId: 'cep_employee_create', normalizedPath: '/pim/employees', method: 'POST' },
  environments: [{ environmentId: 'env_stg', name: 'STG' }],
  schemas: [{
    direction: 'REQUEST',
    schema: {
      type: 'object',
      required: ['employeeId', 'firstName', 'lastName'],
      properties: {
        employeeId: { type: 'string' },
        firstName: { type: 'string' },
        middleName: { type: 'string' },
        lastName: { type: 'string' },
      },
    },
  }],
  testData: { configuredBindings: [] },
};
const employeeObserved = {
  contractVersion: 'qagent.observed-test-data-metadata.v1',
  values: [
    ['$.employeeId', 'STRING'], ['$.firstName', 'STRING'], ['$.middleName', 'STRING'], ['$.lastName', 'STRING'],
  ].flatMap(([selector, valueType]) => [1, 2].map((n) => ({
    environmentId: 'env_stg', target: 'BODY', selector, valueType,
    observationCount: n, successCount: n, clientErrorCount: 0, serverErrorCount: 0,
    lastSeenAt: `2026-08-31T0${n}:00:00.000Z`,
  }))),
  samples: [1, 2].map((n) => ({
    environmentId: 'env_stg', encoding: 'JSON', observationCount: 1, successCount: 1,
    clientErrorCount: 0, serverErrorCount: 0, lastSeenAt: `2026-08-31T0${n}:00:00.000Z`,
    selectors: [
      { target: 'BODY', selector: '$.employeeId', valueType: 'STRING' },
      { target: 'BODY', selector: '$.firstName', valueType: 'STRING' },
      { target: 'BODY', selector: '$.middleName', valueType: 'STRING' },
      { target: 'BODY', selector: '$.lastName', valueType: 'STRING' },
    ],
  })),
};
function planEmployee(scenarioValue, options = {}) {
  return applyTestDataPlannerV1(
    { title: 'Employee intent', objective: 'Employee intent', assumptions: [], scenarios: [scenarioValue] },
    employeeContext,
    { observedTestData: employeeObserved, ...options },
  );
}

const invalidEmployeeId = planEmployee(scenario('create_employee_invalid_employeeId', {
  title: 'Criar funcionário com employeeId inválido',
  objective: 'Verificar erro ao tentar criar um funcionário com um employeeId inválido.',
  body: {},
  needsData: false,
}));
assert.equal(invalidEmployeeId.diagnostics.intentAwareScenarioCount, 1);
assert.equal(invalidEmployeeId.diagnostics.intentTargetCount, 1);
assert.ok(invalidEmployeeId.diagnostics.intentTargets.includes('create_employee_invalid_employeeId:BODY:$.employeeId:INVALID_VALUE'));
assert.equal(invalidEmployeeId.diagnostics.intentBlockedObservedCount, 1);
assert.equal(invalidEmployeeId.diagnostics.plannedScenarioCount, 1);
assert.equal(invalidEmployeeId.plansByScenarioId.create_employee_invalid_employeeId.bindings.length, 0);
assert.equal(invalidEmployeeId.output.scenarios[0].automationHints.needsData, true);
assert.equal(invalidEmployeeId.output.scenarios[0].automationHints.reviewRequired, true);
assert.match(invalidEmployeeId.output.scenarios[0].automationHints.reasons.join(' '), /Scenario Intent.*employeeId.*INVALID_VALUE/i);

// Duplicate is semantically different from invalid: a successful observed value is
// useful because it represents a value that has already existed in the system.
const duplicateEmployeeId = planEmployee(scenario('create_employee_duplicate_employeeId', {
  title: 'Criar funcionário com employeeId duplicado',
  objective: 'Verificar erro ao tentar criar um funcionário com um employeeId já existente.',
  status: 409,
  body: {},
  needsData: false,
}));
assert.ok(duplicateEmployeeId.diagnostics.intentTargets.includes('create_employee_duplicate_employeeId:BODY:$.employeeId:DUPLICATE_REFERENCE'));
assert.equal(duplicateEmployeeId.diagnostics.intentDuplicateObservedReuseCount, 1);
assert.equal(duplicateEmployeeId.plansByScenarioId.create_employee_duplicate_employeeId.bindings.find((item) => item.selector === '$.employeeId')?.source, 'OBSERVED');
assert.equal(duplicateEmployeeId.diagnostics.observedRuntimePendingCount, 1);
assert.equal(duplicateEmployeeId.output.scenarios[0].automationHints.needsData, true);

const invalidFirstName = planEmployee(scenario('create_employee_invalid_firstName', {
  title: 'Criar funcionário com firstName inválido',
  objective: 'Verificar erro ao tentar criar um funcionário com um firstName inválido.',
  body: {},
  needsData: false,
}));
assert.ok(invalidFirstName.diagnostics.intentTargets.includes('create_employee_invalid_firstName:BODY:$.firstName:INVALID_VALUE'));
assert.equal(invalidFirstName.diagnostics.intentBlockedGeneratedCount, 1);
assert.equal(invalidFirstName.plansByScenarioId.create_employee_invalid_firstName.bindings.some((item) => item.selector === '$.firstName'), false);
assert.equal(invalidFirstName.output.scenarios[0].automationHints.needsData, true);

// A generic required-field omission is recognized before planning but does not get
// a valid baseline auto-filled. Empty body already represents the omission intent.
const missingEmployeeFields = planEmployee(scenario('create_employee_missing_fields', {
  title: 'Criar funcionário sem campos obrigatórios',
  objective: 'Verificar erro ao tentar criar um funcionário sem campos obrigatórios.',
  body: {},
  needsData: false,
}));
assert.equal(missingEmployeeFields.diagnostics.intentAwareScenarioCount, 1);
assert.equal(missingEmployeeFields.diagnostics.intentTargetCount, 1);
assert.ok(missingEmployeeFields.diagnostics.intentTargets.includes('create_employee_missing_fields:BODY:$:OMIT_REQUIRED_FIELDS'));
assert.equal(missingEmployeeFields.diagnostics.intentOmissionSatisfiedCount, 1);
assert.equal(missingEmployeeFields.diagnostics.plannedScenarioCount, 0);
assert.deepEqual(missingEmployeeFields.output.scenarios[0].request.body, {});
assert.equal(missingEmployeeFields.output.scenarios[0].automationHints.needsData, false);

console.log('Foundation 07.7.8-C2-C FIX-1 Intent-Aware Observed Selection tests passed ✅');
