 import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import { load } from "cheerio";
import { parseStringPromise } from "xml2js";
import pLimit from "p-limit";
import compression from "compression";
import puppeteer, { Browser } from "puppeteer";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.set("strict routing", false);
app.set("case sensitive routing", false);
app.use(compression());
app.use(express.json());

// ─── Site Configurations ─────────────────────────────────────────────

const SITE_CONFIGS = {
  prod: {
    siteUrl: process.env.SITE_URL || "https://www.journeyrouters.com",
    sitemapUrl:
      process.env.SITEMAP_URL || "https://www.journeyrouters.com/sitemap.xml",
    label: "Production",
  },
  dev: {
    siteUrl: "https://devbranch.d29fwnrj64ci4.amplifyapp.com",
    sitemapUrl:
      "https://devbranch.d29fwnrj64ci4.amplifyapp.com/sitemap.xml",
    label: "Dev Branch",
  },
} as const;

type SiteKey = keyof typeof SITE_CONFIGS;

// ─── Crawl settings ──────────────────────────────────────────────────

const CRAWL_CONCURRENCY = Number(process.env.CRAWL_CONCURRENCY) || 2;
const CRAWL_DELAY_MS = Number(process.env.CRAWL_DELAY_MS) || 1500;
const PAGE_TIMEOUT_MS = Number(process.env.PAGE_TIMEOUT_MS) || 25000;
const JS_RENDER_WAIT_MS = Number(process.env.JS_RENDER_WAIT_MS) || 3000;
const MAX_LINKS_PER_PAGE = Number(process.env.MAX_LINKS_PER_PAGE) || 50;
const BROWSER_RECYCLE_INTERVAL =
  Number(process.env.BROWSER_RECYCLE_INTERVAL) || 15;

// ─── In-memory audit store ───────────────────────────────────────────

let currentAuditId = 0;
let currentAudit: any = {
  status: "idle",
  progress: 0,
  totalUrls: 0,
  processedUrls: 0,
  results: [],
  startTime: null,
  endTime: null,
  error: null,
  message: null,
  site: "prod",
};

// ─── In-memory custom audit store ────────────────────────────────────

let currentCustomAuditId = 0;
let currentCustomAudit: any = {
  status: "idle",
  progress: 0,
  totalUrls: 0,
  processedUrls: 0,
  results: [],
  startTime: null,
  endTime: null,
  error: null,
  message: null,
  site: "prod",
};

// ─── Browser Management ──────────────────────────────────────────────

let browserInstance: Browser | null = null;
let isLaunching = false;

async function getBrowser(): Promise<Browser> {
  if (isLaunching) {
    for (let i = 0; i < 50; i++) {
      if (!isLaunching) break;
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  try {
    if (!browserInstance || !browserInstance.connected) {
      isLaunching = true;
      console.log("Launching new browser instance...");
      browserInstance = await puppeteer.launch({
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-first-run",
          "--no-zygote",
          "--single-process",
          "--disable-extensions",
          "--disable-background-networking",
          "--disable-default-apps",
          "--disable-sync",
          "--disable-translate",
          "--hide-scrollbars",
          "--metrics-recording-only",
          "--mute-audio",
          "--safebrowsing-disable-auto-update",
        ],
        headless: true,
      });
      isLaunching = false;
    }
    return browserInstance;
  } catch (error: any) {
    isLaunching = false;
    throw new Error(`Browser launch failed: ${error.message}`);
  }
}

async function closeBrowser() {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch (_) {}
    browserInstance = null;
  }
}

// ─── Page Crawler (FIXED for Next.js) ────────────────────────────────

async function crawlPage(url: string, retryCount = 0): Promise<any> {
  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);

    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const resourceType = req.resourceType();
      if (["image", "font", "media"].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1280, height: 800 });

    const response = await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: PAGE_TIMEOUT_MS,
    });

    const status = response?.status() || 0;

    await page
      .waitForSelector("h1", { timeout: 5000 })
      .catch(() => {});
    await new Promise((r) => setTimeout(r, JS_RENDER_WAIT_MS));

    const html = await page.content();
    const $ = load(html);

    const seoData: any = {
      url,
      status,
      title: $("title").text().trim() || null,
      metaDescription:
        $('meta[name="description"]').attr("content")?.trim() ||
        $('meta[property="og:description"]').attr("content")?.trim() ||
        null,
      h1s: $("h1")
        .map((_, el) => $(el).text().trim())
        .get()
        .filter((t: string) => t.length > 0),
      h2s: $("h2")
        .map((_, el) => $(el).text().trim())
        .get()
        .filter((t: string) => t.length > 0),
      canonical: $('link[rel="canonical"]').attr("href") || null,
      ogTitle: $('meta[property="og:title"]').attr("content") || null,
      ogImage: $('meta[property="og:image"]').attr("content") || null,
      ogType: $('meta[property="og:type"]').attr("content") || null,
      twitterCard: $('meta[name="twitter:card"]').attr("content") || null,
      robots: $('meta[name="robots"]').attr("content") || null,
      viewport: $('meta[name="viewport"]').attr("content") || null,
      charset:
        $("meta[charset]").attr("charset") ||
        ($('meta[http-equiv="Content-Type"]').attr("content") || "").match(
          /charset=([^\s;]+)/
        )?.[1] ||
        null,
      hasSchema: html.includes("application/ld+json"),
      schemaTypes: (() => {
        const types: string[] = [];
        $('script[type="application/ld+json"]').each((_, el) => {
          try {
            const json = JSON.parse($(el).html() || "");
            if (json["@type"]) types.push(json["@type"]);
            if (Array.isArray(json["@graph"])) {
              json["@graph"].forEach((item: any) => {
                if (item["@type"]) types.push(item["@type"]);
              });
            }
          } catch (_) {}
        });
        return types;
      })(),
      hreflang: $('link[hreflang]')
        .map((_, el) => ({
          lang: $(el).attr("hreflang"),
          href: $(el).attr("href"),
        }))
        .get(),
      images: $("img")
        .map((_, el) => ({
          src: $(el).attr("src") || $(el).attr("data-src") || null,
          alt: $(el).attr("alt") ?? null,
          loading: $(el).attr("loading") || null,
          width: $(el).attr("width") || null,
          height: $(el).attr("height") || null,
        }))
        .get(),
      links: $("a")
        .map((_, el) => ({
          href: $(el).attr("href") || null,
          text: $(el).text().trim().slice(0, 200),
          rel: $(el).attr("rel") || null,
          target: $(el).attr("target") || null,
        }))
        .get(),
      wordCount: $("body")
        .text()
        .replace(/\s+/g, " ")
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 0).length,
      htmlSize: Buffer.byteLength(html, "utf8"),
    };

    await page.close();
    return seoData;
  } catch (error: any) {
    if (page) {
      try {
        await page.close();
      } catch (_) {}
    }
    if (retryCount < 2) {
      console.log(`Retrying ${url} (attempt ${retryCount + 2})...`);
      await new Promise((r) => setTimeout(r, 2000));
      return crawlPage(url, retryCount + 1);
    }
    return {
      url,
      status: 0,
      error: error.message,
      title: null,
      metaDescription: null,
      h1s: [],
      h2s: [],
      links: [],
      images: [],
    };
  }
}

// ─── Link Status Checker ─────────────────────────────────────────────

async function checkLinkStatus(url: string, baseUrl: string) {
  if (
    !url ||
    url.startsWith("#") ||
    url.startsWith("javascript:") ||
    url.startsWith("tel:") ||
    url.startsWith("mailto:") ||
    url.startsWith("data:")
  ) {
    return { url, status: "skipped" };
  }

  let absoluteUrl = url;
  if (url.startsWith("/")) {
    absoluteUrl = baseUrl + url;
  }

  try {
    const response = await axios.head(absoluteUrl, {
      headers: { "User-Agent": "SiteHealthAuditBot/2.0" },
      timeout: 8000,
      maxRedirects: 5,
      validateStatus: () => true,
    });
    return { url: absoluteUrl, status: response.status };
  } catch {
    try {
      const response = await axios.get(absoluteUrl, {
        headers: { "User-Agent": "SiteHealthAuditBot/2.0" },
        timeout: 8000,
        maxRedirects: 5,
        validateStatus: () => true,
      });
      return { url: absoluteUrl, status: response.status };
    } catch (e: any) {
      return {
        url: absoluteUrl,
        status: e.response?.status || 0,
        error: e.message,
      };
    }
  }
}

// ─── Audit Rules Engine ───────────────────────────────────────────────

function runAuditRules(
  pageData: any,
  allSitemapUrls: string[],
  allFoundLinks: Set<string>,
  baseUrl: string
) {
  const issues: any[] = [];
  const {
    url,
    status,
    title,
    metaDescription,
    h1s,
    h2s,
    canonical,
    images,
    ogTitle,
    ogImage,
    ogType,
    twitterCard,
    robots,
    hasSchema,
    schemaTypes,
    viewport,
    wordCount,
    htmlSize,
  } = pageData;

  // ── Broken Page ──
  if (status === 0) {
    issues.push({
      type: "Broken Page",
      severity: "Critical",
      message: `Page unreachable (network error or timeout)`,
    });
    return issues;
  }
  if (status >= 400) {
    issues.push({
      type: "Broken Page",
      severity: "Critical",
      message: `Page returns HTTP ${status}`,
    });
    return issues;
  }
  if (status >= 300 && status < 400) {
    issues.push({
      type: "Redirect",
      severity: "Medium",
      message: `Page redirects (HTTP ${status})`,
    });
  }

  // ── Robots / Noindex ──
  if (robots && robots.toLowerCase().includes("noindex")) {
    issues.push({
      type: "SEO",
      severity: "Critical",
      message: "Page has 'noindex' directive — won't appear in search results",
    });
  }

  // ── Title ──
  if (!title) {
    issues.push({
      type: "SEO",
      severity: "Critical",
      message: "Missing <title> tag",
    });
  } else {
    if (title.length < 30)
      issues.push({
        type: "SEO",
        severity: "Medium",
        message: `Title too short (${title.length} chars, recommended: 30–60)`,
        details: title,
      });
    if (title.length > 60)
      issues.push({
        type: "SEO",
        severity: "Medium",
        message: `Title too long (${title.length} chars, recommended: 30–60)`,
        details: title,
      });
  }

  // ── Meta Description ──
  if (!metaDescription) {
    issues.push({
      type: "SEO",
      severity: "High",
      message: "Missing meta description",
    });
  } else {
    if (metaDescription.length < 70)
      issues.push({
        type: "SEO",
        severity: "Medium",
        message: `Description too short (${metaDescription.length} chars, recommended: 70–160)`,
        details: metaDescription,
      });
    if (metaDescription.length > 160)
      issues.push({
        type: "SEO",
        severity: "Medium",
        message: `Description too long (${metaDescription.length} chars, recommended: 70–160)`,
        details: metaDescription,
      });
  }

  // ── H1 Tag ──
  if (!h1s || h1s.length === 0) {
    issues.push({
      type: "SEO",
      severity: "High",
      message: "Missing H1 tag",
    });
  } else if (h1s.length > 1) {
    issues.push({
      type: "SEO",
      severity: "Medium",
      message: `Multiple H1 tags found (${h1s.length})`,
      details: h1s,
    });
  }

  // ── H1/Title mismatch check ──
  if (title && h1s && h1s.length > 0) {
    const h1Lower = h1s[0].toLowerCase();
    if (
      h1Lower.includes("{{") ||
      h1Lower.includes("}}") ||
      h1Lower.includes("undefined") ||
      h1Lower.includes("[object")
    ) {
      issues.push({
        type: "Technical",
        severity: "Critical",
        message: `H1 contains unrendered template syntax: "${h1s[0].slice(0, 80)}"`,
        details: h1s[0],
      });
    }
  }

  // ── H2 structure check ──
  if ((!h2s || h2s.length === 0) && wordCount > 300) {
    issues.push({
      type: "SEO",
      severity: "Low",
      message: "No H2 headings found on a content-heavy page",
    });
  }

  // ── Canonical ──
  if (!canonical) {
    issues.push({
      type: "SEO",
      severity: "Medium",
      message: "Missing canonical tag",
    });
  } else {
    const normalizedCanonical = canonical
      .replace(/\/$/, "")
      .replace(/^https?:\/\/(www\.)?/, "");
    const normalizedUrl = url
      .replace(/\/$/, "")
      .replace(/^https?:\/\/(www\.)?/, "");
    if (normalizedCanonical !== normalizedUrl) {
      issues.push({
        type: "SEO",
        severity: "Low",
        message: `Canonical URL doesn't match page URL`,
        details: `canonical: ${canonical}`,
      });
    }
  }

  // ── Image Alt Text ──
  const realImages = (images || []).filter(
    (img: any) =>
      img.src &&
      !img.src.includes("data:image") &&
      !img.src.includes("facebook.com/tr") &&
      !img.src.includes("pixel") &&
      !img.src.includes("tracking")
  );
  const imagesWithoutAlt = realImages.filter(
    (img: any) => img.alt === null || img.alt === "" || img.alt === undefined
  );
  if (imagesWithoutAlt.length > 0) {
    issues.push({
      type: "SEO",
      severity: "Medium",
      message: `${imagesWithoutAlt.length} of ${realImages.length} images missing alt text`,
      details: imagesWithoutAlt.slice(0, 5).map((i: any) => i.src),
    });
  }

  // ── Image dimension check (CLS prevention) ──
  const imagesWithoutDimensions = realImages.filter(
    (img: any) => !img.width || !img.height
  );
  if (imagesWithoutDimensions.length > 3) {
    issues.push({
      type: "Performance",
      severity: "Low",
      message: `${imagesWithoutDimensions.length} images missing width/height attributes (causes layout shift)`,
    });
  }

  // ── Lazy loading check ──
  const aboveFoldImages = realImages.slice(0, 1);
  aboveFoldImages.forEach((img: any) => {
    if (img.loading === "lazy") {
      issues.push({
        type: "Performance",
        severity: "Medium",
        message: `First image uses lazy loading — above-fold images should load eagerly`,
        details: img.src,
      });
    }
  });

  // ── Open Graph ──
  if (!ogTitle)
    issues.push({
      type: "SEO",
      severity: "Low",
      message: "Missing Open Graph title (og:title)",
    });
  if (!ogImage)
    issues.push({
      type: "SEO",
      severity: "Low",
      message: "Missing Open Graph image (og:image)",
    });
  if (!ogType)
    issues.push({
      type: "SEO",
      severity: "Low",
      message: "Missing Open Graph type (og:type)",
    });
  if (!twitterCard)
    issues.push({
      type: "SEO",
      severity: "Low",
      message: "Missing Twitter Card tag",
    });

  // ── Schema / Structured Data ──
  if (!hasSchema) {
    issues.push({
      type: "SEO",
      severity: "Low",
      message: "Missing Schema.org structured data (JSON-LD)",
    });
  }

  // ── Viewport ──
  if (!viewport) {
    issues.push({
      type: "Technical",
      severity: "High",
      message: "Missing viewport meta tag (not mobile-friendly)",
    });
  }

  // ── Content Thinness ──
  if (wordCount < 100 && status === 200) {
    issues.push({
      type: "Content",
      severity: "Medium",
      message: `Very thin content (${wordCount} words). Consider adding more content for SEO.`,
    });
  }

  // ── Page Size ──
  if (htmlSize > 1024 * 500) {
    issues.push({
      type: "Performance",
      severity: "Medium",
      message: `Large HTML size (${Math.round(htmlSize / 1024)}KB). Consider code splitting.`,
    });
  }

  // ── Orphan Page Check ──
  if (
    allFoundLinks.size > 0 &&
    !allFoundLinks.has(url) &&
    !allFoundLinks.has(url + "/") &&
    !allFoundLinks.has(url.replace(/\/$/, "")) &&
    url !== baseUrl &&
    url !== baseUrl + "/"
  ) {
    issues.push({
      type: "Technical",
      severity: "Medium",
      message: "Orphan page — not linked from any other page on the site",
    });
  }

  return issues;
}

// ─── Score Calculator ────────────────────────────────────────────────

function calculateScore(issues: any[]) {
  let score = 100;
  issues.forEach((issue) => {
    if (issue.severity === "Critical") score -= 15;
    else if (issue.severity === "High") score -= 10;
    else if (issue.severity === "Medium") score -= 5;
    else if (issue.severity === "Low") score -= 2;
  });
  return Math.max(0, score);
}

// ─── Duplicate Detection ─────────────────────────────────────────────

function detectDuplicates(results: any[]): any[] {
  const extraIssues: { url: string; issue: any }[] = [];

  const titleMap = new Map<string, string[]>();
  const descMap = new Map<string, string[]>();

  for (const page of results) {
    if (page.status !== 200) continue;

    if (page.title) {
      const key = page.title.toLowerCase().trim();
      if (!titleMap.has(key)) titleMap.set(key, []);
      titleMap.get(key)!.push(page.url);
    }
    if (page.metaDescription) {
      const key = page.metaDescription.toLowerCase().trim();
      if (!descMap.has(key)) descMap.set(key, []);
      descMap.get(key)!.push(page.url);
    }
  }

  for (const [title, urls] of titleMap) {
    if (urls.length > 1 && title.length > 5) {
      urls.forEach((u) =>
        extraIssues.push({
          url: u,
          issue: {
            type: "SEO",
            severity: "Medium",
            message: `Duplicate title shared with ${urls.length - 1} other page(s)`,
            details: urls.filter((x) => x !== u),
          },
        })
      );
    }
  }

  for (const [desc, urls] of descMap) {
    if (urls.length > 1 && desc.length > 10) {
      urls.forEach((u) =>
        extraIssues.push({
          url: u,
          issue: {
            type: "SEO",
            severity: "Medium",
            message: `Duplicate meta description shared with ${urls.length - 1} other page(s)`,
            details: urls.filter((x) => x !== u),
          },
        })
      );
    }
  }

  return extraIssues;
}

// ─── Main Audit Runner ───────────────────────────────────────────────

async function runFullAudit(site: SiteKey = "prod") {
  const auditId = ++currentAuditId;
  const config = SITE_CONFIGS[site];
  const baseUrl = config.siteUrl.replace(/\/$/, "");
  const sitemapUrl = config.sitemapUrl;

  console.log(`\n══════════════════════════════════════`);
  console.log(`  Starting audit #${auditId}`);
  console.log(`  Site: ${baseUrl} (${config.label})`);
  console.log(`══════════════════════════════════════\n`);

  currentAudit = {
    status: "crawling",
    progress: 0,
    totalUrls: 0,
    processedUrls: 0,
    results: [],
    startTime: new Date().toISOString(),
    endTime: null,
    error: null,
    message: "Initializing audit...",
    site,
  };

  try {
    // ── Phase 1: Parse Sitemap ──
    currentAudit.message = "Fetching sitemap...";
    console.log("Phase 1: Fetching sitemap...");

    const sitemapResponse = await axios.get(sitemapUrl, {
      headers: { "User-Agent": "SiteHealthAuditBot/2.0" },
      timeout: 20000,
    });
    const sitemapJson = await parseStringPromise(sitemapResponse.data);

    if (auditId !== currentAuditId) return;

    let urls: string[] = [];

    if (sitemapJson.urlset?.url) {
      urls = sitemapJson.urlset.url.map((u: any) => u.loc[0]);
    } else if (sitemapJson.sitemapindex?.sitemap) {
      const sitemapUrls = sitemapJson.sitemapindex.sitemap.map(
        (s: any) => s.loc[0]
      );
      for (const sUrl of sitemapUrls) {
        if (auditId !== currentAuditId) return;
        try {
          currentAudit.message = `Fetching sub-sitemap: ${path.basename(sUrl)}`;
          const subRes = await axios.get(sUrl, {
            headers: { "User-Agent": "SiteHealthAuditBot/2.0" },
            timeout: 15000,
          });
          const subJson = await parseStringPromise(subRes.data);
          if (subJson.urlset?.url) {
            urls.push(...subJson.urlset.url.map((u: any) => u.loc[0]));
          }
        } catch (e: any) {
          console.error(`Failed to fetch sub-sitemap ${sUrl}:`, e.message);
        }
      }
    }

    if (urls.length === 0) {
      throw new Error("No URLs found in sitemap.");
    }

    urls = [...new Set(urls)].sort();
    if (urls.length > 2000) urls = urls.slice(0, 2000);

    currentAudit.totalUrls = urls.length;
    console.log(`Found ${urls.length} URLs in sitemap.\n`);

    // ── Phase 2: Crawl pages with Puppeteer ──
    const allFoundLinks = new Set<string>();
    const linkCache = new Map<string, any>();
    const linkLimit = pLimit(5);
    const intermediateResults: any[] = [];
    let pagesProcessedSinceRestart = 0;

    for (const url of urls) {
      if (auditId !== currentAuditId) break;

      pagesProcessedSinceRestart++;
      if (pagesProcessedSinceRestart > BROWSER_RECYCLE_INTERVAL) {
        const mem = Math.round(
          process.memoryUsage().heapUsed / 1024 / 1024
        );
        console.log(`Recycling browser (Memory: ${mem}MB)`);
        await closeBrowser();
        pagesProcessedSinceRestart = 0;
      }

      try {
        const shortUrlStr = url.replace(baseUrl, "") || "/";
        currentAudit.message = `Crawling ${currentAudit.processedUrls + 1}/${urls.length}: ${shortUrlStr}`;

        const pageData = await crawlPage(url);

        if (auditId !== currentAuditId) break;

        (pageData.links || []).forEach((link: any) => {
          if (!link.href) return;
          if (
            link.href.startsWith("/") ||
            link.href.startsWith(baseUrl)
          ) {
            let abs = link.href.startsWith("/")
              ? baseUrl + link.href
              : link.href;
            abs = abs.split("#")[0].split("?")[0].replace(/\/$/, "");
            allFoundLinks.add(abs);
            allFoundLinks.add(abs + "/");
          }
        });

        const issues = runAuditRules(pageData, urls, new Set(), baseUrl);

        const uniqueLinks = [
          ...new Set(
            pageData.links
              ?.map((l: any) => l.href)
              .filter(Boolean) as string[]
          ),
        ];

        const linkStatuses = await Promise.all(
          uniqueLinks.slice(0, MAX_LINKS_PER_PAGE).map(async (l) => {
            if (linkCache.has(l)) return linkCache.get(l);
            const result = await linkLimit(() => checkLinkStatus(l, baseUrl));
            linkCache.set(l, result);
            return result;
          })
        );

        const brokenLinks: any[] = [];
        linkStatuses.forEach((ls) => {
          if (
            ls.status !== 200 &&
            ls.status !== 301 &&
            ls.status !== 302 &&
            ls.status !== "skipped"
          ) {
            brokenLinks.push({ url: ls.url, status: ls.status });
          }
        });

        if (brokenLinks.length > 0) {
          const internalBroken = brokenLinks.filter(
            (bl) =>
              bl.url.includes(baseUrl) || bl.url.startsWith("/")
          );
          const externalBroken = brokenLinks.filter(
            (bl) =>
              !bl.url.includes(baseUrl) && !bl.url.startsWith("/")
          );

          if (internalBroken.length > 0) {
            issues.push({
              type: "Broken Link (Internal)",
              severity: "Critical",
              message: `${internalBroken.length} broken internal link(s)`,
              details: internalBroken,
            });
          }
          if (externalBroken.length > 0) {
            issues.push({
              type: "Broken Link (External)",
              severity: "High",
              message: `${externalBroken.length} broken external link(s)`,
              details: externalBroken,
            });
          }
        }

        intermediateResults.push({
          url: pageData.url,
          status: pageData.status,
          title: pageData.title,
          metaDescription: pageData.metaDescription,
          h1s: pageData.h1s,
          h2s: pageData.h2s,
          wordCount: pageData.wordCount,
          canonical: pageData.canonical,
          hasSchema: pageData.hasSchema,
          schemaTypes: pageData.schemaTypes,
          issues,
        });

        currentAudit.processedUrls++;
        currentAudit.progress = Math.round(
          (currentAudit.processedUrls / urls.length) * 90
        );

        if (
          currentAudit.processedUrls % 5 === 0 ||
          currentAudit.processedUrls === urls.length
        ) {
          currentAudit.results = intermediateResults.map((p) => ({
            ...p,
            score: calculateScore(p.issues),
          }));
        }

        console.log(
          `  [${currentAudit.processedUrls}/${urls.length}] ${shortUrlStr} → ${pageData.status} | ${issues.length} issues`
        );

        await new Promise((r) => setTimeout(r, CRAWL_DELAY_MS));
      } catch (err: any) {
        console.error(`Error processing ${url}:`, err.message);
        currentAudit.processedUrls++;
      }
    }

    if (auditId !== currentAuditId) return;

    // ── Phase 3: Final checks ──
    currentAudit.message = "Running duplicate & orphan checks...";
    currentAudit.progress = 92;
    console.log("\nPhase 3: Running duplicate & orphan checks...");

    const duplicateIssues = detectDuplicates(intermediateResults);

    const finalResults = intermediateResults
      .map((page) => {
        const issues = [...page.issues];

        if (
          page.status === 200 &&
          !allFoundLinks.has(page.url) &&
          !allFoundLinks.has(page.url + "/") &&
          !allFoundLinks.has(page.url.replace(/\/$/, "")) &&
          page.url !== baseUrl &&
          page.url !== baseUrl + "/"
        ) {
          issues.push({
            type: "Technical",
            severity: "Medium",
            message:
              "Orphan page — not linked from any other page on the site",
          });
        }

        duplicateIssues
          .filter((d) => d.url === page.url)
          .forEach((d) => issues.push(d.issue));

        return {
          ...page,
          issues,
          score: calculateScore(issues),
        };
      })
      .sort((a, b) => a.score - b.score);

    currentAudit.results = finalResults;
    currentAudit.status = "completed";
    currentAudit.progress = 100;
    currentAudit.message = "Audit completed successfully.";
    currentAudit.endTime = new Date().toISOString();

    const totalIssues = finalResults.reduce(
      (sum, p) => sum + p.issues.length,
      0
    );
    console.log(`\n══════════════════════════════════════`);
    console.log(`  Audit #${auditId} COMPLETE`);
    console.log(`  Pages: ${finalResults.length}`);
    console.log(`  Issues: ${totalIssues}`);
    console.log(`══════════════════════════════════════\n`);
  } catch (error: any) {
    if (auditId !== currentAuditId) return;
    console.error(`Audit #${auditId} failed:`, error.message);
    currentAudit.status = "error";
    currentAudit.error = error.message;
    currentAudit.message = `Audit failed: ${error.message}`;
  } finally {
    await closeBrowser();
  }
}

// ─── Custom URL Audit Runner ─────────────────────────────────────────

async function runCustomAudit(urls: string[], site: SiteKey = "prod") {
  const auditId = ++currentCustomAuditId;
  const config = SITE_CONFIGS[site];
  const baseUrl = config.siteUrl.replace(/\/$/, "");

  console.log(`\n──────────────────────────────────────`);
  console.log(`  Starting custom audit #${auditId}`);
  console.log(`  URLs: ${urls.length} | Site: ${config.label}`);
  console.log(`──────────────────────────────────────\n`);

  currentCustomAudit = {
    status: "crawling",
    progress: 0,
    totalUrls: urls.length,
    processedUrls: 0,
    results: [],
    startTime: new Date().toISOString(),
    endTime: null,
    error: null,
    message: "Starting custom URL audit...",
    site,
  };

  try {
    const linkCache = new Map<string, any>();
    const linkLimit = pLimit(5);
    const intermediateResults: any[] = [];

    for (const url of urls) {
      if (auditId !== currentCustomAuditId) break;

      try {
        const shortUrlStr = (() => {
          try { return new URL(url).pathname || "/"; } catch { return url; }
        })();
        currentCustomAudit.message = `Crawling ${currentCustomAudit.processedUrls + 1}/${urls.length}: ${shortUrlStr}`;

        const pageData = await crawlPage(url);

        if (auditId !== currentCustomAuditId) break;

        // No orphan check for custom audits (empty allFoundLinks)
        const issues = runAuditRules(pageData, urls, new Set(), baseUrl);

        const uniqueLinks = [
          ...new Set(
            pageData.links
              ?.map((l: any) => l.href)
              .filter(Boolean) as string[]
          ),
        ];

        const linkStatuses = await Promise.all(
          uniqueLinks.slice(0, MAX_LINKS_PER_PAGE).map(async (l) => {
            if (linkCache.has(l)) return linkCache.get(l);
            const result = await linkLimit(() => checkLinkStatus(l, baseUrl));
            linkCache.set(l, result);
            return result;
          })
        );

        const brokenLinks: any[] = [];
        linkStatuses.forEach((ls) => {
          if (
            ls.status !== 200 &&
            ls.status !== 301 &&
            ls.status !== 302 &&
            ls.status !== "skipped"
          ) {
            brokenLinks.push({ url: ls.url, status: ls.status });
          }
        });

        if (brokenLinks.length > 0) {
          const internalBroken = brokenLinks.filter(
            (bl) => bl.url.includes(baseUrl) || bl.url.startsWith("/")
          );
          const externalBroken = brokenLinks.filter(
            (bl) => !bl.url.includes(baseUrl) && !bl.url.startsWith("/")
          );

          if (internalBroken.length > 0) {
            issues.push({
              type: "Broken Link (Internal)",
              severity: "Critical",
              message: `${internalBroken.length} broken internal link(s)`,
              details: internalBroken,
            });
          }
          if (externalBroken.length > 0) {
            issues.push({
              type: "Broken Link (External)",
              severity: "High",
              message: `${externalBroken.length} broken external link(s)`,
              details: externalBroken,
            });
          }
        }

        intermediateResults.push({
          url: pageData.url,
          status: pageData.status,
          title: pageData.title,
          metaDescription: pageData.metaDescription,
          h1s: pageData.h1s,
          h2s: pageData.h2s,
          wordCount: pageData.wordCount,
          canonical: pageData.canonical,
          hasSchema: pageData.hasSchema,
          schemaTypes: pageData.schemaTypes,
          issues,
          score: calculateScore(issues),
        });

        currentCustomAudit.processedUrls++;
        currentCustomAudit.progress = Math.round(
          (currentCustomAudit.processedUrls / urls.length) * 100
        );
        currentCustomAudit.results = [...intermediateResults];

        console.log(
          `  [custom ${currentCustomAudit.processedUrls}/${urls.length}] ${shortUrlStr} → ${pageData.status} | ${issues.length} issues`
        );

        await new Promise((r) => setTimeout(r, CRAWL_DELAY_MS));
      } catch (err: any) {
        console.error(`Error processing ${url}:`, err.message);
        currentCustomAudit.processedUrls++;
      }
    }

    if (auditId !== currentCustomAuditId) return;

    currentCustomAudit.status = "completed";
    currentCustomAudit.progress = 100;
    currentCustomAudit.message = `Custom audit completed — ${intermediateResults.length} page(s) tested.`;
    currentCustomAudit.endTime = new Date().toISOString();

    console.log(`\n  Custom audit #${auditId} COMPLETE — ${intermediateResults.length} pages\n`);
  } catch (error: any) {
    if (auditId !== currentCustomAuditId) return;
    console.error(`Custom audit #${auditId} failed:`, error.message);
    currentCustomAudit.status = "error";
    currentCustomAudit.error = error.message;
    currentCustomAudit.message = `Custom audit failed: ${error.message}`;
  } finally {
    await closeBrowser();
  }
}

// ─── API Routes ──────────────────────────────────────────────────────

async function startServer() {
  try {
    app.get("/api/health", (_req, res) => {
      res.json({ status: "ok", timestamp: new Date().toISOString() });
    });

    // ── Full audit routes ──

    app.get("/api/audit/status", (req, res) => {
      try {
        if (
          currentAudit.status === "crawling" &&
          currentAudit.results.length > 50 &&
          req.query.full !== "true"
        ) {
          const slim = currentAudit.results.map((r: any) => ({
            ...r,
            issues: r.issues.map((i: any) => {
              const { details, ...rest } = i;
              return rest;
            }),
          }));
          return res.json({ ...currentAudit, results: slim, isSimplified: true });
        }
        res.json(currentAudit);
      } catch (err) {
        res.status(500).json({ error: "Internal server error" });
      }
    });

    app.post("/api/audit/start", (req, res) => {
      const site: SiteKey = req.body?.site === "dev" ? "dev" : "prod";
      runFullAudit(site);
      res.json({ message: "Audit started", site });
    });

    app.post("/api/audit/reset", (_req, res) => {
      currentAuditId++;
      closeBrowser();
      currentAudit = {
        status: "idle",
        progress: 0,
        totalUrls: 0,
        processedUrls: 0,
        results: [],
        startTime: null,
        endTime: null,
        error: null,
        message: null,
        site: "prod",
      };
      res.json({ message: "Audit state reset" });
    });

    app.get("/api/audit/download", (_req, res) => {
      if (currentAudit.results.length === 0) {
        return res
          .status(404)
          .json({ error: "No audit results available" });
      }

      let csv =
        "URL,Status,Score,Title,Meta Description,H1,Word Count,Issue Type,Severity,Message,Details\n";

      currentAudit.results.forEach((page: any) => {
        const esc = (s: string) => `"${(s || "").replace(/"/g, '""')}"`;
        const base = [
          esc(page.url),
          page.status,
          page.score,
          esc(page.title),
          esc(page.metaDescription),
          esc(page.h1s?.[0] || ""),
          page.wordCount || 0,
        ].join(",");

        if (page.issues.length === 0) {
          csv += `${base},"None","None","Healthy",""\n`;
        } else {
          page.issues.forEach((issue: any) => {
            let details = "";
            if (Array.isArray(issue.details)) {
              details = issue.details
                .map((d: any) =>
                  typeof d === "string" ? d : `${d.url} (${d.status})`
                )
                .join(" | ");
            } else if (typeof issue.details === "string") {
              details = issue.details;
            }
            csv += `${base},${esc(issue.type)},${esc(issue.severity)},${esc(issue.message)},${esc(details)}\n`;
          });
        }
      });

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=sitehealth_audit_report.csv"
      );
      res.send(csv);
    });

    // ── Custom audit routes ──

    app.get("/api/custom-audit/status", (_req, res) => {
      res.json(currentCustomAudit);
    });

    app.post("/api/custom-audit/start", (req, res) => {
      const { urls, site } = req.body || {};
      if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({ error: "urls array is required" });
      }
      const validUrls = (urls as string[]).filter(
        (u) => typeof u === "string" && u.startsWith("http")
      );
      if (validUrls.length === 0) {
        return res.status(400).json({ error: "No valid URLs provided (must start with http)" });
      }
      const siteKey: SiteKey = site === "dev" ? "dev" : "prod";
      runCustomAudit(validUrls, siteKey);
      res.json({ message: "Custom audit started", urlCount: validUrls.length, site: siteKey });
    });

    app.post("/api/custom-audit/reset", (_req, res) => {
      currentCustomAuditId++;
      currentCustomAudit = {
        status: "idle",
        progress: 0,
        totalUrls: 0,
        processedUrls: 0,
        results: [],
        startTime: null,
        endTime: null,
        error: null,
        message: null,
        site: "prod",
      };
      res.json({ message: "Custom audit reset" });
    });

    // API catch-all
    app.all("/api/*", (req, res) => {
      res
        .status(404)
        .json({ error: `API route not found: ${req.method} ${req.url}` });
    });

    // Vite dev server or static build
    if (process.env.NODE_ENV !== "production") {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (_req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`\n🩺 SiteHealth running on http://localhost:${PORT}\n`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

// ─── Graceful shutdown ───────────────────────────────────────────────

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  closeBrowser();
  setTimeout(() => process.exit(1), 1000);
});

process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down...");
  await closeBrowser();
  process.exit(0);
});

startServer();
