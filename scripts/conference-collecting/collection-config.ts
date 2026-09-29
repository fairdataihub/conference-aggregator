import type { PostingSourceId } from "./schema.js";

import { wikiCFPCategoriesToNotCollect } from "./utils.js";

export type CollectionMode = "full" | "test";

/** GitHub Actions → full scrape; local dev → test subsets (`LIMITS` below). */

export const COLLECTION_MODE: CollectionMode =
  process.env.GITHUB_ACTIONS === "true" ? "full" : "test";

/** Shared HTTP User-Agent for outbound collectors */
export const COLLECTOR_USER_AGENT =
  "conference-aggregator/1.0 (https://github.com/fairdataihub/conference-aggregator)";

const LIMITS = {
  full: {
    wikiCfp: {
      categoryLimit: null as number | null,
      categoryPageLimit: null as number | null,
    },

    wikidata: {
      pageSize: 500,
      maxPages: null as number | null,
    },

    confidentConference: {
      eventLimit: null as number | null,
    },
  },

  test: {
    wikiCfp: {
      categoryLimit: 2 as number | null,
      categoryPageLimit: 1 as number | null,
    },

    wikidata: {
      pageSize: 500,
      maxPages: 1 as number | null,
    },

    confidentConference: {
      eventLimit: 500 as number | null,
    },
  },
} as const;

const activeLimits = LIMITS[COLLECTION_MODE];

export const WIKICFP_CONFIG = {
  baseUrl: "http://www.wikicfp.com",
  categoryLimit: activeLimits.wikiCfp.categoryLimit,
  categoryPageLimit: activeLimits.wikiCfp.categoryPageLimit,
  crawlMinDelayBetweenRequests: 5001,
  crawlMaxDelayBetweenRequests: 5049,
  categoriesToNotProcess: wikiCFPCategoriesToNotCollect,
};

export const WIKIDATA_CONFIG = {
  collectWikiData: true,
  pageSize: activeLimits.wikidata.pageSize,
  maxPages: activeLimits.wikidata.maxPages,
  sparqlEndpoint: "https://query.wikidata.org/sparql" as const,
  maxRequestAttempts: 10 as const,
  retryBaseDelayMs: 3000 as const,
  minDelayBetweenPagesMs: 4000 as const,
  maxDelayBetweenPagesMs: 7000 as const,
};

export const CONFIDENT_CONFERENCE_CONFIG = {
  /** SMW `action=ask` conditions; append `|?…` printouts only if needed. */
  eventsAskQuery: "[[Concept:Events]]",
  /** Max events to list and load; null = full catalog. */
  eventLimit: activeLimits.confidentConference.eventLimit,
};

export const DEDUP_CONFIG = {
  /** Source reliability when merging duplicates (most trusted first). */
  sourceOrder: [
    "confident-conference.org",
    "wiki.cfp",
    "wikidata.org",
  ] satisfies readonly PostingSourceId[],
};
