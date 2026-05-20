import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddClassWatch } from '@/components/AddClassWatch';
import { BottomNav } from '@/components/BottomNav';
import { DeleteAccountModal } from '@/components/DeleteAccountModal';
import { PullToRefreshIndicator } from '@/components/PullToRefreshIndicator';

const { mockPathname, mockPush } = vi.hoisted(() => ({
  mockPathname: vi.fn(),
  mockPush: vi.fn(),
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
      <option value="2261">Spring 2026 (2261)</option>
      <option value="2264">Summer 2026 (2264)</option>
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

  it('renders bottom navigation as links or a callback-driven add button', () => {
    const onAddClass = vi.fn();
    mockPathname.mockReturnValue('/dashboard/add');

    render(<BottomNav onAddClass={onAddClass} />);

    expect(screen.getByRole('link', { name: /dashboard/i })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('link', { name: /settings/i })).toHaveAttribute('href', '/settings');
    const addButton = screen.getByRole('button', { name: /add class/i });
    expect(addButton).toHaveAttribute('aria-current', 'page');
    fireEvent.click(addButton);
    expect(onAddClass).toHaveBeenCalled();
  });

  it('renders bottom navigation add action as a link when no callback is supplied', () => {
    render(<BottomNav />);

    expect(screen.getByRole('link', { name: /add class/i })).toHaveAttribute(
      'href',
      '/dashboard/add'
    );
  });

  it('validates and submits add-class watch requests', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<AddClassWatch onAdd={onAdd} />);

    fireEvent.submit(screen.getByRole('button', { name: /start watching/i }).closest('form')!);
    expect(
      await screen.findByText('Please select a term and enter a section number')
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: /term/i }), {
      target: { value: '2261' },
    });
    fireEvent.change(screen.getByLabelText(/section number/i), { target: { value: '123' } });
    fireEvent.submit(screen.getByRole('button', { name: /start watching/i }).closest('form')!);
    expect(await screen.findByText('Section number must be exactly 5 digits')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/section number/i), { target: { value: '12345' } });
    fireEvent.submit(screen.getByRole('button', { name: /start watching/i }).closest('form')!);
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith({ term: '2261', class_nbr: '12345' }));
  });

  it('shows add-class submission errors', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('Class already watched'));
    render(<AddClassWatch onAdd={onAdd} />);

    fireEvent.change(screen.getByRole('combobox', { name: /term/i }), {
      target: { value: '2261' },
    });
    fireEvent.change(screen.getByLabelText(/section number/i), { target: { value: '12345' } });
    fireEvent.submit(screen.getByRole('button', { name: /start watching/i }).closest('form')!);

    expect(await screen.findByText('Class already watched')).toBeInTheDocument();
  });

  it('requires explicit confirmation before deleting an account', async () => {
    const onClose = vi.fn();
    render(<DeleteAccountModal open onClose={onClose} />);

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

  it('surfaces account deletion errors and ignores close while loading', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Deletion failed' }),
    } as Response);
    const onClose = vi.fn();
    render(<DeleteAccountModal open onClose={onClose} />);

    fireEvent.change(screen.getByLabelText(/type delete to confirm/i), {
      target: { value: 'DELETE' },
    });
    fireEvent.click(screen.getByRole('button', { name: /delete account/i }));
    expect(await screen.findByText('Deletion failed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
