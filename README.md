# SiteHealth v2 — SEO Audit Tool

**Improved version for journeyrouters.com with proper Next.js rendering support.**

## What changed from v1 (Google AI Studio version)

### Bug fixes
1. **`networkidle2` instead of `domcontentloaded`** — The main fix. Next.js pages render content via JavaScript after the initial HTML loads. The old version grabbed HTML before React hydrated, causing false "Missing H1" and "Missing meta description" errors. Now we wait for the network to settle.

2. **Extra render wait** — After `networkidle2`, we wait an additional 3 seconds (configurable) and specifically wait for `<h1>` elements to appear. This handles pages where Next.js fetches data from an API before rendering.

3. **Stylesheets no longer blocked** — The old version blocked CSS downloads. Some Next.js apps use CSS-in-JS or conditional rendering that depends on styles being loaded.

4. **50 links per page** (was 10) — Now catches far more broken links per page.

5. **Smarter browser recycling** — Every 15 pages instead of 10, with proper cleanup.

### New detection capabilities
- **Duplicate title/description detection** across all pages
- **Template syntax detection** — catches unrendered `{{ }}` or `undefined` in H1s
- **Content thinness check** — flags pages with under 100 words
- **Image dimension check** — missing width/height (causes layout shift / CLS)
- **Lazy loading check** — flags above-fold images that shouldn't be lazy
- **Viewport meta check** — missing = not mobile-friendly
- **Schema type extraction** — shows which JSON-LD types are present
- **Word count per page** — visible in dashboard and CSV export
- **Internal vs external broken links** — separated with different severity

### UI improvements
- Issue type breakdown chips with counts (click to filter)
- Expandable table rows showing inline issues
- Sort by score, issues, or URL
- Slide-over detail panel with full page metadata
- Better progress reporting during crawl

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy environment config
cp .env.example .env

# 3. Start the dev server
npm run dev

# 4. Open http://localhost:3000 and click "Start Audit"
```

## Configuration (.env)

```env
SITE_URL=https://www.journeyrouters.com
SITEMAP_URL=https://www.journeyrouters.com/sitemap.xml
CRAWL_CONCURRENCY=2       # Pages crawled simultaneously
CRAWL_DELAY_MS=1500        # Delay between pages
PAGE_TIMEOUT_MS=25000      # Max time to wait for a page
JS_RENDER_WAIT_MS=3000     # Extra wait for JS rendering (key for Next.js!)
MAX_LINKS_PER_PAGE=50      # How many links to check per page
BROWSER_RECYCLE_INTERVAL=15 # Restart browser every N pages
```

## Deploying

### Google AI Studio
This project is structured identically to your existing AI Studio app. Just replace the files.

### Railway / Render
Push to GitHub, connect to Railway or Render, set env vars, deploy.

### Any VPS
```bash
npm run build
npm start
```

## How the crawler works (for Next.js sites)

1. Fetches `sitemap.xml` (handles sitemap indexes too)
2. Opens each URL in a headless Chrome browser (Puppeteer)
3. Waits for `networkidle2` — meaning the network has settled
4. Waits an extra 3s for React/Next.js to finish rendering
5. Extracts the **fully rendered** HTML (not the initial shell)
6. Runs SEO checks on the rendered content
7. Checks all links found on the page (HEAD then GET fallback)
8. Detects orphan pages, duplicates, and content issues
