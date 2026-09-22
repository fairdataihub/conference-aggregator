import type { CollectedConference } from "./schema.js";
import { wikiCFPCategoriesToNotCollect } from "./utils.js";

/** Known `_source` values on collected postings. */
export type DedupSourceId =
  | "wikicfp"
  | "cfpwiki"
  | "call4paper"
  | "wikidata"
  | "easychair";

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

/** Source reliability when merging a duplicate group (5 = most trusted). */
export type DedupSourceRank = 1 | 2 | 3 | 4 | 5;

type FieldSourceRankings = Partial<
  Record<DedupMergeField, Partial<Record<DedupSourceId, DedupSourceRank>>>
>;

export const DEDUP_CONFIG = {
  /** Fallback when a field has no entry in `fieldSourceRankings`. */
  defaultSourceRankings: {
    cfpwiki: 5,
    wikicfp: 4,
    call4paper: 3,
    easychair: 2,
    wikidata: 1,
  } satisfies Record<DedupSourceId, DedupSourceRank>,

  fieldSourceRankings: {
    conferenceUri: {
      wikicfp: 4,
      call4paper: 3,
      cfpwiki: 5,
      easychair: 2,
      wikidata: 1,
    },
    conferenceName: {
      cfpwiki: 5,
      wikicfp: 4,
      call4paper: 3,
      easychair: 2,
      wikidata: 1,
    },
    conferenceAcronym: {
      call4paper: 5,
      cfpwiki: 4,
      easychair: 2,
      wikicfp: 3,
      wikidata: 1,
    },
    conferenceYear: {
      wikicfp: 5,
      call4paper: 5,
      cfpwiki: 5,
      wikidata: 1,
      easychair: 2,
    },
    conferenceLocation: {
      call4paper: 4,
      wikicfp: 5,
      cfpwiki: 3,
      easychair: 2,
      wikidata: 1,
    },
    conferenceStartDate: {
      call4paper: 4,
      wikicfp: 5,
      cfpwiki: 3,
      easychair: 2,
      wikidata: 1,
    },
    conferenceEndDate: {
      call4paper: 4,
      wikicfp: 5,
      cfpwiki: 3,
      easychair: 2,
      wikidata: 1,
    },
    submissionDeadline: {
      call4paper: 4,
      wikicfp: 3,
      cfpwiki: 5,
      easychair: 2,
      wikidata: 1,
    },
    conferenceSeries: {
      wikidata: 5,
      wikicfp: 4,
      cfpwiki: 3,
      call4paper: 2,
      easychair: 1,
    },
    conferenceText: {
      call4paper: 5,
      cfpwiki: 4,
      wikicfp: 3,
      easychair: 2,
      wikidata: 1,
    },
    conferenceCategories: {
      wikidata: 5,
      wikicfp: 4,
      cfpwiki: 3,
      easychair: 2,
      call4paper: 1,
    },
  } satisfies FieldSourceRankings,
};

export function getDedupSourceRank(
  field: DedupMergeField,
  source: DedupSourceId,
): DedupSourceRank {
  return (
    DEDUP_CONFIG.fieldSourceRankings[field]?.[source] ??
    DEDUP_CONFIG.defaultSourceRankings[source]
  );
}

export const CALL4PAPER_CONFIG = {
  baseUrl: "https://www.call4paper.com",
  subjectLimit: 1 as number | null,
  eventLimit: 1 as number | null,
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
  categoryLimit: 1 as number | null,
  categoryPageLimit: 5 as number | null,
  crawlMinDelayBetweenRequests: 5001,
  crawlMaxDelayBetweenRequests: 5049,
  categoriesToNotProcess: wikiCFPCategoriesToNotCollect,
};

export const WIKIDATA_CONFIG = {
  collectWikiData: true,
  pageSize: 1500,
  maxRequestAttempts: 7,
  retryBaseDelayMs: 3000,
  minDelayBetweenPagesMs: 4000,
  maxDelayBetweenPagesMs: 7000,
};
