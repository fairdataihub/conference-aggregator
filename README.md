<div align="center">

<br />

<h1>Conference Aggregator</h1>

<p> A scraper that collects and aggregates conference CFP and posting metadata from public sources. </p>

<br />

</div>

---

## About

This repository contains a conference aggregator that crawls public conference listing sites and produces machine-readable conference datasets at the repository root (`conference-postings.json` without CFP body text, and `conference-postings-full.json` with `conferenceText`).

The collector implements scrapers for these sources:

- `wiki.cfp`
- `cfp.wiki`
- `call4paper.com`
- `callforpaper.org`
- `wikidata.org`

Extracted fields include conference name, acronym, year, dates, location, website URL, CFP text snippets, and categories metadata.

## What this repo does

- Crawls listing and detail pages for the source(s) specified.
- Parses conference metadata and normalizes dates and acronyms.
- Merges new postings into JSON databases at `conference-postings.json` (slim) and `conference-postings-full.json` (includes `conferenceText`).
- Provides single-site and full-collection CLI commands.

## How collection works

Scripts run `main.ts` with `--site` set to `all` or a source id (`wiki.cfp`, `cfp.wiki`, `call4paper.com`, `callforpaper.org`, `wikidata.org`).

Each collector crawls listings, parses detail pages, and returns rows. `main.ts` deduplicates by conference name, then writes **`conference-postings-full.json`** (includes `conferenceText`) and **`conference-postings.json`** (same records, `conferenceText` omitted).

- **One source:** load the full file, delete that source’s old rows, add the new crawl, dedupe, save both files. Other sources are untouched.
- **`all`:** run every collector, deduplicate, save both files (full refresh).

### How normalization works

Normalization happens in two layers: while scraping, and when merging duplicates.

**During scraping**

- Dates are parsed into ISO `YYYY-MM-DD` where possible (`utils.ts`).
- Each scraper sets `_sources` to the site id (for example `wiki.cfp`).
- `conferenceAcronym` is passed through `normalizeConferenceAcronym()` in `utils.ts`. Values that look like titles, URLs, or full sentences are dropped (`null`), with a console log explaining the rejection. Some sources apply extra rules first (for example callforpaper.org often uses the segment before `:` in the event title).

**Merge and deduplication**

After collection, `deduplicate.ts` groups postings by **normalized conference name** (trimmed, collapsed whitespace, case-insensitive). Each group becomes one record.

For most fields, the merged value is taken from the **most trusted source** that has a non-empty value. Trust order is `DEDUP_CONFIG.sourceOrder` in `collection-config.ts` (first entry is most trusted). Tie-breakers: more populated merge fields, then lowest stable `id`.

Special cases:

- **Start and end dates**: postings with **both** dates set rank above partial dates; then the usual source order applies so start and end usually come from the same row.
- **Categories**: union of unique category strings across the group (order follows source priority when iterating).
- **`_sources`**: union of all sources in the group.
- **`collectionDate`**: newest date in the group.
- **`id`**: taken from the winning row for `conferenceName`.

## Code layout

- `scripts/conference-collecting/main.ts`: CLI entrypoint (`--site`)
- `scripts/conference-collecting/collection-config.ts`: per-source crawl limits and dedup `sourceOrder`
- `scripts/conference-collecting/collectors.ts`: source-specific scrapers
- `scripts/conference-collecting/schema.ts`: record/DB shapes
- `scripts/conference-collecting/storage.ts`: load/save conference JSON exports

## Where data is stored

- `conference-postings.json` (repo root): consolidated output without `conferenceText` (for lightweight consumers).
- `conference-postings-full.json`: same records with `conferenceText` preserved.
- `storage/` (repo root): Crawlee internal crawl state (KV stores + request queues). Deleting it resets crawl progress/state.

## Getting started

### Prerequisites/Dependencies

You will need the following installed on your system:

- [mise](https://mise.jdx.dev) - manages Node.js and pnpm versions (see `mise.toml`)
- [Docker](https://www.docker.com/) - for running PostgreSQL locally

## Setup

1. Clone the repository

   ```bash
   git clone https://github.com/fairdataihub/posters-science.git
   cd posters-science
   ```

2. Trust and install the required tool versions

   ```bash
   mise trust
   mise install
   ```

3. Install dependencies

   ```bash
   pnpm install
   ```

4. Add your environment variables

   ```bash
   cp .env.example .env
   ```

5. Start the development server

   ```bash
   pnpm dev
   ```

6. Open the application at [http://localhost:3000](http://localhost:3000) or appropriate port if you have it configured differently.

## Running Collectors

Run the collectors (examples):

- Collect all configured sources:

```bash
pnpm run collect:all
```

- Collect only one site (for example wiki.cfp):

```bash
pnpm run collect:wiki.cfp
```

The collectors write both JSON files at the repository root. Load `conference-postings.json` for dropdowns and lists; use `conference-postings-full.json` when you need CFP text.

## Development

Collection-source configuration can be found in `scripts/conference-collecting/collectors.ts`:

After changes, run `pnpm run collect:*` to update `conference-postings.json`.

## Contributing

Contributions welcome — open issues or pull requests for new collector sources, bug fixes, or improvements to normalization/merging logic.
