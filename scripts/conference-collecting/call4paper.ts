import { CheerioCrawler, type CheerioCrawlingContext } from "crawlee";

import type { CollectedConference } from "./schema.js";

import {
  generateCollectionDate,
  parseDateRange,
  randomDelay,
  resolveUrl,
} from "./utils.js";

const CALL4PAPER_BASE_URL = "https://www.call4paper.com";

const CALL4PAPER_CONFIG = {
  subjectLimit: 2 as number | null,
  eventLimit: 2 as number | null,
  crawlMinDelayBetweenRequests: 3001,
  crawlMaxDelayBetweenRequests: 3900,
};

interface Call4PaperListing {
  detailUrl: string;
  conferenceUri: string | null;
  conferenceName: string;
  conferenceAcronym: string | null;
  conferenceLocation: string | null;
  conferenceStartDate: string | null;
  conferenceEndDate: string | null;
  submissionDeadline: string | null;
  conferenceCategories: string[];
}

function parseSubmissionDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return value.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
}

function getConferenceYear(startDate: string | null): number | null {
  if (!startDate) {
    return null;
  }

  const year = Number.parseInt(startDate.slice(0, 4), 10);
  return Number.isNaN(year) ? null : year;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractLabeledValue(
  $: CheerioCrawlingContext["$"],
  label: string,
): string | null {
  const element = $("body")
    .find("*")
    .filter((_, candidate) => {
      const text = $(candidate)
        .clone()
        .children()
        .remove()
        .end()
        .text()
        .replace(/\s+/g, " ")
        .trim();

      return text.toLowerCase() === `${label}:`.toLowerCase();
    })
    .first();

  if (!element.length) {
    return null;
  }

  const value = element
    .parent()
    .text()
    .replace(new RegExp(`^${escapeRegExp(label)}\\s*:\\s*`, "i"), "")
    .replace(/\s+/g, " ")
    .trim();

  return value || null;
}

function extractCategories($: CheerioCrawlingContext["$"]): string[] {
  const categories: string[] = [];
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const titleMatch = bodyText.match(
    /Organizer:.*?Location:.*?(.*?)(?:\s{2,}|$)/i,
  );

  if (titleMatch?.[1]) {
    categories.push(
      ...titleMatch[1]
        .split(/\s{2,}/)
        .map((category) => category.trim())
        .filter(Boolean),
    );
  }

  return [...new Set(categories)];
}

function extractEventDetails($: CheerioCrawlingContext["$"]): {
  officialUrl: string | null;
  acronym: string | null;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  submissionDeadline: string | null;
  categories: string[];
} {
  const officialUrl = extractLabeledValue($, "URL");
  const eventDate = extractLabeledValue($, "Event Date");
  const submissionDate =
    extractLabeledValue($, "Submission Date") ||
    extractLabeledValue($, "Submission Due Date");
  const location = extractLabeledValue($, "Location");
  const { startDate, endDate } = parseDateRange(eventDate ?? "");
  const title = $("h1").first().text().replace(/\s+/g, " ").trim();

  const acronymMatch = title.match(/\(([A-Z][A-Z0-9&-]{1,15})\)/g);
  const acronym = acronymMatch?.length
    ? acronymMatch[acronymMatch.length - 1].slice(1, -1)
    : null;

  return {
    officialUrl,
    acronym,
    location,
    startDate: startDate ?? null,
    endDate: endDate ?? null,
    submissionDeadline: parseSubmissionDate(submissionDate),
    categories: extractCategories($),
  };
}

export async function collectCall4Paper(): Promise<CollectedConference[]> {
  const listings = new Map<string, Call4PaperListing>();

  // ===========================================================================
  // LISTING CRAWLER
  // ===========================================================================

  const listingCrawler = new CheerioCrawler({
    maxConcurrency: 1,
    preNavigationHooks: [
      async () => {
        await randomDelay(
          CALL4PAPER_CONFIG.crawlMinDelayBetweenRequests,
          CALL4PAPER_CONFIG.crawlMaxDelayBetweenRequests,
        );
      },
    ],

    requestHandler: async ({ request, $ }: CheerioCrawlingContext) => {
      const rows = $("table tr").toArray();

      console.log(
        `[Call4Paper] Listing page: ${request.url} (${rows.length} rows)`,
      );

      console.log(
        `[Call4Paper] Tables: ${$("table").length}; rows: ${rows.length}`,
      );

      const rowsWithCells = rows.filter((row) => $(row).find("td").length > 0);

      console.log(`[Call4Paper] Rows with cells: ${rowsWithCells.length}`);

      rowsWithCells.slice(0, 3).forEach((row, index) => {
        const cells = $(row).find("td");

        console.log(
          `[Call4Paper] Row ${index + 1} cells:`,
          cells
            .toArray()
            .map((element) => $(element).text().replace(/\s+/g, " ").trim()),
        );

        console.log(
          `[Call4Paper] Row ${index + 1} links:`,
          $(row)
            .find("a[href]")
            .toArray()
            .map((element) => ({
              text: $(element).text().replace(/\s+/g, " ").trim(),
              href: $(element).attr("href"),
            })),
        );
      });

      let listingsFound = 0;

      rowsWithCells.forEach((row) => {
        const cells = $(row).find("td");

        if (cells.length < 5) {
          return;
        }

        const link = $(row).find('a[href*="/cfp/detail/event/"]').first();

        if (!link.length) {
          return;
        }

        const conferenceName =
          link.find("span").first().text().replace(/\s+/g, " ").trim() ||
          link.text().replace(/\s+/g, " ").trim();

        const href = link.attr("href");

        if (!conferenceName || !href) {
          return;
        }

        const detailUrl = resolveUrl(href, request.url);

        if (!detailUrl) {
          console.warn(
            `[Call4Paper] Could not resolve conference URL: ${href}`,
          );

          return;
        }

        const conferenceAcronym =
          cells.eq(1).text().replace(/\s+/g, " ").trim() || null;

        const conferenceLocation =
          cells.eq(3).text().replace(/\s+/g, " ").trim() || null;

        const dateText = cells.eq(4).text().replace(/\s+/g, " ").trim();

        const submissionText =
          cells.length > 5
            ? cells.eq(5).text().replace(/\s+/g, " ").trim()
            : null;

        const numericDateRange = dateText.match(
          /(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/,
        );
        const { startDate, endDate } = numericDateRange
          ? {
              startDate: numericDateRange[1],
              endDate: numericDateRange[2],
            }
          : parseDateRange(dateText);

        listings.set(detailUrl, {
          detailUrl,
          conferenceUri: null,
          conferenceName,
          conferenceAcronym,
          conferenceLocation,
          conferenceStartDate: startDate,
          conferenceEndDate: endDate,
          submissionDeadline: parseSubmissionDate(submissionText),
          conferenceCategories: [],
        });

        listingsFound++;
      });

      console.log(
        `[Call4Paper] Listings found: ${listingsFound}; total listings: ${listings.size}`,
      );
    },

    errorHandler: async ({ request, log }, error) => {
      log.error(`[Call4Paper] Listing request failed: ${request.url}`, {
        error: String(error),
      });
    },
  });

  // ===========================================================================
  // DETAIL CRAWLER
  // ===========================================================================

  const detailCrawler = new CheerioCrawler({
    maxConcurrency: 1,

    preNavigationHooks: [
      async () => {
        await randomDelay(
          CALL4PAPER_CONFIG.crawlMinDelayBetweenRequests,
          CALL4PAPER_CONFIG.crawlMaxDelayBetweenRequests,
        );
      },
    ],

    requestHandler: async ({ request, $ }: CheerioCrawlingContext) => {
      const listing = listings.get(request.url);

      if (!listing) {
        console.log(
          `[Call4Paper] Missing listing for detail URL: ${request.url}`,
        );

        return;
      }

      const details = extractEventDetails($);

      if (details.categories.length > 0) {
        listing.conferenceCategories = details.categories;
      }

      if (details.officialUrl) {
        const officialUrl = resolveUrl(details.officialUrl, request.url);

        if (officialUrl) {
          listing.conferenceUri = officialUrl;
        }
      }

      if (details.location) {
        listing.conferenceLocation = details.location;
      }

      if (details.startDate) {
        listing.conferenceStartDate = details.startDate;
      }

      if (details.endDate) {
        listing.conferenceEndDate = details.endDate;
      }

      if (details.submissionDeadline) {
        listing.submissionDeadline = details.submissionDeadline;
      }

      listing.conferenceAcronym =
        listing.conferenceAcronym ||
        details.acronym ||
        extractConferenceAcronym(listing.conferenceName);

      console.log(`[Call4Paper] Detail processed: ${request.url}`);
    },

    errorHandler: async ({ request, log }, error) => {
      log.error(`[Call4Paper] Detail request failed: ${request.url}`, {
        error: String(error),
      });
    },
  });

  // ===========================================================================
  // COLLECT SUBJECT URLS
  // ===========================================================================

  const subjectUrls = await collectSubjectUrls();

  const limitedSubjectUrls =
    CALL4PAPER_CONFIG.subjectLimit === null
      ? subjectUrls
      : subjectUrls.slice(0, CALL4PAPER_CONFIG.subjectLimit);

  console.log(
    `[Call4Paper] Subject URLs to process: ${limitedSubjectUrls.length}`,
  );

  if (limitedSubjectUrls.length === 0) {
    console.log("[Call4Paper] No subject URLs found.");

    return [];
  }

  await listingCrawler.run(limitedSubjectUrls);

  console.log("listings after listing crawler", listings);

  let detailUrls = [...listings.keys()];

  console.log(`[Call4Paper] Detail URLs collected: ${detailUrls.length}`);

  if (CALL4PAPER_CONFIG.eventLimit !== null) {
    detailUrls = detailUrls.slice(0, CALL4PAPER_CONFIG.eventLimit);
  }

  console.log(`[Call4Paper] Detail URLs to process: ${detailUrls.length}`);

  if (detailUrls.length === 0) {
    console.log("[Call4Paper] No detail URLs found.");

    return [];
  }

  await detailCrawler.run(detailUrls);

  const postings = [...listings.values()].map((listing) => ({
    id: listing.detailUrl,
    collectionDate: generateCollectionDate(),
    _source: "call4paper" as const,
    conferenceName: listing.conferenceName,
    conferenceYear: getConferenceYear(listing.conferenceStartDate),
    conferenceUri: listing.conferenceUri,
    conferenceLocation: listing.conferenceLocation,
    conferenceStartDate: listing.conferenceStartDate,
    conferenceEndDate: listing.conferenceEndDate,
    conferenceAcronym: listing.conferenceAcronym,
    conferenceSeries: null,
    conferenceCategories: listing.conferenceCategories,
    conferenceText: null,
    submissionDeadline: listing.submissionDeadline,
  }));

  console.log(`[Call4Paper] Collection complete: ${postings.length} postings.`);

  return postings;
}

// ============================================================================
// SUBJECT COLLECTION
// ============================================================================

async function collectSubjectUrls(): Promise<string[]> {
  const subjectUrls = new Set<string>();

  const crawler = new CheerioCrawler({
    maxConcurrency: 1,

    preNavigationHooks: [
      async () => {
        await randomDelay(
          CALL4PAPER_CONFIG.crawlMinDelayBetweenRequests,
          CALL4PAPER_CONFIG.crawlMaxDelayBetweenRequests,
        );
      },
    ],

    requestHandler: async ({ request, $ }: CheerioCrawlingContext) => {
      console.log(`[Call4Paper] Collecting subject URLs from: ${request.url}`);

      const links = $('a.normal[href*="/cfp/listBySubject"]');

      links.each((_, element) => {
        const href = $(element).attr("href");

        if (!href) {
          return;
        }

        let parsedUrl: URL;

        try {
          parsedUrl = new URL(href, request.url);
        } catch (error) {
          console.warn(`[Call4Paper] Invalid subject href: ${href}`, error);
          return;
        }

        if (parsedUrl.searchParams.get("type") !== "event") {
          console.log(
            "event type is not event",
            parsedUrl.searchParams.get("type"),
            parsedUrl.href,
          );
          return;
        }

        const subjectCode = parsedUrl.searchParams.get("subject");

        if (!subjectCode) {
          return;
        }

        subjectUrls.add(parsedUrl.href);
      });

      console.log(`[Call4Paper] Event subject URLs found: ${subjectUrls.size}`);
    },

    errorHandler: async ({ request, log }, error) => {
      log.error(
        `[Call4Paper] Subject homepage request failed: ${request.url}`,
        {
          error: String(error),
        },
      );
    },
  });

  await crawler.run([CALL4PAPER_BASE_URL]);

  const urls = [...subjectUrls];

  console.log(
    `[Call4Paper] Subject collection complete: ${urls.length} event subjects`,
  );

  return urls;
}

// ============================================================================
// EVENT DETAIL PARSING
// ============================================================================

// function extractEventDetails(
//   $: CheerioCrawlingContext["$"],
// ): {
//   officialUrl: string | null;
//   acronym: string | null;
//   location: string | null;
//   startDate: string | null;
//   endDate: string | null;
//   submissionDeadline: string | null;
//   categories: string[];
// } {
//   const officialUrl = extractLabeledValue($, "URL");
//   const eventDate = extractLabeledValue($, "Event Date");
//
//   const submissionDate =
//     extractLabeledValue($, "Submission Date") ||
//     extractLabeledValue($, "Submission Due Date");
//
//   const location = extractLabeledValue($, "Location");
//
//   const { startDate, endDate } = parseDateRange(eventDate);
//
//   const categories = extractCategories($);
//
//   const title = $("h1").first().text().replace(/\s+/g, " ").trim();
//
//   return {
//     officialUrl,
//     acronym: extractConferenceAcronym(title),
//     location,
//     startDate,
//     endDate,
//     submissionDeadline: parseSubmissionDate(submissionDate),
//     categories,
//   };
// }

// ============================================================================
// LABELED VALUE EXTRACTION
// ============================================================================

// function extractLabeledValue(
//   $: CheerioCrawlingContext["$"],
//   label: string,
// ): string | null {
//   const element = $("body")
//     .find("*")
//     .filter((_, candidate) => {
//       const text = $(candidate)
//         .clone()
//         .children()
//         .remove()
//         .end()
//         .text()
//         .replace(/\s+/g, " ")
//         .trim();
//
//       return text === `${label}:`;
//     })
//     .first();
//
//   if (!element.length) {
//     return null;
//   }
//
//   const value = element
//     .parent()
//     .text()
//     .replace(new RegExp(`^${escapeRegExp(label)}\\s*:\\s*`, "i"), "")
//     .replace(/\s+/g, " ")
//     .trim();
//
//   return value || null;
// }

// ============================================================================
// CATEGORY EXTRACTION
// ============================================================================

// function extractCategories($: CheerioCrawlingContext["$"]): string[] {
//   const categories: string[] = [];
//
//   const bodyText = $("body").text().replace(/\s+/g, " ").trim();
//
//   const titleMatch = bodyText.match(
//     /Organizer:.*?Location:.*?(.*?)(?:\s{2,}|$)/i,
//   );
//
//   if (titleMatch?.[1]) {
//     categories.push(
//       ...titleMatch[1]
//         .split(/\s{2,}/)
//         .map((category) => category.trim())
//         .filter(Boolean),
//     );
//   }
//
//   return [...new Set(categories)];
// }

// ============================================================================
// SUBMISSION DATE
// ============================================================================

// function parseSubmissionDate(value: string | null): string | null {
//   if (!value) {
//     return null;
//   }
//
//   const match = value.match(/\d{4}-\d{2}-\d{2}/);
//
//   return match?.[0] || null;
// }

// ============================================================================
// CONFERENCE ACRONYM
// ============================================================================

// function extractConferenceAcronym(title: string): string | null {
//   const matches = [...title.matchAll(/\(([A-Z][A-Z0-9&-]{1,15})\)/g)];
//
//   if (matches.length === 0) {
//     return null;
//   }
//
//   return matches[matches.length - 1][1];
// }

// ============================================================================
// CONFERENCE YEAR
// ============================================================================

// function getConferenceYear(startDate: string | null): number | null {
//   if (!startDate) {
//     return null;
//   }
//
//   const year = Number(startDate.substring(0, 4));
//
//   return Number.isNaN(year) ? null : year;
// }

// ============================================================================
// REGEX ESCAPING
// ============================================================================

// function escapeRegExp(value: string): string {
//   return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// }
