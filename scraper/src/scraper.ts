import puppeteer, { Browser, Page } from 'puppeteer'
import type { ClassDetails } from './types.js'

/**
 * CONCURRENCY CONFIGURATION
 *
 * This scraper is designed for high concurrent load from Cloudflare Workers cron jobs.
 * Expected load: 6,250 requests per 30 minutes (batch size 3, 2000+ sections)
 *
 * Browser Pool Strategy:
 * - Maintain pool of 5 browser instances (reduced from 10 for reliability)
 * - Each browser can handle 1 concurrent scrape job (Puppeteer pages are isolated)
 * - Queue system prevents overwhelming the server (max 100 concurrent jobs)
 * - Browser reuse avoids expensive launch/close overhead (~2-3 seconds per browser)
 * - Batched launching prevents timeout during initialization
 *
 * Memory considerations:
 * - Each browser instance: ~50-150MB RAM
 * - Total with 5 browsers: ~750MB RAM max
 * - Oracle server has 24GB RAM - this is very conservative
 *
 * Performance:
 * - 5 browsers still provides 5x parallelization vs single browser
 * - Sufficient for 10k users with queue-based architecture
 * - More reliable initialization on resource-constrained servers
 *
 * Adjust MAX_CONCURRENT_BROWSERS based on your server:
 * - 2GB RAM server: 3-5 browsers (current setting)
 * - 4GB RAM server: 8-10 browsers
 * - 24GB RAM server (Oracle): Can increase to 10-15 if needed
 */
const MAX_CONCURRENT_BROWSERS = 5 // Maximum number of browser instances (reduced for reliable initialization)
const BROWSER_LAUNCH_BATCH_SIZE = 2 // Launch browsers in batches to avoid timeout
const MAX_QUEUE_SIZE = 100 // Maximum queued scrape jobs before rejecting new ones

/**
 * Browser pool with concurrency control
 * Maintains multiple browser instances and queues scrape jobs
 */
class BrowserPool {
  private browsers: Browser[] = []
  private availableBrowsers: Browser[] = []
  private isShuttingDown = false
  private queue: Array<{
    resolve: (browser: Browser) => void
    reject: (error: Error) => void
  }> = []

  /**
   * Initialize browser pool
   * Called on first scrape request (lazy initialization)
   *
   * Launches browsers in small batches to prevent timeout on resource-constrained servers
   */
  private async initializePool(): Promise<void> {
    if (this.browsers.length > 0) return // Already initialized

    console.log(`[BrowserPool] Initializing pool with ${MAX_CONCURRENT_BROWSERS} browsers (batches of ${BROWSER_LAUNCH_BATCH_SIZE})...`)
    const startTime = Date.now()

    // Launch browsers in batches to prevent timeout during initialization
    this.browsers = []
    for (let i = 0; i < MAX_CONCURRENT_BROWSERS; i += BROWSER_LAUNCH_BATCH_SIZE) {
      const batchSize = Math.min(BROWSER_LAUNCH_BATCH_SIZE, MAX_CONCURRENT_BROWSERS - i)
      const batchNum = Math.floor(i / BROWSER_LAUNCH_BATCH_SIZE) + 1
      const totalBatches = Math.ceil(MAX_CONCURRENT_BROWSERS / BROWSER_LAUNCH_BATCH_SIZE)

      console.log(`[BrowserPool] Launching batch ${batchNum}/${totalBatches} (${batchSize} browsers)...`)

      const batchPromises = Array.from({ length: batchSize }, (_, j) =>
        this.launchBrowser(i + j + 1)
      )

      const launchedBrowsers = await Promise.all(batchPromises)
      this.browsers.push(...launchedBrowsers)

      console.log(`[BrowserPool] Batch ${batchNum}/${totalBatches} complete - ${this.browsers.length}/${MAX_CONCURRENT_BROWSERS} browsers ready`)
    }

    this.availableBrowsers = [...this.browsers]

    const duration = Date.now() - startTime
    console.log(`[BrowserPool] Pool fully initialized in ${duration}ms - ${this.browsers.length} browsers ready`)
  }

  /**
   * Acquire browser from pool
   * Waits in queue if all browsers are busy
   */
  async acquireBrowser(): Promise<Browser> {
    // Initialize pool on first request
    if (this.browsers.length === 0) {
      await this.initializePool()
    }

    if (this.isShuttingDown) {
      throw new Error('Browser pool is shutting down')
    }

    // Check queue size
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      throw new Error(`Queue is full (${MAX_QUEUE_SIZE} jobs waiting) - server overloaded`)
    }

    // If browser available, return immediately
    if (this.availableBrowsers.length > 0) {
      const browser = this.availableBrowsers.pop()!
      console.log(`[BrowserPool] Browser acquired - ${this.availableBrowsers.length}/${this.browsers.length} available`)
      return browser
    }

    // Wait in queue for next available browser
    console.log(`[BrowserPool] All browsers busy - queuing (${this.queue.length + 1} waiting)`)
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject })
    })
  }

  /**
   * Release browser back to pool
   * Gives browser to next queued job or marks as available
   */
  releaseBrowser(browser: Browser): void {
    if (this.isShuttingDown) {
      // During shutdown, close browsers instead of releasing
      browser.close().catch(console.error)
      return
    }

    // If jobs are queued, give browser to next job
    const next = this.queue.shift()
    if (next) {
      console.log(`[BrowserPool] Browser assigned to queued job - ${this.queue.length} still waiting`)
      next.resolve(browser)
      return
    }

    // No queue - mark browser as available
    this.availableBrowsers.push(browser)
    console.log(`[BrowserPool] Browser released - ${this.availableBrowsers.length}/${this.browsers.length} available`)
  }

  /**
   * Launch headless Chromium with optimized settings
   * Increased timeout to 60s for reliable initialization on slower servers
   */
  private async launchBrowser(id: number): Promise<Browser> {
    console.log(`[BrowserPool] Launching browser #${id}...`)

    const browser = await puppeteer.launch({
      headless: true,
      timeout: 60000, // Increased from default 30s to 60s for slower servers
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--metrics-recording-only',
        '--mute-audio',
        '--no-default-browser-check',
        '--no-pings',
        '--password-store=basic',
        '--use-mock-keychain',
      ],
      defaultViewport: {
        width: 1920,
        height: 1080,
      },
    })

    console.log(`[BrowserPool] Browser #${id} launched successfully`)
    return browser
  }

  /**
   * Close all browsers gracefully
   */
  async close(): Promise<void> {
    this.isShuttingDown = true

    console.log(`[BrowserPool] Shutting down - rejecting ${this.queue.length} queued jobs`)

    // Reject all queued jobs
    for (const { reject } of this.queue) {
      reject(new Error('Browser pool shutting down'))
    }
    this.queue = []

    // Close all browsers
    console.log(`[BrowserPool] Closing ${this.browsers.length} browsers...`)
    await Promise.all(this.browsers.map(browser => browser.close()))

    this.browsers = []
    this.availableBrowsers = []
    console.log('[BrowserPool] All browsers closed')
  }

  /**
   * Get pool status for monitoring
   */
  getStatus(): {
    total: number
    available: number
    busy: number
    queued: number
  } {
    return {
      total: this.browsers.length,
      available: this.availableBrowsers.length,
      busy: this.browsers.length - this.availableBrowsers.length,
      queued: this.queue.length,
    }
  }
}

// Global browser pool instance
const browserPool = new BrowserPool()

/**
 * Cleanup browser on process termination
 */
process.on('SIGINT', async () => {
  console.log('\n[Process] SIGINT received, cleaning up...')
  await browserPool.close()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('\n[Process] SIGTERM received, cleaning up...')
  await browserPool.close()
  process.exit(0)
})

/**
 * Configure page for optimized scraping
 * NOTE: For React SPAs, we DON'T block JS/CSS as they're needed for rendering
 */
async function setupPage(page: Page): Promise<void> {
  // Set viewport
  await page.setViewport({ width: 1920, height: 1080 })

  // Block only images and fonts for faster loading (keep CSS/JS for React app)
  await page.setRequestInterception(true)
  page.on('request', (request) => {
    const resourceType = request.resourceType()
    if (['image', 'font', 'media'].includes(resourceType)) {
      request.abort()
    } else {
      request.continue()
    }
  })

  // Set longer timeout for React SPA
  page.setDefaultTimeout(45000) // 45 seconds
  page.setDefaultNavigationTimeout(45000)
}

/**
 * Parse seat availability from "X of Y" or "X of Y open seats" format
 * @example parseSeats("5 of 150") => { available: 5, capacity: 150 }
 * @example parseSeats("7 of 150 open seats") => { available: 7, capacity: 150 }
 */
function parseSeats(seatsText: string): { available: number; capacity: number } | null {
  // Handle both old format "X of Y" and new format "X of Y open seats"
  const match = seatsText.trim().match(/^(\d+)\s+of\s+(\d+)(?:\s+open\s+seats)?$/i)
  if (!match) {
    console.warn(`[Parser] Failed to parse seats: "${seatsText}"`)
    return null
  }
  return {
    available: parseInt(match[1], 10),
    capacity: parseInt(match[2], 10),
  }
}

/**
 * Scrapes ASU class search for a given section number and term
 *
 * ASU uses a React SPA, so we need to:
 * 1. Wait for network to be idle (React bundle loaded + API call complete)
 * 2. Wait for the results to appear in the DOM
 * 3. Extract data from the dynamically rendered table
 *
 * @param sectionNumber - The 5-digit section number (e.g., "12431")
 * @param term - The 4-digit term code (e.g., "2261")
 * @returns Class details including seats, instructor, location, etc.
 * @throws Error if section not found, timeout, or parsing fails
 */
export async function scrapeClassSection(
  sectionNumber: string,
  term: string
): Promise<ClassDetails> {
  console.log(`[Scraper] Starting scrape: section=${sectionNumber}, term=${term}`)

  // Acquire browser from pool (waits if all busy)
  const browser = await browserPool.acquireBrowser()
  const page = await browser.newPage()

  try {
    // Setup page with optimizations
    await setupPage(page)

    // Construct ASU class search URL with all required parameters
    // campusOrOnlineSelection=A: Include all campus locations
    // honors=F: Include non-honors classes
    // promod=F: Include non-professional/modular classes
    // searchType=all: Search all class types
    const url = `https://catalog.apps.asu.edu/catalog/classes/classlist?campusOrOnlineSelection=A&honors=F&keywords=${sectionNumber}&promod=F&searchType=all&term=${term}`
    console.log(`[Scraper] Navigating to: ${url}`)

    // Navigate and wait for network to be idle (React app loads + API call completes)
    console.log('[Scraper] Waiting for React SPA to load and hydrate...')
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 })
    console.log('[Scraper] Page network idle, waiting for results to render...')

    // Wait a bit more for React to render (using Promise instead of deprecated waitForTimeout)
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Now try to find the results
    // ASU updated their page structure - now uses div-based grid instead of tables
    // Check if the results container exists
    const hasResults = await page.evaluate(() => {
      const resultsContainer = document.querySelector('.class-results-rows')
      console.log(`Results container found: ${!!resultsContainer}`)
      return !!resultsContainer
    })

    if (!hasResults) {
      // No results container found - check for "no results" message
      const bodyText = await page.evaluate(() => document.body.textContent || '')
      console.log('[Scraper] No results container found. Page text preview:', bodyText.substring(0, 300))

      if (
        bodyText.toLowerCase().includes('no classes found') ||
        bodyText.toLowerCase().includes('no results') ||
        bodyText.toLowerCase().includes('0 classes')
      ) {
        throw new Error(`Section ${sectionNumber} not found for term ${term}`)
      }

      // Unknown state - throw timeout error
      throw new Error('Page loaded but no results container found')
    }

    // Extract data from the page using new div-based structure
    console.log('[Scraper] Results container found, extracting class data...')

    const classData = await page.evaluate(() => {
      // Find the class results container
      const resultsContainer = document.querySelector('.class-results-rows')
      if (!resultsContainer) return null

      // Get all data rows (skip header which is first child)
      const dataRows = Array.from(resultsContainer.querySelectorAll('.class-accordion'))
      if (dataRows.length === 0) return null

      // Get the first data row
      const row = dataRows[0]

      // Helper to extract text from cells by class name
      const getCellText = (className: string): string => {
        const cell = row.querySelector(`.class-results-cell.${className}`)
        return cell?.textContent?.trim() || ''
      }

      // Helper to extract link text (for instructor names)
      const getLinkText = (className: string): string => {
        const cell = row.querySelector(`.class-results-cell.${className}`)
        const link = cell?.querySelector('a')
        return link?.textContent?.trim() || cell?.textContent?.trim() || ''
      }

      // Extract course code from the course cell (e.g., "CSE 412")
      const courseText = getCellText('course')

      // Extract all fields using CSS class selectors
      return {
        number: getCellText('number'),
        subjectCourse: courseText,
        title: getCellText('title'),
        instructor: getLinkText('instructor'),
        seats: getCellText('seats'),
        location: getCellText('location'),
        // Combine days, start, and end times into meeting_times
        times: `${getCellText('days')} ${getCellText('start')}-${getCellText('end')}`.trim(),
      }
    })

    if (!classData) {
      throw new Error('Failed to extract class data from results - unexpected page structure')
    }

    console.log('[Scraper] Raw data extracted:', classData)

    // Validate we got the right section number
    if (classData.number !== sectionNumber) {
      throw new Error(
        `Section number mismatch: expected ${sectionNumber}, got ${classData.number}`
      )
    }

    // Parse subject and catalog number from "CSE 240" format
    const subjectMatch = classData.subjectCourse.match(/^([A-Z]{2,4})\s+(\d{3})/)
    if (!subjectMatch) {
      throw new Error(`Failed to parse subject/catalog from: "${classData.subjectCourse}"`)
    }

    const subject = subjectMatch[1]
    const catalogNbr = subjectMatch[2]

    // Parse seats
    const seatsInfo = parseSeats(classData.seats)

    // Parse instructor (handle "Staff" or actual names)
    const instructor = classData.instructor || 'Staff'

    // Step 4: Extract non-reserved seats from expanded accordion
    let nonReservedSeats: number | null = null

    try {
      console.log('[Scraper] Attempting to extract non-reserved seat information...')

      // Click course cell to expand accordion (ASU uses clickable course cell, not a button)
      const detailsButton = await page.$('.class-results-cell.course.pointer')
      if (detailsButton) {
        await detailsButton.click()
        console.log('[Scraper] Clicked course cell to expand accordion')

        // Wait for the reserved seat table to load
        await page.waitForSelector('table', { timeout: 5000 })
        console.log('[Scraper] Reserved seat table loaded')

        // Extract non-reserved seats from table
        nonReservedSeats = await page.evaluate(() => {
          const tables = Array.from(document.querySelectorAll('table'))

          // Find the table that contains reserved seat information
          for (const table of tables) {
            const rows = Array.from(table.querySelectorAll('tbody tr'))

            // Look for the "Non Reserved Available Seats" row
            const nonReservedRow = rows.find((row) =>
              row.textContent?.includes('Non Reserved Available Seats')
            )

            if (nonReservedRow) {
              // Extract number from "Non Reserved Available Seats: 6" format
              const cellText = nonReservedRow.textContent || ''
              const match = cellText.match(/Non Reserved Available Seats:\s*(\d+)/)

              if (match) {
                return parseInt(match[1], 10)
              }
            }
          }

          return null
        })

        if (nonReservedSeats !== null) {
          console.log(`[Scraper] Extracted non-reserved seats: ${nonReservedSeats}`)
        } else {
          console.warn('[Scraper] Could not find non-reserved seats row in table')
        }
      } else {
        console.warn('[Scraper] Course cell not found - cannot extract reserved seat info')
      }
    } catch (error) {
      console.warn('[Scraper] Failed to extract reserved seat information:', error)
      // Continue with null value (graceful fallback)
    }

    // Build response
    const result: ClassDetails = {
      subject,
      catalog_nbr: catalogNbr,
      title: classData.title,
      instructor,
      seats_available: seatsInfo?.available,
      seats_capacity: seatsInfo?.capacity,
      non_reserved_seats: nonReservedSeats,
      location: classData.location || undefined,
      meeting_times: classData.times || undefined,
    }

    console.log('[Scraper] Successfully scraped class data:', result)
    return result
  } catch (error) {
    console.error('[Scraper] Error during scraping:', error)

    // Provide more context for debugging
    if (error instanceof Error) {
      // Check if it's a known error type
      if (error.message.includes('not found')) {
        throw error // Re-throw with original message
      }
      if (error.message.includes('Timeout') || error.message.includes('timeout')) {
        throw new Error(
          `Timeout while scraping section ${sectionNumber} - ASU site may be slow or down`
        )
      }
      if (error.message.includes('Failed to parse') || error.message.includes('Failed to extract')) {
        throw new Error(`Data parsing error for section ${sectionNumber}: ${error.message}`)
      }
    }

    throw new Error(
      `Scraping failed for section ${sectionNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  } finally {
    // Always close the page and release browser back to pool
    await page.close()
    browserPool.releaseBrowser(browser)
    console.log('[Scraper] Page closed, browser released to pool')
  }
}

/**
 * Validates section number format (5 digits)
 */
export function isValidSectionNumber(sectionNumber: string): boolean {
  return /^\d{5}$/.test(sectionNumber)
}

/**
 * Validates term format (4 digits)
 */
export function isValidTerm(term: string): boolean {
  return /^\d{4}$/.test(term)
}

/**
 * Get browser pool status (for debugging/monitoring)
 */
export function getBrowserStatus(): {
  total: number
  available: number
  busy: number
  queued: number
} {
  return browserPool.getStatus()
}
