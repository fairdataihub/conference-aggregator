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
  pageLimit: 5 as number | null,
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
  categoryLimit: 3 as number | null,
  categoryPageLimit: 5 as number | null,
  crawlMinDelayBetweenRequests: 5001,
  crawlMaxDelayBetweenRequests: 5049,
  categoriesToNotProcess: wikiCFPCategoriesToNotCollect,
};

export const WIKIDATA_CONFIG = {
  limit: null as number | null,
};
