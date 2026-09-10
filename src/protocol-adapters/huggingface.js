import { configureHuggingFaceHeaders } from '../protocols/huggingface.js';
import { BASE_PROTOCOL_ADAPTER, allowAnonymous } from './base.js';

export const HUGGING_FACE_ADAPTER = Object.freeze({
  ...BASE_PROTOCOL_ADAPTER,
  kind: 'huggingface',
  allowsSharedCache: () => false,
  usesProtocolSemantics: true,
  authenticate: async () => allowAnonymous(),
  /** @param {{ headers: Headers, request: Request }} options */
  prepareUpstreamHeaders: ({ headers, request }) => {
    configureHuggingFaceHeaders(headers, request);
  }
});
