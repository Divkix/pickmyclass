import { renderWithRouter } from "@/tests/helpers/render-with-router";
import { describe, expect, it } from "vite-plus/test";
import { FinishSetupCard } from "@/components/FinishSetupCard";
import { EmptyWatchlist } from "@/components/dashboard/EmptyStates";
import { DashboardPreview } from "@/components/landing/DashboardPreview";
import { FeaturesSection } from "@/components/landing/FeaturesSection";
import { HeroSection } from "@/components/landing/HeroSection";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { SocialProofBanner } from "@/components/landing/SocialProofBanner";

describe("navigation calls to action", () => {
  it.each([
    ["hero", <HeroSection key="hero" />, "/sign-up"],
    ["how it works", <HowItWorks key="how-it-works" />, "/sign-up"],
    ["empty watchlist", <EmptyWatchlist key="empty-watchlist" />, "/dashboard/add"],
    ["finish setup", <FinishSetupCard key="finish-setup" />, "/dashboard/add"],
  ])(
    "renders %s as styled links, not nested interactive elements",
    async (_name, content, href) => {
      const markup = await renderWithRouter(content);
      expect(markup).toContain(`href="${href}"`);
      expect(markup).toContain('data-slot="button"');
      expect(markup).not.toContain("<button");
    },
  );
});

describe("public landing sections", () => {
  it.each([
    ["hero", <HeroSection key="hero" />],
    ["features", <FeaturesSection key="features" />],
    ["how it works", <HowItWorks key="how-it-works" />],
    ["dashboard preview", <DashboardPreview key="preview" />],
    ["social proof", <SocialProofBanner key="social-proof" />],
  ])("renders %s visible before hydration", async (_name, content) => {
    const markup = await renderWithRouter(content);
    expect(markup).not.toContain("opacity:0");
  });
});
