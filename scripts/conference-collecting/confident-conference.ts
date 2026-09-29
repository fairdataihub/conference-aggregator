import {
  COLLECTOR_USER_AGENT,
  CONFIDENT_CONFERENCE_CONFIG,
} from "./collection-config.js";
import type { CollectedConference } from "./schema.js";
import {
  generateCollectionDate,
  normalizeConferenceAcronym,
  randomDelay,
} from "./utils.js";

const MEDIA_WIKI_API_URL = "https://www.confident-conference.org/api.php";
const ASK_PAGE_SIZE = 500;
const WIKITEXT_BATCH_SIZE = 50;
const MAX_REQUEST_ATTEMPTS = 10;
const RETRY_BASE_DELAY_MS = 3000;
const CRAWL_MIN_DELAY_MS = 3001;
const CRAWL_MAX_DELAY_MS = 3900;

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

type ConfidentEventStub = {
  pageTitle: string;
  pageUrl: string;
  displayTitle: string;
};

type SmwAskResponse = {
  "query-continue-offset"?: number;
  query?: {
    results?: Record<
      string,
      {
        fulltext: string;
        fullurl: string;
        displaytitle: string;
      }
    >;
    meta?: { count: number; offset: number };
  };
  error?: { code?: string; info?: string };
};

type MwQueryRevisionsResponse = {
  query?: {
    pages?: Record<
      string,
      {
        title?: string;
        missing?: "";
        revisions?: { slots?: { main?: { "*"?: string } } }[];
      }
    >;
  };
  error?: { code?: string; info?: string };
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiDelay(): Promise<void> {
  await randomDelay(CRAWL_MIN_DELAY_MS, CRAWL_MAX_DELAY_MS);
}

async function fetchJson<T>(url: URL, label: string): Promise<T> {
  const maxAttempts = MAX_REQUEST_ATTEMPTS;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": COLLECTOR_USER_AGENT,
        },
      });

      if (!response.ok) {
        if (RETRYABLE_STATUS.has(response.status) && attempt < maxAttempts) {
          await sleep(RETRY_BASE_DELAY_MS * attempt);
          continue;
        }

        throw new Error(
          `[ConfIDent API] ${label} HTTP ${response.status}: ${response.statusText}`,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error;
      }

      await sleep(RETRY_BASE_DELAY_MS * attempt);
    }
  }

  throw new Error(`[ConfIDent API] ${label} failed after retries`);
}

function buildAskUrl(offset: number): URL {
  const url = new URL(MEDIA_WIKI_API_URL);
  const pageSize = ASK_PAGE_SIZE;
  const offsetClause = offset > 0 ? `|offset=${offset}` : "";
  const query = `${CONFIDENT_CONFERENCE_CONFIG.eventsAskQuery}|limit=${pageSize}${offsetClause}`;

  url.searchParams.set("action", "ask");
  url.searchParams.set("format", "json");
  url.searchParams.set("query", query);

  return url;
}

async function fetchConfidentEventStubs(): Promise<ConfidentEventStub[]> {
  const stubs: ConfidentEventStub[] = [];
  const eventLimit = CONFIDENT_CONFERENCE_CONFIG.eventLimit;
  let offset = 0;
  let pageIndex = 0;

  while (true) {
    await apiDelay();

    const body = await fetchJson<SmwAskResponse>(
      buildAskUrl(offset),
      `ask offset=${offset}`,
    );

    if (body.error) {
      throw new Error(
        `[ConfIDent API] ask failed: ${body.error.code ?? "unknown"} — ${body.error.info ?? ""}`,
      );
    }

    const results = body.query?.results ?? {};
    const resultEntries = Object.entries(results);

    if (pageIndex === 0 && resultEntries.length > 0) {
      const [pageTitle, row] = resultEntries[0];
      console.log(
        "[ConfIDent API] First ask result:",
        JSON.stringify(
          {
            pageTitle,
            pageUrl: row.fullurl.replace(/:443/, ""),
            displayTitle: row.displaytitle,
          },
          null,
          2,
        ),
      );
    }

    const batch = resultEntries.map(([, row]) => ({
      pageTitle: row.fulltext,
      pageUrl: row.fullurl.replace(/:443/, ""),
      displayTitle: row.displaytitle,
    }));

    stubs.push(...batch);

    console.log(
      `[ConfIDent API] ask page ${pageIndex + 1}: ${batch.length} events (total ${stubs.length})`,
    );

    if (eventLimit !== null && stubs.length >= eventLimit) {
      break;
    }

    const nextOffset = body["query-continue-offset"];
    if (nextOffset === undefined || batch.length === 0) {
      break;
    }

    offset = nextOffset;
    pageIndex += 1;
  }

  const capped = eventLimit !== null ? stubs.slice(0, eventLimit) : stubs;

  const unique = [
    ...new Map(capped.map((stub) => [stub.pageTitle, stub])).values(),
  ];

  if (unique.length !== capped.length) {
    console.log(
      `[ConfIDent API] Deduplicated event list: ${capped.length} → ${unique.length}`,
    );
  }

  return unique;
}

function parseTemplateBlock(
  wikitext: string,
  templateName: string,
): Record<string, string> {
  const pattern = new RegExp(
    `\\{\\{${templateName}\\n([\\s\\S]*?)\\n\\}\\}`,
    "i",
  );
  const match = wikitext.match(pattern);

  if (!match?.[1]) {
    return {};
  }

  const fields: Record<string, string> = {};

  for (const line of match[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      continue;
    }

    const body = trimmed.slice(1);
    const eq = body.indexOf("=");
    if (eq === -1) {
      continue;
    }

    const key = body.slice(0, eq).trim();
    const value = body.slice(eq + 1).trim();
    if (key) {
      fields[key] = value;
    }
  }

  return fields;
}

function isoDateOnly(raw: string | undefined): string | null {
  if (!raw?.trim()) {
    return null;
  }

  const normalized = raw.trim().replace(/\//g, "-");
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  const yearMonth = normalized.match(/^(\d{4})-(\d{2})$/);
  if (yearMonth) {
    return `${yearMonth[1]}-${yearMonth[2]}-01`;
  }

  return null;
}

function countryLabel(raw: string | undefined): string | null {
  if (!raw?.trim()) {
    return null;
  }

  const value = raw.trim();
  const prefix = "Country:";
  if (value.startsWith(prefix)) {
    return value.slice(prefix.length).trim() || null;
  }

  return value;
}

function eventSeriesPageTitle(raw: string | undefined): string | null {
  if (!raw?.trim()) {
    return null;
  }

  const value = raw.trim();
  return value.startsWith("Event Series:") ? value : null;
}

function formatEventSeriesLabel(wikitext: string): string | null {
  const fields = parseTemplateBlock(wikitext, "Event Series");
  const acronym = fields.Acronym?.trim();
  const title = fields.Title?.trim();

  if (acronym && title) {
    return `${acronym} - ${title}`;
  }

  return title || acronym || null;
}

async function resolveConferenceSeriesLabels(
  postings: CollectedConference[],
): Promise<void> {
  const seriesTitles = new Set<string>();

  for (const posting of postings) {
    const series = posting.conferenceSeries;
    if (!series) {
      continue;
    }

    if (series.startsWith("Event Series:")) {
      seriesTitles.add(series);
    } else if (/^[0-9a-f-]{36}$/i.test(series)) {
      seriesTitles.add(`Event Series:${series}`);
    }
  }

  if (seriesTitles.size === 0) {
    return;
  }

  const titles = [...seriesTitles];
  const labelByTitle = new Map<string, string>();

  for (let i = 0; i < titles.length; i += WIKITEXT_BATCH_SIZE) {
    await apiDelay();
    const wikitextByTitle = await fetchWikitextBatch(
      titles.slice(i, i + WIKITEXT_BATCH_SIZE),
    );

    for (const [title, wikitext] of wikitextByTitle) {
      const label = formatEventSeriesLabel(wikitext);
      if (label) {
        labelByTitle.set(title, label);
      }
    }
  }

  for (const posting of postings) {
    const series = posting.conferenceSeries;
    if (!series) {
      continue;
    }

    const pageTitle = series.startsWith("Event Series:")
      ? series
      : /^[0-9a-f-]{36}$/i.test(series)
        ? `Event Series:${series}`
        : null;

    if (!pageTitle) {
      continue;
    }

    const label = labelByTitle.get(pageTitle);
    if (label) {
      posting.conferenceSeries = label;
    }
  }

  console.log(
    `[ConfIDent API] Resolved ${labelByTitle.size}/${seriesTitles.size} event series labels`,
  );
}

function locationFromEventFields(event: Record<string, string>): string | null {
  const parts = [event.City, event.Region, countryLabel(event.Country)].filter(
    Boolean,
  ) as string[];

  return parts.length ? parts.join(", ") : null;
}

function categoriesFromEventFields(
  event: Record<string, string>,
): string[] | null {
  const raw = event["Academic Field"];
  if (!raw?.trim()) {
    return null;
  }

  return raw
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

function postingFromEventWikitext(
  stub: ConfidentEventStub,
  wikitext: string,
): CollectedConference | null {
  const event = parseTemplateBlock(wikitext, "Event");
  const deadlines = parseTemplateBlock(wikitext, "Event Deadline");

  const conferenceName =
    event.Title?.trim() ||
    event.Acronym?.trim() ||
    stub.displayTitle.trim() ||
    "";

  if (!conferenceName) {
    return null;
  }

  const conferenceStartDate = isoDateOnly(event["Start Date"]);
  const conferenceEndDate = isoDateOnly(event["End Date"]);
  const submissionDeadline =
    isoDateOnly(deadlines["Paper Deadline"]) ??
    isoDateOnly(deadlines["Submission Deadline"]) ??
    isoDateOnly(deadlines["Abstract Deadline"]);

  const yearMatch =
    conferenceStartDate?.match(/^(\d{4})/)?.[1] ??
    conferenceEndDate?.match(/^(\d{4})/)?.[1] ??
    event.Year?.match(/^(\d{4})/)?.[1] ??
    conferenceName.match(/\b(19|20)\d{2}\b/)?.[0];

  const conferenceYear = yearMatch ? Number.parseInt(yearMatch, 10) : null;
  const acronymSource = event.Acronym?.trim() || stub.displayTitle.trim();

  return {
    id: stub.pageUrl,
    collectionDate: generateCollectionDate(),
    _sources: ["confident-conference.org"],
    conferenceName,
    conferenceYear,
    conferenceAcronym: normalizeConferenceAcronym(acronymSource),
    conferenceSeries: eventSeriesPageTitle(event["In Event Series"]),
    conferenceLocation: locationFromEventFields(event),
    conferenceStartDate,
    conferenceEndDate,
    conferenceUri: event["Official Website"]?.trim() || null,
    conferenceCategories: categoriesFromEventFields(event),
    conferenceText: null,
    submissionDeadline,
  };
}

async function fetchWikitextBatch(
  titles: string[],
): Promise<Map<string, string>> {
  const url = new URL(MEDIA_WIKI_API_URL);
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("prop", "revisions");
  url.searchParams.set("rvslots", "main");
  url.searchParams.set("rvprop", "content");
  url.searchParams.set("titles", titles.join("|"));

  const body = await fetchJson<MwQueryRevisionsResponse>(
    url,
    "query revisions",
  );

  if (body.error) {
    throw new Error(
      `[ConfIDent API] query failed: ${body.error.code ?? "unknown"} — ${body.error.info ?? ""}`,
    );
  }

  const out = new Map<string, string>();
  const pages = body.query?.pages ?? {};

  for (const page of Object.values(pages)) {
    if (!page.title || page.missing !== undefined) {
      continue;
    }

    const wikitext = page.revisions?.[0]?.slots?.main?.["*"];
    if (wikitext) {
      out.set(page.title, wikitext);
    }
  }

  return out;
}

async function collectConfidentEventsFromMediaWikiApi(): Promise<
  CollectedConference[]
> {
  const stubs = await fetchConfidentEventStubs();

  if (!stubs.length) {
    console.log("[ConfIDent API] No events returned from SMW ask query.");
    return [];
  }

  const postings: CollectedConference[] = [];
  let skippedNoWikitext = 0;
  let skippedUnmapped = 0;
  const eventLimit = CONFIDENT_CONFERENCE_CONFIG.eventLimit;
  const totalBatches = Math.ceil(stubs.length / WIKITEXT_BATCH_SIZE);

  console.log(
    `[ConfIDent API] Loading wikitext for ${stubs.length} events ` +
      `(batch size ${WIKITEXT_BATCH_SIZE}, eventLimit ${eventLimit ?? "unlimited"})`,
  );

  batchLoop: for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const i = batchIndex * WIKITEXT_BATCH_SIZE;
    const batch = stubs.slice(i, i + WIKITEXT_BATCH_SIZE);
    await apiDelay();

    const wikitextByTitle = await fetchWikitextBatch(
      batch.map((stub) => stub.pageTitle),
    );

    for (const stub of batch) {
      if (eventLimit !== null && postings.length >= eventLimit) {
        break batchLoop;
      }

      const wikitext = wikitextByTitle.get(stub.pageTitle);
      if (!wikitext) {
        skippedNoWikitext += 1;
        continue;
      }

      const posting = postingFromEventWikitext(stub, wikitext);
      if (posting) {
        if (postings.length === 0) {
          console.log(
            "[ConfIDent API] First collected posting:",
            JSON.stringify(posting, null, 2),
          );
        }
        postings.push(posting);
      } else {
        skippedUnmapped += 1;
      }
    }

    console.log(
      `[ConfIDent API] Parsed wikitext batch ${batchIndex + 1}/${totalBatches} (${postings.length} postings so far)`,
    );
  }

  const finalPostings =
    eventLimit !== null ? postings.slice(0, eventLimit) : postings;

  await resolveConferenceSeriesLabels(finalPostings);

  console.log(
    `[ConfIDent API] Done: ${finalPostings.length} postings from ${stubs.length} events ` +
      `(skipped ${skippedNoWikitext} without wikitext, ${skippedUnmapped} unmapped)`,
  );

  return finalPostings;
}

export async function collectConfidentConference(): Promise<
  CollectedConference[]
> {
  if (CONFIDENT_CONFERENCE_CONFIG.eventLimit === 0) {
    console.log("[ConfIDent] Collection disabled: eventLimit is 0.");
    return [];
  }

  console.log(
    `[ConfIDent] MediaWiki API collection: askQuery=${CONFIDENT_CONFERENCE_CONFIG.eventsAskQuery}, ` +
      `eventLimit=${CONFIDENT_CONFERENCE_CONFIG.eventLimit ?? "unlimited"}`,
  );

  const postings = await collectConfidentEventsFromMediaWikiApi();

  console.log(`[ConfIDent] Collected ${postings.length} conferences`);

  return postings;
}
