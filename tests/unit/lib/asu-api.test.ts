import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, clearAsuApiCache, fetchClassFromASU } from '@/lib/asu/api';

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

  it('should throw ApiError with status 408 when fetch times out', async () => {
    const timeoutError = new DOMException('The operation was aborted.', 'TimeoutError');
    vi.spyOn(global, 'fetch').mockRejectedValue(timeoutError);

    await expect(
      fetchClassFromASU('42737', '2264', {
        ASU_API_BASE_URL:
          'https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1',
        ASU_API_TOKEN: 'test-token',
      })
    ).rejects.toSatisfy((error: unknown) => {
      return error instanceof ApiError && error.status === 408;
    });
  });

  it('should throw ApiError with timeout message when fetch times out', async () => {
    const timeoutError = new DOMException('The operation was aborted.', 'TimeoutError');
    vi.spyOn(global, 'fetch').mockRejectedValue(timeoutError);

    await expect(
      fetchClassFromASU('42737', '2264', {
        ASU_API_BASE_URL:
          'https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1',
        ASU_API_TOKEN: 'test-token',
      })
    ).rejects.toThrow('ASU API request timed out');
  });

  it('should compute non_reserved_seats correctly with waitlist data', async () => {
    // enrlCap=30, enrlTot=10, waitTot=5 → non_reserved_seats = max(0, 30-10-5) = 15
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(buildAsuResponseWithWaitlist('30', '10', '5', '10')), {
        status: 200,
      })
    );

    const result = await fetchClassFromASU('12345', '2264', {
      ASU_API_BASE_URL: 'https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1',
      ASU_API_TOKEN: 'test-token',
    });

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

    const result = await fetchClassFromASU('12345', '2264', {
      ASU_API_BASE_URL: 'https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1',
      ASU_API_TOKEN: 'test-token',
    });

    expect(result.non_reserved_seats).toBe(0);
  });

  it('should compute non_reserved_seats correctly when no waitlist data is provided', async () => {
    // enrlCap=25, enrlTot=4, no WAITTOT/WAITCAP → non_reserved_seats = max(0, 25-4-0) = 21
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(buildAsuSuccessResponse()), { status: 200 })
    );

    const result = await fetchClassFromASU('42737', '2264', {
      ASU_API_BASE_URL: 'https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1',
      ASU_API_TOKEN: 'null',
    });

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

    const result = await fetchClassFromASU('42737', '2264', {
      ASU_API_BASE_URL: 'https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1',
      ASU_API_TOKEN: 'test-token',
    });

    // Should return the class with CLASSNBR='42737', not the first hit (CLASSNBR='99999')
    expect(result.subject).toBe('ABS');
    expect(result.catalog_nbr).toBe('302');
    expect(result.title).toBe('Ethical and Policy Issues in Biology');
    expect(result.instructor).toBe('Ms Julie Murphree');
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
      fetchClassFromASU('99999', '2264', {
        ASU_API_BASE_URL:
          'https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1',
        ASU_API_TOKEN: 'test-token',
      })
    ).rejects.toSatisfy((error: unknown) => {
      return error instanceof Error && error.message.includes('Section 99999 not found');
    });
  });
});
