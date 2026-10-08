// Click through the keyframe stepper (screenshot every step) and check that video playback drives the chart playhead.
import { chromium } from 'playwright-core'
import { homedir } from 'node:os'
const BASE = process.env.URL || 'http://127.0.0.1:5199/'
const exe = `${homedir()}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const problems = []
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`[${m.type()}] ${m.text()}`) })
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`))

await page.goto(`${BASE}#keyframe`); await page.reload()
await page.waitForSelector('main h1')
for (let i = 1; i <= 8; i++) {
  await page.waitForTimeout(1200)
  await page.locator('.stepper').screenshot({ path: new URL(`./shots/kf-step${i}.png`, import.meta.url).pathname })
  if (i < 8) await page.getByRole('button', { name: 'Next', exact: true }).click()
}

await page.goto(`${BASE}#trace`); await page.reload()
await page.waitForSelector('main h1')
await page.waitForTimeout(2000)
const before = await page.locator('.tr .mono').first().innerText()
await page.getByRole('button', { name: 'Play', exact: true }).first().click()
await page.waitForTimeout(3000)
const after = await page.locator('.tr .mono').first().innerText()
const vt = await page.evaluate(() => document.querySelector('video')?.currentTime)
console.log('transport label', before, '->', after, '| video.currentTime', vt)
console.log(problems.join('\n') || 'no console problems')
await browser.close()
