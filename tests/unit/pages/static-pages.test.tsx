import { render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vite-plus/test';
import AboutPage from '@/app/about/page';
import ASUClassSeatTrackerPost from '@/app/blog/asu-class-seat-tracker/page';
import ASURegistrationTipsPost from '@/app/blog/asu-registration-tips/page';
import ASUTransferRegistrationPost from '@/app/blog/asu-transfer-registration/page';
import ASUWaitlistGuidePost from '@/app/blog/asu-waitlist-guide/page';
import HowToGetIntoFullClassesPost from '@/app/blog/how-to-get-into-full-asu-classes/page';
import MyASUSearchTipsPost from '@/app/blog/myasu-search-tips/page';
import BlogIndexPage from '@/app/blog/page';
import FAQPage from '@/app/faq/page';
import LegalPage from '@/app/legal/page';
import PrivacyPolicyPage from '@/app/legal/privacy/page';
import TermsOfServicePage from '@/app/legal/terms/page';
import Home from '@/app/page';
import { blogPosts } from '@/lib/blog/posts';

type LinkHref = string | { pathname?: string };
type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: LinkHref;
  children: ReactNode;
};

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: LinkProps) => (
    <a href={typeof href === 'string' ? href : (href.pathname ?? '#')} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: vi.fn(),
  }),
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({
    theme: 'light',
    setTheme: vi.fn(),
  }),
}));

vi.mock('@/lib/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
  }),
}));

vi.mock('framer-motion', () => ({
  motion: createMotionElements(),
  m: createMotionElements(),
}));

beforeAll(() => {
  global.IntersectionObserver = class IntersectionObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  } as unknown as typeof IntersectionObserver;
});

type MotionTag = 'div' | 'button' | 'h1' | 'p' | 'ul' | 'li' | 'article' | 'span' | 'section';

function createMotionElements() {
  const MotionElement = ({
    as: Component,
    children,
    ...props
  }: { as: MotionTag; children?: ReactNode } & Record<string, unknown>) => {
    const {
      initial: _initial,
      animate: _animate,
      transition: _transition,
      whileInView: _whileInView,
      whileHover: _whileHover,
      whileTap: _whileTap,
      viewport: _viewport,
      variants: _variants,
      ...domProps
    } = props;

    return <Component {...domProps}>{children}</Component>;
  };

  const tags: MotionTag[] = ['div', 'button', 'h1', 'p', 'ul', 'li', 'article', 'span', 'section'];

  return Object.fromEntries(
    tags.map((tag) => [
      tag,
      (props: { children?: ReactNode } & Record<string, unknown>) => (
        <MotionElement as={tag} {...props} />
      ),
    ])
  );
}

describe('static marketing and legal pages', () => {
  it('renders the homepage sections that explain the class tracking flow', async () => {
    render(await Home());

    expect(
      screen.getByRole('heading', { name: /free asu class seat tracker/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/every 30 minutes so you don't have to/i)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /your dashboard, ready to go/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/see all frequently asked questions/i)).toHaveAttribute('href', '/faq');
  });

  it('renders the about page story, trust stats, and open-source link', async () => {
    render(await AboutPage());

    expect(screen.getByRole('heading', { name: /about pickmyclass/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /the problem we faced/i })).toBeInTheDocument();
    expect(screen.getByText('15,000+')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open source on github/i })).toHaveAttribute(
      'href',
      'https://github.com/Divkix/pickmyclass'
    );
  });

  it('renders FAQ categories, answers, and the registration call to action', async () => {
    render(await FAQPage());

    expect(
      screen.getByRole('heading', { name: /frequently asked questions/i, level: 1 })
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /getting started/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /features & compatibility/i })).toBeInTheDocument();
    expect(screen.getByText(/supports all asu campuses/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /get started free/i })).toHaveAttribute(
      'href',
      '/register'
    );
  });

  it('renders the legal index and document pages with their primary headings', async () => {
    const { rerender } = render(await LegalPage());
    expect(screen.getByRole('heading', { name: /legal documents/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /privacy policy/i })).toHaveAttribute(
      'href',
      '/legal/privacy'
    );

    rerender(await PrivacyPolicyPage());
    expect(screen.getByRole('heading', { name: /privacy policy/i })).toBeInTheDocument();
    expect(screen.getByText(/information we collect/i)).toBeInTheDocument();

    rerender(await TermsOfServicePage());
    expect(screen.getAllByText(/terms of service/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/user responsibilities/i)).toBeInTheDocument();
  });
});

describe('blog pages', () => {
  it('renders every published blog card on the blog index', async () => {
    render(await BlogIndexPage());

    const articleLinks = screen.getAllByRole('link').filter((link) => {
      return link.getAttribute('href')?.startsWith('/blog/');
    });

    expect(
      screen.getByRole('heading', { name: /asu registration tips & guides/i })
    ).toBeInTheDocument();
    expect(articleLinks).toHaveLength(blogPosts.length);
    expect(
      screen.getByRole('heading', { name: /how to get into full classes at asu/i })
    ).toBeInTheDocument();
    expect(screen.getAllByText(/min read/i).length).toBeGreaterThan(0);
  });

  it.each([
    {
      renderPage: ASUClassSeatTrackerPost,
      heading: 'ASU Class Seat Tracker: How to Get Notified When Seats Open',
    },
    {
      renderPage: ASURegistrationTipsPost,
      heading: 'ASU Registration Tips: Build Your Perfect Schedule',
    },
    {
      renderPage: ASUTransferRegistrationPost,
      heading: 'ASU Transfer Student Registration: Complete Guide for MyPath2ASU Students',
    },
    {
      renderPage: ASUWaitlistGuidePost,
      heading:
        "How to Add a Full ASU Class to the Waitlist (And What to Do If There's No Waitlist)",
    },
    {
      renderPage: HowToGetIntoFullClassesPost,
      heading: 'How to Get Into Full Classes at ASU: 7 Strategies That Work',
    },
    {
      renderPage: MyASUSearchTipsPost,
      heading: "MyASU Class Search: 10 Hidden Features Most Students Don't Know",
    },
  ])(
    'renders the $heading article body, takeaways, and FAQ section',
    async ({ renderPage, heading }) => {
      render(await renderPage());

      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
      expect(screen.getByText(/key takeaways/i)).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: /frequently asked questions/i })
      ).toBeInTheDocument();
      expect(screen.getAllByText(/pickmyclass/i).length).toBeGreaterThan(0);
    }
  );
});
