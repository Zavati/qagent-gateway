import test from "node:test";
import assert from "node:assert/strict";

import {
  buildObservedTestDataPlanningContext,
} from "../src/intelligence/observedTestDataPlanningContext.js";

import {
  applyTestDataPlannerV1,
} from "../src/intelligence/testDataPlanner.js";

function context(path) {
  return {
    endpoint: {
      normalizedPath: path,
      queryParameters: [],
    },
    schemas: [],
    environments: [
      {
        environmentId: "env_stg",
      },
    ],
    testData: {
      configuredBindings: [],
    },
  };
}

function scenario({
  category = "HAPPY_PATH",
  status = 200,
} = {}) {
  return {
    scenarios: [
      {
        scenarioId: "test_path",
        title: "Observed path",
        objective: "Executar path parametrizado.",
        category,
        request: {
          pathParams: {},
          query: {},
          headers: {},
        },
        assertions: [
          {
            type: "STATUS",
            expectedStatusCodes: [
              status,
            ],
          },
        ],
        automationHints: {
          needsData: true,
          reviewRequired: false,
          reasons: [
            "Valores de path params precisam ser fornecidos por massa de teste/runtime.",
          ],
        },
      },
    ],
  };
}

function repeatedObservedContext() {
  return buildObservedTestDataPlanningContext({
    environmentIds: [
      "env_stg",
    ],
    samples: [
      {
        environmentId: "env_stg",
        encoding: "PATH",
        observationCount: 3,
        successCount: 3,
        values: [
          {
            target: "PATH_PARAM",
            selector: "id",
            valueType: "STRING",
            value: "10",
            segmentIndex: 1,
            occurrence: 0,
          },
          {
            target: "PATH_PARAM",
            selector: "id",
            valueType: "STRING",
            value: "25",
            segmentIndex: 3,
            occurrence: 1,
          },
        ],
      },
    ],
  });
}

test(
  "C2-F planning context preserves repeated PATH positions",
  () => {
    const observed =
      repeatedObservedContext();

    assert.deepEqual(
      observed.samples[0].selectors,
      [
        {
          target: "PATH_PARAM",
          selector: "id",
          valueType: "STRING",
          segmentIndex: 1,
          occurrence: 0,
        },
        {
          target: "PATH_PARAM",
          selector: "id",
          valueType: "STRING",
          segmentIndex: 3,
          occurrence: 1,
        },
      ],
    );
  },
);

test(
  "C2-F happy-path planner emits OBSERVED positional bindings",
  () => {
    const result =
      applyTestDataPlannerV1(
        scenario(),
        context(
          "/companies/{id}/employees/{id}",
        ),
        {
          observedTestData:
            repeatedObservedContext(),
          observedRuntimeEnabled:
            true,
        },
      );

    assert.deepEqual(
      result.plansByScenarioId
        .test_path
        .bindings,
      [
        {
          target: "PATH_PARAM",
          selector: "id",
          source: "OBSERVED",
          valueType: "STRING",
          bindingKey: "PATH_PARAM:id@1:0",
        },
        {
          target: "PATH_PARAM",
          selector: "id",
          source: "OBSERVED",
          valueType: "STRING",
          bindingKey: "PATH_PARAM:id@3:1",
        },
      ],
    );

    assert.equal(
      result.output
        .scenarios[0]
        .automationHints
        .needsData,
      false,
    );
  },
);

test(
  "C2-F does not replace negative/not-found intent with a valid observed id",
  () => {
    const result =
      applyTestDataPlannerV1(
        scenario({
          category: "NEGATIVE",
          status: 404,
        }),
        context(
          "/companies/{id}/employees/{id}",
        ),
        {
          observedTestData:
            repeatedObservedContext(),
          observedRuntimeEnabled:
            true,
        },
      );

    const bindings =
      result.plansByScenarioId
        .test_path
        ?.bindings
      || [];

    assert.equal(
      bindings.some(
        (binding) =>
          binding.source === "OBSERVED",
      ),
      false,
    );

    assert.equal(
      result.output
        .scenarios[0]
        .automationHints
        .needsData,
      true,
    );
  },
);

test(
  "C2-F explicit PATH config keeps historical selector binding key",
  () => {
    const ctx =
      context(
        "/companies/{id}/employees/{id}",
      );

    ctx.testData.configuredBindings = [
      {
        bindingId: "tdb_id",
        scopeType: "PROJECT",
        environmentId: null,
        target: "PATH_PARAM",
        selector: "id",
        sourceType: "FIXED",
        valueType: "STRING",
      },
    ];

    const result =
      applyTestDataPlannerV1(
        scenario(),
        ctx,
        {
          observedTestData: {
            contractVersion:
              "qagent.observed-test-data-planning-context.v1",
            values: [],
            samples: [],
          },
          observedRuntimeEnabled:
            true,
        },
      );

    assert.equal(
      result.plansByScenarioId
        .test_path
        .bindings
        .length,
      1,
    );

    assert.equal(
      result.plansByScenarioId
        .test_path
        .bindings[0]
        .bindingKey,
      "PATH_PARAM:id",
    );
  },
);
