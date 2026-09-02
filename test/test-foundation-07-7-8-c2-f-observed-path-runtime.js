import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveObservedTestDataForRun,
} from "../src/services/observedTestDataRuntimeResolver.js";

function repeatedScenario() {
  return {
    scenarioId: "test_path",
    spec: {
      testData: {
        bindings: [
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
      },
    },
  };
}

test(
  "C2-F runtime freezes complete correlated PATH sample",
  async () => {
    let scalarCalled = false;

    const result =
      await resolveObservedTestDataForRun({
        organizationId: "org_demo",
        projectId: "prj_demo",
        endpointId: "cep_demo",
        environmentId: "env_stg",
        selectedScenarios: [
          repeatedScenario(),
        ],
        loadSamples:
          async () => [
            {
              sampleFingerprint:
                "otds_demo",
              environmentId:
                "env_stg",
              encoding:
                "PATH",
              observationCount:
                4,
              successCount:
                4,
              lastSeenAt:
                "2026-09-02T00:00:00.000Z",
              values: [
                {
                  target:
                    "PATH_PARAM",
                  selector:
                    "id",
                  valueType:
                    "STRING",
                  value:
                    "10",
                  segmentIndex:
                    1,
                  occurrence:
                    0,
                },
                {
                  target:
                    "PATH_PARAM",
                  selector:
                    "id",
                  valueType:
                    "STRING",
                  value:
                    "25",
                  segmentIndex:
                    3,
                  occurrence:
                    1,
                },
              ],
            },
          ],
        loadValues:
          async () => {
            scalarCalled = true;
            return [];
          },
      });

    assert.equal(
      result.resolvedCount,
      2,
    );

    assert.equal(
      result.correlatedSampleBindingCount,
      2,
    );

    assert.equal(
      result.scalarFallbackBindingCount,
      0,
    );

    assert.equal(
      scalarCalled,
      false,
    );

    assert.deepEqual(
      result.frozenByBindingKey,
      {
        "PATH_PARAM:id@1:0": {
          target:
            "PATH_PARAM",
          selector:
            "id",
          valueType:
            "STRING",
          value:
            "10",
          segmentIndex:
            1,
          occurrence:
            0,
        },
        "PATH_PARAM:id@3:1": {
          target:
            "PATH_PARAM",
          selector:
            "id",
          valueType:
            "STRING",
          value:
            "25",
          segmentIndex:
            3,
          occurrence:
            1,
        },
      },
    );
  },
);

test(
  "C2-F PATH never falls back to scalar Reservoir",
  async () => {
    let scalarCalled = false;

    await assert.rejects(
      () =>
        resolveObservedTestDataForRun({
          organizationId:
            "org_demo",
          projectId:
            "prj_demo",
          endpointId:
            "cep_demo",
          environmentId:
            "env_stg",
          selectedScenarios: [
            {
              scenarioId:
                "single",
              spec: {
                testData: {
                  bindings: [
                    {
                      target:
                        "PATH_PARAM",
                      selector:
                        "id",
                      source:
                        "OBSERVED",
                      valueType:
                        "STRING",
                      bindingKey:
                        "PATH_PARAM:id@6:0",
                    },
                  ],
                },
              },
            },
          ],
          loadSamples:
            async () => [],
          loadValues:
            async () => {
              scalarCalled = true;
              return [];
            },
        }),
      (error) =>
        error?.code
        === "RUN_OBSERVED_TEST_DATA_CORRELATED_SAMPLE_MISSING",
    );

    assert.equal(
      scalarCalled,
      false,
    );
  },
);
