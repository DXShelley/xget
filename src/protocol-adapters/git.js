import { configureGitHeaders } from '../protocols/git.js';
import { gitAuthenticationChallenge, validateGitCredential } from '../auth/browser.js';
import {
  BASE_PROTOCOL_ADAPTER,
  allowAnonymous,
  isAuthenticationRequired,
  stripProxyAuthentication
} from './base.js';

export const GIT_ADAPTER = Object.freeze({
  ...BASE_PROTOCOL_ADAPTER,
  kind: 'git',
  allowsSharedCache: () => false,
  usesProtocolSemantics: true,
  /** @param {{ env: Record<string, unknown>, request: Request }} context */
  authenticate: async context => {
    const principal = await validateGitCredential(context.request, context.env);
    if (principal) return { principal, response: null };
    return isAuthenticationRequired(context.env)
      ? { principal: null, response: gitAuthenticationChallenge() }
      : allowAnonymous();
  },
  /** @param {{ headers: Headers, principal?: { authMethod: string } | null, request: Request, url: URL, isGitLFS: boolean }} options */
  prepareUpstreamHeaders: ({ headers, principal, request, url, isGitLFS }) => {
    if (principal?.authMethod === 'git-basic') stripProxyAuthentication(headers);
    configureGitHeaders(headers, request, url, isGitLFS);
  }
});
