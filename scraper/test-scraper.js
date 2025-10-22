/**
 * Test script to verify scraper functionality
 * Run with: node test-scraper.js
 */

import { scrapeClassSection } from './dist/scraper.js'

async function testScraper() {
  console.log('=== ASU Class Search Scraper Test ===\n')

  const testCases = [
    { section: '12431', term: '2261', description: 'Valid section (if exists)' },
    { section: '99999', term: '2261', description: 'Invalid section (should fail)' },
  ]

  for (const { section, term, description } of testCases) {
    console.log(`\nTest: ${description}`)
    console.log(`Section: ${section}, Term: ${term}`)
    console.log('-'.repeat(50))

    try {
      const result = await scrapeClassSection(section, term)
      console.log('✓ Success!')
      console.log('Result:', JSON.stringify(result, null, 2))
    } catch (error) {
      console.log('✗ Failed!')
      console.log('Error:', error.message)
    }
  }

  console.log('\n=== Test Complete ===')
  process.exit(0)
}

testScraper()
