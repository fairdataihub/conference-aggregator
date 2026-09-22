import { CheerioCrawler, type CheerioCrawlingContext } from "crawlee";

import type { CollectedConference } from "./schema.js";

import { CALL4PAPER_CONFIG } from "./collection-config.js";

import {
  generateCollectionDate,
  parseDateRange,
  randomDelay,
  resolveUrl,
} from "./utils.js";

function parseSubmissionDate(value: string | null): string | null {
  return value?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
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

/** Canonical detail URL; listing links and post-redirect paths may differ. */
function call4PaperEventId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(
      /(?:\/cfp)?\/detail\/event\/([^/?#]+)/i,
    );

    if (!match) {
      return null;
    }

    return `${parsed.origin}/cfp/detail/event/${match[1]}`;
  } catch {
    return null;
  }
}

function detailMapKey(url: string): string {
  return call4PaperEventId(url) ?? url;
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

function extractDescriptionConferenceText(
  $: CheerioCrawlingContext["$"],
): string | null {
  const text = $("div.description").text().replace(/\s+/g, " ").trim();
  return text || null;
}

function extractEventDescFields(
  $: CheerioCrawlingContext["$"],
): Record<string, string> {
  const fields: Record<string, string> = {};

  $("ul.event-desc li").each((_, li) => {
    const $li = $(li);
    const fullText = $li.text().replace(/\s+/g, " ").trim();
    const match = fullText.match(/^([^:]+):\s*(.*)$/);

    if (!match) {
      return;
    }

    const key = match[1].trim();
    let value = match[2].trim();

    if (key.toLowerCase() === "url") {
      const href = $li.find("a[href]").first().attr("href");
      if (href) {
        value = href;
      }
    }

    if (value) {
      fields[key] = value;
    }
  });

  return fields;
}

function extractEventDetails($: CheerioCrawlingContext["$"]) {
  const eventDesc = extractEventDescFields($);
  const urlFromEventDesc =
    eventDesc.URL ?? eventDesc.Url ?? eventDesc.url ?? null;
  const urlFromLabel = extractLabeledValue($, "URL");
  const officialUrl = urlFromEventDesc ?? urlFromLabel;
  const conferenceText = extractDescriptionConferenceText($);

  return {
    officialUrl,
    categories: [],
    conferenceText,
  };
}

export async function collectCall4Paper(): Promise<CollectedConference[]> {
  if (
    CALL4PAPER_CONFIG.subjectLimit === 0 ||
    CALL4PAPER_CONFIG.eventLimit === 0
  ) {
    console.log(
      "[Call4Paper] Collection disabled: subjectLimit or eventLimit is 0.",
    );
    return [];
  } else {
    console.log(
      `[Call4Paper] Collection Starting: subjectLimit=${CALL4PAPER_CONFIG.subjectLimit}, eventLimit=${CALL4PAPER_CONFIG.eventLimit}`,
    );
  }

  const listings = new Map<string, CollectedConference>();

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
      $("#cfpTable").each((_, table) => {
        const headers = $(table)
          .find("thead th")
          .map((_, header) => $(header).text().replace(/\s+/g, " ").trim())
          .get();

        $(table)
          .find("tbody tr")
          .each((_, row) => {
            const cells = $(row).find("td");

            if (!headers.length || cells.length < headers.length) {
              return;
            }

            const listingFields = headers.reduce<Record<string, string>>(
              (fields, header, index) => {
                fields[header] = $(cells[index])
                  .text()
                  .replace(/\s+/g, " ")
                  .trim();
                return fields;
              },
              {},
            );

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

            const resolved = resolveUrl(href, request.url);

            if (!resolved) {
              return;
            }

            const id = call4PaperEventId(resolved) ?? resolved;

            const conferenceAcronym = listingFields["Title Abbr."] || null;
            const conferenceLocation = listingFields.Location || null;
            const dateText = listingFields.Date || "";
            const submissionText = listingFields["Submission Due Date"] || null;

            const numericDateRange = dateText.match(
              /(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/,
            );

            const { startDate, endDate } = numericDateRange
              ? {
                  startDate: numericDateRange[1],
                  endDate: numericDateRange[2],
                }
              : parseDateRange(dateText);

            listings.set(id, {
              id,
              collectionDate: null,
              _sources: ["call4paper.com"],
              conferenceName,
              conferenceYear: getConferenceYear(startDate ?? null),
              conferenceLocation,
              conferenceIdentifier: undefined,
              conferenceIdentifierType: undefined,
              conferenceSchemaUri: undefined,
              conferenceStartDate: startDate ?? null,
              conferenceEndDate: endDate ?? null,
              conferenceAcronym,
              conferenceSeries: null,
              submissionDeadline: parseSubmissionDate(submissionText),
            });
          });
      });
    },

    errorHandler: async ({ request, log }, error) => {
      log.error(`[Call4Paper] Listing request failed: ${request.url}`, {
        error: String(error),
      });
    },
  });

  const subjectUrls = await collectSubjectUrls();

  const limitedSubjectUrls =
    CALL4PAPER_CONFIG.subjectLimit === null
      ? subjectUrls
      : subjectUrls.slice(0, CALL4PAPER_CONFIG.subjectLimit);

  if (!limitedSubjectUrls.length) {
    return [];
  }

  await listingCrawler.run(limitedSubjectUrls);

  console.log(
    `[Call4Paper] Listing crawl: ${listings.size} events from ${limitedSubjectUrls.length} subjects`,
  );

  let listingIds = [...listings.keys()];

  if (CALL4PAPER_CONFIG.eventLimit !== null) {
    listingIds = listingIds.slice(0, CALL4PAPER_CONFIG.eventLimit);
  }

  if (!listingIds.length) {
    return [];
  }

  const details = new Map<string, ReturnType<typeof extractEventDetails>>();

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
      const loadedUrl = request.loadedUrl ?? request.url;
      const key = detailMapKey(loadedUrl);
      details.set(key, extractEventDetails($));
    },

    errorHandler: async ({ request, log }, error) => {
      log.error(`[Call4Paper] Detail request failed: ${request.url}`, {
        error: String(error),
      });
    },
  });

  await detailCrawler.run(listingIds.map((id) => listings.get(id)?.id ?? id));

  const postings = listingIds
    .map((listingId) => {
      const listing = listings.get(listingId);

      if (!listing) {
        return null;
      }

      const detail = details.get(detailMapKey(listing.id));

      if (!detail) {
        return {
          ...listing,
          collectionDate: generateCollectionDate(),
          conferenceUri: null,
          conferenceCategories: [],
          conferenceText: null,
        };
      }

      const conferenceUri = detail.officialUrl
        ? (resolveUrl(detail.officialUrl, listing.id) ?? null)
        : null;

      return {
        ...listing,
        collectionDate: generateCollectionDate(),
        conferenceUri,
        conferenceCategories: detail.categories,
        conferenceText: detail.conferenceText,
      };
    })
    .filter(Boolean) as CollectedConference[];

  console.log(`[Call4Paper] Collected ${postings.length} conferences`);

  return postings;
}

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
      $('a.normal[href*="/cfp/listBySubject"]').each((_, element) => {
        const href = $(element).attr("href");

        if (!href) {
          return;
        }

        try {
          const url = new URL(href, request.url);

          if (
            url.searchParams.get("type") === "event" &&
            url.searchParams.get("subject")
          ) {
            subjectUrls.add(url.href);
          }
        } catch {
          // skip malformed subject links
        }
      });
    },

    errorHandler: async ({ request, log }, error) => {
      log.error(
        `[Call4Paper] Subject homepage request failed: ${request.url}`,
        { error: String(error) },
      );
    },
  });

  await crawler.run([CALL4PAPER_CONFIG.baseUrl]);

  return [...subjectUrls];
}
