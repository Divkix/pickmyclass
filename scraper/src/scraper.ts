import puppeteer, { Browser, Page } from 'puppeteer'
import type { ClassDetails } from './types.js'

/**
 * Browser pool to reuse browser instances across requests
 * Maintains a single headless browser instance for performance
 */
class BrowserPool {
  private browser: Browser | null = null
  private isLaunching = false
  private launchPromise: Promise<Browser> | null = null

  /**
   * Get or create browser instance
   * Reuses existing browser to avoid launch overhead
   */
  async getBrowser(): Promise<Browser> {
    // If browser exists and is connected, return it
    if (this.browser && this.browser.connected) {
      return this.browser
    }

    // If another request is launching, wait for it
    if (this.isLaunching && this.launchPromise) {
      return this.launchPromise
    }

    // Launch new browser
    this.isLaunching = true
    this.launchPromise = this.launchBrowser()

    try {
      this.browser = await this.launchPromise
      return this.browser
    } finally {
      this.isLaunching = false
      this.launchPromise = null
    }
  }

  /**
   * Launch headless Chromium with optimized settings
   */
  private async launchBrowser(): Promise<Browser> {
    console.log('[BrowserPool] Launching new browser instance')

    const browser = await puppeteer.launch({
      headless: true,
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

    console.log('[BrowserPool] Browser launched successfully')
    return browser
  }

  /**
   * Close browser gracefully
   */
  async close(): Promise<void> {
    if (this.browser) {
      console.log('[BrowserPool] Closing browser')
      await this.browser.close()
      this.browser = null
      console.log('[BrowserPool] Browser closed')
    }
  }

  /**
   * Check if browser is running
   */
  isConnected(): boolean {
    return this.browser?.connected || false
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

  const browser = await browserPool.getBrowser()
  const page = await browser.newPage()

  try {
    // Setup page with optimizations
    await setupPage(page)

    // Construct ASU class search URL
    const url = `https://catalog.apps.asu.edu/catalog/classes/classlist?keywords=${sectionNumber}&term=${term}`
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

    // Build response
    const result: ClassDetails = {
      subject,
      catalog_nbr: catalogNbr,
      title: classData.title,
      instructor,
      seats_available: seatsInfo?.available,
      seats_capacity: seatsInfo?.capacity,
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
    // Always close the page
    await page.close()
    console.log('[Scraper] Page closed')
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
export function getBrowserStatus(): { connected: boolean } {
  return {
    connected: browserPool.isConnected(),
  }
}
