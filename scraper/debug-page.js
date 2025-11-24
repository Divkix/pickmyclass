/**
 * Debug script to inspect ASU class search page structure
 * Run with: node debug-page.js
 */

import fs from 'node:fs';
import puppeteer from 'puppeteer';

async function debugPage() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  const url = 'https://catalog.apps.asu.edu/catalog/classes/classlist?keywords=12431&term=2261';
  console.log(`Navigating to: ${url}`);

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  console.log('Page loaded, waiting 3 seconds for any dynamic content...');
  await page.waitForTimeout(3000);

  // Take screenshot
  await page.screenshot({
    path: '/Users/divkix/GitHub/pickmyclass/scraper/debug-screenshot.png',
    fullPage: true,
  });
  console.log('Screenshot saved to debug-screenshot.png');

  // Get page HTML
  const html = await page.content();
  fs.writeFileSync('/Users/divkix/GitHub/pickmyclass/scraper/debug-page.html', html);
  console.log('HTML saved to debug-page.html');

  // Check for various selectors
  const selectors = [
    'table',
    'table.table-striped',
    'table tbody tr',
    '.no-results',
    '.alert',
    '[class*="table"]',
    '[class*="result"]',
    '[class*="class"]',
  ];

  console.log('\nChecking selectors:');
  for (const selector of selectors) {
    const elements = await page.$$(selector);
    console.log(`  ${selector}: ${elements.length} found`);
  }

  // Get all table classes
  const tableSummary = await page.evaluate(() => {
    const tables = document.querySelectorAll('table');
    return Array.from(tables).map((table, i) => ({
      index: i,
      className: table.className,
      rows: table.querySelectorAll('tr').length,
      firstRowCells: table.querySelector('tr')?.querySelectorAll('td, th').length || 0,
    }));
  });

  console.log('\nTables found:', JSON.stringify(tableSummary, null, 2));

  // Get page text content (first 1000 chars)
  const textContent = await page.evaluate(() => document.body.textContent);
  console.log('\nPage text preview (first 500 chars):');
  console.log(textContent?.substring(0, 500));

  await browser.close();
  console.log('\nDone! Check debug-screenshot.png and debug-page.html');
}

debugPage().catch(console.error);
