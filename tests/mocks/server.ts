import { setupServer } from 'msw/node'
import { scraperHandlers } from './handlers/scraper'
import { resendHandlers } from './handlers/resend'

/**
 * MSW server for mocking HTTP requests in tests
 */
export const server = setupServer(...scraperHandlers, ...resendHandlers)
