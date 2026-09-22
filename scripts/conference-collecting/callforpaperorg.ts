import { CheerioCrawler, type CheerioCrawlingContext } from "crawlee";
import type { CollectedConference } from "./schema.js";

import { CALLFORPAPER_ORG_CONFIG } from "./collection-config.js";
import { generateCollectionDate, randomDelay, resolveUrl } from "./utils.js";

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function readField(source: unknown, key: string): unknown {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return undefined;
  }

  return (source as { [key: string]: unknown })[key];
}

function crawlDelayHook() {
  return async () => {
    await randomDelay(
      CALLFORPAPER_ORG_CONFIG.crawlMinDelayBetweenRequests,
      CALLFORPAPER_ORG_CONFIG.crawlMaxDelayBetweenRequests,
    );
  };
}

function isoDateOnly(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const datePart = value.split("T")[0]?.trim();
  return datePart || null;
}

/** Many CallForPaper.org titles are `SHORT : long description`. */
function acronymBeforeColon(title: string | null): string | null {
  if (!title) {
    return null;
  }

  const colonIndex = title.indexOf(":");
  if (colonIndex === -1) {
    return null;
  }

  const before = title.slice(0, colonIndex).trim();
  return before || null;
}

function postingFromCfpPage(
  $: CheerioCrawlingContext["$"],
  cfpUrl: string,
  fallbackCategory: string | null,
): CollectedConference | null {
  let event: unknown;
  let breadcrumbCategory: string | null = null;

  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).html()?.trim();
    if (!raw) {
      return;
    }

    let block: unknown;
    try {
      block = JSON.parse(raw);
    } catch {
      return;
    }

    if (!event && readField(block, "@type") === "Event") {
      event = block;
    }

    const breadcrumbItems = readField(block, "itemListElement");
    if (
      !breadcrumbCategory &&
      readField(block, "@type") === "BreadcrumbList" &&
      Array.isArray(breadcrumbItems)
    ) {
      for (const item of breadcrumbItems) {
        if (readField(item, "position") === 2) {
          breadcrumbCategory = readString(readField(item, "name"));
          break;
        }
      }
    }
  });

  if (!event) {
    return null;
  }

  const conferenceName = readString(readField(event, "name"));
  if (!conferenceName) {
    return null;
  }

  const conferenceStartDate = isoDateOnly(
    readString(readField(event, "startDate")),
  );
  const conferenceEndDate = isoDateOnly(
    readString(readField(event, "endDate")),
  );
  const yearMatch =
    conferenceStartDate?.match(/^(\d{4})/)?.[1] ??
    conferenceEndDate?.match(/^(\d{4})/)?.[1] ??
    conferenceName.match(/\b(19|20)\d{2}\b/)?.[0];

  const conferenceYear = yearMatch ? Number.parseInt(yearMatch, 10) : null;

  const organizer = readField(event, "organizer");
  const location = readField(event, "location");
  const address = readField(location, "address");
  const potentialAction = readField(event, "potentialAction");

  const sameAs = readString(readField(event, "sameAs"));
  const organizerUrl = readString(readField(organizer, "url"));
  let conferenceUri: string | null = null;

  if (sameAs && !sameAs.includes("callforpaper.org")) {
    conferenceUri = sameAs;
  } else if (organizerUrl && !organizerUrl.includes("callforpaper.org")) {
    conferenceUri = organizerUrl;
  }

  const submissionDeadline =
    isoDateOnly(readString(readField(event, "submissionDeadline"))) ??
    isoDateOnly(readString(readField(event, "abstractRegistration"))) ??
    isoDateOnly(readString(readField(potentialAction, "endTime")));

  const conferenceLocation =
    readString(readField(location, "name")) ??
    readString(readField(address, "addressLocality"));

  const alternateName = readString(readField(event, "alternateName"));
  const organizerName = readString(readField(organizer, "name"));

  const conferenceAcronym =
    acronymBeforeColon(conferenceName) ??
    acronymBeforeColon(alternateName) ??
    alternateName ??
    organizerName;

  const category = breadcrumbCategory ?? fallbackCategory;

  return {
    id: cfpUrl,
    collectionDate: generateCollectionDate(),
    _sources: ["callforpaper.org"],
    conferenceName,
    conferenceYear,
    conferenceUri,
    conferenceLocation,
    conferenceStartDate,
    conferenceEndDate,
    conferenceAcronym,
    conferenceSeries: null,
    conferenceCategories: category ? [category] : null,
    conferenceText: readString(readField(event, "description")),
    submissionDeadline,
  };
}

function extractCategoryLinks($: CheerioCrawlingContext["$"]): string[] {
  const urls = new Set<string>();

  $('a[href*="/categories/"]').each((_, element) => {
    const href = $(element).attr("href");
    const abs = resolveUrl(href, CALLFORPAPER_ORG_CONFIG.baseUrl);
    if (!abs) {
      return;
    }

    if (abs.endsWith("/categories") || abs.endsWith("/categories/")) {
      return;
    }

    if (!abs.includes("/categories/")) {
      return;
    }

    urls.add(abs.split("?")[0]!);
  });

  return [...urls].sort((a, b) => a.localeCompare(b));
}

function extractCfpLinks($: CheerioCrawlingContext["$"]): string[] {
  const urls = new Set<string>();

  $('a[href*="/cfp/"]').each((_, element) => {
    const href = $(element).attr("href");
    const abs = resolveUrl(href, CALLFORPAPER_ORG_CONFIG.baseUrl);
    if (abs?.includes("/cfp/")) {
      urls.add(abs.split("?")[0]!);
    }
  });

  return [...urls];
}

function extractNextCategoryPageUrl(
  $: CheerioCrawlingContext["$"],
  currentUrl: string,
): string | null {
  const nextHref = $('a[rel="next"]').attr("href");
  if (!nextHref) {
    return null;
  }

  return resolveUrl(nextHref, currentUrl) ?? null;
}

async function collectCallForPaperOrgCategories(): Promise<string[]> {
  let categoryUrls: string[] = [];

  const crawler = new CheerioCrawler({
    maxRequestsPerCrawl: 1,
    maxConcurrency: 1,
    preNavigationHooks: [crawlDelayHook()],
    async requestHandler({ $ }) {
      categoryUrls = extractCategoryLinks($);
    },
  });

  await crawler.run([`${CALLFORPAPER_ORG_CONFIG.baseUrl}/categories`]);

  return categoryUrls;
}

async function discoverCfpUrlsForCategory(
  categoryUrl: string,
): Promise<Map<string, string | null>> {
  const cfpUrls = new Map<string, string | null>();
  const startUrl = categoryUrl.split("?")[0]!;
  const categorySlug = startUrl.split("/categories/")[1]?.split("/")[0] ?? null;
  const categoryLabel = categorySlug ? categorySlug.replace(/-/g, " ") : null;

  let pagesScanned = 0;

  const crawler = new CheerioCrawler({
    maxRequestsPerCrawl:
      CALLFORPAPER_ORG_CONFIG.categoryPageLimit === null
        ? 500
        : CALLFORPAPER_ORG_CONFIG.categoryPageLimit,
    maxConcurrency: 1,
    preNavigationHooks: [crawlDelayHook()],
    async requestHandler(context) {
      const { $, request } = context;
      pagesScanned++;

      for (const cfpUrl of extractCfpLinks($)) {
        if (!cfpUrls.has(cfpUrl)) {
          cfpUrls.set(cfpUrl, categoryLabel);
        }
      }

      if (
        CALLFORPAPER_ORG_CONFIG.categoryPageLimit !== null &&
        pagesScanned >= CALLFORPAPER_ORG_CONFIG.categoryPageLimit
      ) {
        return;
      }

      const nextPage = extractNextCategoryPageUrl($, request.url);
      if (nextPage && nextPage !== request.url) {
        await context.addRequests([{ url: nextPage }]);
      }
    },
  });

  await crawler.run([startUrl]);

  console.log(
    `[CallForPaper.org] Category ${startUrl}: ${cfpUrls.size} CFP URLs across ${pagesScanned} page(s)`,
  );

  return cfpUrls;
}

async function collectCfpDetails(
  cfpUrls: Map<string, string | null>,
): Promise<CollectedConference[]> {
  const postings: CollectedConference[] = [];
  const urlList = [...cfpUrls.keys()];

  if (!urlList.length) {
    return [];
  }

  let processed = 0;

  const crawler = new CheerioCrawler({
    maxRequestsPerCrawl: urlList.length,
    maxConcurrency: 1,
    preNavigationHooks: [crawlDelayHook()],
    async requestHandler({ $, request }) {
      const posting = postingFromCfpPage(
        $,
        request.url,
        cfpUrls.get(request.url) ?? null,
      );

      if (posting) {
        postings.push(posting);
      }

      processed++;
      if (processed % 25 === 0 || processed === urlList.length) {
        console.log(
          `[CallForPaper.org] CFP details: ${processed}/${urlList.length}`,
        );
      }
    },
  });

  await crawler.run(urlList);

  return postings;
}

export async function collectCallForPaperOrg(): Promise<CollectedConference[]> {
  if (CALLFORPAPER_ORG_CONFIG.categoryLimit === 0) {
    console.log("[CallForPaper.org] Collection disabled: categoryLimit is 0.");
    return [];
  }

  console.log(
    `[CallForPaper.org] Starting (categoryLimit=${CALLFORPAPER_ORG_CONFIG.categoryLimit}, categoryPageLimit=${CALLFORPAPER_ORG_CONFIG.categoryPageLimit})`,
  );

  const categories = await collectCallForPaperOrgCategories();
  if (!categories.length) {
    console.log("[CallForPaper.org] No categories found.");
    return [];
  }

  const categoriesToProcess =
    CALLFORPAPER_ORG_CONFIG.categoryLimit === null
      ? categories
      : categories.slice(0, CALLFORPAPER_ORG_CONFIG.categoryLimit);

  const cfpUrls = new Map<string, string | null>();

  for (const [index, categoryUrl] of categoriesToProcess.entries()) {
    const discovered = await discoverCfpUrlsForCategory(categoryUrl);

    for (const [url, label] of discovered) {
      if (!cfpUrls.has(url)) {
        cfpUrls.set(url, label);
      }
    }

    console.log(
      `[CallForPaper.org] Categories scanned: ${index + 1}/${categoriesToProcess.length}`,
    );
  }

  console.log(`[CallForPaper.org] Unique CFP URLs: ${cfpUrls.size}`);

  const postings = await collectCfpDetails(cfpUrls);

  console.log(`[CallForPaper.org] Collected ${postings.length} conferences`);

  return postings;
}
