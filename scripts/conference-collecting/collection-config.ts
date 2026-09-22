import type { PostingSourceId } from "./schema.js";
import { wikiCFPCategoriesToNotCollect } from "./utils.js";

export const CALL4PAPER_CONFIG = {
  baseUrl: "https://www.call4paper.com",
  subjectLimit: 2 as number | null,
  eventLimit: 2 as number | null,
  crawlMinDelayBetweenRequests: 3001,
  crawlMaxDelayBetweenRequests: 3900,
};

export const CFP_WIKI_CONFIG = {
  baseUrl: "https://cfp.wiki",
  pageLimit: 20 as number | null,
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
  categoryLimit: 2 as number | null,
  categoryPageLimit: 10 as number | null,
  crawlMinDelayBetweenRequests: 5001,
  crawlMaxDelayBetweenRequests: 5049,
  categoriesToNotProcess: wikiCFPCategoriesToNotCollect,
};

export const WIKIDATA_CONFIG = {
  collectWikiData: true,
  pageSize: 1500,
  maxRequestAttempts: 10,
  retryBaseDelayMs: 3000,
  minDelayBetweenPagesMs: 4000,
  maxDelayBetweenPagesMs: 7000,
};

export const CALLFORPAPER_ORG_CONFIG = {
  baseUrl: "https://callforpaper.org",
  categoryLimit: 2 as number | null,
  categoryPageLimit: 5 as number | null,
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
