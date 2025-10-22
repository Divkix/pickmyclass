import type { ClassDetails } from './types.js'

/**
 * Scrapes ASU class search for a given section number and term
 *
 * @param sectionNumber - The 5-digit section number (e.g., "12431")
 * @param term - The 4-digit term code (e.g., "2261")
 * @returns Class details including seats, instructor, location, etc.
 *
 * TODO Phase 2: Implement actual Puppeteer scraping logic
 * - Launch headless browser
 * - Navigate to ASU class search with keywords parameter
 * - Wait for results table to load
 * - Extract data from table rows
 * - Parse "X of Y" seat format
 * - Handle "Staff" vs actual instructor names
 * - Handle cases where section is not found
 */
export async function scrapeClassSection(
  sectionNumber: string,
  term: string
): Promise<ClassDetails> {
  console.log(`[Scraper] Scraping section ${sectionNumber} for term ${term}`)

  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 500))

  // Stub data - replace with actual Puppeteer logic in Phase 2
  const stubData: ClassDetails = {
    subject: 'CSE',
    catalog_nbr: '240',
    title: 'Introduction to Computer Science',
    instructor: 'Staff',
    seats_available: 5,
    seats_capacity: 150,
    location: 'BYENG M1-17',
    meeting_times: 'MW 10:30AM-11:45AM'
  }

  console.log(`[Scraper] Successfully scraped section ${sectionNumber}`)
  return stubData
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
