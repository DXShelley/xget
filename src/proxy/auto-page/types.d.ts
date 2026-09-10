/** Workers HTML parser, keeping the project's DOM Response type at the boundary. */
declare class HTMLRewriter {
  on(
    selector: string,
    handlers: import('@cloudflare/workers-types').HTMLRewriterElementContentHandlers
  ): HTMLRewriter;
  transform(response: Response): Response;
}
