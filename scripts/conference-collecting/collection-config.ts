import type { CollectedConference } from "./schema.js";
import { wikiCFPCategoriesToNotCollect } from "./utils.js";

/** Known `_source` values used when merging duplicate postings. */
export type DedupSourceId =
  | "wikicfp"
  | "cfpwiki"
  | "call4paper"
  | "wikidata"
  | "easychair";

/** Fields merged from duplicate postings (identity keys excluded). */
export type DedupMergeField = Exclude<
  keyof CollectedConference,
  | "id"
  | "_source"
  | "collectionDate"
  | "conferenceIdentifier"
  | "conferenceIdentifierType"
  | "conferenceSchemaUri"
>;

/** Field merge priorities when deduplicating by normalized conference name. */
export const DEDUP_CONFIG = {
  /** Fallback source priority when a field has no fieldSourceOrder entry. */
  defaultSourceOrder: [
    "wikicfp",
    "cfpwiki",
    "call4paper",
    "easychair",
    "wikidata",
  ] satisfies DedupSourceId[],

  /** Per-field source priority (first = preferred). */
  fieldSourceOrder: {
    conferenceUri: [
      "call4paper",
      "wikicfp",
      "cfpwiki",
      "easychair",
      "wikidata",
    ],
    conferenceName: [
      "wikicfp",
      "cfpwiki",
      "call4paper",
      "easychair",
      "wikidata",
    ],
    conferenceAcronym: [
      "wikicfp",
      "call4paper",
      "cfpwiki",
      "easychair",
      "wikidata",
    ],
    conferenceYear: [
      "wikicfp",
      "call4paper",
      "cfpwiki",
      "wikidata",
      "easychair",
    ],
    conferenceLocation: [
      "call4paper",
      "wikicfp",
      "cfpwiki",
      "easychair",
      "wikidata",
    ],
    conferenceStartDate: [
      "call4paper",
      "wikicfp",
      "cfpwiki",
      "easychair",
      "wikidata",
    ],
    conferenceEndDate: [
      "call4paper",
      "wikicfp",
      "cfpwiki",
      "easychair",
      "wikidata",
    ],
    submissionDeadline: [
      "call4paper",
      "wikicfp",
      "cfpwiki",
      "easychair",
      "wikidata",
    ],
    conferenceSeries: [
      "wikidata",
      "wikicfp",
      "cfpwiki",
      "call4paper",
      "easychair",
    ],
    conferenceText: [
      "call4paper",
      "cfpwiki",
      "wikicfp",
      "easychair",
      "wikidata",
    ],
    conferenceCategories: [
      "wikidata",
      "wikicfp",
      "cfpwiki",
      "easychair",
      "call4paper",
    ],
  } satisfies Partial<Record<DedupMergeField, DedupSourceId[]>>,
};

export function getDedupFieldSourceOrder(
  field: DedupMergeField,
): readonly DedupSourceId[] {
  return (
    DEDUP_CONFIG.fieldSourceOrder[field] ?? DEDUP_CONFIG.defaultSourceOrder
  );
}

/** Lower rank = higher priority (for sorting postings when merging a field). */
export function getDedupSourceRank(
  field: DedupMergeField,
  source: DedupSourceId,
): number {
  const order = getDedupFieldSourceOrder(field);
  const index = order.indexOf(source);
  return index === -1 ? order.length : index;
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
  limit: null as number | null,
};
