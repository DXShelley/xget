/** Immutable per-label mapping, available immediately across Cloudflare locations. */
export class PageMap {
  /**
   * Retains the platform-provided storage handle.
   * @param {import('@cloudflare/workers-types').DurableObjectState} state Durable object state.
   */
  constructor(state) {
    this.state = state;
  }

  /**
   * Stores only origin/path; concurrent registrations cannot replace an existing mapping.
   * @param {Request} request Internal request.
   * @returns {Promise<Response>} Mapping result.
   */
  async fetch(request) {
    if (request.method === 'PUT') {
      const value = await request.text();
      if (value.length > 8192) return new Response(null, { status: 413 });
      const ok = await this.state.storage.transaction(async storage => {
        const previous = await storage.get('target');
        if (previous && previous !== value) return false;
        if (!previous) await storage.put('target', value);
        return true;
      });
      return new Response(null, { status: ok ? 204 : 409 });
    }
    const value = await this.state.storage.get('target');
    return typeof value === 'string' ? new Response(value) : new Response(null, { status: 404 });
  }
}
