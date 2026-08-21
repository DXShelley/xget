import { describe, expect, it } from 'vitest';

import { PLATFORM_CATALOG } from '../../src/config/platform-catalog.js';
import {
  filterPlatformTextResponse,
  isOriginBoundPlatformResponse,
  shouldFilterPlatformTextResponse,
  shouldVaryPlatformCacheByOrigin
} from '../../src/platforms/response-filters.js';
import { transformPlatformPath } from '../../src/platforms/path-transformers.js';
import { SORTED_PLATFORMS, getPlatformPathPrefix } from '../../src/routing/platform-index.js';

describe('Platform module boundaries', () => {
  it('keeps the platform catalog as the single source of upstream origins', () => {
    expect(PLATFORM_CATALOG.npm).toBe('https://registry.npmjs.org');
  });

  it('sorts platform keys by the longest routable prefix first', () => {
    const prefixLengths = SORTED_PLATFORMS.map(
      platformKey => getPlatformPathPrefix(platformKey).length
    );

    prefixLengths.forEach((length, index) => {
      if (index < prefixLengths.length - 1) {
        expect(length).toBeGreaterThanOrEqual(prefixLengths[index + 1]);
      }
    });
  });

  it('uses the dedicated transformer module for platform-specific paths', () => {
    expect(transformPlatformPath('/jenkins/test-path', 'jenkins')).toBe('/current/test-path');
    expect(transformPlatformPath('/crates/', 'crates')).toBe('/api/v1/crates');
  });

  it('keeps platform response filters outside generic response utilities', () => {
    expect(shouldFilterPlatformTextResponse('npm', '/npm/react', 'application/json')).toBe(true);
    expect(
      filterPlatformTextResponse(
        'pypi',
        '/pypi/simple/example/',
        'https://files.pythonhosted.org/packages/example.whl',
        'https://fast.dxshelley.fun'
      )
    ).toContain('https://fast.dxshelley.fun/pypi/files/packages/example.whl');
    expect(shouldVaryPlatformCacheByOrigin('flathub', '/flathub/repo/example.flatpakrepo')).toBe(
      true
    );
    expect(isOriginBoundPlatformResponse('pypi')).toBe(true);
  });
});
