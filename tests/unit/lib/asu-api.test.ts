import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  ApiError,
  AuthError,
  clearAsuApiCache,
  fetchClassFromASU,
  NotFoundError,
  RateLimitError,
} from '@/lib/asu/api';

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

function buildAsuResponseWithWaitlist(
  enrlCap: string,
  enrlTot: string,
  waitTot: string,
  waitCap: string
) {
  return {
    hits: {
      total: { value: 1 },
      hits: [
        {
          _source: {
            CLASSNBR: '12345',
            SUBJECT: 'CSE',
            CATALOGNBR: '101',
            COURSETITLELONG: 'Introduction to Programming',
            INSTRUCTORSLIST: ['Dr. Smith'],
            ENRLCAP: enrlCap,
            ENRLTOT: enrlTot,
            WAITTOT: waitTot,
            WAITCAP: waitCap,
            FACILITYID: 'MAIN',
            MON: 'Y',
            TUES: 'N',
            WED: 'Y',
            THURS: 'N',
            FRI: 'Y',
            STARTTIME: '09:00:00',
            ENDTIME: '10:15:00',
          },
        },
      ],
    },
  };
}

describe('fetchClassFromASU', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearAsuApiCache();
  });

  it('should append /search/classes when base URL is api/v1 and normalize bearer token', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(buildAsuSuccessResponse()), { status: 200 }));

    const result = await fetchClassFromASU(
      { class_nbr: '42737', term: '2264' },
      {
        ASU_API_BASE_URL:
          'https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1',
        ASU_API_TOKEN: 'null',
      }
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    // SAFETY: fetchSpy mock returns string url from fetch call; validated by test setup
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
      instructor_name: 'Ms Julie Murphree',
      seats_available: 21,
      seats_capacity: 25,
    });
  });

  it('should preserve /search/classes when it is already present and keep bearer token', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(buildAsuSuccessResponse()), { status: 200 }));

    await fetchClassFromASU(
      { class_nbr: '42737', term: '2264' },
      {
        ASU_API_BASE_URL:
          'https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1/search/classes',
        ASU_API_TOKEN: 'Bearer null',
      }
    );

    const [url, init] = fetchSpy.mock.calls[0];
    // SAFETY: fetchSpy mock returns string url from fetch call; validated by test setup
    const parsedUrl = new URL(url as string);

    expect(parsedUrl.pathname).toBe('/catalog-microservices/api/v1/search/classes');
    expect(init).toMatchObject({
      headers: { Authorization: 'Bearer null' },
    });
  });

  it.each([
    ['base URL', { ASU_API_BASE_URL: '', ASU_API_TOKEN: 'test-token' }],
    ['token', { ASU_API_BASE_URL: 'https://example.com/api/v1', ASU_API_TOKEN: '' }],
  ])('should reject when the ASU API %s is missing', async (_field, env) => {
    await expect(fetchClassFromASU({ class_nbr: '42737', term: '2264' }, env)).rejects.toSatisfy(
      // eslint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: test helper decodes unknown error at boundary
      (error: unknown) => {
        return error instanceof ApiError && error.message.includes('not configured');
      }
    );
  });

  it('should serve repeated class lookups from cache', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(buildAsuSuccessResponse()), { status: 200 }));

    const env = {
      ASU_API_BASE_URL: 'https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1',
      ASU_API_TOKEN: 'test-token',
    };

    const first = await fetchClassFromASU({ class_nbr: '42737', term: '2264' }, env);
    const second = await fetchClassFromASU({ class_nbr: '42737', term: '2264' }, env);

    expect(first).toEqual(second);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('should throw ApiError with status 408 when fetch times out', async () => {
    const timeoutError = new DOMException('The operation was aborted.', 'TimeoutError');
    vi.spyOn(global, 'fetch').mockRejectedValue(timeoutError);

    await expect(
      fetchClassFromASU(
        { class_nbr: '42737', term: '2264' },
        {
          ASU_API_BASE_URL:
            'https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1',
          ASU_API_TOKEN: 'test-token',
        }
      )
      // eslint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: test helper decodes unknown error at boundary
    ).rejects.toSatisfy((error: unknown) => {
      return error instanceof ApiError && error.status === 408;
    });
  });

  it('should throw ApiError with timeout message when fetch times out', async () => {
    const timeoutError = new DOMException('The operation was aborted.', 'TimeoutError');
    vi.spyOn(global, 'fetch').mockRejectedValue(timeoutError);

    await expect(
      fetchClassFromASU(
        { class_nbr: '42737', term: '2264' },
        {
          ASU_API_BASE_URL:
            'https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1',
          ASU_API_TOKEN: 'test-token',
        }
      )
    ).rejects.toThrow('ASU API request timed out');
  });

  it('should rethrow non-timeout fetch failures', async () => {
    const networkError = new TypeError('network down');
    vi.spyOn(global, 'fetch').mockRejectedValue(networkError);

    await expect(
      fetchClassFromASU(
        { class_nbr: '42737', term: '2264' },
        {
          ASU_API_BASE_URL:
            'https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1',
          ASU_API_TOKEN: 'test-token',
        }
      )
    ).rejects.toBe(networkError);
  });

  it.each([
    [401, AuthError, 'token expired'],
    [403, AuthError, 'token expired'],
    [429, RateLimitError, 'rate limit'],
    [503, ApiError, 'returned 503'],
  ])('should map ASU API status %s to the expected error', async (status, ErrorClass, message) => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status }));

    await expect(
      fetchClassFromASU(
        { class_nbr: '42737', term: '2264' },
        {
          ASU_API_BASE_URL:
            'https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1',
          ASU_API_TOKEN: 'test-token',
        }
      )
      // eslint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: test helper decodes unknown error at boundary
    ).rejects.toSatisfy((error: unknown) => {
      return error instanceof ErrorClass && error.message.includes(message);
    });
  });

  it.each([
    ['empty hit list', { hits: { total: { value: 0 }, hits: [] } }],
    ['missing hit list', { hits: { total: { value: 0 } } }],
  ])('should throw NotFoundError when the ASU response has an %s', async (_case, body) => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200 })
    );

    await expect(
      fetchClassFromASU(
        { class_nbr: '42737', term: '2264' },
        {
          ASU_API_BASE_URL:
            'https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1',
          ASU_API_TOKEN: 'test-token',
        }
      )
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('should compute non_reserved_seats correctly with waitlist data', async () => {
    // enrlCap=30, enrlTot=10, waitTot=5 → non_reserved_seats = max(0, 30-10-5) = 15
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(buildAsuResponseWithWaitlist('30', '10', '5', '10')), {
        status: 200,
      })
    );

    const result = await fetchClassFromASU(
      { class_nbr: '12345', term: '2264' },
      {
        ASU_API_BASE_URL:
          'https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1',
        ASU_API_TOKEN: 'test-token',
      }
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.non_reserved_seats).toBe(15);
  });

  it('should return 0 for non_reserved_seats when all seats are filled including waitlist', async () => {
    // enrlCap=30, enrlTot=25, waitTot=10 → non_reserved_seats = max(0, 30-25-10) = 0
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(buildAsuResponseWithWaitlist('30', '25', '10', '10')), {
        status: 200,
      })
    );

    const result = await fetchClassFromASU(
      { class_nbr: '12345', term: '2264' },
      {
        ASU_API_BASE_URL:
          'https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1',
        ASU_API_TOKEN: 'test-token',
      }
    );

    expect(result.non_reserved_seats).toBe(0);
  });

  it('should compute non_reserved_seats correctly when no waitlist data is provided', async () => {
    // enrlCap=25, enrlTot=4, no WAITTOT/WAITCAP → non_reserved_seats = max(0, 25-4-0) = 21
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(buildAsuSuccessResponse()), { status: 200 })
    );

    const result = await fetchClassFromASU(
      { class_nbr: '42737', term: '2264' },
      {
        ASU_API_BASE_URL:
          'https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1',
        ASU_API_TOKEN: 'null',
      }
    );

    expect(result.non_reserved_seats).toBe(21);
  });

  it('should return the class matching the requested CLASSNBR, not just the first hit', async () => {
    // Simulate Elasticsearch returning fuzzy matches with different CLASSNBR values
    const responseWithMultipleHits = {
      hits: {
        total: { value: 3 },
        hits: [
          {
            _source: {
              CLASSNBR: '99999',
              SUBJECT: 'WRONG',
              CATALOGNBR: '999',
              COURSETITLELONG: 'Wrong Class Data',
              INSTRUCTORSLIST: ['Wrong Instructor'],
              ENRLCAP: '100',
              ENRLTOT: '99',
              FACILITYID: 'WRONG',
              MON: 'N',
              TUES: 'N',
              WED: 'N',
              THURS: 'N',
              FRI: 'N',
              STARTTIME: null,
              ENDTIME: null,
            },
          },
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
          {
            _source: {
              CLASSNBR: '88888',
              SUBJECT: 'OTHER',
              CATALOGNBR: '888',
              COURSETITLELONG: 'Another Wrong Class',
              INSTRUCTORSLIST: ['Other Instructor'],
              ENRLCAP: '50',
              ENRLTOT: '49',
              FACILITYID: 'OTHER',
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

    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(responseWithMultipleHits), { status: 200 })
    );

    const result = await fetchClassFromASU(
      { class_nbr: '42737', term: '2264' },
      {
        ASU_API_BASE_URL:
          'https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1',
        ASU_API_TOKEN: 'test-token',
      }
    );

    // Should return the class with CLASSNBR='42737', not the first hit (CLASSNBR='99999')
    expect(result.subject).toBe('ABS');
    expect(result.catalog_nbr).toBe('302');
    expect(result.title).toBe('Ethical and Policy Issues in Biology');
    expect(result.instructor_name).toBe('Ms Julie Murphree');
    expect(result.seats_capacity).toBe(25);
  });

  it('should throw NotFoundError when response contains hits but none match requested CLASSNBR', async () => {
    const responseWithWrongHits = {
      hits: {
        total: { value: 2 },
        hits: [
          {
            _source: {
              CLASSNBR: '11111',
              SUBJECT: 'MATH',
              CATALOGNBR: '101',
              COURSETITLELONG: 'Math Class',
              INSTRUCTORSLIST: ['Dr. Math'],
              ENRLCAP: '30',
              ENRLTOT: '20',
              FACILITYID: 'MATH',
              MON: 'Y',
              TUES: 'N',
              WED: 'Y',
              THURS: 'N',
              FRI: 'Y',
              STARTTIME: '09:00:00',
              ENDTIME: '10:15:00',
            },
          },
          {
            _source: {
              CLASSNBR: '22222',
              SUBJECT: 'ENG',
              CATALOGNBR: '102',
              COURSETITLELONG: 'English Class',
              INSTRUCTORSLIST: ['Dr. English'],
              ENRLCAP: '25',
              ENRLTOT: '15',
              FACILITYID: 'ENG',
              MON: 'N',
              TUES: 'Y',
              WED: 'N',
              THURS: 'Y',
              FRI: 'N',
              STARTTIME: '10:30:00',
              ENDTIME: '11:45:00',
            },
          },
        ],
      },
    };

    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(responseWithWrongHits), { status: 200 })
    );

    await expect(
      fetchClassFromASU(
        { class_nbr: '99999', term: '2264' },
        {
          ASU_API_BASE_URL:
            'https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1',
          ASU_API_TOKEN: 'test-token',
        }
      )
      // eslint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: test helper decodes unknown error at boundary
    ).rejects.toSatisfy((error: unknown) => {
      return error instanceof Error && error.message.includes('Section 99999 not found');
    });
  });

  it('should handle empty string enrollment fields without returning NaN', async () => {
    // Regression test for issue #169: Number.parseInt('', 10) returns NaN
    // which causes Math.max(0, NaN) to return NaN, serializing as null in JSON
    const responseWithEmptyStrings = {
      hits: {
        total: { value: 1 },
        hits: [
          {
            _source: {
              CLASSNBR: '12345',
              SUBJECT: 'CSE',
              CATALOGNBR: '101',
              COURSETITLELONG: 'Introduction to Programming',
              INSTRUCTORSLIST: ['Dr. Smith'],
              ENRLCAP: '', // Empty string should be treated as 0
              ENRLTOT: '', // Empty string should be treated as 0
              WAITTOT: '', // Empty string should be treated as 0
              FACILITYID: 'MAIN',
              MON: 'Y',
              TUES: 'N',
              WED: 'Y',
              THURS: 'N',
              FRI: 'Y',
              STARTTIME: '09:00:00',
              ENDTIME: '10:15:00',
            },
          },
        ],
      },
    };

    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(responseWithEmptyStrings), { status: 200 })
    );

    const result = await fetchClassFromASU(
      { class_nbr: '12345', term: '2264' },
      {
        ASU_API_BASE_URL:
          'https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1',
        ASU_API_TOKEN: 'test-token',
      }
    );

    // All seat counts should be valid numbers, not NaN
    expect(result.seats_capacity).toBe(0);
    expect(result.seats_available).toBe(0);
    expect(result.non_reserved_seats).toBe(0);
    expect(Number.isNaN(result.seats_capacity)).toBe(false);
    expect(Number.isNaN(result.seats_available)).toBe(false);
    expect(Number.isNaN(result.non_reserved_seats)).toBe(false);
  });

  it('should map optional ASU fields to sensible fallbacks', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          hits: {
            total: { value: 1 },
            hits: [
              {
                _source: {
                  CLASSNBR: '55555',
                  SUBJECT: 'ENG',
                  CATALOGNBR: '101',
                  TITLE: 'First-Year Composition',
                  MON: 'Y',
                  TUES: 'Y',
                  WED: 'Y',
                  THURS: 'Y',
                  FRI: 'Y',
                  STARTTIME: '00:05:00',
                  ENDTIME: '13:30:00',
                },
              },
            ],
          },
        }),
        { status: 200 }
      )
    );

    const result = await fetchClassFromASU(
      { class_nbr: '55555', term: '2264' },
      {
        ASU_API_BASE_URL:
          'https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1',
        ASU_API_TOKEN: 'test-token',
      }
    );

    expect(result).toMatchObject({
      title: 'First-Year Composition',
      instructor_name: 'Staff',
      seats_available: 0,
      seats_capacity: 0,
      non_reserved_seats: 0,
      location: 'TBD',
      meeting_times: 'MTuWThF 12:05 AM-1:30 PM',
    });
  });

  it('should use Unknown when ASU omits all title fields', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          hits: {
            total: { value: 1 },
            hits: [
              {
                _source: {
                  CLASSNBR: '66666',
                  SUBJECT: 'UNI',
                  CATALOGNBR: '101',
                },
              },
            ],
          },
        }),
        { status: 200 }
      )
    );

    const result = await fetchClassFromASU(
      { class_nbr: '66666', term: '2264' },
      {
        ASU_API_BASE_URL:
          'https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1',
        ASU_API_TOKEN: 'test-token',
      }
    );

    expect(result.title).toBe('Unknown');
    expect(result.meeting_times).toBe('TBD');
  });
});
