<!-- SPDX-License-Identifier: Apache-2.0 -->
# GitHub Actions Cost Policy

The repository is public, so the standard GitHub-hosted runners used by these
workflows are free. The policy is to use only those free standard labels:

- `ubuntu-24.04` (x86_64)
- `ubuntu-24.04-arm` (arm64)
- `windows-latest`
- `macos-15`

Paid larger runners are not allowed. `pnpm run ci:cost:check` verifies that
every workflow is dispatchable, never schedules recurring jobs, never uses
paid/larger runner labels, and keeps the workflows below in their expected
shape.

Default behavior:

- `CI` runs automatically on `main` pushes and pull requests. The Ubuntu
  frontend, Rust core, Tauri backend, security/license, fuzz corpus replay, and
  web preview E2E jobs run on `ubuntu-24.04`. The Windows HEIC check runs on
  `windows-latest` for `main` pushes. The Linux package build/install smoke
  runs on both `ubuntu-24.04` and `ubuntu-24.04-arm` for `main` pushes.
  Manual dispatch keeps the Windows check, package smoke, fuzz replay, and
  arm64 package smoke optional with `false` defaults.
- `Linux Release` builds `amd64` and `arm64` automatically when a `v*` tag is
  pushed. The tag build also runs the Docker install/runtime smoke matrix.
  Manual dispatch defaults to `amd64` only, with free public arm64 and Docker
  smoke as explicit opt-ins.
- `macOS Smoke` is manual-only and runs on the free public `macos-15` arm64
  runner. It retains the Apple Silicon AVIF benchmark JSON artifact for 14
  days; signing, asynchronous notarization submission, DMG, and MAS candidate
  steps remain opt-in because they require Apple secrets. A submitted DMG and
  its SHA-256-bound receipt are retained for seven days without holding the
  runner open while Apple processes the request.
- `macOS DMG Release` is a manual-only `macos-15` arm64 release job. It accepts
  only an exact application tag, requires Apple signing/notarization secrets,
  and saves the submitted DMG plus receipt for seven days. `macOS Notarization
  Finalize` is a separate manual `macos-15` job that validates the source run,
  checks Apple once, staples an accepted DMG, retains the result for 14 days,
  and only uploads it to an already existing same-tag GitHub Release when the
  original release run recorded `publish_release=true`. It never uses
  `--clobber`, creates a Release, or changes a Release draft state.
- `Windows Smoke` is manual-only and runs on the free public
  `windows-latest` x64 runner. Installer signing and Store MSIX packaging
  remain opt-in because they require secrets or Store identity work.
- `Windows Store MSIX` is a manual-only production submission build. It uses
  an exact app tag plus the committed Partner Center identity defaults, disables
  external codecs and Tauri updater, verifies a temporary copy through the
  elevated sideload smoke, and uploads the untouched original `*.msix`
  submission artifact for 14 days.
- `Updater Release` and `Updater Upgrade Smoke` are manual-only because they
  publish or consume real GitHub Release artifacts.

All Ubuntu CI and release jobs that need native build packages (`CI`, `Linux
Release`, `Updater Release`, and `Updater Upgrade Smoke`) use the shared
`scripts/ci-install-apt-packages.sh` bootstrap. Its `apt-get update` work is
bounded to three 180-second attempts with a short backoff, and package install
is bounded to ten minutes. This converts a transient hosted-runner mirror stall
into a clear retry or failure instead of silently consuming an entire CI job;
it does not add a runner, schedule, package source, or privileged service.
When `GITHUB_ACTIONS=true` and `RUNNER_ENVIRONMENT=github-hosted`, if the
hosted Ubuntu image's `apt-mirrors.txt` contains the unavailable Azure archive
host, the bootstrap temporarily substitutes the official
`archive.ubuntu.com` host for that script invocation and restores the runner's
original mirror file on exit. If restoration fails after an otherwise successful
bootstrap, the step fails rather than silently continuing with a modified runner
configuration.

Run the static guardrail after changing workflows:

```bash
pnpm run ci:cost:check
```

Before deciding whether to run packaging or publishing jobs, run the read-only
release readiness report:

```bash
pnpm run release:readiness
```

It does not build artifacts or trigger GitHub Actions. It only reports which
local checks/artifacts are present and which remaining items require external
credentials, store review, or platform runners.

Before publishing the first GitHub Releases batch, run the stricter local gate:

```bash
pnpm run release:readiness:github:ready
```

That command is still local and read-only, but it exits non-zero if any
GitHub-release in-scope artifact, updater signature, manifest, or prerequisite
is not ready.
