import { Header } from '@/components/Header';
import { AuthRedirect } from '@/components/landing/AuthRedirect';
import { DashboardPreview } from '@/components/landing/DashboardPreview';
import { FAQSection, faqs } from '@/components/landing/FAQSection';
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
    'Free ASU class seat tracker and notification service. Get email alerts when seats open in full ASU classes. Checks every 30 minutes.',
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
  featureList: [
    'Email notifications for open ASU class seats',
    'Instructor change alerts when Staff is assigned',
    'Automatic checks every 30 minutes',
    'Real-time dashboard with class status',
    'Support for all ASU campuses and online classes',
  ],
};

const howToSchema = {
  '@context': 'https://schema.org',
  '@type': 'HowTo',
  name: 'How to Get ASU Class Seat Notifications with PickMyClass',
  description:
    'Track ASU class availability and get free email alerts when seats open in full classes.',
  totalTime: 'PT2M',
  step: [
    {
      '@type': 'HowToStep',
      name: 'Add Your Classes',
      text: 'Search for ASU classes by section number and add them to your watchlist. You can track multiple classes at once.',
    },
    {
      '@type': 'HowToStep',
      name: 'We Monitor For You',
      text: "Our system checks ASU's class search every 30 minutes for seat availability changes and instructor assignments.",
    },
    {
      '@type': 'HowToStep',
      name: 'Get Notified Instantly',
      text: 'Receive an email the moment a seat opens up. Register for the class before everyone else on the waitlist.',
    },
  ],
};

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map((faq) => ({
    '@type': 'Question',
    name: faq.question,
    acceptedAnswer: {
      '@type': 'Answer',
      text: faq.answer,
    },
  })),
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
