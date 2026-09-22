import { WIKIDATA_CONFIG } from "./collection-config.js";
import type { CollectedConference } from "./schema.js";
import { generateCollectionDate, randomDelay } from "./utils.js";

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const SPARQL_BODY = `
SELECT DISTINCT ?conference ?conferenceLabel ?website ?startDate ?endDate ?location ?locationLabel ?acronym ?series ?seriesLabel ?subject ?subjectLabel
WHERE {
  ?conference wdt:P31 wd:Q2020153 .
  ?conference rdfs:label ?conferenceLabel .
  FILTER(LANG(?conferenceLabel) = "en")
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

function retryBackoffMs(attempt: number): number {
  return (
    WIKIDATA_CONFIG.retryBaseDelayMs * 2 ** (attempt - 1) +
    Math.random() * 750
  );
}

function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  if (
    message.includes("terminated") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("socket")
  ) {
    return true;
  }

  let current: unknown = error;
  for (let depth = 0; depth < 4; depth++) {
    if (!current || typeof current !== "object") {
      break;
    }

    const code = (current as { code?: string }).code;
    if (
      code &&
      [
        "UND_ERR_SOCKET",
        "UND_ERR_HEADERS_TIMEOUT",
        "UND_ERR_BODY_TIMEOUT",
        "ECONNRESET",
        "ETIMEDOUT",
        "EPIPE",
        "ECONNREFUSED",
      ].includes(code)
    ) {
      return true;
    }

    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSparqlPage(
  query: string,
  offset: number,
): Promise<SparqlResponse> {
  const maxAttempts = WIKIDATA_CONFIG.maxRequestAttempts;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(SPARQL_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/sparql-results+json",
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent":
            "conference-aggregator/1.0 (https://github.com/conference-aggregator)",
        },
        body: new URLSearchParams({
          query,
          format: "json",
        }),
      });

      if (!response.ok) {
        const retryable = RETRYABLE_STATUS.has(response.status);
        const isLast = attempt >= maxAttempts;

        if (!retryable || isLast) {
          throw new Error(
            `Wikidata request failed: ${response.status} ${response.statusText} (offset=${offset}, attempt=${attempt}/${maxAttempts})`,
          );
        }

        const backoffMs = retryBackoffMs(attempt);
        console.warn(
          `[Wikidata] HTTP ${response.status}, retrying in ${Math.round(backoffMs)}ms (attempt ${attempt}/${maxAttempts}, offset=${offset})`,
        );
        await sleep(backoffMs);
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

        const backoffMs = retryBackoffMs(attempt);
        console.warn(
          `[Wikidata] Invalid JSON response, retrying in ${Math.round(backoffMs)}ms (offset=${offset})`,
        );
        await sleep(backoffMs);
      }
    } catch (error) {
      const isLast = attempt >= maxAttempts;

      if (!isRetryableNetworkError(error)) {
        throw error;
      }

      if (isLast) {
        const detail =
          error instanceof Error ? error.message : String(error);
        throw new Error(
          `Wikidata network error (offset=${offset}, attempt=${attempt}/${maxAttempts}): ${detail}`,
          { cause: error },
        );
      }

      const backoffMs = retryBackoffMs(attempt);
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(
        `[Wikidata] Network error (${detail}), retrying in ${Math.round(backoffMs)}ms (attempt ${attempt}/${maxAttempts}, offset=${offset})`,
      );
      await sleep(backoffMs);
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
    conferenceText: null,
    submissionDeadline: null,
  });
}

export async function collectWikiData(): Promise<CollectedConference[]> {
  if (!WIKIDATA_CONFIG.collectWikiData) {
    console.log("[Wikidata] Collection disabled (collectWikiData is false).");
    return [];
  }

  const conferences = new Map<string, CollectedConference>();
  const { pageSize } = WIKIDATA_CONFIG;
  let offset = 0;
  let page = 0;
  let rowsFetched = 0;

  console.log(`[Wikidata] Starting collection (pageSize=${pageSize})`);

  while (true) {
    page++;
    const query = buildPageQuery(offset, pageSize);

    console.log(
      `[Wikidata] Fetching page ${page} (offset=${offset}, limit=${pageSize})`,
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

    if (bindings.length < pageSize) {
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
