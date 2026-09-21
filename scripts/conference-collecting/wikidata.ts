import { WIKIDATA_CONFIG } from "./collection-config.js";
import type { CollectedConference } from "./schema.js";
import { generateCollectionDate, randomDelay } from "./utils.js";

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

const SPARQL_BODY = `
SELECT DISTINCT ?conference ?conferenceLabel ?description ?website ?startDate ?endDate ?location ?locationLabel ?acronym ?series ?seriesLabel ?subject ?subjectLabel
WHERE {
  ?conference wdt:P31 wd:Q2020153 .
  ?conference rdfs:label ?conferenceLabel .
  FILTER(LANG(?conferenceLabel) = "en")
  OPTIONAL { ?conference schema:description ?description . FILTER(LANG(?description) = "en") }
  OPTIONAL { ?conference wdt:P856 ?website . }
  OPTIONAL { ?conference wdt:P580 ?startDate . }
  OPTIONAL { ?conference wdt:P582 ?endDate . }
  OPTIONAL { ?conference wdt:P276 ?location . }
  OPTIONAL { ?conference wdt:P1813 ?acronym . }
  OPTIONAL { ?conference wdt:P179 ?series . }
  OPTIONAL { ?conference wdt:P921 ?subject . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
ORDER BY ?conference
`.trim();

type SparqlBinding = Record<
  string,
  { value: string; type?: string } | undefined
>;

interface SparqlResponse {
  results: { bindings: SparqlBinding[] };
}

function buildPageQuery(offset: number, pageLimit: number): string {
  return `${SPARQL_BODY}\nLIMIT ${pageLimit}\nOFFSET ${offset}`;
}

async function fetchSparqlPage(
  query: string,
  offset: number,
): Promise<SparqlResponse> {
  const maxAttempts = WIKIDATA_CONFIG.maxRequestAttempts;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(SPARQL_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/sparql-results+json",
        "Content-Type": "application/sparql-query",
        "User-Agent": "conference-aggregator/1.0 (https://github.com/conference-aggregator)",
      },
      body: query,
    });

    if (!response.ok) {
      const retryable = RETRYABLE_STATUS.has(response.status);
      const isLast = attempt >= maxAttempts;

      if (!retryable || isLast) {
        throw new Error(
          `Wikidata request failed: ${response.status} ${response.statusText} (offset=${offset}, attempt=${attempt}/${maxAttempts})`,
        );
      }

      const backoffMs =
        WIKIDATA_CONFIG.retryBaseDelayMs * 2 ** (attempt - 1) +
        Math.random() * 500;

      console.warn(
        `[Wikidata] HTTP ${response.status}, retrying in ${Math.round(backoffMs)}ms (attempt ${attempt}/${maxAttempts}, offset=${offset})`,
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      continue;
    }

    const text = await response.text();

    try {
      return JSON.parse(text) as SparqlResponse;
    } catch {
      const isLast = attempt >= maxAttempts;
      if (isLast) {
        throw new Error(
          `Wikidata returned invalid JSON (${text.length} bytes, offset=${offset}, attempt=${attempt}/${maxAttempts})`,
        );
      }

      const backoffMs =
        WIKIDATA_CONFIG.retryBaseDelayMs * 2 ** (attempt - 1) +
        Math.random() * 500;

      console.warn(
        `[Wikidata] Invalid JSON response, retrying in ${Math.round(backoffMs)}ms (offset=${offset})`,
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw new Error(`Wikidata request exhausted retries (offset=${offset})`);
}

function ingestBinding(
  conferences: Map<string, CollectedConference>,
  result: SparqlBinding,
): void {
  const id = result.conference?.value;
  if (!id) {
    return;
  }

  const subject = result.subjectLabel?.value || null;
  const existing = conferences.get(id);

  if (existing) {
    if (
      subject &&
      existing.conferenceCategories &&
      !existing.conferenceCategories.includes(subject)
    ) {
      existing.conferenceCategories.push(subject);
    }
    return;
  }

  const conferenceStartDate = result.startDate?.value?.split("T")[0] || null;

  conferences.set(id, {
    id,
    collectionDate: generateCollectionDate(),
    _source: ["wikidata"],
    conferenceName: result.conferenceLabel?.value ?? "",
    conferenceYear: conferenceStartDate
      ? Number(conferenceStartDate.substring(0, 4))
      : null,
    conferenceUri: result.website?.value || null,
    conferenceLocation: result.locationLabel?.value || null,
    conferenceStartDate,
    conferenceEndDate: result.endDate?.value?.split("T")[0] || null,
    conferenceAcronym: result.acronym?.value || null,
    conferenceSeries: result.seriesLabel?.value || null,
    conferenceCategories: subject ? [subject] : [],
    conferenceText: result.description?.value || null,
    submissionDeadline: null,
  });
}

export async function collectWikiData(): Promise<CollectedConference[]> {
  if (WIKIDATA_CONFIG.limit === 0) {
    console.log("[Wikidata] Collection disabled: limit is 0.");
    return [];
  }

  const conferences = new Map<string, CollectedConference>();
  const pageSize = WIKIDATA_CONFIG.pageSize;
  let offset = 0;
  let page = 0;
  let rowsFetched = 0;
  const rowCap =
    WIKIDATA_CONFIG.limit === null ? null : WIKIDATA_CONFIG.limit;

  console.log(
    `[Wikidata] Starting collection (pageSize=${pageSize}, rowCap=${rowCap ?? "none"})`,
  );

  while (true) {
    const remaining =
      rowCap === null ? pageSize : Math.max(0, rowCap - rowsFetched);

    if (remaining === 0) {
      break;
    }

    const pageLimit = Math.min(pageSize, remaining);
    page++;
    const query = buildPageQuery(offset, pageLimit);

    console.log(
      `[Wikidata] Fetching page ${page} (offset=${offset}, limit=${pageLimit})`,
    );

    const data = await fetchSparqlPage(query, offset);
    const bindings = data.results?.bindings ?? [];

    for (const result of bindings) {
      ingestBinding(conferences, result);
    }

    rowsFetched += bindings.length;
    offset += bindings.length;

    console.log(
      `[Wikidata] Page ${page}: ${bindings.length} rows (${conferences.size} unique conferences so far)`,
    );

    if (bindings.length < pageLimit) {
      break;
    }

    await randomDelay(
      WIKIDATA_CONFIG.minDelayBetweenPagesMs,
      WIKIDATA_CONFIG.maxDelayBetweenPagesMs,
    );
  }

  console.log(
    `[Wikidata] Done: ${conferences.size} conferences from ${rowsFetched} rows`,
  );

  return [...conferences.values()];
}
