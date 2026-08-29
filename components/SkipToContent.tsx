/**
 * First focusable control on every page. Targets the `#main` landmark so
 * keyboard users skip the sticky header / nav chrome.
 */
export function SkipToContent() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2.5 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-smooth"
    >
      Skip to content
    </a>
  );
}
