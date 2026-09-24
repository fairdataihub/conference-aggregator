import type { PostingSourceId } from "./schema.js";
import { wikiCFPCategoriesToNotCollect } from "./utils.js";

export const CALL4PAPER_CONFIG = {
  baseUrl: "https://www.call4paper.com",
  subjectLimit: 1 as number | null,
  eventLimit: 20 as number | null,
  crawlMinDelayBetweenRequests: 3001,
  crawlMaxDelayBetweenRequests: 3900,
};

export const CFP_WIKI_CONFIG = {
  baseUrl: "https://cfp.wiki",
  pageLimit: 1 as number | null,
  crawlMinDelayBetweenRequests: 3001,
  crawlMaxDelayBetweenRequests: 3900,
};

export const EASYCHAIR_CONFIG = {
  baseUrl: "https://easychair.org",
  pageLimit: 0 as number | null,
  crawlMinDelayBetweenRequests: 3001,
  crawlMaxDelayBetweenRequests: 3900,
};

export const WIKICFP_CONFIG = {
  baseUrl: "http://www.wikicfp.com",
  categoryLimit: 1 as number | null,
  categoryPageLimit: 1 as number | null,
  crawlMinDelayBetweenRequests: 5001,
  crawlMaxDelayBetweenRequests: 5049,
  categoriesToNotProcess: wikiCFPCategoriesToNotCollect,
};

export const WIKIDATA_CONFIG = {
  collectWikiData: true,
  /** Smaller pages reduce 502/504 timeouts on query.wikidata.org. */
  pageSize: 500,
  sparqlEndpoint: "https://query.wikidata.org/sparql" as const,
  maxRequestAttempts: 10 as const,
  retryBaseDelayMs: 3000 as const,
  minDelayBetweenPagesMs: 4000 as const,
  maxDelayBetweenPagesMs: 7000 as const,
};

export const CALLFORPAPER_ORG_CONFIG = {
  baseUrl: "https://callforpaper.org",
  categoryLimit: 1 as number | null,
  categoryPageLimit: 1 as number | null,
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
