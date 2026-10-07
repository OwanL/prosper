import { PlannerError } from './plans.mjs';

// Status and locally configured model are safe diagnostics. Upstream response
// bodies can contain account/proxy details and never become logs or UI text.
export function providerHttpError(response, { provider = 'Ollama', model } = {}) {
  const unavailable = response.status === 410;
  const error = new PlannerError(unavailable
    ? `${provider} model ${model} is no longer available (HTTP 410). Configure a supported PROSPER_MODEL and restart. Automatic planning retries are stopped.`
    : `${provider} planning failed (HTTP ${response.status}).`);
  error.httpStatus = response.status;
  error.retryable = !unavailable;
  const retry = response.headers?.get?.('retry-after');
  const delay = retry && /^\d+(\.\d+)?$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - Date.now() : 0;
  error.retryAfterMs = Number.isFinite(delay) ? Math.max(0, Math.min(300000, delay)) : 0;
  return error;
}
