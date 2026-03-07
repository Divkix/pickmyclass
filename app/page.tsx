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
    "Get instant email alerts when seats open up in full ASU classes. We check every 30 minutes so you don't have to.",
  applicationCategory: 'EducationalApplication',
  operatingSystem: 'Web',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
  aggregateRating: {
    '@type': 'AggregateRating',
    ratingValue: '4.8',
    ratingCount: '2400',
  },
};

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'How does PickMyClass work?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: "PickMyClass works in three simple steps: (1) Add your ASU classes by section number to your watchlist, (2) Our system automatically checks ASU's class search every 30 minutes for seat availability and instructor changes, (3) You get an email the moment a seat opens so you can register before everyone else.",
      },
    },
    {
      '@type': 'Question',
      name: 'Is PickMyClass free?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes, free forever for all ASU students.',
      },
    },
    {
      '@type': 'Question',
      name: 'How often does PickMyClass check for open seats?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Every 30 minutes.',
      },
    },
    {
      '@type': 'Question',
      name: 'Does PickMyClass work for all ASU classes?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: "Yes, any class section listed on ASU's class search.",
      },
    },
  ],
};

const howToSchema = {
  '@context': 'https://schema.org',
  '@type': 'HowTo',
  name: 'How to get notified when ASU class seats open up',
  description:
    'Use PickMyClass to monitor ASU class availability and get email alerts when seats open.',
  step: [
    {
      '@type': 'HowToStep',
      position: 1,
      name: 'Add Your Classes',
      text: 'Search for ASU classes by section number and add them to your watchlist.',
    },
    {
      '@type': 'HowToStep',
      position: 2,
      name: 'We Handle the Obsessing',
      text: "Our system checks ASU's class search every 30 minutes for seat availability and instructor changes.",
    },
    {
      '@type': 'HowToStep',
      position: 3,
      name: 'Register Before Everyone Else',
      text: 'Get an email the moment a seat opens. Beat the crowd. Get your schedule.',
    },
  ],
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
      <JsonLd data={faqSchema} />
      <JsonLd data={howToSchema} />
    </AuthRedirect>
  );
}
