import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const { mockSignUp } = vi.hoisted(() => ({
  mockSignUp: vi.fn(),
}));

vi.mock('@clerk/react', () => ({
  SignUp: mockSignUp,
}));

vi.mock('@/components/Header', () => ({
  Header: () => <div data-testid="header" />,
}));

import SignUpPage from '@/app/sign-up/[[...sign-up]]/page';

describe('sign-up page', () => {
  beforeEach(() => {
    mockSignUp.mockClear();
    mockSignUp.mockReturnValue(<div data-testid="clerk-sign-up" />);
  });

  it('renders the hosted Clerk SignUp with path routing', () => {
    render(<SignUpPage />);

    expect(mockSignUp).toHaveBeenCalledTimes(1);
    const props = mockSignUp.mock.calls[0][0] as Record<string, unknown>;
    expect(props.routing).toBe('path');
    expect(props.path).toBe('/sign-up');
    expect(props.signInUrl).toBe('/sign-in');
    expect(props.fallbackRedirectUrl).toBe('/auth/post-oauth?next=%2Fdashboard');
    expect(screen.getByTestId('clerk-sign-up')).toBeInTheDocument();
  });

  it('brands the component with the ASU maroon primary color', () => {
    render(<SignUpPage />);

    const props = mockSignUp.mock.calls[0][0] as {
      appearance?: { variables?: Record<string, string> };
    };
    expect(props.appearance?.variables?.colorPrimary).toBe('#7a0019');
    expect(props.appearance?.variables?.colorBackground).toBe('#fff8e7');
  });
});
