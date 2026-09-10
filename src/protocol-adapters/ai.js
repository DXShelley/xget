import { configureAIHeaders } from '../protocols/ai.js';
import { BASE_PROTOCOL_ADAPTER, allowAnonymous } from './base.js';

export const AI_ADAPTER = Object.freeze({
  ...BASE_PROTOCOL_ADAPTER,
  kind: 'ai',
  allowsSharedCache: () => false,
  usesProtocolSemantics: true,
  authenticate: async () => allowAnonymous(),
  /** @param {{ headers: Headers, request: Request }} options */
  prepareUpstreamHeaders: ({ headers, request }) => {
    configureAIHeaders(headers, request);
  }
});
