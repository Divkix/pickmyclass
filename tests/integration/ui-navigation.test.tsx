import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { FinishSetupCard } from "@/components/FinishSetupCard";
import { EmptyWatchlist } from "@/components/dashboard/EmptyStates";
import { HeroSection } from "@/components/landing/HeroSection";
import { HowItWorks } from "@/components/landing/HowItWorks";

describe("navigation calls to action", () => {
  it.each([
    ["hero", <HeroSection key="hero" />, "/sign-up"],
    ["how it works", <HowItWorks key="how-it-works" />, "/sign-up"],
    ["empty watchlist", <EmptyWatchlist key="empty-watchlist" />, "/dashboard/add"],
    ["finish setup", <FinishSetupCard key="finish-setup" />, "/dashboard/add"],
  ])("renders %s as styled links, not nested interactive elements", (_name, content, href) => {
    const markup = renderToStaticMarkup(content);
    expect(markup).toContain(`href="${href}"`);
    expect(markup).toContain('data-slot="button"');
    expect(markup).not.toContain("<button");
  });
});
