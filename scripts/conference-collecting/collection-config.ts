import type { PostingSourceId } from "./schema.js";
import { wikiCFPCategoriesToNotCollect } from "./utils.js";

export type CollectionMode = "full" | "test";

/** GitHub Actions → full scrape; local dev → test subsets (`LIMITS` below). */
export const COLLECTION_MODE: CollectionMode =
  process.env.GITHUB_ACTIONS === "true" ? "full" : "test";

const LIMITS = {
  full: {
    call4paper: {
      subjectLimit: null as number | null,
      eventLimit: null as number | null,
    },
    cfpWiki: { pageLimit: null as number | null },
    easyChair: { pageLimit: 0 as number | null },
    wikiCfp: {
      categoryLimit: null as number | null,
      categoryPageLimit: null as number | null,
    },
    wikidata: {
      pageSize: 500,
      maxPages: null as number | null,
    },
    callforpaperOrg: {
      categoryLimit: null as number | null,
      categoryPageLimit: null as number | null,
    },
  },
  test: {
    call4paper: {
      subjectLimit: 1 as number | null,
      eventLimit: 20 as number | null,
    },
    cfpWiki: { pageLimit: 1 as number | null },
    easyChair: { pageLimit: 0 as number | null },
    wikiCfp: {
      categoryLimit: 1 as number | null,
      categoryPageLimit: 1 as number | null,
    },
    wikidata: {
      pageSize: 500,
      maxPages: 1 as number | null,
    },
    callforpaperOrg: {
      categoryLimit: 1 as number | null,
      categoryPageLimit: 1 as number | null,
    },
  },
} as const;

const activeLimits = LIMITS[COLLECTION_MODE];

export const CALL4PAPER_CONFIG = {
  baseUrl: "https://www.call4paper.com",
  subjectLimit: activeLimits.call4paper.subjectLimit,
  eventLimit: activeLimits.call4paper.eventLimit,
  crawlMinDelayBetweenRequests: 3001,
  crawlMaxDelayBetweenRequests: 3900,
};

export const CFP_WIKI_CONFIG = {
  baseUrl: "https://cfp.wiki",
  pageLimit: activeLimits.cfpWiki.pageLimit,
  crawlMinDelayBetweenRequests: 3001,
  crawlMaxDelayBetweenRequests: 3900,
};

export const EASYCHAIR_CONFIG = {
  baseUrl: "https://easychair.org",
  pageLimit: activeLimits.easyChair.pageLimit,
  crawlMinDelayBetweenRequests: 3001,
  crawlMaxDelayBetweenRequests: 3900,
};

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

export const CALLFORPAPER_ORG_CONFIG = {
  baseUrl: "https://callforpaper.org",
  categoryLimit: activeLimits.callforpaperOrg.categoryLimit,
  categoryPageLimit: activeLimits.callforpaperOrg.categoryPageLimit,
  crawlMinDelayBetweenRequests: 3001,
  crawlMaxDelayBetweenRequests: 3900,
};

export const DEDUP_CONFIG = {
  /** Source reliability when merging duplicates (most trusted first). */
  sourceOrder: [
    "callforpaper.org",
    "cfp.wiki",
    "call4paper.com",
    "wiki.cfp",
    "wikidata.org",
  ] satisfies readonly PostingSourceId[],
};
