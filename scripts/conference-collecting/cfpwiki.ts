import { CheerioCrawler, type CheerioCrawlingContext } from "crawlee";
import type { CollectedConference } from "./schema.js";

import { CFP_WIKI_CONFIG } from "./collection-config.js";

import {
  generateCollectionDate,
  parseDateRange,
  randomDelay,
  resolveUrl,
} from "./utils.js";

type CfpWikiListingMeta = {
  conferenceName: string | null;
  conferenceYear: number | null;
  conferenceLocation: string | null;
  conferenceStartDate: string | null;
  conferenceEndDate: string | null;
  conferenceAcronym: string | null;
  submissionDeadline: string | null;
};

export async function collectCfpWiki(): Promise<CollectedConference[]> {
  if (CFP_WIKI_CONFIG.pageLimit === 0) {
    console.log("[cfp.wiki] Collection disabled: pageLimit is 0.");
    return [];
  } else {
    console.log(
      `[cfp.wiki] Collection Starting: pageLimit=${CFP_WIKI_CONFIG.pageLimit}`,
    );
  }

  const listingUrl = `${CFP_WIKI_CONFIG.baseUrl}/conferences`;
  const detailUrls = new Set<string>();

  const listingCardMetaByDetailUrl = new Map<string, CfpWikiListingMeta>();

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
      $(".page-section article.conference-list-card")
        .toArray()
        .forEach((el) => {
          const card = $(el);

          const titleLink = card.find(".conference-list-title a[href]").first();

          const href = titleLink.attr("href");

          if (!href) {
            return;
          }

          const abs = resolveUrl(href, CFP_WIKI_CONFIG.baseUrl);

          if (!abs) {
            return;
          }

          if (!abs.includes("/conferences/")) {
            return;
          }

          if (abs === request.url) {
            return;
          }

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
            locationStrong.parent().find("div").first().text().trim() || null;

          const yearText = card
            .find(".badge-row .muted.small-text")
            .first()
            .text()
            .trim();

          const yearFromBadge = yearText
            ? Number.parseInt(yearText, 10)
            : undefined;

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

          const conferenceYear = eventDateParsed.year ?? yearFromBadge ?? null;

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

    async requestHandler({ $, request }) {
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
        .reduce(
          (acc, dt) => {
            const key = $(dt).text().trim();

            if (!key) {
              return acc;
            }

            const dd = $(dt).next("dd").first();

            const aHref = dd.find("a").first().attr("href") ?? null;

            const value = aHref ?? dd.text().replace(/\s+/g, " ").trim();

            acc[key] = value;

            return acc;
          },
          {} as Record<string, string>,
        );

      const conferenceCategories = dlFields["Category"]
        ? dlFields["Category"]
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [];

      const cfpSummaryCard = $("div.card.stack-lg")
        .filter((_, el) => {
          const cardTitle = $(el)
            .find("h2.section-title")
            .first()
            .text()
            .trim();

          return cardTitle.includes("CFP summary");
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
        ? (resolveUrl(officialSiteHref, CFP_WIKI_CONFIG.baseUrl) ??
          officialSiteHref)
        : null;

      postings.push({
        id: request.url,
        collectionDate: generateCollectionDate(),
        _sources: ["cfp.wiki"],
        conferenceName: listingMeta.conferenceName,
        conferenceYear: listingMeta.conferenceYear,
        conferenceUri,
        conferenceLocation: conferenceLocation || null,
        conferenceStartDate,
        conferenceEndDate,
        conferenceAcronym: listingMeta.conferenceAcronym || null,
        conferenceSeries: detailConferenceSeries ?? null,
        conferenceCategories:
          conferenceCategories.length > 0 ? conferenceCategories : null,
        conferenceText: conferenceText || null,
        submissionDeadline: submissionDeadline || null,
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
