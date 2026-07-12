import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vite-plus/test';
import { FinishSetupCard } from '@/components/FinishSetupCard';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

describe('FinishSetupCard', () => {
  it('renders the finish-setup prompt', () => {
    render(<FinishSetupCard />);

    expect(screen.getByText('Finish setting up')).toBeInTheDocument();
    expect(screen.getByText(/Add your first class and we/i)).toBeInTheDocument();
  });

  it('links to the add-class page so skipping leads to finishing setup', () => {
    render(<FinishSetupCard />);

    expect(screen.getByRole('link', { name: /add a class/i })).toHaveAttribute(
      'href',
      '/dashboard/add'
    );
  });
});
