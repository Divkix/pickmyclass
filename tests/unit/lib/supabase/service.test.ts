import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSupabaseCreateClient } = vi.hoisted(() => ({
  mockSupabaseCreateClient: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: mockSupabaseCreateClient,
}));

async function loadServiceModule() {
  vi.resetModules();
  return import('@/lib/supabase/service');
}

describe('supabase service client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabaseCreateClient.mockImplementation((_url: string, key: string) => ({ key }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('requires a service role key when creating clients directly', async () => {
    const { createServiceClient } = await loadServiceModule();

    expect(() => createServiceClient('')).toThrow('Service role key is required');
  });

  it('creates service clients with non-persistent auth options', async () => {
    const { createServiceClient } = await loadServiceModule();

    const client = createServiceClient('service-key');

    expect(client).toEqual({ key: 'service-key' });
    expect(mockSupabaseCreateClient).toHaveBeenCalledWith(
      'https://osopxwuebsefhoxgeojh.supabase.co',
      'service-key',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );
  });

  it('requires SUPABASE_SERVICE_ROLE_KEY for environment-backed clients', async () => {
    const { getServiceClient } = await loadServiceModule();

    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');

    expect(() => getServiceClient()).toThrow('SUPABASE_SERVICE_ROLE_KEY is not set');
  });

  it('caches environment-backed clients until the service role key changes', async () => {
    const { getServiceClient } = await loadServiceModule();

    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'first-key');
    const first = getServiceClient();
    const second = getServiceClient();

    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'second-key');
    const third = getServiceClient();

    expect(first).toBe(second);
    expect(third).not.toBe(first);
    expect(mockSupabaseCreateClient).toHaveBeenCalledTimes(2);
  });
});
