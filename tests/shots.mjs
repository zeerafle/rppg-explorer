// Visual smoke test: open every module in headless Chromium, record console errors, save screenshots.
//   node tests/shots.mjs [module ...]
import { chromium } from 'playwright-core'
import { homedir } from 'node:os'
import { mkdirSync } from 'node:fs'

const BASE = process.env.URL || 'http://127.0.0.1:5199/'
const exe = `${homedir()}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['overview', 'skin', 'trace', 'pos', 'hr', 'codec', 'keyframe', 'results', 'lab']
mkdirSync(new URL('./shots/', import.meta.url), { recursive: true })
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const problems = []
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`[${m.type()}] ${m.text()}`) })
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`))
page.on('requestfailed', (r) => problems.push(`[requestfailed] ${r.url()}`))
for (const id of ids) {
  problems.push(`--- ${id}`)
  await page.goto(`${BASE}#${id}`)
  await page.reload()
  await page.waitForSelector('main h1', { timeout: 30000 })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: new URL(`./shots/${id}.png`, import.meta.url).pathname, fullPage: true })
}
console.log(problems.join('\n'))
await browser.close()
