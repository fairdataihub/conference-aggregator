import { CheerioCrawler, type CheerioCrawlingContext } from "crawlee";
import { wikiCFPCategoriesToNotCollect } from "./utils.js";
import type { CollectedConference } from "./schema.js";

import {
  extractConferenceAcronym,
  parseDateRange,
  randomDelay,
  resolveUrl,
  generateCollectionDate,
} from "./utils.js";

const WIKICFP_BASE_URL = "http://www.wikicfp.com";
const EASYCHAIR_BASE_URL = "https://easychair.org";
const CFP_WIKI_BASE_URL = "https://cfp.wiki";

const WIKICFP_CONFIG: {
  categoryLimit: number | null;
  categoryPageLimit: number | null;
  crawlMinDelayBetweenRequests: number;
  crawlMaxDelayBetweenRequests: number;
  categoriesToNotProcess: string[];
} = {
  categoryLimit: 1,
  categoryPageLimit: 1,
  crawlMinDelayBetweenRequests: 5001,
  crawlMaxDelayBetweenRequests: 5049,
  categoriesToNotProcess: wikiCFPCategoriesToNotCollect,
};

const EASYCHAIR_CONFIG: {
  pageLimit: number | null;
  crawlMinDelayBetweenRequests: number;
  crawlMaxDelayBetweenRequests: number;
} = {
  pageLimit: 1,
  crawlMinDelayBetweenRequests: 3001,
  crawlMaxDelayBetweenRequests: 3900,
};

const CFP_WIKI_CONFIG: {
  pageLimit: number | null;
  crawlMinDelayBetweenRequests: number;
  crawlMaxDelayBetweenRequests: number;
} = {
  pageLimit: 1,
  crawlMinDelayBetweenRequests: 3001,
  crawlMaxDelayBetweenRequests: 3900,
};

type WikiCFPCategory = { url: string; name: string };

/**
 * Extracts categories (name + URL) from the WikiCFP "all categories" page.
 */
function parseWikiCFPCategories($: CheerioCrawlingContext["$"]): WikiCFPCategory[] {
  const categories: WikiCFPCategory[] = [];

  $("div.contsec a").each((_, element) => {
    const href = $(element).attr("href");
    const url = resolveUrl(href, WIKICFP_BASE_URL);
    const name = $(element).text().trim();

    if (url && name) {
      categories.push({ url, name });
    }
  });

  // Ensure stable uniqueness by URL.
  return [...new Map(categories.map((c) => [c.url, c])).values()];
}

/**
 * Fetches all available WikiCFP categories from the main categories page.
 */
async function collectWikiCFPCategories(): Promise<WikiCFPCategory[]> {
  const categories: WikiCFPCategory[] = [];
  const allcatUrl = `${WIKICFP_BASE_URL}/cfp/allcat`;

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

  const allCategories = [...new Map(categories.map((c) => [c.url, c])).values()];

  // Filter out categories we don't want to process.
  let categoriesToProcessBase = allCategories;

  if (WIKICFP_CONFIG.categoriesToNotProcess.length !== 0) {
    categoriesToProcessBase =
      allCategories.filter(
        (category) =>
          !WIKICFP_CONFIG.categoriesToNotProcess.some((skip) =>
            category.name
              .toLowerCase()
              .includes(skip.trim().toLowerCase()),
          ),
      );

    const skippedCount = allCategories.length - categoriesToProcessBase.length;
    if (skippedCount > 0) {
      console.log(
        `[WikiCFP] Skipped ${skippedCount} categories (categoriesToNotProcess).`,
      );
    }

    // If your skip list filters out everything, fall back so the run doesn't become a no-op.
    if (
      categoriesToProcessBase.length === 0 &&
      allCategories.length > 0
    ) {
      console.log(
        `[WikiCFP] Warning: categoriesToNotProcess filtered out all ${allCategories.length} categories; falling back to unfiltered list for this run.`,
      );
      categoriesToProcessBase = allCategories;
    }
  }

  return categoriesToProcessBase;
}

/**
 * Extracts next page URLs from WikiCFP category listing pages.
 */
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

        if (url.hostname !== new URL(WIKICFP_BASE_URL).hostname) {
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
        // Ignore invalid URLs (malformed or different domain)
      }
    });
  }

  return [...urls];
}

/**
 * Removes trailing year from conference acronym (e.g., "ATRACC 2026" → "ATRACC").
 */
function cleanAcronym(rawAcronym: string): string {
  return rawAcronym.replace(/\s+\d{4}$/, "").trim();
}

/**
 * Extracts conference URLs and metadata from WikiCFP category listing pages.
 */
function extractWikiCFPConferenceUrls($: CheerioCrawlingContext["$"]): Array<{
  url: string;
  acronym: string;
  series: string;
  startDate?: string;
  endDate?: string;
  location?: string;
}> {
  const results = new Map<
    string,
    {
      url: string;
      acronym: string;
      series: string;
      startDate?: string;
      endDate?: string;
      location?: string;
    }
  >();

  $("a[href*='/cfp/servlet/event.showcfp']").each((_, element) => {
    const href = $(element).attr("href");
    const url = resolveUrl(href, WIKICFP_BASE_URL);
    const rawAcronym = $(element).text().trim();
    const acronym = cleanAcronym(rawAcronym);

    if (!url || !acronym || results.has(url)) {
      return;
    }

    const data: {
      url: string;
      acronym: string;
      series: string;
      startDate?: string;
      endDate?: string;
      location?: string;
    } = { url, acronym, series: rawAcronym };

    // Extract dates and location from the next row in the listing
    const row = $(element).closest("tr");
    const nextRow = row.next("tr");

    if (nextRow.length) {
      const cells = nextRow.find("td");

      // First cell contains dates in format "Nov 5, 2026 - Nov 7, 2026"
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
            // Continue without dates if parsing fails
          }
        }
      }

      // Second cell contains location
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

/**
 * Parses conference details from WikiCFP detail page, with fallback to listing page data.
 */
function parseWikiCFPConferenceDetail(
  $: CheerioCrawlingContext["$"],
  conferenceDetailUrl: string,
  acronymFromListing?: string,
  seriesFromListing?: string,
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

  conferenceName = conferenceName.trim();

  const conferenceStartDate =
    $("span[property='v:startDate']").attr("content")?.split("T")[0] ||
    startDateFromListing;

  const conferenceEndDate =
    $("span[property='v:endDate']").attr("content")?.split("T")[0] ||
    endDateFromListing;

  let conferenceLocation =
    $("span[property='v:locality']").attr("content") || locationFromListing;

  // WikiCFP detail pages render key/value data in a header table as:
  // <th>Where</th><td>...</td>, <th>Submission Deadline</th><td>...</td>, etc.
  // Build a map once, then read the values we need.
  const kvFields: Record<string, string> = {};
  $("th").each((_, th) => {
    const key = $(th).text().trim();
    if (!key) return;

    const row = $(th).closest("tr");
    const td = row.find("td").first();
    if (!td.length) return;

    if (key === "Submission Deadline") {
      const iso =
        td.find("span[property='v:startDate']").first().attr("content")?.split(
          "T",
        )[0];
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

  // WikiCFP detail pages include "Submission Deadline" in the same header table as "Where".
  const submissionDeadline: string | undefined =
    kvFields["Submission Deadline"] || undefined;

  let conferenceUri = "";

  $("div.contsec td").each((_, cell) => {
    if (conferenceUri || !$(cell).text().trim().startsWith("Link:")) {
      return;
    }

    const href = $(cell).find("a").first().attr("href");

    if (href) {
      conferenceUri = resolveUrl(href, WIKICFP_BASE_URL) ?? "";
    }
  });

  // WikiCFP detail pages include a "Categories" block in the header area.
  // For now we only extract + log the category labels as a string array.
  const categories = $("h5 a[href*='call?conference='], h5 a[href*='../call?conference=']")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((t) => Boolean(t) && t.toLowerCase() !== "categories");

  // There can be multiple `div.cfp` blocks on a page; extract the one that
  // appears right after the "Call For Papers" row.
  const callForPapersRow = $("tr").filter((_, tr) => {
    const h3Text = $(tr).find("h3").first().text().trim().toLowerCase();
    return h3Text.includes("call for papers");
  }).first();

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
  const conferenceAcronym =
    acronymFromListing || extractConferenceAcronym(conferenceName);

  return {
    id: conferenceDetailUrl,
    collectionDate,
    _source: "wikicfp",
    conferenceName,
    conferenceYear,
    conferenceUri,
    conferenceLocation: conferenceLocation || null,
    conferenceStartDate: conferenceStartDate ?? null,
    conferenceEndDate: conferenceEndDate ?? null,
    conferenceAcronym: conferenceAcronym ?? null,
    conferenceSeries: seriesFromListing ?? null,
    conferenceCategories: categories.length ? categories : null,
    conferenceText: cfpDetails || null,
    submissionDeadline: submissionDeadline || null,
  };
}

/**
 * Collects all conferences from a WikiCFP category by crawling listing and detail pages.
 */
async function collectWikiCFPConferences(
  categoryUrl: string,
  categoryNumber: number,
  categoryTotal: number,
): Promise<CollectedConference[]> {
  // Step 1: Crawl WikiCFP category listing pages to collect detail URLs + lightweight metadata.
  const conferenceUrls = new Map<
    string,
    {
      acronym: string;
      series: string;
      startDate?: string;
      endDate?: string;
      location?: string;
    }
  >();

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
        ({ url, acronym, series, startDate, endDate, location }) => {
          if (!conferenceUrls.has(url)) {
            conferenceUrls.set(url, {
              acronym,
              series,
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

  // Step 2: Crawl each conference detail page and parse the full posting.
  const postings: CollectedConference[] = [];

  let detailsProcessed = 0;

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
        data?.series,
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

  const urls = [...conferenceUrls.keys()];

  await detailCrawler.run(urls);

  console.log(
    `[WikiCFP] Category ${categoryNumber}/${categoryTotal}: ` +
    `parsed ${postings.length}/${urls.length} conferences`,
  );

  // Step 3: Return all parsed postings for this category.
  return postings;
}

export async function collectWikiCFP(): Promise<CollectedConference[]> {
  // Step 1: Fetch all WikiCFP categories.
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

  // Step 2: Process each category (list crawl + detail crawl), accumulating postings.
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

  // Step 3: Return all postings across processed categories.
  return postings;
}

/**
 * Parses conference listings from EasyChair search results page.
 */
function parseEasyChairConferences(
  $: CheerioCrawlingContext["$"],
): CollectedConference[] {
  const postings: CollectedConference[] = [];
  const collectionDate = generateCollectionDate();

  $("tr.green, tr.white").each((_, row) => {
    const cells = $(row).find("td");

    if (cells.length < 5) {
      return;
    }

    const titleLink = $(cells[0]).find("a").first();
    const rawAcronym = titleLink.text().trim();
    const title = $(cells[1]).text().trim();
    const href = titleLink.attr("href");

    if (!title || !href || !rawAcronym) {
      return;
    }

    const conferenceUri = resolveUrl(href, EASYCHAIR_BASE_URL);

    if (!conferenceUri) {
      return;
    }

    const acronym = cleanAcronym(rawAcronym);
    const conferenceSeries = rawAcronym;
    const conferenceLocation = $(cells[2]).text().trim();
    const rawDate = $(cells[4]).text().trim();

    const {
      startDate: conferenceStartDate,
      endDate: conferenceEndDate,
      year: conferenceYear,
    } = parseDateRange(rawDate);

    if (!conferenceYear) {
      return;
    }

    postings.push({
      // Use the EasyChair posting URL itself as the stable identifier.
      id: conferenceUri,
      collectionDate,
      _source: "easychair",
      conferenceName: title,
      conferenceYear,
      conferenceUri,
      conferenceLocation: conferenceLocation || null,
      conferenceStartDate: conferenceStartDate ?? null,
      conferenceEndDate: conferenceEndDate ?? null,
      conferenceAcronym: acronym ?? null,
      conferenceSeries: conferenceSeries ?? null,
      conferenceCategories: null,
      conferenceText: null,
      submissionDeadline: null,
    });
  });

  return postings;
}

/**
 * Extracts next page URLs from EasyChair search results.
 */
function extractEasyChairPaginationUrls(
  $: CheerioCrawlingContext["$"],
  currentUrl: string,
): string[] {
  const urls = new Set<string>();

  $(".pagination a, .pager a, a[href*='page=']").each((_, element) => {
    const url = resolveUrl($(element).attr("href"), currentUrl);

    if (!url) {
      return;
    }

    try {
      const parsedUrl = new URL(url);

      if (
        parsedUrl.hostname === new URL(EASYCHAIR_BASE_URL).hostname &&
        parsedUrl.pathname === "/cfp" &&
        parsedUrl.searchParams.has("page")
      ) {
        urls.add(parsedUrl.toString());
      }
    } catch {
      // Ignore URLs that don't match EasyChair CFP search parameters
    }
  });

  return [...urls];
}

/**
 * Extracts the conference website URL from EasyChair detail page.
 */
function extractEasyChairConferenceWebsite(
  $: CheerioCrawlingContext["$"],
): string {
  let conferenceWebsite = "";

  $("table.date_table tr").each((_, row) => {
    if (conferenceWebsite) {
      return;
    }

    const cells = $(row).find("td");

    if ($(cells[0]).text().trim().toLowerCase() !== "conference web page") {
      return;
    }

    const href = $(cells[1]).find("a").first().attr("href");
    conferenceWebsite = resolveUrl(href, EASYCHAIR_BASE_URL) ?? "";
  });

  return conferenceWebsite;
}

export async function collectEasyChair(): Promise<CollectedConference[]> {
  // Step 1: Crawl EasyChair listing pages and collect conferences (initial fields).
  const postings: CollectedConference[] = [];
  const url = `${EASYCHAIR_BASE_URL}/cfp`;
  let pagesScanned = 0;

  const crawler = new CheerioCrawler({
    maxRequestsPerCrawl: EASYCHAIR_CONFIG.pageLimit ?? 5000,
    maxConcurrency: 1,
    preNavigationHooks: [
      async () => {
        await randomDelay(
          EASYCHAIR_CONFIG.crawlMinDelayBetweenRequests,
          EASYCHAIR_CONFIG.crawlMaxDelayBetweenRequests,
        );
      },
    ],
    async requestHandler({ $, log, request, addRequests }) {
      pagesScanned++;
      if (EASYCHAIR_CONFIG.pageLimit !== null) {
        console.log(`[EasyChair] Listing pages processed: ${pagesScanned}/${EASYCHAIR_CONFIG.pageLimit}`);
      } else {
        console.log(`[EasyChair] Listing pages processed: ${pagesScanned}`);
      }

      const found = parseEasyChairConferences($);

      postings.push(...found);

      log.debug(`Page ${pagesScanned}: found ${found.length} conferences`);

      if (
        EASYCHAIR_CONFIG.pageLimit !== null &&
        pagesScanned >= EASYCHAIR_CONFIG.pageLimit
      ) {
        return;
      }

      const paginationUrls = extractEasyChairPaginationUrls($, request.url);

      if (paginationUrls.length) {
        await addRequests([{ url: paginationUrls[0] }]);
      }
    },

    errorHandler: async ({ request, log }, error) => {
      log.error(`EasyChair request failed: ${request.url}`, {
        error: String(error),
      });
    },

    failedRequestHandler: async ({ request, log }) => {
      log.error(`EasyChair request failed: ${request.url}`);
    },
  });

  await crawler.run([url]);

  // Step 2: Limit results and build a URL -> posting map for detail crawling.
  const limitedPostings =
    EASYCHAIR_CONFIG.pageLimit !== null
      ? postings.slice(0, EASYCHAIR_CONFIG.pageLimit)
      : postings;

  const postingsByDetailUrl = new Map(
    limitedPostings.map((posting) => [posting.conferenceUri, posting]),
  );

  const conferenceUrls = [...postingsByDetailUrl.keys()].filter(
    (conferenceUrl): conferenceUrl is string => Boolean(conferenceUrl),
  );

  let detailsProcessed = 0;

  limitedPostings.forEach((posting) => {
    posting.conferenceUri = "";
  });

  // Step 3: Crawl EasyChair detail pages and enrich each posting.
  const detailCrawler = new CheerioCrawler({
    maxRequestsPerCrawl: conferenceUrls.length,
    maxConcurrency: 1,

    preNavigationHooks: [
      async () => {
        await randomDelay(
          EASYCHAIR_CONFIG.crawlMinDelayBetweenRequests,
          EASYCHAIR_CONFIG.crawlMaxDelayBetweenRequests,
        );
      },
    ],

    async requestHandler({ $, request, log }) {
      const posting = postingsByDetailUrl.get(request.url);

      if (!posting) {
        return;
      }

      const conferenceWebsite = extractEasyChairConferenceWebsite($);

      posting.conferenceUri = conferenceWebsite;

      // EasyChair detail pages include a "Topics:" block with tag links.
      const topics = $("div.topics a")
        .map((_, a) => {
          const tagText = $(a).find("span.tag").first().text().trim();
          return tagText || $(a).text().trim();
        })
        .get()
        .filter((t) => Boolean(t));

      if (topics.length) {
        posting.conferenceCategories = topics;
      }

      // `div#cfp` contains some title/date tables and then the rest of the
      // call text. We want only the text after the tables.
      const cfpDiv = $("#cfp");
      if (cfpDiv.length) {
        const conferenceText = cfpDiv
          .clone()
          .find("table")
          .remove()
          .end()
          .text()
          .replace(/\s+/g, " ")
          .trim();

        if (conferenceText) {
          posting.conferenceText = conferenceText;
        }
      }

      const submissionDeadlineRow = $("tr")
        .filter((_, tr) => {
          const firstTdText = $(tr).find("td").first().text().trim().toLowerCase();
          return firstTdText === "submission deadline";
        })
        .first();

      const submissionDeadlineRaw = submissionDeadlineRow
        .find("td")
        .eq(1)
        .text()
        .trim();

      if (submissionDeadlineRaw) {
        const deadlineParsed = parseDateRange(submissionDeadlineRaw);
        posting.submissionDeadline =
          deadlineParsed.startDate ?? submissionDeadlineRaw;
      }

      log.debug(`${conferenceWebsite ? "Found" : "No"} conference website`);

      detailsProcessed++;
      console.log(
        `[EasyChair] Detail pages processed: ${detailsProcessed}/${conferenceUrls.length}`,
      );
    },

    errorHandler: async ({ request, log }, error) => {
      log.error(`EasyChair detail request failed: ${request.url}`, {
        error: String(error),
      });
    },

    failedRequestHandler: async ({ request, log }) => {
      log.error(`EasyChair detail request permanently failed: ${request.url}`);
    },
  });

  await detailCrawler.run(conferenceUrls);

  console.log(`[EasyChair] Collected ${limitedPostings.length} conferences`);

  return limitedPostings;
}

/**
 * Collects conference editions from cfp.wiki.
 *
 * Note: this is a best-effort scraper using the text content and a few stable
 * label markers ("Location", "Event date", "Paper deadline", "Status").
 */
export async function collectCfpWiki(): Promise<CollectedConference[]> {
  // Step 1: Crawl the `/conferences` listing page to collect detail URLs + basic year/date metadata.
  const listingUrl = `${CFP_WIKI_BASE_URL}/conferences`;
  const detailUrls = new Set<string>();

  // Metadata collected from the listing page
  const listingCardMetaByDetailUrl = new Map<
    string,
    {
      conferenceName: string | null;
      conferenceYear: number | null;
      conferenceLocation: string | null;
      conferenceStartDate: string | null;
      conferenceEndDate: string | null;
      conferenceAcronym: string | null;
      submissionDeadline: string | null;
    }
  >();

  const listingCrawler = new CheerioCrawler({
    maxRequestsPerCrawl: 1,
    maxConcurrency: 1,
    preNavigationHooks: [
      async () => {
        await randomDelay(
          CFP_WIKI_CONFIG.crawlMinDelayBetweenRequests,
          CFP_WIKI_CONFIG.crawlMaxDelayBetweenRequests,
        );
      },
    ],
    async requestHandler({ $, request }) {
      // Conference detail links look like `/conferences/<something>`.
      // Limit to the main listing section to avoid unrelated links.
      $(".page-section article.conference-list-card")
        .toArray()
        .forEach((el) => {
          const card = $(el);
          const titleLink = card.find(".conference-list-title a[href]").first();
          const href = titleLink.attr("href");
          if (!href) return;

          const abs = resolveUrl(href, CFP_WIKI_BASE_URL);
          if (!abs) return;
          if (!abs.includes("/conferences/")) return;
          if (abs === request.url) return;

          detailUrls.add(abs);

          const conferenceName = titleLink.text().trim() || null;

          const conferenceAcronymText = card
            .find(".badge-row .badge")
            .first()
            .text()
            .trim();
          const conferenceAcronym = conferenceAcronymText || null;

          const locationStrong = card
            .find(".conference-list-meta strong")
            .filter((_, strongEl) => $(strongEl).text().trim() === "Location")
            .first();
          const conferenceLocation =
            locationStrong.parent().find("div").first().text().trim() ||
            null;

          // Year badge is shown as `2026` in the card.
          const yearText = card
            .find(".badge-row .muted.small-text")
            .first()
            .text()
            .trim();
          const yearFromBadge = yearText ? Number.parseInt(yearText, 10) : undefined;

          // Conference event date is in `.conference-list-meta` under the
          // `Event date` label.
          const eventDateStrong = card
            .find(".conference-list-meta strong")
            .filter((_, strongEl) => $(strongEl).text().trim() === "Event date")
            .first();
          const eventDateRaw = eventDateStrong
            .parent()
            .find("div")
            .first()
            .text()
            .trim();

          const eventDateNormalized = eventDateRaw
            ? eventDateRaw.replace(/–/g, "-")
            : "";
          const eventDateParsed = eventDateNormalized
            ? parseDateRange(eventDateNormalized)
            : {};

          const conferenceYear =
            eventDateParsed.year ?? yearFromBadge ?? null;

          const paperDeadlineStrong = card
            .find(".conference-list-meta strong")
            .filter(
              (_, strongEl) => $(strongEl).text().trim() === "Paper deadline",
            )
            .first();
          const paperDeadlineRaw = paperDeadlineStrong
            .parent()
            .find("div")
            .first()
            .text()
            .trim();

          const paperDeadlineNormalized = paperDeadlineRaw
            ? paperDeadlineRaw.replace(/–/g, "-")
            : "";
          const deadlineParsed = paperDeadlineNormalized
            ? parseDateRange(paperDeadlineNormalized)
            : {};

          listingCardMetaByDetailUrl.set(abs, {
            conferenceName,
            conferenceYear,
            conferenceLocation,
            conferenceStartDate: eventDateParsed.startDate ?? null,
            conferenceEndDate: eventDateParsed.endDate ?? null,
            conferenceAcronym,
            submissionDeadline: deadlineParsed.startDate ?? null,
          });
        });
    },

    errorHandler: async ({ request, log }, error) => {
      log.error(`cfp.wiki listing request failed: ${request.url}`, {
        error: String(error),
      });
    },
  });

  await listingCrawler.run([listingUrl]);

  // Step 2: Build the list of detail URLs to crawl (respecting pageLimit) and parse each detail page.
  const detailUrlList = [...detailUrls];
  const limitedDetailUrls =
    CFP_WIKI_CONFIG.pageLimit === null
      ? detailUrlList
      : detailUrlList.slice(0, CFP_WIKI_CONFIG.pageLimit);

  const postings: CollectedConference[] = [];

  let detailsProcessed = 0;

  const detailCrawler = new CheerioCrawler({
    maxRequestsPerCrawl: limitedDetailUrls.length || 1,
    maxConcurrency: 1,

    preNavigationHooks: [
      async () => {
        await randomDelay(
          CFP_WIKI_CONFIG.crawlMinDelayBetweenRequests,
          CFP_WIKI_CONFIG.crawlMaxDelayBetweenRequests,
        );
      },
    ],

    async requestHandler({ $, request, log }) {
      // Step 3: Parse the detail page fields and merge/override with listing-derived values.
      const listingMeta = listingCardMetaByDetailUrl.get(request.url);
      if (!listingMeta?.conferenceName) {
        return;
      }
      if (listingMeta.conferenceYear === null) {
        return;
      }

      const title =
        $("h1").first().text().trim() || $("h2").first().text().trim();

      if (!title) {
        return;
      }

      // Prefer listing-derived fields; only parse detail page when the
      // listing card didn't have the value.
      let conferenceLocation = listingMeta.conferenceLocation;
      let conferenceStartDate = listingMeta.conferenceStartDate;
      let conferenceEndDate = listingMeta.conferenceEndDate;
      let submissionDeadline = listingMeta.submissionDeadline;

      if (
        conferenceLocation === null ||
        conferenceStartDate === null ||
        conferenceEndDate === null ||
        submissionDeadline === null
      ) {
        const pageText = $("body").text().replace(/\s+/g, " ").trim();

        if (conferenceLocation === null) {
          const locationMatch = pageText.match(
            /Location\s+(.+?)\s+Event date/i,
          );
          conferenceLocation = locationMatch?.[1]?.trim() ?? null;
        }

        if (conferenceStartDate === null || conferenceEndDate === null) {
          const eventDateMatch = pageText.match(
            /Event date\s+(.+?)\s+Paper deadline/i,
          );
          const eventDateRaw = eventDateMatch?.[1]?.trim();
          const eventDateNormalized = eventDateRaw
            ? eventDateRaw.replace(/–/g, "-")
            : "";

          const eventDateParsed = eventDateNormalized
            ? parseDateRange(eventDateNormalized)
            : {};

          conferenceStartDate =
            eventDateParsed.startDate ?? conferenceStartDate;
          conferenceEndDate = eventDateParsed.endDate ?? conferenceEndDate;
        }

        if (submissionDeadline === null) {
          const paperDeadlineMatch = pageText.match(
            /Paper deadline\s+(.+?)\s+Status/i,
          );
          const paperDeadlineRaw = paperDeadlineMatch?.[1]?.trim();
          const deadlineParsed = paperDeadlineRaw
            ? parseDateRange(paperDeadlineRaw)
            : {};

          submissionDeadline = deadlineParsed.startDate ?? null;
        }
      }

      const dlFields = $("dl.definition-list")
        .find("dt")
        .toArray()
        .reduce((acc, dt) => {
          const key = $(dt).text().trim();
          if (!key) return acc;

          const dd = $(dt).next("dd").first();
          const aHref = dd.find("a").first().attr("href") ?? null;
          const value =
            aHref ?? dd.text().replace(/\s+/g, " ").trim() ?? "";

          acc[key] = value;
          return acc;
        }, {} as Record<string, string>);

      // Prefer `dl.definition-list` categories (comma-separated in the dd).
      const conferenceCategories = dlFields["Category"]
        ? dlFields["Category"]
          .split(",")
          .map((t) => t.trim())
          .filter((t) => Boolean(t))
        : [];


      // `conferenceText` should come from the "CFP summary" card (summary + topics),
      // not from all of `main`.
      const cfpSummaryCard = $("div.card.stack-lg")
        .filter((_, el) => {
          const title = $(el).find("h2.section-title").first().text().trim();
          return title.includes("CFP summary");
        })
        .first();
      const conferenceText = cfpSummaryCard
        .find("div.muted")
        .map((_, el) => $(el).text().trim())
        .get()
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      const detailConferenceSeries = dlFields["Series"] ?? null;

      const officialSiteHref = dlFields["Official site"] ?? null;
      const conferenceUri = officialSiteHref
        ? resolveUrl(officialSiteHref, CFP_WIKI_BASE_URL) ?? officialSiteHref
        : null;

      postings.push({
        id: request.url,
        collectionDate: generateCollectionDate(),
        _source: "cfpwiki",
        conferenceName: listingMeta.conferenceName,
        conferenceYear: listingMeta.conferenceYear,
        conferenceUri,
        conferenceLocation: conferenceLocation || null,
        conferenceStartDate,
        conferenceEndDate,
        conferenceAcronym: listingMeta.conferenceAcronym || null,
        conferenceSeries:
          detailConferenceSeries ?? null,
        conferenceCategories:
          conferenceCategories.length > 0 ? conferenceCategories : null,
        conferenceText: conferenceText || null,
        submissionDeadline:
          submissionDeadline || null,
      });

      detailsProcessed++;
      console.log(
        `[cfp.wiki] Detail pages processed: ${detailsProcessed}/${limitedDetailUrls.length}`,
      );
    },

    errorHandler: async ({ request, log }, error) => {
      log.error(`cfp.wiki detail request failed: ${request.url}`, {
        error: String(error),
      });
    },
  });

  await detailCrawler.run(limitedDetailUrls);
  return postings;
}
