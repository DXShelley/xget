/* global HTMLRewriter */
import { parse as parseCss, walk, generate } from 'css-tree';
import valueParser from 'postcss-value-parser';
import { parse } from 'es-module-lexer/js';
import { navigationUrl, resourceUrl, publicTarget } from './urls.js';

/**
 * Rewrites literal imports while leaving executable code intact.
 * @param {string} text
 * @param {URL} base
 * @param {string} mirror
 * @returns {string} Rewritten module.
 */
export function rewriteModule(text, base, mirror) {
  const [imports] = parse(text);
  for (const item of [...imports].reverse()) {
    if (!item.n || !/^(\.|\/|https?:)/.test(item.n)) continue;
    const mapped = resourceUrl(item.n, base, mirror);
    text =
      text.slice(0, item.s) + (item.d >= 0 ? JSON.stringify(mapped) : mapped) + text.slice(item.e);
  }
  return text;
}

/**
 * Rewrites CSS URLs with a CSS value parser, preserving data URLs and quoting.
 * @param {string} value
 * @param {URL} base
 * @param {string} mirror
 * @returns {string} Rewritten value.
 */
function cssValue(value, base, mirror) {
  const parsed = valueParser(value);
  parsed.walk(node => {
    if (node.type === 'function' && node.value.toLowerCase() === 'url') {
      const raw = valueParser.stringify(node.nodes).trim();
      const source = /^['"]/.test(raw) ? raw.slice(1, -1) : raw;
      const mapped = resourceUrl(source, base, mirror);
      node.nodes = [
        { type: 'string', quote: '"', value: mapped, sourceIndex: 0, sourceEndIndex: 0 }
      ];
      return false;
    }
    return undefined;
  });
  return parsed.toString();
}

/**
 * Rewrites stylesheet resources and quoted imports.
 * @param {string} text
 * @param {URL} base
 * @param {string} mirror
 * @returns {string} Stylesheet.
 */
export function rewriteCss(text, base, mirror) {
  const root = parseCss(text, { parseCustomProperty: true });
  walk(root, node => {
    if (node.type === 'Url') node.value = resourceUrl(node.value, base, mirror);
    if (
      node.type === 'Atrule' &&
      node.name.toLowerCase() === 'import' &&
      node.prelude?.type === 'AtrulePrelude'
    ) {
      const { first } = node.prelude.children;
      if (first?.type === 'String') first.value = resourceUrl(first.value, base, mirror);
    }
  });
  return generate(root);
}

/**
 * Maps a srcset list without splitting the comma inside a data URL.
 * @param {string} text
 * @param {URL} base
 * @param {string} mirror
 * @returns {string} Rewritten source candidates.
 */
function rewriteSrcset(text, base, mirror) {
  const output = [];
  let cursor = 0;
  while (cursor < text.length) {
    while (/[\s,]/.test(text[cursor] || '') && cursor < text.length) cursor++;
    const start = cursor;
    while (cursor < text.length && !/\s/.test(text[cursor])) cursor++;
    let source = text.slice(start, cursor);
    if (!source) break;
    const terminated = source.endsWith(',');
    source = source.replace(/,+$/, '');
    const descriptorStart = cursor;
    if (!terminated) while (cursor < text.length && text[cursor] !== ',') cursor++;
    output.push(resourceUrl(source, base, mirror) + text.slice(descriptorStart, cursor));
    if (text[cursor] === ',') cursor++;
  }
  return output.join(', ');
}

/**
 * Rewrites a buffered document with Cloudflare's HTML parser.
 * @param {string} text
 * @param {URL} target
 * @param {string} mirror
 * @returns {Promise<string>} Rewritten document.
 */
export async function rewriteHtml(text, target, mirror) {
  let base = target;
  let foundBase = false;
  await new HTMLRewriter()
    .on('base[href]', {
      element(element) {
        if (!foundBase) {
          base = publicTarget(new URL(element.getAttribute('href') || '', target));
          foundBase = true;
        }
      }
    })
    .transform(new Response(text))
    .text();
  const escape = (/** @type {string} */ value) =>
    value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  const rewriter = new HTMLRewriter()
    .on('base', {
      element(element) {
        element.remove();
      }
    })
    .on('meta[http-equiv]', {
      element(element) {
        const type = element.getAttribute('http-equiv')?.toLowerCase();
        if (type === 'content-security-policy') element.remove();
        if (type === 'refresh') {
          const match = /^\s*([\d.]+)\s*;\s*url\s*=\s*['"]?(.*?)['"]?\s*$/i.exec(
            element.getAttribute('content') || ''
          );
          if (match)
            element.setAttribute('content', `${match[1]};url=${navigationUrl(match[2], base)}`);
          else element.remove();
        }
      }
    })
    .on('head', {
      element(element) {
        element.prepend(
          `<base href="${escape(resourceUrl(base.href, base, mirror))}"><script src="${mirror}/__xget/page-runtime.js" data-upstream="${escape(base.href)}"></script>`,
          { html: true }
        );
      }
    })
    .on('*', {
      element(element) {
        for (const attr of ['src', 'poster', 'component-url', 'renderer-url', 'data-src']) {
          const value = element.getAttribute(attr);
          if (value) {
            try {
              element.setAttribute(attr, resourceUrl(value, base, mirror));
            } catch {
              element.removeAttribute(attr);
            }
          }
        }
        for (const attr of ['srcset', 'imagesrcset']) {
          const value = element.getAttribute(attr);
          if (value) {
            try {
              element.setAttribute(attr, rewriteSrcset(value, base, mirror));
            } catch {
              element.removeAttribute(attr);
            }
          }
        }
        const href = element.getAttribute('href');
        if (href && element.tagName !== 'base') {
          const rel = element.getAttribute('rel') || '';
          if (/^(preconnect|dns-prefetch)$/i.test(rel)) element.remove();
          else if (!/^(canonical|alternate)$/i.test(rel)) {
            try {
              element.setAttribute(
                'href',
                element.tagName === 'a' || element.tagName === 'area'
                  ? href.startsWith('#')
                    ? `${mirror}/${target.search}${href}`
                    : navigationUrl(href, base)
                  : resourceUrl(href, base, mirror)
              );
            } catch {
              element.removeAttribute('href');
            }
          }
        }
        if (element.tagName === 'form') {
          const action = new URL(element.getAttribute('action') || target.href, base);
          element.setAttribute('data-upstream-action', action.href);
          element.setAttribute('action', 'https://fast.dxshelley.fun/');
        }
        const style = element.getAttribute('style');
        if (style) {
          try {
            element.setAttribute('style', cssValue(style, base, mirror));
          } catch {
            element.removeAttribute('style');
          }
        }
        element.removeAttribute('integrity');
        element.removeAttribute('crossorigin');
      }
    });
  // Text chunks can split imports and URLs; replace only after collecting a full element.
  let scriptText = '';
  let scriptType = '';
  rewriter.on('script:not([src])', {
    element(element) {
      scriptText = '';
      scriptType = element.getAttribute('type') || '';
    },
    text(chunk) {
      scriptText += chunk.text;
      if (chunk.lastInTextNode) {
        const executable =
          !scriptType || /^(module|text\/javascript|application\/javascript)$/.test(scriptType);
        chunk.replace(executable ? rewriteModule(scriptText, base, mirror) : scriptText, {
          html: true
        });
      } else chunk.remove();
    }
  });
  let styleText = '';
  rewriter.on('style', {
    element() {
      styleText = '';
    },
    text(chunk) {
      styleText += chunk.text;
      if (chunk.lastInTextNode) chunk.replace(rewriteCss(styleText, base, mirror), { html: true });
      else chunk.remove();
    }
  });
  return await rewriter.transform(new Response(text)).text();
}
