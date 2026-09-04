import { normalizeRunCreateInput } from './runContracts.js';

export const RUN_BATCH_CREATE_CONTRACT_VERSION = 'qagent.run-batch-create.v1';
export const RUN_BATCH_CONTRACT_VERSION = 'qagent.run-batch.v1';

export function normalizeRunBatchCreateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    const error = new Error('Payload de Run Batch inválido.');
    error.code = 'RUN_BATCH_CREATE_CONTRACT_INVALID';
    error.status = 400;
    throw error;
  }
  if (input.contractVersion !== RUN_BATCH_CREATE_CONTRACT_VERSION) {
    const error = new Error(`contractVersion deve ser '${RUN_BATCH_CREATE_CONTRACT_VERSION}'.`);
    error.code = 'RUN_BATCH_CREATE_CONTRACT_INVALID';
    error.status = 400;
    throw error;
  }
  try {
    const normalized = normalizeRunCreateInput({ ...input, contractVersion: 'qagent.run-create.v1' });
    return { ...normalized, contractVersion: RUN_BATCH_CREATE_CONTRACT_VERSION };
  } catch (cause) {
    const error = new Error(cause?.message || 'Payload de Run Batch inválido.');
    error.code = 'RUN_BATCH_CREATE_CONTRACT_INVALID';
    error.status = cause?.status || 400;
    error.publicDetails = cause?.publicDetails || null;
    throw error;
  }
}
