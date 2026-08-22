import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vite-plus/test';
import { AuthProvider } from '@/lib/contexts/AuthContext';

// Mock the supabase client module
const mockSupabaseClient = {
  auth: {
    getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    onAuthStateChange: vi.fn().mockReturnValue({
      data: {
        subscription: {
          unsubscribe: vi.fn(),
        },
      },
    }),
  },
};

// Track createClient calls
const createClientMock = vi.fn().mockReturnValue(mockSupabaseClient);

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => createClientMock(),
}));

describe.skip('AuthContext', () => {
  it('should memoize supabase client and not recreate it on re-renders', async () => {
    // Reset call count
    createClientMock.mockClear();

    // Create a component that triggers re-renders
    let renderCount = 0;
    function TestComponent() {
      renderCount++;
      return <div data-testid="render-count">{renderCount}</div>;
    }

    function App() {
      return (
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );
    }

    // Initial render
    const { rerender } = render(<App />);

    // Wait for initial auth check
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Trigger multiple re-renders
    rerender(<App />);
    rerender(<App />);
    rerender(<App />);

    // Wait for any async effects
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Verify createClient was called exactly once
    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('render-count').textContent).toBe('4');
  });
});
