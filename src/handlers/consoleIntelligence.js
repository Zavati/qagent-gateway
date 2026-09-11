import { observedBaselineGenerationEnabled } from '../intelligence/observedBaselineFeature.js';
import { listCatalogObservedBaselines } from '../intelligence/catalogKnowledgeClient.js';
import { getEnvNum } from '../lib/config.js';
import { requireConsoleTenant } from '../services/tenantContextService.js';
import { getOrganizationProject } from '../services/projectService.js';
import { buildCatalogTestDesignContextV1 } from '../intelligence/catalogContextBuilder.js';
import { generateAndPersistCatalogTestDesignV1 } from '../intelligence/testDesignPersistence.js';
import { loadLatestPersistedTestDesignV1 } from '../intelligence/testDesignRetrieval.js';

export async function getConsoleTestDesignContext(req, env, { projectId, endpointId }) {
  const tenant = await requireConsoleTenant(req, env);
  await getOrganizationProject(env, tenant.organizationId, projectId);
  const result = await buildCatalogTestDesignContextV1({
    env,
    organizationId: tenant.organizationId,
    projectId,
    endpointId,
  });
  return {
    status: 'ok',
    data: result,
  };
}


export async function getConsoleTestDesign(
  req,
  env,
  { projectId, endpointId },
  {
    requireTenant = requireConsoleTenant,
    getProject = getOrganizationProject,
    loadLatest = loadLatestPersistedTestDesignV1,
    loadBaselines = listCatalogObservedBaselines,
  } = {},
) {
  const tenant = await requireTenant(req, env);
  await getProject(env, tenant.organizationId, projectId);

  const result = await loadLatest({
    env,
    organizationId: tenant.organizationId,
    projectId,
    endpointId,
  });

  if(observedBaselineGenerationEnabled(env)){
    try{const sources=await loadBaselines({env,organizationId:tenant.organizationId,projectId,endpointId});
      result.observedBaselineSources=sources.items;result.observedBaselineSourcesTruncated=sources.itemsTruncated===true;
    }catch{result.observedBaselineSources=[];result.observedBaselineSourcesUnavailable=true;}
  }
  return {
    status: 'ok',
    data: result,
  };
}

export async function postConsoleTestDesign(req, env, { projectId, endpointId }, { rateLimiter = null } = {}) {
  const tenant = await requireConsoleTenant(req, env);
  await getOrganizationProject(env, tenant.organizationId, projectId);

  if (rateLimiter) {
    rateLimiter({
      key: `test-design:${tenant.organizationId}:${tenant.user?.userId || tenant.accountId || 'console'}`,
      windowMs: getEnvNum(env, 'TEST_DESIGN_RATE_LIMIT_WINDOW_MS', 60_000),
      max: getEnvNum(env, 'TEST_DESIGN_RATE_LIMIT_MAX', 6),
    });
  }

  let body={};
  const requestText=await req.text();
  if(requestText.trim()){
    if(requestText.length>4096)throw Object.assign(new Error('Payload de geração excedeu o limite.'),{status:413,code:'TEST_DESIGN_OPTIONS_TOO_LARGE'});
    try{body=JSON.parse(requestText);}catch{throw Object.assign(new Error('JSON inválido.'),{status:400,code:'TEST_DESIGN_OPTIONS_INVALID'});}
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>k!=='baselineOptions'))throw Object.assign(new Error('Opções de geração inválidas.'),{status:400,code:'TEST_DESIGN_OPTIONS_INVALID'});
  }
  const result = await generateAndPersistCatalogTestDesignV1({
    env,
    organizationId: tenant.organizationId,
    projectId,
    endpointId,
    accountId: tenant.accountId || null,
    baselineActorId: tenant.user?.userId || tenant.accountId || null,
    baselineOptions: body.baselineOptions || null,
  });

  return {
    status: 'ok',
    data: result,
  };
}
