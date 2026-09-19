/**
 * Versioned path for the public health endpoint.
 *
 * The handler lives at `/api/monitoring/health`, which stays as a stable
 * unversioned alias; agents integrate against the versioned path so a future
 * breaking change can ship as `/api/v2/...` while `v1` keeps answering.
 */
export { GET } from '@/app/api/monitoring/health/route';
