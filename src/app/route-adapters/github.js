import { handleGithubWebRequest } from '../../github/handle-request.js';
import { createRouteAdapter } from './base.js';

/** GitHub transparent mirror strategy. */
export const GITHUB_ROUTE_ADAPTER = createRouteAdapter(
  'github',
  async ({ request, url, env, config }) =>
    await handleGithubWebRequest({ request, url, env, config })
);
