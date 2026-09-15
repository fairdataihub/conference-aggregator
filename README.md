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

This repository contains a lightweight conference aggregator that crawls public conference listing sites and produces a machine-readable dataset of conference postings at the repository root (conference-postings.json).

The collector currently implements scrapers for three sources:

- `wikicfp` (WikiCFP)
- `easychair` (EasyChair CFP search)
- `cfpwiki` (cfp.wiki)

Extracted fields include conference name, year, dates, location, website URL, CFP text snippets, and categories metadata. 

## What this repo does

- Crawls listing and detail pages on WikiCFP, EasyChair, and cfp.wiki.
- Parses conference metadata and normalizes dates and acronyms.
- Merges new postings into a single JSON database at `conference-postings.json`.
- Provides single-site and full-collection CLI commands.

## How collection works

Running a collection script executes `scripts/conference-collecting/main.ts` with a `--site` argument (`all`, `wikicfp`, `easychair`, `cfpwiki`).

1. Crawl listings and collect detail-page URLs.
2. Fetch detail pages and parse conference metadata.
3. Merge postings and write the consolidated DB.

## Code layout

- `scripts/conference-collecting/main.ts`: CLI entrypoint (`--site`)
- `scripts/conference-collecting/collectors.ts`: source-specific scrapers
- `scripts/conference-collecting/schema.ts`: record/DB shapes
- `scripts/conference-collecting/storage.ts`: load/save `conference-postings.json`

## Where data is stored

- `conference-postings.json` (repo root): consolidated output.
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
pnpm run collect:wikicfp
```

- Collect only EasyChair:

```bash
pnpm run collect:easychair
```

- Collect only cfp.wiki:

```bash
pnpm run collect:cfpwiki
```

The collectors write the consolidated database to `conference-postings.json` at the repository root.

## Development

Collection-source configuration can be found in `scripts/conference-collecting/collectors.ts`:

After changes, run `pnpm run collect:*` to update `conference-postings.json` (the project uses `tsx`, so no separate build step is required).

## Contributing

Contributions welcome — open issues or pull requests for new collector sources, bug fixes, or improvements to normalization/merging logic.