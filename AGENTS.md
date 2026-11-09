# pi-model-banner — development notes

Notes for contributors and coding agents. User-facing documentation lives in `README.md`, the contribution workflow in `CONTRIBUTING.md`; neither this file nor `CONTRIBUTING.md` is published to npm.

## Layout

| Path | Contents |
|---|---|
| `index.ts` | Extension entry: events, `/banner` command, install/uninstall of the header. |
| `lib/` | Runtime logic: config loading, family detection, art loading, header layout. |
| `content/` | Plain data: families, labels, keyword tables. |
| `content/ansi/` | Generated Braille art, one `<family>.ansi` per family. Do not edit by hand. |
| `icons/` | Source SVG marks the art is built from, each with a source and license comment. |
| `scripts/` | Art build, art checks, art preview, dev dependency linking. |
| `tests/` | Unit tests (`node --test`). |
| `screenshots/` | `<family>.png` banners shown in the README. |

## Prerequisites

- Node.js 22.19 or newer (the tests import the TypeScript sources directly).
- A global Pi install. The extension uses the Pi packages Pi itself provides, and
  `npm run link:deps` symlinks them into `node_modules/` from the `pi` on your
  `PATH`, or from the `pi-coding-agent` package directory in `MODEL_BANNER_PI_DIR`
  if set.
- Python 3 for the art checks.
- Only for rebuilding the art: `rsvg-convert` (librsvg), plus the Python packages
  Pillow and numpy.

## Commands

| Command | Effect |
|---|---|
| `npm test` | Link the Pi packages, run the unit tests, check the art. |
| `npm run test:unit` | Unit tests only (needs the links from `link:deps`). |
| `npm run link:deps` | Symlink Pi's host packages into `node_modules/`. |
| `npm run build:logos` | Regenerate `content/ansi/*.ansi` from `icons/*.svg`. |
| `npm run check:logos` | Check every family has art that fits the 20x10 cell grid. |
| `npm run preview:logos` | Print the art's dot grid and color map, no terminal needed. |

The art build and its tuning knobs are documented in the headers of
`scripts/build-logos.sh` and `scripts/png-to-ansi.py`.

## Dependencies

The Pi packages (`@earendil-works/pi-coding-agent`, `pi-ai`, `pi-tui`) are provided
by Pi at runtime. Declare them in `peerDependencies` with `"*"` and never in
`dependencies`; a bundled copy bypasses Pi's module mapping.

## Adding a vendor

Follow "Adding a family" in the header of `scripts/build-logos.sh` (icon, content
tables, tuning, build, test). Then also:

1. Add a row for the new art to the table in `NOTICE.md`, and the license text if
   the source requires it.
2. Add a `####` entry to the Vendors section of `README.md`, with a screenshot in
   `screenshots/<family>.png`.
3. Note the addition in `CHANGELOG.md`.

## Commits

Do not add agent co-authorship to commits: no `Co-authored-by:` trailers or
similar attribution for coding agents. The human author is responsible for every
commit.

## Publishing

The published package is an allowlist: `files` in `package.json` packs only the
extension sources, the generated `content/ansi/*.ansi` and the docs (`README.md`,
`CHANGELOG.md`, `LICENSE.md`, `NOTICE.md`), so `icons/`, `scripts/`, `tests/`,
`screenshots/` and this file stay in the repository. Check with
`npm pack --dry-run`.

README images use absolute `raw.githubusercontent.com/.../main/...` URLs so they
also render on npmjs.com, where `screenshots/` is not shipped.

Versions follow the year-based scheme described in the README. Each release gets a
`## [x.y.z] - YYYY-MM-DD` entry in `CHANGELOG.md`; Pi matches these headings against
`version` in `package.json` to show update notes.

## Releases

Releases are published to npm only. Only a maintainer cuts a release, and agents
never do: no `git tag`, no `npm publish`. The steps are in
[CONTRIBUTING.md](CONTRIBUTING.md#releasing).

`.github/workflows/test.yml` runs the tests on every push to `main` and every pull
request. Git installs (`pi install git:...`) read the repository directly, so
`main` should only ever hold release-ready code.
