import { createUiCaptureGrant } from '../ui/uiCaptureGrantService.js';
export async function postPluginUiCaptureGrant(request, env) { return createUiCaptureGrant(request, env); }
