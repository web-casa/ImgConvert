import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

/**
 * Custom MDX components that extend Fumadocs defaults.
 *
 * Fumadocs already provides:
 * - Callout / CalloutContainer / CalloutTitle / CalloutDescription (for :::info etc.)
 * - Card / Cards
 * - CodeBlockTabs / CodeBlockTab
 * - Custom pre, img, table, h1-h6
 *
 * We add: external link indicators, and leave room for future extensions.
 */
export function getMDXComponents(components?: MDXComponents) {
  const base = { ...defaultMdxComponents, ...components };

  // Wrap links: external links get a subtle indicator.
  // Delegate internal links to the base link component (Fumadocs Link /
  // caller-supplied RelativeLink) so relative hrefs resolve and client-side
  // routing / prefetch are preserved.
  const BaseLink = base.a;
  if (BaseLink) {
    base.a = (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
      const { href, children, ...rest } = props;
      const isExternal =
        typeof href === "string" && (href.startsWith("http://") || href.startsWith("https://"));

      if (isExternal) {
        return (
          <a href={href} rel="noreferrer noopener" target="_blank" {...rest}>
            {children}
            <span className="ml-0.5 inline-block text-xs opacity-40">↗</span>
          </a>
        );
      }

      const LinkComp = BaseLink as React.ComponentType<
        React.AnchorHTMLAttributes<HTMLAnchorElement>
      >;
      return (
        <LinkComp href={href} {...rest}>
          {children}
        </LinkComp>
      );
    };
  }

  return base satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
