# bos_build — BrowserOS Chromium build system

One engine, many products, many hosts. Every axis of variation —
product, platform, arch, host type — is data, not a copied config file.

## Layout

```
bos_build/
  cli/        thin Typer wrappers (build, source, product, dev, release, ota)
  core/       engine: context, step registry, planner, runner, events,
              notify, versions, env — zero domain knowledge
  steps/      pipeline steps, registered via @step with metadata
              (source, setup, resources, patches, extensions, compile,
              sign, package, storage, release, ota)
  patchkit/   the Python patch surface: dev extract, non-interactive
              batch-apply, features.yaml IO (interactive apply/sync
              lives in the Go tool: tools/patch, `bpatch`)
  products/   one package per product: define() call + server bundles
  profiles/   saved switch sets for CI (flat yaml, no module lists)
  config/     data: gn flags, resource yamls, appcast templates, offset
```

## How a build is composed

Pipeline shapes live in `core/planner.py` as one pure function:

```
plan(preset, platform, arch, switches) -> [step names]
```

- **Presets** (`release`, `debug`) encode step composition, including
  platform variance (sparkle vs winsparkle, mini_installer on unsigned
  Windows) — once, in code, golden-tested against the YAML matrix this
  replaced.
- **Switches** are flat toggles: `product`, `arch`, `clean`,
  `provision` (none/full/shallow), `download`, `sign`, `upload`.
  Resolution: CLI > profile file > preset default.
- **Steps** self-register with `@step(name, phase, platforms, notify,
  env, optional)`. Required env vars derive from the selected steps and
  are preflighted before anything runs; within-phase order is the
  import order in `steps/__init__.py`.

```bash
# Local signed release build
browseros build --preset release --product browserclaw --arch arm64

# What nightly CI runs (profile = saved switches)
browseros build --profile nightly-ci --arch x64

# Power users: explicit steps
browseros build --modules clean,compile,sign_macos --product browseros
```

## Remote / ephemeral runners

A fresh machine needs nothing outside this package:

```bash
uv sync
uv run browseros source ensure --root "$CHROMIUM_ROOT" --step checkout
uv run browseros build --modules clean --chromium-src "$CHROMIUM_ROOT/src" -t release
uv run browseros source ensure --root "$CHROMIUM_ROOT" --step sync
uv run browseros build --profile nightly-ci --chromium-src "$CHROMIUM_ROOT/src"
```

(checkout/sync are split because `clean` must run between them — it
deletes hook-managed toolchains that sync restores. `browseros source
cache restore|save` handles the R2 checkout cache on runners without
WarpCache.)

## Products

A product is one file: `products/<id>/product.py` with a
`ProductDescriptor.define()` call (~5 irreducible inputs, ~40 fields
derived by convention, keyword overrides for deviations) plus its
server bundle definitions. Verify with:

```bash
browseros product doctor          # identity uniqueness + branding assets
```

## Tests

```bash
uv run python -m unittest discover -s bos_build -t . -p "*_test.py"
uv run ruff check bos_build
```
