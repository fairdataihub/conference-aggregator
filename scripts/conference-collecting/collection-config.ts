import type { CollectedConference } from "./schema.js";
import { wikiCFPCategoriesToNotCollect } from "./utils.js";

/** `_source` tags written on collected postings. */
export const POSTING_SOURCES = {
  cfpWiki: "cfp.wiki",
  call4PaperOrg: "call4paper.org",
  wikiCfp: "wiki.cfp",
  wikidata: "wikidata.org",
  call4PaperCom: "call4paper.com",
} as const;

export type DedupSourceId =
  (typeof POSTING_SOURCES)[keyof typeof POSTING_SOURCES];

/** Fields combined when duplicate postings are merged. */
export type DedupMergeField = Exclude<
  keyof CollectedConference,
  | "id"
  | "_source"
  | "collectionDate"
  | "conferenceIdentifier"
  | "conferenceIdentifierType"
  | "conferenceSchemaUri"
>;

export const CALL4PAPER_CONFIG = {
  baseUrl: "https://www.call4paper.com",
  subjectLimit: null as number | null,
  eventLimit: null as number | null,
  crawlMinDelayBetweenRequests: 3001,
  crawlMaxDelayBetweenRequests: 3900,
};

export const CFP_WIKI_CONFIG = {
  baseUrl: "https://cfp.wiki",
  pageLimit: null as number | null,
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
  categoryLimit: null as number | null,
  categoryPageLimit: null as number | null,
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
  /** `null` = all categories. `0` disables collection. */
  categoryLimit: null as number | null,
  /** Max listing pages per category (`null` = follow pagination until end). */
  categoryPageLimit: null as number | null,
  crawlMinDelayBetweenRequests: 3001,
  crawlMaxDelayBetweenRequests: 3900,
};

export const DEDUP_CONFIG = {
  /** Source reliability when merging duplicates (most trusted first). */
  sourceOrder: [
    POSTING_SOURCES.call4PaperOrg,
    POSTING_SOURCES.cfpWiki,
    POSTING_SOURCES.call4PaperCom,
    POSTING_SOURCES.wikiCfp,
    POSTING_SOURCES.wikidata,
  ] satisfies readonly DedupSourceId[],
};
