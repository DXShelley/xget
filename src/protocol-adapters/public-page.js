import { createProtocolAdapter } from './base.js';

/** Public generated pages have a dedicated anonymous Web strategy. */
export const PUBLIC_PAGE_ADAPTER = createProtocolAdapter({
  kind: 'public-page',
  allowsSharedCache: () => false
});
