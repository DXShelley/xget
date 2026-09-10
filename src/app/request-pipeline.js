import { runPipeline } from '../filters/run-pipeline.js';
import { PerformanceMonitor } from '../utils/performance.js';
import { REQUEST_PIPELINE } from './request-pipeline-filters.js';

/** @param {any} requestContext @param {ExecutionContext} ctx */
export async function runRequestPipeline(requestContext, ctx) {
  return await runPipeline(
    { ...requestContext, ctx, isProxiedResponse: false, monitor: new PerformanceMonitor() },
    REQUEST_PIPELINE
  );
}
