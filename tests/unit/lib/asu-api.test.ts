import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchClassFromASU } from '@/lib/asu/api';

function buildAsuSuccessResponse() {
  return {
    hits: {
      total: { value: 1 },
      hits: [
        {
          _source: {
            CLASSNBR: '42737',
            SUBJECT: 'ABS',
            CATALOGNBR: '302',
            COURSETITLELONG: 'Ethical and Policy Issues in Biology',
            INSTRUCTORSLIST: ['Ms Julie Murphree'],
            ENRLCAP: '25',
            ENRLTOT: '4',
            FACILITYID: 'INTRT',
            MON: 'N',
            TUES: 'N',
            WED: 'N',
            THURS: 'N',
            FRI: 'N',
            STARTTIME: null,
            ENDTIME: null,
          },
        },
      ],
    },
  };
}

describe('fetchClassFromASU', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should append /search/classes when base URL is api/v1 and normalize bearer token', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(buildAsuSuccessResponse()), { status: 200 }));

    const result = await fetchClassFromASU('42737', '2264', {
      ASU_API_BASE_URL: 'https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1',
      ASU_API_TOKEN: 'null',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    const parsedUrl = new URL(url as string);

    expect(parsedUrl.pathname).toBe('/catalog-microservices/api/v1/search/classes');
    expect(parsedUrl.searchParams.get('classNbr')).toBe('42737');
    expect(parsedUrl.searchParams.get('term')).toBe('2264');
    expect(init).toMatchObject({
      headers: { Authorization: 'Bearer null' },
    });

    expect(result).toMatchObject({
      subject: 'ABS',
      catalog_nbr: '302',
      title: 'Ethical and Policy Issues in Biology',
      instructor: 'Ms Julie Murphree',
      seats_available: 21,
      seats_capacity: 25,
    });
  });

  it('should preserve /search/classes when it is already present and keep bearer token', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(buildAsuSuccessResponse()), { status: 200 }));

    await fetchClassFromASU('42737', '2264', {
      ASU_API_BASE_URL:
        'https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1/search/classes',
      ASU_API_TOKEN: 'Bearer null',
    });

    const [url, init] = fetchSpy.mock.calls[0];
    const parsedUrl = new URL(url as string);

    expect(parsedUrl.pathname).toBe('/catalog-microservices/api/v1/search/classes');
    expect(init).toMatchObject({
      headers: { Authorization: 'Bearer null' },
    });
  });
});
