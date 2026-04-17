# Installation and Usage Guide

This document explains how to install, configure, and use SiteHealth v2 locally.

## Prerequisites

- Node.js 20 or newer
- npm
- A target site URL to audit
- Optional: a sitemap URL for faster crawling

## Installation

1. Clone or open the project in your editor.
2. Install dependencies:

```bash
npm install
```

3. Create your local environment file:

```bash
cp .env.example .env
```

4. Edit `.env` with your target site details and preferred crawl settings.

## Configuration

The crawler reads settings from `.env`. Common values include:

```env
SITE_URL=https://www.example.com
SITEMAP_URL=https://www.example.com/sitemap.xml
CRAWL_CONCURRENCY=2
CRAWL_DELAY_MS=1500
PAGE_TIMEOUT_MS=25000
JS_RENDER_WAIT_MS=3000
MAX_LINKS_PER_PAGE=50
BROWSER_RECYCLE_INTERVAL=15
```

Use a smaller concurrency value if the target site is slow or rate-limited.

## Running Locally

Start the app in development mode:

```bash
npm run dev
```

Then open the app in your browser and start an audit from the UI.

## Building for Production

```bash
npm run build
```

To run the production server locally:

```bash
npm start
```

## How to Use the Tool

1. Set `SITE_URL` and, if available, `SITEMAP_URL` in `.env`.
2. Start the app with `npm run dev`.
3. Open the browser and launch an audit.
4. Wait for the crawl to finish and review the dashboard results.
5. Export or review the issues list as needed.

## Common Checks Performed

- Missing titles and meta descriptions
- Duplicate titles and descriptions
- Missing H1 tags
- Thin content pages
- Broken internal and external links
- Image issues such as missing dimensions or lazy loading above the fold
- Missing viewport meta tags
- JSON-LD schema presence

## Troubleshooting

- If the site renders slowly, increase `JS_RENDER_WAIT_MS`.
- If pages are timing out, increase `PAGE_TIMEOUT_MS`.
- If the crawler is too aggressive, reduce `CRAWL_CONCURRENCY`.
- If the browser restarts too often, increase `BROWSER_RECYCLE_INTERVAL`.
