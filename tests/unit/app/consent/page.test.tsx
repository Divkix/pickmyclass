import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import ConsentPage from '@/app/consent/page';

const { mockReplace, mockUseSearchParams } = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  mockUseSearchParams: vi.fn(),
}));

vi.mock('@/components/Header', () => ({
  Header: () => null,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: mockUseSearchParams,
}));

describe('ConsentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSearchParams.mockReturnValue(new URLSearchParams('next=/dashboard'));
    global.fetch = vi.fn();
  });

  function confirmStatements() {
    fireEvent.click(screen.getByLabelText(/i am 18 years or older/i));
    fireEvent.click(screen.getByLabelText(/i agree to the terms/i));
  }

  it('requires both statements and records consent before continuing', async () => {
    // SAFETY: test fetch mock only needs ok/json subset of Response
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    } as Response);
    render(<ConsentPage />);

    const continueButton = screen.getByRole('button', { name: /save and continue/i });
    expect(continueButton).toBeDisabled();

    confirmStatements();
    fireEvent.click(continueButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/auth/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ageVerified: true, agreedToTerms: true }),
      });
    });
    expect(mockReplace).toHaveBeenCalledWith('/dashboard');
  });

  it('keeps the gate open and explains persistence failures', async () => {
    // SAFETY: test fetch mock only needs ok/json subset of Response
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Could not save consent' }),
    } as Response);
    render(<ConsentPage />);

    confirmStatements();
    fireEvent.click(screen.getByRole('button', { name: /save and continue/i }));

    expect(await screen.findByText('Could not save consent')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('does not follow an external next URL', async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('next=https://evil.test'));
    // SAFETY: test fetch mock only needs ok/json subset of Response
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    } as Response);
    render(<ConsentPage />);

    confirmStatements();
    fireEvent.click(screen.getByRole('button', { name: /save and continue/i }));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
  });
});
