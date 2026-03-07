import { Header } from '@/components/Header';
import { AuthRedirect } from '@/components/landing/AuthRedirect';
import { DashboardPreview } from '@/components/landing/DashboardPreview';
import { FeaturesSection } from '@/components/landing/FeaturesSection';
import { HeroSection } from '@/components/landing/HeroSection';
import { HowItWorks } from '@/components/landing/HowItWorks';
import { JsonLd } from '@/components/landing/JsonLd';
import { MobileStickyCTA } from '@/components/landing/MobileStickyCTA';
import { SocialProofBanner } from '@/components/landing/SocialProofBanner';
export const dynamic = 'error';

const webApplicationSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'PickMyClass',
  url: 'https://pickmyclass.app',
  description:
    "Get timely email alerts when seats open up in full ASU classes. We check every 30 minutes so you don't have to.",
  applicationCategory: 'EducationalApplication',
  operatingSystem: 'Web',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
  author: {
    '@type': 'Organization',
    name: 'PickMyClass',
  },
  screenshot: 'https://pickmyclass.app/og-image.png',
};

export default async function Home() {
  return (
    <AuthRedirect>
      <div className="flex min-h-screen flex-col bg-background">
        <Header />

        <main className="flex-1 pb-16 sm:pb-0">
          <HeroSection />
          <SocialProofBanner />
          <FeaturesSection />
          <DashboardPreview />
          <HowItWorks />
        </main>

        <MobileStickyCTA />
      </div>

      <JsonLd data={webApplicationSchema} />
    </AuthRedirect>
  );
}
