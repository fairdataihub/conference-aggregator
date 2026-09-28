import { CheerioCrawler, type CheerioCrawlingContext } from "crawlee";
import type { CollectedConference } from "./schema.js";

import { CONFIDENT_CONFERENCE_CONFIG } from "./collection-config.js";

import {
  generateCollectionDate,
  normalizeConferenceAcronym,
  randomDelay,
  resolveUrl,
} from "./utils.js";

/** Browse target (e.g. event series index) — same role as WikiCFP categories. */
type ConfidentEventSeries = {
  url: string;
  name: string;
};

/** Event link from a series or events listing page before detail fetch. */
type ConfidentEventListing = {
  url: string;
  title?: string;
  startDate?: string;
  endDate?: string;
  location?: string;
};

function crawlDelayHook() {
  return async () => {
    await randomDelay(
      CONFIDENT_CONFERENCE_CONFIG.crawlMinDelayBetweenRequests,
      CONFIDENT_CONFERENCE_CONFIG.crawlMaxDelayBetweenRequests,
    );
  };
}

/**
 * Parse event series (or other browse sections) from the index page.
 * ConfIDent is MediaWiki + Semantic MediaWiki — adjust selectors for your entry URL.
 */
function parseConfidentEventSeries(
  $: CheerioCrawlingContext["$"],
  pageUrl: string,
): ConfidentEventSeries[] {
  const series: ConfidentEventSeries[] = [];

  $('a[href*="Event_Series:"]').each((_, element) => {
    const href = $(element).attr("href");
    const url = resolveUrl(href, pageUrl);
    const name = $(element).text().trim();

    if (url && name) {
      series.push({ url, name });
    }
  });

  return [...new Map(series.map((s) => [s.url, s])).values()];
}

async function collectConfidentEventSeries(): Promise<ConfidentEventSeries[]> {
  const series: ConfidentEventSeries[] = [];
  const indexUrl = CONFIDENT_CONFERENCE_CONFIG.eventSeriesBrowseUrl;

  const crawler = new CheerioCrawler({
    maxRequestsPerCrawl: 1,

    preNavigationHooks: [crawlDelayHook()],

    async requestHandler({ $, log, request }) {
      const found = parseConfidentEventSeries($, request.url);
      series.push(...found);

      if (found.length > 0) {
        log.info(`Found ${found.length} ConfIDent event series links`);
      }
    },

    errorHandler: async ({ request, log }, error) => {
      log.error(`ConfIDent request failed: ${request.url}`, {
        error: String(error),
      });
    },

    failedRequestHandler: async ({ request, log }) => {
      log.error(`ConfIDent request failed: ${request.url}`);
    },
  });

  await crawler.run([indexUrl]);

  let seriesToProcess = [...new Map(series.map((s) => [s.url, s])).values()];

  if (CONFIDENT_CONFERENCE_CONFIG.seriesToNotProcess.length !== 0) {
    seriesToProcess = seriesToProcess.filter(
      (item) =>
        !CONFIDENT_CONFERENCE_CONFIG.seriesToNotProcess.some((skip) =>
          item.name.toLowerCase().includes(skip.trim().toLowerCase()),
        ),
    );
  }

  return seriesToProcess;
}

/**
 * Parse pagination URLs on a ConfIDent listing page.
 */
function extractConfidentPaginationUrls(
  $: CheerioCrawlingContext["$"],
  listingUrl: string,
): string[] {
  const urls = new Set<string>();

  const selectors = [
    ".smw-pagination a",
    ".pagination a",
    "div.mw-pager-navigation-bar a",
    "a[href*='offset=']",
    "a[href*='limit=']",
  ];

  for (const selector of selectors) {
    $(selector).each((_, element) => {
      const href = $(element).attr("href");
      const absoluteUrl = resolveUrl(href, listingUrl);

      if (absoluteUrl) {
        urls.add(absoluteUrl);
      }
    });
  }

  return [...urls];
}

/**
 * Parse event page URLs from a series or events listing.
 */
function extractConfidentEventListings(
  $: CheerioCrawlingContext["$"],
  pageUrl: string,
): ConfidentEventListing[] {
  const results = new Map<string, ConfidentEventListing>();

  $('a[href*="Event:"]').each((_, element) => {
    const href = $(element).attr("href");
    const url = resolveUrl(href, pageUrl);
    const title = $(element).text().trim();

    if (!url || results.has(url)) {
      return;
    }

    results.set(url, { url, title: title || undefined });
  });

  return [...results.values()];
}

/**
 * Build a CollectedConference from an Event:… page.
 * Fill in property infobox / SMW fields as you discover them on ConfIDent.
 */
function postingFromConfidentEventPage(
  $: CheerioCrawlingContext["$"],
  eventUrl: string,
  listingHint?: ConfidentEventListing,
): CollectedConference | null {
  const collectionDate = generateCollectionDate();

  const conferenceName =
    $("#firstHeading").text().trim() ||
    listingHint?.title?.trim() ||
    "";

  if (!conferenceName) {
    return null;
  }

  const conferenceStartDate = listingHint?.startDate ?? null;
  const conferenceEndDate = listingHint?.endDate ?? null;
  const conferenceLocation = listingHint?.location ?? null;

  const yearMatch =
    conferenceStartDate?.match(/^(\d{4})/)?.[1] ??
    conferenceEndDate?.match(/^(\d{4})/)?.[1] ??
    conferenceName.match(/\b(19|20)\d{2}\b/)?.[0];

  if (!yearMatch) {
    return null;
  }

  const conferenceYear = Number.parseInt(yearMatch, 10);
  const conferenceAcronym = normalizeConferenceAcronym(
    conferenceName.split(/\s[-–—]\s/)[0]?.trim() ?? null,
  );

  // Optional: scrape infobox / category links into conferenceCategories.
  const conferenceCategories = $(
    'a[href*="Academic_Field:"]',
  )
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);

  return {
    id: eventUrl,
    collectionDate,
    _sources: ["confident-conference.org"],
    conferenceName,
    conferenceYear,
    conferenceLocation,
    conferenceStartDate,
    conferenceEndDate,
    conferenceAcronym,
    conferenceCategories: conferenceCategories.length
      ? conferenceCategories
      : null,
    conferenceUri: eventUrl,
  };
}

async function collectConfidentEventsForSeries(
  seriesUrl: string,
  seriesNumber: number,
  seriesTotal: number,
): Promise<CollectedConference[]> {
  const listings = new Map<string, ConfidentEventListing>();
  const pageLimit = CONFIDENT_CONFERENCE_CONFIG.categoryPageLimit;

  const listingCrawler = new CheerioCrawler({
    maxRequestsPerCrawl:
      pageLimit === null ? undefined : Math.max(1, pageLimit + 1),

    preNavigationHooks: [crawlDelayHook()],

    async requestHandler({ $, enqueueLinks, request }) {
      for (const listing of extractConfidentEventListings($, request.url)) {
        listings.set(listing.url, listing);
      }

      if (pageLimit === null || listings.size < pageLimit * 50) {
        const paginationUrls = extractConfidentPaginationUrls($, request.url);
        await enqueueLinks({
          urls: paginationUrls,
          strategy: "same-domain",
        });
      }
    },
  });

  await listingCrawler.run([seriesUrl]);

  let eventUrls = [...listings.values()];

  if (pageLimit !== null) {
    eventUrls = eventUrls.slice(0, pageLimit * 50);
  }

  const postings: CollectedConference[] = [];

  const detailCrawler = new CheerioCrawler({
    maxRequestsPerCrawl: eventUrls.length || 1,

    preNavigationHooks: [crawlDelayHook()],

    async requestHandler({ $, request }) {
      const hint = listings.get(request.url);
      const posting = postingFromConfidentEventPage($, request.url, hint);

      if (posting) {
        postings.push(posting);
      }
    },
  });

  await detailCrawler.run(eventUrls.map((e) => e.url));

  console.log(
    `[ConfIDent] Series ${seriesNumber}/${seriesTotal}: ` +
      `parsed ${postings.length}/${eventUrls.length} events`,
  );

  return postings;
}

export async function collectConfidentConference(): Promise<
  CollectedConference[]
> {
  if (
    CONFIDENT_CONFERENCE_CONFIG.categoryLimit === 0 ||
    CONFIDENT_CONFERENCE_CONFIG.categoryPageLimit === 0
  ) {
    console.log(
      "[ConfIDent] Collection disabled: categoryLimit or categoryPageLimit is 0.",
    );
    return [];
  }

  console.log(
    `[ConfIDent] Collection starting: categoryLimit=${CONFIDENT_CONFERENCE_CONFIG.categoryLimit}, ` +
      `categoryPageLimit=${CONFIDENT_CONFERENCE_CONFIG.categoryPageLimit}, ` +
      `eventSeriesBrowseUrl=${CONFIDENT_CONFERENCE_CONFIG.eventSeriesBrowseUrl}`,
  );

  const allSeries = await collectConfidentEventSeries();

  if (!allSeries.length) {
    console.log(
      "[ConfIDent] No event series found — set eventSeriesBrowseUrl and parseConfidentEventSeries() for your crawl entry point.",
    );
    return [];
  }

  const seriesToProcess =
    CONFIDENT_CONFERENCE_CONFIG.categoryLimit === null
      ? allSeries
      : allSeries.slice(0, CONFIDENT_CONFERENCE_CONFIG.categoryLimit);

  console.log(
    `[ConfIDent] Processing ${seriesToProcess.length}/${allSeries.length} series`,
  );

  const postings: CollectedConference[] = [];

  for (const [index, series] of seriesToProcess.entries()) {
    const seriesPostings = await collectConfidentEventsForSeries(
      series.url,
      index + 1,
      seriesToProcess.length,
    );

    postings.push(...seriesPostings);

    console.log(
      `[ConfIDent] Series processed: ${index + 1}/${seriesToProcess.length} (${series.name})`,
    );
  }

  console.log(`[ConfIDent] Collected ${postings.length} conferences`);

  return postings;
}
