import { configureAIHeaders } from '../protocols/ai.js';
import { createProtocolAdapter } from './base.js';

export const AI_ADAPTER = createProtocolAdapter({
  kind: 'ai',
  allowsSharedCache: () => false,
  usesProtocolSemantics: true,
  /** @param {{ headers: Headers, request: Request }} options */
  prepareUpstreamHeaders: ({ headers, request }) => {
    configureAIHeaders(headers, request);
  }
});
