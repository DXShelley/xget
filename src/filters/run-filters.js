/**
 * Runs asynchronous request or response filters in registration order.
 * @template T
 * @param {T} context
 * @param {Array<(context: T) => T | Promise<T>>} filters
 * @returns {Promise<T>} The context returned by the final filter.
 */
export async function runFilters(context, filters) {
  let current = context;
  for (const filter of filters) {
    current = await filter(current);
  }
  return current;
}
