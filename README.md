<div align="center">

<br />

<h1>Conference Aggregator</h1>

<p>
A scraper that collects and aggregates conference CFP and posting metadata from public sources.
</p>

<br />

</div>

---

## About

This repository contains a lightweight conference aggregator that crawls public conference listing sites and produces machine-readable conference datasets at the repository root (`conference-postings.json` without CFP body text, and `conference-postings-full.json` with `conferenceText`).

The collector implements scrapers for these sources (`_sources` / `--site` ids):

- `wiki.cfp` (WikiCFP)
- `cfp.wiki` (cfp.wiki)
- `call4paper.com` (call4paper.com)
- `callforpaper.org` (callforpaper.org)
- `wikidata.org` (Wikidata)

Extracted fields include conference name, year, dates, location, website URL, CFP text snippets, and categories metadata.

## What this repo does

- Crawls listing and detail pages on WikiCFP, EasyChair, and cfp.wiki.
- Parses conference metadata and normalizes dates and acronyms.
- Merges new postings into JSON databases at `conference-postings.json` (slim) and `conference-postings-full.json` (includes `conferenceText`).
- Provides single-site and full-collection CLI commands.

## How collection works

Running a collection script executes `scripts/conference-collecting/main.ts` with a `--site` argument (`all`, or any `_sources` id such as `wiki.cfp`, `cfp.wiki`, `call4paper.com`, `callforpaper.org`, `wikidata.org`).

1. Crawl listings and collect detail-page URLs.
2. Fetch detail pages and parse conference metadata.
3. Merge postings and write the consolidated DB.

## Code layout

- `scripts/conference-collecting/main.ts`: CLI entrypoint (`--site`)
- `scripts/conference-collecting/collectors.ts`: source-specific scrapers
- `scripts/conference-collecting/schema.ts`: record/DB shapes
- `scripts/conference-collecting/storage.ts`: load/save conference JSON exports

## Where data is stored

- `conference-postings.json` (repo root): consolidated output without `conferenceText` (for lightweight consumers).
- `conference-postings-full.json`: same records with `conferenceText` preserved.
- `storage/` (repo root): Crawlee internal crawl state (KV stores + request queues). Deleting it resets crawl progress/state.

## Getting started

Prerequisites:

- Node.js (recommended recent LTS)
- pnpm (recommended) or a compatible package manager

Install dependencies:

```bash
pnpm install
```

Run the collectors (examples):

- Collect all configured sources:

```bash
pnpm run collect:all
```

- Collect only WikiCFP:

```bash
pnpm run collect:wiki.cfp
```

- Collect only cfp.wiki:

```bash
pnpm run collect:cfp.wiki
```

The collectors write both JSON files at the repository root. Load `conference-postings.json` for dropdowns and lists; use `conference-postings-full.json` when you need CFP text.

## Development

Collection-source configuration can be found in `scripts/conference-collecting/collectors.ts`:

After changes, run `pnpm run collect:*` to update `conference-postings.json` (the project uses `tsx`, so no separate build step is required).

## Contributing

Contributions welcome — open issues or pull requests for new collector sources, bug fixes, or improvements to normalization/merging logic.
