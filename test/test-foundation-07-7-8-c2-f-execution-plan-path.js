import test from "node:test";
import assert from "node:assert/strict";

import {
  materializeExecutionPlanV1,
} from "../src/services/executionPlanMaterializerService.js";

function artifact({
  path,
  bindings,
} = {}) {
  return {
    organizationId: "org_demo",
    projectId: "prj_demo",
    endpointId: "cep_demo",
    specificationVersion:
      "qagent.test-spec.v1",
    testDesignId: "td_demo",
    testDesignVersionId:
      "tdv_demo",
    version: 1,
    contextFingerprint:
      "ctx_demo",
    specification: {
      contractVersion:
        "qagent.test-design.v1",
      specificationVersion:
        "qagent.test-spec.v1",
      source: {
        organizationId: "org_demo",
        projectId: "prj_demo",
        endpointId: "cep_demo",
      },
      scenarios: [
        {
          scenarioId: "test_path",
          title: "Observed path",
          category: "HAPPY_PATH",
          priority: "HIGH",
          confidence: "HIGH",
          grounding: {
            level: "OBSERVED",
          },
          automation: {
            readiness: "READY",
          },
          spec: {
            dslVersion:
              "qagent.api-test-dsl.v1",
            type: "api",
            target: {
              apiServiceKey:
                "orangehrm",
              method: "GET",
              path,
            },
            auth: {
              requirement: "NONE",
              authProfileRef: null,
            },
            request: {
              pathParams: {},
              query: {},
              headers: {},
            },
            assertions: [],
            extract: [],
            testData: {
              contractVersion:
                "qagent.test-data-bindings.v1",
              bindings,
            },
          },
        },
      ],
    },
  };
}

async function materialize({
  path,
  bindings,
  frozenByBindingKey,
} = {}) {
  return materializeExecutionPlanV1({
    env: {},
    organizationId: "org_demo",
    projectId: "prj_demo",
    artifact: artifact({
      path,
      bindings,
    }),
    environmentId: "env_stg",
    runId: "run_demo",
    executionPlanId: "xplan_demo",
    runtimeSnapshotId: "rts_demo",
    createdAt:
      "2026-09-02T00:00:00.000Z",
    resolveRuntime:
      async () => ({
        environment: {
          environmentId: "env_stg",
          name: "STG",
        },
        apiServices: {
          orangehrm: {
            apiServiceId:
              "apisvc_demo",
            name: "OrangeHRM",
            baseUrl:
              "https://example.test",
          },
        },
        variables: {},
        authProfiles: {},
      }),
    resolveObservedTestData:
      async () => ({
        contractVersion:
          "qagent.observed-test-data-runtime-resolution.v1",
        frozenByBindingKey,
        provenanceByBindingKey: {},
        resolvedCount:
          Object.keys(
            frozenByBindingKey,
          ).length,
        correlatedSampleBindingCount:
          Object.keys(
            frozenByBindingKey,
          ).length,
        scalarFallbackBindingCount: 0,
        durationMs: 1,
      }),
  });
}

test(
  "C2-F single observed id keeps canonical Execution Plan path",
  async () => {
    const result =
      await materialize({
        path:
          "/web/index.php/api/v2/pim/employees/{id}",
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
        frozenByBindingKey: {
          "PATH_PARAM:id@6:0": {
            target:
              "PATH_PARAM",
            selector:
              "id",
            valueType:
              "STRING",
            value:
              "198",
            segmentIndex:
              6,
            occurrence:
              0,
          },
        },
      });

    const spec =
      result.executionPlan
        .scenarios[0]
        .spec;

    assert.equal(
      spec.target.path,
      "/web/index.php/api/v2/pim/employees/{id}",
    );

    assert.deepEqual(
      spec.testData.bindings[0],
      {
        target:
          "PATH_PARAM",
        selector:
          "id",
        source:
          "FIXED",
        valueType:
          "STRING",
        bindingKey:
          "PATH_PARAM:id@6:0",
      },
    );

    assert.deepEqual(
      result.runtimeSnapshot
        .testData.fixed[
          "PATH_PARAM:id@6:0"
        ],
      {
        bindingId: null,
        scopeType: null,
        target:
          "PATH_PARAM",
        selector:
          "id",
        valueType:
          "STRING",
        value:
          "198",
      },
    );
  },
);

test(
  "C2-F repeated id uses runtime-only aliases while Runner remains unchanged",
  async () => {
    const result =
      await materialize({
        path:
          "/companies/{id}/employees/{id}",
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
              "PATH_PARAM:id@1:0",
          },
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
              "PATH_PARAM:id@3:1",
          },
        ],
        frozenByBindingKey: {
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
      });

    const spec =
      result.executionPlan
        .scenarios[0]
        .spec;

    assert.equal(
      spec.target.path,
      "/companies/{__qagent_path_1_0}/employees/{__qagent_path_3_1}",
    );

    assert.deepEqual(
      spec.testData.bindings,
      [
        {
          target:
            "PATH_PARAM",
          selector:
            "__qagent_path_1_0",
          source:
            "FIXED",
          valueType:
            "STRING",
          bindingKey:
            "PATH_PARAM:id@1:0",
        },
        {
          target:
            "PATH_PARAM",
          selector:
            "__qagent_path_3_1",
          source:
            "FIXED",
          valueType:
            "STRING",
          bindingKey:
            "PATH_PARAM:id@3:1",
        },
      ],
    );

    assert.equal(
      result.runtimeSnapshot
        .testData.fixed[
          "PATH_PARAM:id@1:0"
        ].selector,
      "__qagent_path_1_0",
    );

    assert.equal(
      result.runtimeSnapshot
        .testData.fixed[
          "PATH_PARAM:id@3:1"
        ].selector,
      "__qagent_path_3_1",
    );
  },
);
