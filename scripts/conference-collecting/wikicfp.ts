import { CheerioCrawler, type CheerioCrawlingContext } from "crawlee";
import type { CollectedConference } from "./schema.js";

import { WIKICFP_CONFIG } from "./collection-config.js";

import { generateCollectionDate, randomDelay, resolveUrl } from "./utils.js";

type WikiCFPCategory = {
  url: string;
  name: string;
};

type WikiCFPListingData = {
  url: string;
  acronym: string;
  startDate?: string;
  endDate?: string;
  location?: string;
};

function parseWikiCFPCategories(
  $: CheerioCrawlingContext["$"],
): WikiCFPCategory[] {
  const categories: WikiCFPCategory[] = [];

  $("div.contsec a").each((_, element) => {
    const href = $(element).attr("href");
    const url = resolveUrl(href, WIKICFP_CONFIG.baseUrl);
    const name = $(element).text().trim();

    if (url && name) {
      categories.push({ url, name });
    }
  });

  return [...new Map(categories.map((c) => [c.url, c])).values()];
}

async function collectWikiCFPCategories(): Promise<WikiCFPCategory[]> {
  const categories: WikiCFPCategory[] = [];
  const allcatUrl = `${WIKICFP_CONFIG.baseUrl}/cfp/allcat`;

  const crawler = new CheerioCrawler({
    maxRequestsPerCrawl: 1,

    async requestHandler({ $, log }) {
      const found = parseWikiCFPCategories($);
      categories.push(...found);

      if (found.length > 0) {
        log.info(`Found ${found.length} WikiCFP categories`);
      }
    },

    errorHandler: async ({ request, log }, error) => {
      log.error(`WikiCFP request failed: ${request.url}`, {
        error: String(error),
      });
    },

    failedRequestHandler: async ({ request, log }) => {
      log.error(`WikiCFP request failed: ${request.url}`);
    },
  });

  await crawler.run([allcatUrl]);

  const allCategories = [
    ...new Map(categories.map((c) => [c.url, c])).values(),
  ];

  let categoriesToProcessBase = allCategories;

  if (WIKICFP_CONFIG.categoriesToNotProcess.length !== 0) {
    categoriesToProcessBase = allCategories.filter(
      (category) =>
        !WIKICFP_CONFIG.categoriesToNotProcess.some((skip) =>
          category.name.toLowerCase().includes(skip.trim().toLowerCase()),
        ),
    );

    const skippedCount = allCategories.length - categoriesToProcessBase.length;

    if (skippedCount > 0) {
      console.log(
        `[WikiCFP] Skipped ${skippedCount} categories (categoriesToNotProcess).`,
      );
    }

    if (categoriesToProcessBase.length === 0 && allCategories.length > 0) {
      console.log(
        `[WikiCFP] Warning: categoriesToNotProcess filtered out all ${allCategories.length} categories; falling back to unfiltered list for this run.`,
      );

      categoriesToProcessBase = allCategories;
    }
  }

  return categoriesToProcessBase;
}

function extractWikiCFPPaginationUrls(
  $: CheerioCrawlingContext["$"],
  categoryUrl: string,
): string[] {
  const urls = new Set<string>();

  const selectors = [
    ".pagination a",
    ".pager a",
    "div.pages a",
    "div.paging a",
    "a[href*='page=']",
    "a[href*='start=']",
  ];

  for (const selector of selectors) {
    $(selector).each((_, element) => {
      const href = $(element).attr("href");
      const absoluteUrl = resolveUrl(href, categoryUrl);

      if (!absoluteUrl) {
        return;
      }

      try {
        const url = new URL(absoluteUrl);

        if (url.hostname !== new URL(WIKICFP_CONFIG.baseUrl).hostname) {
          return;
        }

        if (!url.pathname.includes("/cfp/")) {
          return;
        }

        const isPagination =
          url.searchParams.has("page") ||
          url.searchParams.has("start") ||
          url.searchParams.has("offset");

        if (isPagination) {
          urls.add(url.toString());
        }
      } catch {
        // Ignore invalid URLs.
      }
    });
  }

  return [...urls];
}

function extractWikiCFPConferenceUrls(
  $: CheerioCrawlingContext["$"],
): WikiCFPListingData[] {
  const results = new Map<string, WikiCFPListingData>();

  $("a[href*='/cfp/servlet/event.showcfp']").each((_, element) => {
    const href = $(element).attr("href");
    const url = resolveUrl(href, WIKICFP_CONFIG.baseUrl);
    const acronym = $(element).text().trim();

    if (!url || results.has(url)) {
      return;
    }

    const data: WikiCFPListingData = {
      url,
      acronym,
    };

    const row = $(element).closest("tr");
    const nextRow = row.next("tr");

    if (nextRow.length) {
      const cells = nextRow.find("td");

      if (cells.length > 0) {
        const dateStr = $(cells[0]).text().trim();
        const dateParts = dateStr.split("-").map((d) => d.trim());

        if (dateParts.length === 2) {
          try {
            const startDate = new Date(dateParts[0]);
            const endDate = new Date(dateParts[1]);

            if (!Number.isNaN(startDate.getTime())) {
              data.startDate = startDate.toISOString().split("T")[0];
            }

            if (!Number.isNaN(endDate.getTime())) {
              data.endDate = endDate.toISOString().split("T")[0];
            }
          } catch {
            // Continue without dates.
          }
        }
      }

      if (cells.length > 1) {
        const location = $(cells[1]).text().trim();

        if (location) {
          data.location = location;
        }
      }
    }

    results.set(url, data);
  });

  return [...results.values()];
}

function parseWikiCFPConferenceDetail(
  $: CheerioCrawlingContext["$"],
  conferenceDetailUrl: string,
  acronymFromListing?: string,
  startDateFromListing?: string,
  endDateFromListing?: string,
  locationFromListing?: string,
): CollectedConference | null {
  const collectionDate = generateCollectionDate();

  let conferenceName: string | undefined = $("span[property='v:description']")
    .text()
    .trim()
    .split(":")
    .slice(1)
    .join(":")
    .trim();

  if (!conferenceName) {
    conferenceName = $("span[property='v:summary']").attr("content");
  }

  if (!conferenceName) {
    conferenceName = $("h2 span").first().text().trim();
  }

  if (!conferenceName) {
    return null;
  }

  const conferenceStartDate =
    $("span[property='v:startDate']").attr("content")?.split("T")[0] ||
    startDateFromListing;

  const conferenceEndDate =
    $("span[property='v:endDate']").attr("content")?.split("T")[0] ||
    endDateFromListing;

  let conferenceLocation =
    $("span[property='v:locality']").attr("content") || locationFromListing;

  const kvFields: Record<string, string> = {};

  $("th").each((_, th) => {
    const key = $(th).text().trim();
    if (!key) return;

    const row = $(th).closest("tr");
    const td = row.find("td").first();

    if (!td.length) return;

    if (key === "Submission Deadline") {
      const iso = td
        .find("span[property='v:startDate']")
        .first()
        .attr("content")
        ?.split("T")[0];

      kvFields[key] = iso ?? td.text().trim();
      return;
    }

    kvFields[key] = td.text().trim();
  });

  if (!conferenceLocation) {
    conferenceLocation = kvFields["Where"] || undefined;
  }

  if (conferenceLocation) {
    conferenceLocation = conferenceLocation.replace(/,\s*$/, "").trim();
  }

  const submissionDeadline = kvFields["Submission Deadline"] || undefined;

  let conferenceUri = "";

  $("div.contsec td").each((_, cell) => {
    if (conferenceUri || !$(cell).text().trim().startsWith("Link:")) {
      return;
    }

    const href = $(cell).find("a").first().attr("href");

    if (href) {
      conferenceUri = resolveUrl(href, WIKICFP_CONFIG.baseUrl) ?? "";
    }
  });

  const categories = $(
    "h5 a[href*='call?conference='], h5 a[href*='../call?conference=']",
  )
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((text) => Boolean(text) && text.toLowerCase() !== "categories");

  const callForPapersRow = $("tr")
    .filter((_, tr) => {
      const h3Text = $(tr).find("h3").first().text().trim().toLowerCase();
      return h3Text.includes("call for papers");
    })
    .first();

  const nextRow = callForPapersRow.length ? callForPapersRow.next("tr") : $();

  const cfpDetails = nextRow.find("div.cfp").first().text().trim();

  const year =
    conferenceStartDate?.match(/^(\d{4})/)?.[1] ??
    conferenceEndDate?.match(/^(\d{4})/)?.[1] ??
    conferenceName.match(/(\d{4})/)?.[1];

  if (!year) {
    return null;
  }

  const conferenceYear = Number.parseInt(year, 10);

  const conferenceAcronym = acronymFromListing?.trim() || null;

  return {
    id: conferenceDetailUrl,
    collectionDate,
    _source: ["wikicfp"],
    conferenceName,
    conferenceYear,
    conferenceUri,
    conferenceLocation: conferenceLocation || null,
    conferenceStartDate: conferenceStartDate ?? null,
    conferenceEndDate: conferenceEndDate ?? null,
    conferenceAcronym,
    conferenceSeries: null,
    conferenceCategories: categories.length ? categories : null,
    conferenceText: cfpDetails || null,
    submissionDeadline: submissionDeadline || null,
  };
}

async function collectWikiCFPConferences(
  categoryUrl: string,
  categoryNumber: number,
  categoryTotal: number,
): Promise<CollectedConference[]> {
  const conferenceUrls = new Map<string, Omit<WikiCFPListingData, "url">>();

  let categoryPagesScanned = 0;

  const categoryCrawler = new CheerioCrawler({
    maxRequestsPerCrawl: WIKICFP_CONFIG.categoryPageLimit ?? 5000,
    maxConcurrency: 1,

    preNavigationHooks: [
      async () => {
        await randomDelay(
          WIKICFP_CONFIG.crawlMinDelayBetweenRequests,
          WIKICFP_CONFIG.crawlMaxDelayBetweenRequests,
        );
      },
    ],

    async requestHandler(context) {
      const { $, log } = context;

      categoryPagesScanned++;

      log.debug(
        `Category ${categoryNumber}/${categoryTotal}, page ${categoryPagesScanned}`,
      );

      const conferenceData = extractWikiCFPConferenceUrls($);

      conferenceData.forEach(
        ({ url, acronym, startDate, endDate, location }) => {
          if (!conferenceUrls.has(url)) {
            conferenceUrls.set(url, {
              acronym,
              startDate,
              endDate,
              location,
            });
          }
        },
      );

      log.debug(
        `Found ${conferenceData.length} conferences (${conferenceUrls.size} unique total)`,
      );

      if (
        WIKICFP_CONFIG.categoryPageLimit !== null &&
        categoryPagesScanned >= WIKICFP_CONFIG.categoryPageLimit
      ) {
        return;
      }

      const paginationUrls = extractWikiCFPPaginationUrls($, categoryUrl);

      if (paginationUrls.length) {
        await context.addRequests([{ url: paginationUrls[0] }]);
      }
    },

    errorHandler: async ({ request, log }, error) => {
      log.error(`WikiCFP category request failed: ${request.url}`, {
        error: String(error),
      });
    },

    failedRequestHandler: async ({ request, log }) => {
      log.error(`WikiCFP category request permanently failed: ${request.url}`);
    },
  });

  await categoryCrawler.run([categoryUrl]);

  console.log(
    `[WikiCFP] Category ${categoryNumber}/${categoryTotal}: ` +
      `${conferenceUrls.size} conferences across ${categoryPagesScanned} pages`,
  );

  if (!conferenceUrls.size) {
    return [];
  }

  const postings: CollectedConference[] = [];

  const detailCrawler = new CheerioCrawler({
    maxRequestsPerCrawl: conferenceUrls.size,
    maxConcurrency: 1,

    preNavigationHooks: [
      async () => {
        await randomDelay(
          WIKICFP_CONFIG.crawlMinDelayBetweenRequests,
          WIKICFP_CONFIG.crawlMaxDelayBetweenRequests,
        );
      },
    ],

    async requestHandler({ $, log, request }) {
      const data = conferenceUrls.get(request.url);

      const posting = parseWikiCFPConferenceDetail(
        $,
        request.url,
        data?.acronym,
        data?.startDate,
        data?.endDate,
        data?.location,
      );

      if (posting) {
        postings.push(posting);
      } else {
        log.debug(`Could not parse conference: ${request.url}`);
      }
    },

    errorHandler: async ({ request, log }, error) => {
      log.error(`WikiCFP detail request failed: ${request.url}`, {
        error: String(error),
      });
    },

    failedRequestHandler: async ({ request, log }) => {
      log.error(`WikiCFP detail request permanently failed: ${request.url}`);
    },
  });

  await detailCrawler.run([...conferenceUrls.keys()]);

  console.log(
    `[WikiCFP] Category ${categoryNumber}/${categoryTotal}: ` +
      `parsed ${postings.length}/${conferenceUrls.size} conferences`,
  );

  return postings;
}

export async function collectWikiCFP(): Promise<CollectedConference[]> {
  if (
    WIKICFP_CONFIG.categoryLimit === 0 ||
    WIKICFP_CONFIG.categoryPageLimit === 0
  ) {
    console.log(
      "[WikiCFP] Collection disabled: categoryLimit or categoryPageLimit is 0.",
    );
    return [];
  } else {
    console.log(
      `[WikiCFP] Collection Starting: categoryLimit=${WIKICFP_CONFIG.categoryLimit}, categoryPageLimit=${WIKICFP_CONFIG.categoryPageLimit}`,
    );
  }

  const categories = await collectWikiCFPCategories();

  if (!categories.length) {
    console.log("[WikiCFP] No categories found");
    return [];
  }

  const categoriesToProcess =
    WIKICFP_CONFIG.categoryLimit === null
      ? categories
      : categories.slice(0, WIKICFP_CONFIG.categoryLimit);

  console.log(
    `[WikiCFP] Processing ${categoriesToProcess.length}/${categories.length} categories`,
  );

  const postings: CollectedConference[] = [];

  for (const [index, category] of categoriesToProcess.entries()) {
    const categoryPostings = await collectWikiCFPConferences(
      category.url,
      index + 1,
      categoriesToProcess.length,
    );

    postings.push(...categoryPostings);

    console.log(
      `[WikiCFP] Categories processed: ${index + 1}/${categoriesToProcess.length} (${category.name})`,
    );
  }

  console.log(`[WikiCFP] Collected ${postings.length} conferences`);

  return postings;
}
