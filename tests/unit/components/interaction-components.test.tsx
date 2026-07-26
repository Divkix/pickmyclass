import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { AddClassWatch } from '@/components/AddClassWatch';
import { BottomNav } from '@/components/BottomNav';
import { DeleteAccountModal } from '@/components/DeleteAccountModal';
import { PullToRefreshIndicator } from '@/components/PullToRefreshIndicator';
import type { ClassWatchRow } from '@/lib/types/class-watch';

const { mockCreateWatch, mockPathname, mockPush } = vi.hoisted(() => ({
  mockCreateWatch: vi.fn(),
  mockPathname: vi.fn(),
  mockPush: vi.fn(),
}));

const mockSelectableTerms = vi.hoisted(() => [
  {
    code: '2264',
    label: 'Summer 2026',
    season: 'summer' as const,
    year: 2026,
    catalogAvailable: { year: 2026, month: 2, day: 5 },
    sessionStart: { year: 2026, month: 5, day: 18 },
    sessionEnd: { year: 2026, month: 8, day: 14 },
  },
  {
    code: '2267',
    label: 'Fall 2026',
    season: 'fall' as const,
    year: 2026,
    catalogAvailable: { year: 2026, month: 2, day: 23 },
    sessionStart: { year: 2026, month: 8, day: 20 },
    sessionEnd: { year: 2026, month: 12, day: 12 },
  },
]);

vi.mock('@/lib/asu/terms', () => ({
  getSelectableTerms: () => mockSelectableTerms,
  formatTermOption: (term: { label: string; code: string }) => `${term.label} (${term.code})`,
}));

vi.mock('@/lib/class-watches/class-watch-creation', () => ({
  classWatchCreation: {
    create: mockCreateWatch,
    getOptions: () => ({ terms: mockSelectableTerms, defaultTerm: '2264' }),
  },
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    onClick,
    ...props
  }: { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useRouter: () => ({
    push: mockPush,
  }),
}));

vi.mock('@/lib/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, loading: false }),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    open,
    children,
    onOpenChange,
  }: {
    open: boolean;
    children: ReactNode;
    onOpenChange?: (open: boolean) => void;
  }) => (
    <div data-open={open}>
      {open ? (
        <>
          <button type="button" aria-label="Close dialog" onClick={() => onOpenChange?.(false)} />
          {children}
        </>
      ) : null}
    </div>
  ),
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div
      role="dialog"
      tabIndex={-1}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={() => {}}
    >
      {children}
    </div>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    disabled,
    onValueChange,
  }: {
    value?: string;
    disabled?: boolean;
    onValueChange?: (value: string) => void;
  }) => (
    <select
      aria-label={disabled ? 'University' : 'Term'}
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      <option value="">Select term</option>
      <option value="asu">Arizona State University (ASU)</option>
      <option value="2264">Summer 2026 (2264)</option>
      <option value="2267">Fall 2026 (2267)</option>
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <>{placeholder}</>,
}));

describe('interactive components', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockPathname.mockReturnValue('/dashboard');
    mockCreateWatch.mockResolvedValue({ id: 'watch-1' } as ClassWatchRow);
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('renders pull-to-refresh states based on distance and refresh status', () => {
    const { rerender, container } = render(
      <PullToRefreshIndicator pullDistance={0} isRefreshing={false} threshold={80} />
    );
    expect(container.firstChild).toBeNull();

    rerender(<PullToRefreshIndicator pullDistance={20} isRefreshing={false} threshold={80} />);
    expect(screen.getByText('Pull to refresh')).toBeInTheDocument();

    rerender(<PullToRefreshIndicator pullDistance={100} isRefreshing={false} threshold={80} />);
    expect(screen.getByText('Release to refresh')).toBeInTheDocument();

    rerender(<PullToRefreshIndicator pullDistance={80} isRefreshing={true} threshold={80} />);
    expect(screen.getByText('Refreshing...')).toBeInTheDocument();
  });

  it('renders bottom navigation links and marks the current page', () => {
    mockPathname.mockReturnValue('/dashboard/add');

    render(<BottomNav />);

    expect(screen.getByRole('link', { name: /dashboard/i })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('link', { name: /settings/i })).toHaveAttribute('href', '/settings');
    expect(screen.getByRole('link', { name: /add class/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('submits through the creation module and reports the created watch', async () => {
    const onCreated = vi.fn().mockResolvedValue(undefined);
    render(<AddClassWatch onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText(/section number/i), { target: { value: '12345' } });
    fireEvent.submit(screen.getByRole('button', { name: /start watching/i }).closest('form')!);
    await waitFor(() => {
      expect(mockCreateWatch).toHaveBeenCalledWith({ term: '2264', class_nbr: '12345' });
      expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'watch-1' }), {
        term: '2264',
        class_nbr: '12345',
      });
    });
  });

  it('shows add-class submission errors', async () => {
    mockCreateWatch.mockRejectedValue(new Error('Class already watched'));
    render(<AddClassWatch onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/section number/i), { target: { value: '12345' } });
    fireEvent.submit(screen.getByRole('button', { name: /start watching/i }).closest('form')!);

    expect(await screen.findByText('Class already watched')).toBeInTheDocument();
  });

  it('requires explicit confirmation before deleting an account', async () => {
    const onClose = vi.fn();
    render(<DeleteAccountModal open onOpenChange={onClose} />);

    expect(screen.getByRole('button', { name: /delete account/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/type delete to confirm/i), {
      target: { value: 'DELETE' },
    });
    fireEvent.click(screen.getByRole('button', { name: /delete account/i }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('/api/user/delete', { method: 'DELETE' })
    );
    expect(mockPush).toHaveBeenCalledWith('/login?message=Account deleted successfully');
  });

  it('surfaces account deletion errors and allows close after error', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Deletion failed' }),
    } as Response);
    const onClose = vi.fn();
    render(<DeleteAccountModal open onOpenChange={onClose} />);

    fireEvent.change(screen.getByLabelText(/type delete to confirm/i), {
      target: { value: 'DELETE' },
    });
    fireEvent.click(screen.getByRole('button', { name: /delete account/i }));
    expect(await screen.findByText('Deletion failed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
