import { CheerioCrawler, type CheerioCrawlingContext } from "crawlee";
import type { CollectedConference } from "./schema.js";

import { EASYCHAIR_CONFIG } from "./collection-config.js";

import {
  generateCollectionDate,
  parseDateRange,
  randomDelay,
  resolveUrl,
} from "./utils.js";

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

    const conferenceUri = resolveUrl(href, EASYCHAIR_CONFIG.baseUrl);

    if (!conferenceUri) {
      return;
    }

    const acronym = rawAcronym.replace(/\s+\d{4}$/, "").trim();
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
      id: conferenceUri,
      collectionDate,
      _sources: ["easychair"],
      conferenceName: title,
      conferenceYear,
      conferenceUri,
      conferenceLocation: conferenceLocation || null,
      conferenceStartDate: conferenceStartDate ?? null,
      conferenceEndDate: conferenceEndDate ?? null,
      conferenceAcronym: acronym || null,
      conferenceSeries: conferenceSeries || null,
      conferenceCategories: null,
      conferenceText: null,
      submissionDeadline: null,
    });
  });

  return postings;
}

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
        parsedUrl.hostname === new URL(EASYCHAIR_CONFIG.baseUrl).hostname &&
        parsedUrl.pathname === "/cfp" &&
        parsedUrl.searchParams.has("page")
      ) {
        urls.add(parsedUrl.toString());
      }
    } catch {
      // Ignore invalid URLs.
    }
  });

  return [...urls];
}

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

    conferenceWebsite = resolveUrl(href, EASYCHAIR_CONFIG.baseUrl) ?? "";
  });

  return conferenceWebsite;
}

export async function collectEasyChair(): Promise<CollectedConference[]> {
  if (EASYCHAIR_CONFIG.pageLimit === 0) {
    console.log("[EasyChair] Collection disabled: pageLimit is 0.");
    return [];
  } else {
    console.log(
      `[EasyChair] Collection Starting: pageLimit=${EASYCHAIR_CONFIG.pageLimit}`,
    );
  }

  const postings: CollectedConference[] = [];
  const url = `${EASYCHAIR_CONFIG.baseUrl}/cfp`;

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

      if (EASYCHAIR_CONFIG.pageLimit === null) {
        console.log(`[EasyChair] Listing pages processed: ${pagesScanned}`);
      } else {
        console.log(
          `[EasyChair] Listing pages processed: ${pagesScanned}/${EASYCHAIR_CONFIG.pageLimit}`,
        );
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

  const limitedPostings =
    EASYCHAIR_CONFIG.pageLimit === null
      ? postings
      : postings.slice(0, EASYCHAIR_CONFIG.pageLimit);

  const postingsByDetailUrl = new Map(
    limitedPostings.map((posting) => [posting.conferenceUri, posting]),
  );

  const conferenceUrls = [...postingsByDetailUrl.keys()].filter(
    (conferenceUrl): conferenceUrl is string => Boolean(conferenceUrl),
  );

  limitedPostings.forEach((posting) => {
    posting.conferenceUri = "";
  });

  let detailsProcessed = 0;

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

      const topics = $("div.topics a")
        .map((_, a) => {
          const tagText = $(a).find("span.tag").first().text().trim();

          return tagText || $(a).text().trim();
        })
        .get()
        .filter(Boolean);

      if (topics.length) {
        posting.conferenceCategories = topics;
      }

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
          const firstTdText = $(tr)
            .find("td")
            .first()
            .text()
            .trim()
            .toLowerCase();

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
