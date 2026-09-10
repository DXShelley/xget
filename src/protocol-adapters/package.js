import { PACKAGE_MANAGER_PLATFORM_KEYS } from '../config/platform-catalog.js';
import { createProtocolAdapter } from './base.js';

const PACKAGE_MANAGER_PATH_PREFIXES = Object.freeze(
  PACKAGE_MANAGER_PLATFORM_KEYS.map(key => `/${key.replaceAll('-', '/')}`)
);

/** @param {URL} url @returns {boolean} */
export function isPackageManagerRequest(url) {
  return PACKAGE_MANAGER_PATH_PREFIXES.some(
    prefix => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)
  );
}

export const PACKAGE_ADAPTER = createProtocolAdapter({ kind: 'package' });
