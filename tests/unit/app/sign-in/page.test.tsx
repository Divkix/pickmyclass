import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const { mockSignIn } = vi.hoisted(() => ({
  mockSignIn: vi.fn(),
}));

vi.mock('@clerk/clerk-react', () => ({
  SignIn: mockSignIn,
}));

import SignInPage from '@/app/sign-in/[[...sign-in]]/page';

describe('sign-in page', () => {
  beforeEach(() => {
    mockSignIn.mockClear();
    mockSignIn.mockReturnValue(<div data-testid="clerk-sign-in" />);
  });

  it('renders the hosted Clerk SignIn with path routing', () => {
    render(<SignInPage />);

    expect(mockSignIn).toHaveBeenCalledTimes(1);
    const props = mockSignIn.mock.calls[0][0] as Record<string, unknown>;
    expect(props.routing).toBe('path');
    expect(props.path).toBe('/sign-in');
    expect(props.signUpUrl).toBe('/sign-up');
    expect(props.fallbackRedirectUrl).toBe('/dashboard');
    expect(screen.getByTestId('clerk-sign-in')).toBeInTheDocument();
  });

  it('brands the component with the ASU maroon primary color', () => {
    render(<SignInPage />);

    const props = mockSignIn.mock.calls[0][0] as {
      appearance?: { variables?: Record<string, string> };
    };
    expect(props.appearance?.variables?.colorPrimary).toBe('#7a0019');
    expect(props.appearance?.variables?.colorBackground).toBe('#fff8e7');
  });
});
