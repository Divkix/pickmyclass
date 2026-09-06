import { fireEvent, render, screen, within } from '@testing-library/react';
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
type JsonValue =
  | string
  | number
  | boolean
  | null
  | ReactNode
  | JsonValue[]
  | { [key: string]: JsonValue };

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
  // eslint-disable-next-line anti-slop/no-chained-type-assertions
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
  }: { as: MotionTag; children?: ReactNode } & Record<string, JsonValue>) => {
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
      (props: { children?: ReactNode } & Record<string, JsonValue>) => (
        <MotionElement as={tag} {...props} />
      ),
    ])
  );
}

describe('static marketing and legal pages', () => {
  it('links the FAQ from the homepage main landmark', async () => {
    render(await Home());

    expect(document.querySelector('main#main')).toBeInTheDocument();
    expect(screen.getByText(/see all frequently asked questions/i)).toHaveAttribute('href', '/faq');
  });

  it('links money-post guides from homepage body copy', async () => {
    render(await Home());

    expect(screen.getByRole('link', { name: /^asu class search$/i })).toHaveAttribute(
      'href',
      '/blog/asu-class-search'
    );
    expect(screen.getByRole('link', { name: /^asu class seat tracker$/i })).toHaveAttribute(
      'href',
      '/blog/asu-class-seat-tracker'
    );
    expect(screen.getByRole('link', { name: /asu waitlist guide/i })).toHaveAttribute(
      'href',
      '/blog/asu-waitlist-guide'
    );
    expect(
      screen.getByRole('link', { name: /strategies to get into full asu classes/i })
    ).toHaveAttribute('href', '/blog/how-to-get-into-full-asu-classes');
  });

  it('moves authentication actions into the mobile menu below the desktop breakpoint', async () => {
    render(await Home());

    const header = screen.getByRole('banner');
    const headerLogin = within(header).getByRole('link', { name: 'Sign in' });
    expect(headerLogin.closest('.hidden')).toHaveClass('md:block');

    fireEvent.click(within(header).getByRole('button', { name: 'Open menu' }));
    const mobileNav = within(header).getByRole('navigation', { name: 'Mobile navigation' });
    expect(within(mobileNav).getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/sign-in'
    );
    expect(within(mobileNav).getByRole('link', { name: 'Sign up' })).toHaveAttribute(
      'href',
      '/sign-up'
    );
  });

  it('links the open-source repo from the about page', async () => {
    render(await AboutPage());

    expect(screen.getByRole('link', { name: /open source on github/i })).toHaveAttribute(
      'href',
      'https://github.com/Divkix/pickmyclass'
    );
    expect(document.querySelector('main#main')).toBeInTheDocument();
  });

  it('links registration from the FAQ page', async () => {
    render(await FAQPage());

    expect(screen.getByRole('link', { name: /get started free/i })).toHaveAttribute(
      'href',
      '/sign-up'
    );
    expect(document.querySelector('main#main')).toBeInTheDocument();
  });

  it('links the legal documents and renders each page landmark', async () => {
    const { rerender } = render(await LegalPage());
    expect(screen.getByRole('link', { name: /privacy policy/i })).toHaveAttribute(
      'href',
      '/legal/privacy'
    );
    expect(screen.getByRole('link', { name: /terms of service/i })).toHaveAttribute(
      'href',
      '/legal/terms'
    );

    rerender(await PrivacyPolicyPage());
    expect(document.querySelector('main#main')).toBeInTheDocument();

    rerender(await TermsOfServicePage());
    expect(document.querySelector('main#main')).toBeInTheDocument();
  });
});

describe('blog pages', () => {
  it('renders every published blog card on the blog index', async () => {
    render(await BlogIndexPage());

    const articleLinks = screen.getAllByRole('link').filter((link) => {
      return link.getAttribute('href')?.startsWith('/blog/');
    });

    expect(articleLinks).toHaveLength(blogPosts.length);

    const schemas = [...document.querySelectorAll('script[type="application/ld+json"]')].map(
      (script) => {
        return JSON.parse(script.textContent ?? '{}') as {
          '@type'?: string;
          itemListElement?: {
            '@type': string;
            position: number;
            name: string;
            item?: string;
          }[];
        };
      }
    );
    const breadcrumbs = schemas.find((schema) => schema['@type'] === 'BreadcrumbList');
    expect(breadcrumbs?.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://pickmyclass.app/' },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://pickmyclass.app/blog' },
    ]);
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
  ])('renders the $heading article with FAQ schema', async ({ renderPage }) => {
    render(await renderPage());

    expect(document.querySelector('main#main article')).toBeInTheDocument();
    const schemas = [...document.querySelectorAll('script[type="application/ld+json"]')].map(
      (script) => JSON.parse(script.textContent ?? '{}') as { '@type'?: string }
    );
    expect(schemas.some((schema) => schema['@type'] === 'FAQPage')).toBe(true);
  });
});
