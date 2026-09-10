import { configureHuggingFaceHeaders } from '../protocols/huggingface.js';
import { createProtocolAdapter } from './base.js';

export const HUGGING_FACE_ADAPTER = createProtocolAdapter({
  kind: 'huggingface',
  allowsSharedCache: () => false,
  usesProtocolSemantics: true,
  /** @param {{ headers: Headers, request: Request }} options */
  prepareUpstreamHeaders: ({ headers, request }) => {
    configureHuggingFaceHeaders(headers, request);
  }
});
