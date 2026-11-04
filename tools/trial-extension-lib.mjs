/** Offline planning + guarded operations. No HTTP routes are introduced. */
import { createHash } from 'node:crypto';
import { DAY_MS, MAX_TRIAL_DAYS } from '../src/lib/trialConfig.js';
export const PLAN_VERSION = 'qagent.trial-extension-plan.v1';
const keyPattern = /^license:(sha256:[a-f0-9]{64})$/;
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const own = (v, k) => v && Object.hasOwn(v, k);
const dict = v => Boolean(v && typeof v === 'object' && !Array.isArray(v));
export function validateOperation({ days, operationId, plannedAt }) {
  if (!Number.isSafeInteger(days) || days < 1 || days > MAX_TRIAL_DAYS) throw new Error('INVALID_DAYS');
  if (typeof operationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(operationId)) throw new Error('INVALID_OPERATION_ID');
  if (typeof plannedAt !== 'string' || !Number.isFinite(Date.parse(plannedAt))) throw new Error('INVALID_PLAN_TIME');
}
export function keyAuthority(keyRecord) {
  return Object.fromEntries(['keyHash','customerId','revokedAt','disabledAt','suspendedAt','status','createdAt'].map(k=>[k,keyRecord?.[k]??null]));
}
export function proposeExtension({ key, license, clientKey, licenseMeta = {}, clientKeyMeta = {}, days, operationId, plannedAt }) {
  validateOperation({ days, operationId, plannedAt });
  const skip = reason => ({ eligible: false, reason });
  const match = keyPattern.exec(key);
  if (!match) return skip('UNSUPPORTED_KEY'); // never modify legacy token licenses
  if (!dict(license) || !dict(clientKey)) return skip('MISSING_RECORD');
  if (clientKey.keyHash !== match[1] || !clientKey.customerId || license.customerId !== clientKey.customerId) return skip('ACCOUNT_BINDING_MISMATCH');
  if (clientKey.revokedAt || clientKey.disabledAt || clientKey.suspendedAt || (clientKey.status && clientKey.status !== 'active')) return skip('CLIENT_KEY_NOT_ACTIVE');
  if (license.revokedAt || license.disabledAt || license.suspendedAt || !['trial','expired'].includes(license.status)) return skip('LICENSE_NOT_TRIAL');
  // Expired paid subscriptions may still have an old trialEndsAt: never reopen them.
  if (['currentPeriodStart','currentPeriodEnd','providerCustomerId','providerSubscriptionId','lastBillingEventType','lastBillingEventAt','lastPaymentSucceededAt','lastPaymentFailedAt','cancelAt'].some(k=>license[k]) || license.cancelAtPeriodEnd) return skip('BILLING_HISTORY_PRESENT');
  if (licenseMeta.expiration != null || clientKeyMeta.expiration != null) return skip('PHYSICAL_KV_EXPIRATION_REQUIRES_REVIEW');
  if (own(license,'trialExtensionOperations') && !dict(license.trialExtensionOperations)) return skip('INVALID_EXTENSION_HISTORY');
  if (own(license.trialExtensionOperations, operationId)) return skip('OPERATION_ALREADY_APPLIED');
  const expiration = Date.parse(license.expiresAt || license.trialEndsAt || '');
  if (!Number.isFinite(expiration) || !license.licenseId) return skip('INVALID_LICENSE');
  if (license.status === 'expired' && !Number.isFinite(Date.parse(license.trialEndsAt || ''))) return skip('EXPIRED_WITHOUT_TRIAL_PROVENANCE');
  if (license.trialEndsAt && Date.parse(license.trialEndsAt) !== expiration) return skip('EXPIRY_MISMATCH');
  const nextExpiry = new Date(Math.max(expiration, Date.parse(plannedAt)) + days * DAY_MS).toISOString();
  const marker = { days, plannedAt, previousStatus: license.status, previousExpiresAt: license.expiresAt ?? null, previousTrialEndsAt: license.trialEndsAt ?? null, expiresAt: nextExpiry };
  const next = { ...license, status: 'trial', trialEndsAt: nextExpiry, expiresAt: nextExpiry, updatedAt: plannedAt,
    trialExtensionOperations: { ...license.trialExtensionOperations, [operationId]: marker } };
  return { eligible: true, next, previousExpiresAt: new Date(expiration).toISOString(), nextExpiresAt: nextExpiry };
}
export async function buildPlan(kv, { days = 30, operationId, plannedAt = new Date().toISOString(), target, customerId = null }) {
  validateOperation({ days, operationId, plannedAt });
  const licenses = await kv.list('license:sha256:');
  const keys = new Map((await kv.list('clientkey:sha256:')).map(x=>[x.name,x]));
  const plan = { version:PLAN_VERSION, target, days, operationId, plannedAt, customerId, scanned:licenses.length, entries:[], skipped:[] };
  const seen = new Set();
  for (const meta of licenses) {
    if (seen.has(meta.name)) throw new Error('DUPLICATE_LIST_KEY'); seen.add(meta.name);
    const key = meta.name; const match = keyPattern.exec(key);
    if (!match) { plan.skipped.push({ key, reason:'UNSUPPORTED_KEY' }); continue; }
    const clientKeyName = 'clientkey:'+match[1]; const keyMeta = keys.get(clientKeyName);
    if (!keyMeta) { plan.skipped.push({ key, reason:'MISSING_CLIENT_KEY' }); continue; }
    const before = await kv.get(key); const clientKey = await kv.get(clientKeyName);
    if (customerId && before?.customerId !== customerId) { plan.skipped.push({ key, reason:'OUT_OF_SCOPE' }); continue; }
    const proposal = proposeExtension({key,license:before,clientKey,licenseMeta:meta,clientKeyMeta:keyMeta,days,operationId,plannedAt});
    if (!proposal.eligible) { plan.skipped.push({key,reason:proposal.reason}); continue; }
    plan.entries.push({ key, clientKeyName, before, after:proposal.next, authority:keyAuthority(clientKey),
      metadata:meta.metadata??null, clientMetadata:keyMeta.metadata??null, beforeHash:digest(before), afterHash:digest(proposal.next) });
  }
  return { ...plan, planHash:digest(plan) };
}
export function validatePlan(plan, target) {
  const { planHash, ...content } = plan;
  if (plan.version!==PLAN_VERSION || digest(content)!==planHash) throw new Error('PLAN_INTEGRITY_INVALID');
  if (canonical(plan.target)!==canonical(target)) throw new Error('TARGET_MISMATCH');
  validateOperation(plan);
  const seen = new Set();
  for (const e of plan.entries) {
    const match=keyPattern.exec(e.key);
    if (!match || e.clientKeyName!=='clientkey:'+match[1] || seen.has(e.key)) throw new Error('PLAN_KEY_INVALID');
    seen.add(e.key);
    const proposed=proposeExtension({key:e.key,license:e.before,clientKey:e.authority,days:plan.days,operationId:plan.operationId,plannedAt:plan.plannedAt});
    if (!proposed.eligible || digest(e.before)!==e.beforeHash || digest(e.after)!==e.afterHash || canonical(proposed.next)!==canonical(e.after)) throw new Error('PLAN_ENTRY_INVALID');
    if (plan.customerId && e.before.customerId!==plan.customerId) throw new Error('PLAN_SCOPE_INVALID');
  }
}
export async function executePlan(kv, plan, { target, mode = 'apply', now = Date.now(), record = async()=>{} } = {}) {
  validatePlan(plan,target);
  if (!['apply','verify','rollback'].includes(mode)) throw new Error('INVALID_MODE');
  // Metadata checked again; physical expiration/changed metadata are not silently removed.
  const licenseList = new Map((await kv.list('license:sha256:')).map(x=>[x.name,x]));
  const keyList = new Map((await kv.list('clientkey:sha256:')).map(x=>[x.name,x]));
  const results=[];
  for (const e of plan.entries) {
    const done=async status=>{ const item={key:e.key,status};results.push(item);await record(item); };
    const meta=licenseList.get(e.key), keyMeta=keyList.get(e.clientKeyName);
    if (!meta || !keyMeta || meta.expiration!=null || keyMeta.expiration!=null || canonical(meta.metadata??null)!==canonical(e.metadata) || canonical(keyMeta.metadata??null)!==canonical(e.clientMetadata)) {await done('CONFLICT_METADATA');continue;}
    const authority=keyAuthority(await kv.get(e.clientKeyName));
    if (canonical(authority)!==canonical(e.authority)) {await done('CONFLICT_CLIENT_KEY');continue;}
    const current=await kv.get(e.key); const hash=digest(current);
    if (mode==='verify') {await done(hash===e.afterHash?'VERIFIED':hash===e.beforeHash?'NOT_APPLIED_OR_NOT_VISIBLE':'CHANGED_AFTER_PLAN');continue;}
    if (mode==='apply') {
      if (hash===e.afterHash) {await done('ALREADY_APPLIED');continue;}
      // Marker survives ordinary spreads/renewals. Never re-extend an operation.
      if (own(current?.trialExtensionOperations,plan.operationId)) {await done('ALREADY_APPLIED_STATE_CHANGED');continue;}
      if (hash!==e.beforeHash) {await done('CONFLICT_LICENSE');continue;}
      if (Date.parse(e.after.expiresAt)<=now) {await done('PLAN_EXPIRED');continue;}
    } else {
      if (hash===e.beforeHash) {await done('ALREADY_ROLLED_BACK');continue;}
      if (hash!==e.afterHash) {await done('CONFLICT_LICENSE');continue;}
    }
    // KV has no CAS/transaction: operator must ensure a single writer/maintenance window.
    // Recheck authority immediately before write; this is conflict detection, NOT a lock.
    if (canonical(keyAuthority(await kv.get(e.clientKeyName)))!==canonical(e.authority)) {await done('CONFLICT_CLIENT_KEY');continue;}
    if (digest(await kv.get(e.key))!==hash) {await done('CONFLICT_LICENSE');continue;}
    await record({key:e.key,status:'WRITE_INTENT',mode});
    try { await kv.put(e.key, mode==='apply'?e.after:e.before, e.metadata); }
    catch { await done('WRITE_UNCERTAIN'); break; } // verify before retry; never blindly add more days
    await done(mode==='apply'?'WRITE_ACKNOWLEDGED':'ROLLBACK_ACKNOWLEDGED');
  }
  return results;
}
