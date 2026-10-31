import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo/head";
import { Header } from "@/components/Header";
import { AuthRedirect } from "@/components/landing/AuthRedirect";
import { DashboardPreview } from "@/components/landing/DashboardPreview";
import { FAQSection } from "@/components/landing/FAQSection";
import { FeaturesSection } from "@/components/landing/FeaturesSection";
import { HeroSection } from "@/components/landing/HeroSection";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { JsonLd } from "@/components/landing/JsonLd";
import { MobileStickyCTA } from "@/components/landing/MobileStickyCTA";
import { SocialProofBanner } from "@/components/landing/SocialProofBanner";
import { faqs } from "@/lib/faqs";

const homeTitle = "PickMyClass — Free ASU Class Seat Tracker & Open Seat Alerts";

const homeDescription =
  "Free ASU class seat tracker. Get email alerts when seats open in full ASU classes. Trusted by 2,400+ Sun Devils.";

export const Route = createFileRoute("/")({
  head: () =>
    pageHead({
      absoluteTitle: homeTitle,
      description:
        "Get a free email the moment a seat opens in a full ASU class. PickMyClass checks every 30 minutes so you stop refreshing MyASU. Trusted by 2,400+ Sun Devils.",
      path: "/",
      social: {
        title: homeTitle,
        description: homeDescription,
      },
    }),
  component: Home,
});

const webApplicationSchema = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "PickMyClass",
  url: "https://pickmyclass.app",
  description:
    "Free ASU class seat tracker and notification service. Get email alerts when seats open in full ASU classes. Checks every 30 minutes.",
  applicationCategory: "EducationalApplication",
  operatingSystem: "Web",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  author: {
    "@type": "Organization",
    name: "PickMyClass",
  },
  screenshot: "https://pickmyclass.app/og-image.png",
  featureList: [
    "Email notifications for open ASU class seats",
    "Alerts when ASU replaces Staff with a named instructor",
    "Automatic checks every 30 minutes",
    "Real-time dashboard with class status",
    "Support for all ASU campuses and online classes",
  ],
};

// Keep setup steps aligned with HowItWorks: create an account, add class numbers, then get alerts.
const howToSchema = {
  "@context": "https://schema.org",
  "@type": "HowTo",
  name: "How to Get ASU Class Seat Notifications with PickMyClass",
  description:
    "Track ASU class availability and get free email alerts when seats open in full classes.",
  totalTime: "PT2M",
  step: [
    {
      "@type": "HowToStep",
      name: "Create a free account",
      text: "Sign up for a free PickMyClass account.",
    },
    {
      "@type": "HowToStep",
      name: "Add your classes",
      text: "Find the 5-digit class number in ASU Class Search. Choose the term and enter that number in PickMyClass. You can watch up to 10 classes at a time.",
    },
    {
      "@type": "HowToStep",
      name: "Get email alerts",
      text: "We check every 30 minutes and email you when we detect an open seat or a named instructor assignment. Register through MyASU.",
    },
  ],
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: faq.answer,
    },
  })),
};

function Home() {
  return (
    <AuthRedirect>
      <div className="flex min-h-screen flex-col bg-background">
        <Header />

        <main id="main" tabIndex={-1} className="flex-1 pb-16 sm:pb-0">
          <HeroSection />
          <SocialProofBanner />
          <FeaturesSection />
          <DashboardPreview />
          <HowItWorks />
          <FAQSection />
        </main>

        <MobileStickyCTA />
      </div>

      <JsonLd data={webApplicationSchema} />
      <JsonLd data={howToSchema} />
      <JsonLd data={faqSchema} />
    </AuthRedirect>
  );
}
