/**
 * Xget - High-performance acceleration engine for developer resources
 * Copyright (C) Xi Xu
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { PLATFORM_CATALOG } from '../config/platform-catalog.js';
import { getPlatformPathPrefix } from '../routing/platform-index.js';

/**
 * Escapes a string for safe use in a regular expression.
 * @param {string} value
 * @returns {string} A regular-expression-safe value.
 */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Removes the recognized platform prefix from a routed path.
 * @param {string} path
 * @param {string} platformKey
 * @returns {string} Path without its platform prefix.
 */
function stripPlatformPrefix(path, platformKey) {
  return path.replace(new RegExp(`^${escapeRegex(getPlatformPathPrefix(platformKey))}`), '/');
}

/**
 * Normalizes a Crates.io route for its API upstream.
 * @param {string} path
 * @returns {string} Crates.io upstream path.
 */
function transformCratesPath(path) {
  if (!path.startsWith('/')) return path;
  if (path === '/' || path.startsWith('/?')) return path.replace('/', '/api/v1/crates');
  return `/api/v1/crates${path}`;
}

/**
 * Normalizes a Jenkins route for the Update Center upstream.
 * @param {string} path
 * @returns {string} Jenkins upstream path.
 */
function transformJenkinsPath(path) {
  if (!path.startsWith('/')) return path;
  if (path === '/update-center.json') return '/current/update-center.json';
  if (path === '/update-center.actual.json') return '/current/update-center.actual.json';
  if (
    path.startsWith('/experimental/') ||
    path.startsWith('/download/') ||
    path.startsWith('/current/')
  ) {
    return path;
  }
  return `/current${path}`;
}

/** @type {{ [key: string]: (path: string) => string }} */
const PLATFORM_PATH_TRANSFORMERS = {
  crates: transformCratesPath,
  jenkins: transformJenkinsPath
};

/**
 * Converts a routed request path into the upstream path expected by the platform.
 * @param {string} path
 * @param {string} platformKey
 * @returns {string} Upstream-ready request path.
 */
export function transformPlatformPath(path, platformKey) {
  if (!PLATFORM_CATALOG[platformKey]) return path;

  const strippedPath = stripPlatformPrefix(path, platformKey);
  const transformer = PLATFORM_PATH_TRANSFORMERS[platformKey];
  return transformer ? transformer(strippedPath) : strippedPath;
}
