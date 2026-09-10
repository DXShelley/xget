/**
 * Runs request filters in order and unwinds their response handling in reverse order.
 * @template T
 * @param {T} context
 * @param {ReadonlyArray<(context: T, next: () => Promise<Response>) => Promise<Response>>} filters
 * @returns {Promise<Response>} The response returned after every filter has unwound.
 */
export async function runPipeline(context, filters) {
  /** @param {number} index @returns {Promise<Response>} */
  const dispatch = async index => {
    const filter = filters[index];
    if (!filter) throw new Error('Request pipeline has no terminal response filter');
    return await filter(context, () => dispatch(index + 1));
  };
  return await dispatch(0);
}
