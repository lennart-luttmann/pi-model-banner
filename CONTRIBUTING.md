# Contributing to pi-model-banner

Thanks for helping out. Most contributions fall into one of three kinds: reporting a problem, asking for a vendor, or sending a pull request.

## Reporting a bug

Open an [issue](https://github.com/lennart-luttmann/pi-model-banner/issues) and include:

- your Pi version (`pi --version`),
- your terminal and font,
- the output of `/banner status`,
- a screenshot, if the banner looks wrong.

## Wrong logo or missing vendor

If a model shows the wrong logo, open an issue with the model id and provider id, both shown by `/banner status`. Until it is fixed, you can pick the logo yourself with `overrides` in the [configuration](README.md#configuration).

If a vendor has no logo yet, open an issue with the vendor's name and a link to an official SVG of its mark. Or add it yourself, see [Adding a vendor](#adding-a-vendor).

## Setting up

You need:

- Node.js 22.19 or newer,
- Pi installed globally, so `pi` is on your `PATH`,
- Python 3.

Then clone the repository and run the tests:

```bash
git clone https://github.com/lennart-luttmann/pi-model-banner.git
cd pi-model-banner
npm test
```

There is nothing to `npm install`: the extension only uses the packages Pi itself provides, and `npm test` links them from your Pi install. If `pi` is not on your `PATH`, point `MODEL_BANNER_PI_DIR` at the `pi-coding-agent` package directory.

To try your changes in a real session, start Pi with the local copy:

```bash
pi -e ./index.ts
```

## Pull requests

- Keep a pull request to one change, and describe what it fixes or adds.
- Run `npm test` before you push; it runs the unit tests and checks the art.
- **Only** add or update tests for behavior you change.
- Match the style of the surrounding code: 4-space indentation, small functions,
  a short doc comment on each.
- Add a line under a new `## [Unreleased]` heading in `CHANGELOG.md` if users will
  notice the change.
- Do not edit `content/ansi/*.ansi` by hand; they are generated from `icons/`.
- You are responsible for your own commits and the code therein, including code written with the help of AI tools.
- **Do not list AI agents as co-authors** (no `Co-authored-by:` trailers for agents).

## Adding a vendor

A new vendor needs the vendor's own mark, not a redrawn one. Rebuilding the art also needs `rsvg-convert` (librsvg) and the Python packages Pillow and numpy.

1. Follow `Adding a family` at the top of `scripts/build-logos.sh`: add the SVG to `icons/` with its source and license in a comment, add the vendor to the tables in `content/`, then run `npm run build:logos`.
2. Check the result with `npm run preview:logos` and in Pi, then run `npm test`.
3. Add a row to the table in `NOTICE.md`, and the license text if the source requires it. Marks from unclear or unlicensed sources cannot be accepted.
4. Add an entry to the Vendors section of `README.md`.
5. If you can, add a screenshot as `screenshots/<family>.png`, cropped like the existing ones (895 × 325 pixels, dark theme). Otherwise write **No screenshot available** and one can be added later.

The project structure and the publishing setup are included in [AGENTS.md](AGENTS.md).

## License

By contributing, you agree that your contribution is licensed under the
[MIT license](LICENSE.md) of this project.
