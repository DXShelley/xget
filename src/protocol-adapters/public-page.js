import { BASE_PROTOCOL_ADAPTER, allowAnonymous } from './base.js';

/** Public generated pages have a dedicated anonymous Web strategy. */
export const PUBLIC_PAGE_ADAPTER = Object.freeze({
  ...BASE_PROTOCOL_ADAPTER,
  kind: 'public-page',
  allowsSharedCache: () => false,
  authenticate: async () => allowAnonymous()
});
