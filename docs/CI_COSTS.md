<!-- SPDX-License-Identifier: Apache-2.0 -->
# GitHub Actions Cost Policy

The repository is public, so the standard GitHub-hosted runners used by these
workflows are free. The policy is to use only those free standard labels:

- `ubuntu-24.04` (x86_64)
- `ubuntu-24.04-arm` (arm64)
- `ubuntu-22.04` (x86_64 release compatibility baseline)
- `ubuntu-22.04-arm` (arm64 release compatibility baseline)
- `windows-latest`
- `windows-11-arm`
- `macos-15`
- `macos-15-intel`

Paid larger runners are not allowed. `pnpm run ci:cost:check` verifies that
every workflow is dispatchable, never schedules recurring jobs, never uses
paid/larger runner labels, and keeps the workflows below in their expected
shape.

Default behavior:

- `CI` runs automatically on `main` pushes and pull requests. The Ubuntu
  frontend, Rust core, Tauri backend, security/license, fuzz corpus replay, and
  web preview E2E jobs run on `ubuntu-24.04`. The Windows HEIC check runs on
  `windows-latest` for `main` pushes. The Linux package build/install smoke
  runs on both `ubuntu-22.04` and `ubuntu-22.04-arm` for `main` pushes so the
  compatibility check is performed on the same baseline as release builds.
  Manual dispatch keeps the Windows check, package smoke, fuzz replay, and
  arm64 package smoke optional with `false` defaults.
- `Linux Release` builds `amd64` and `arm64` on Ubuntu 22.04 automatically when
  a `v*` tag is pushed. This keeps AppImageHub artifacts at or below the
  `GLIBC_2.35` compatibility baseline. The tag build also runs the Docker
  install/runtime smoke matrix.
  Manual dispatch also defaults to both architectures; Docker smoke remains an
  explicit opt-in.
- `macOS Smoke` is manual-only and runs on the free public `macos-15` arm64
  runner. It retains the Apple Silicon AVIF benchmark JSON artifact for 14
  days; signing, asynchronous notarization submission, DMG, and MAS candidate
  steps remain opt-in because they require Apple secrets. A submitted DMG and
  its SHA-256-bound receipt are retained for seven days without holding the
  runner open while Apple processes the request. `macOS Intel Smoke` is a
  separate manual-only `macos-15-intel` run for the same ImageIO HEIC path and
  optional unsigned Intel DMG, so the release gate does not infer Intel support
  from an Apple Silicon build.
- `macOS DMG Release` is a manual-only arm64/x64 matrix using `macos-15` and
  `macos-15-intel`. It accepts only an exact application tag, requires Apple
  signing/notarization secrets, and saves each submitted DMG plus its receipt
  for seven days. `macOS Notarization Finalize` is a separate manual `macos-15`
  job that finalizes one selected architecture at a time, retains an accepted
  result for 14 days, and only uploads it to an already existing same-tag GitHub
  Release when the original release run recorded `publish_release=true`. It
  never uses `--clobber`, creates a Release, or changes a Release draft state.
- `Windows Smoke` is manual-only and runs an x64/arm64 matrix on the free public
  `windows-latest` and `windows-11-arm` runners. Installer signing and Store
  MSIX packaging remain opt-in because they require secrets or Store identity
  work.
- `Windows Store MSIX` is a manual-only x64/arm64 production submission matrix. It uses
  an exact app tag plus the committed Partner Center identity defaults, disables
  external codecs and Tauri updater, verifies a temporary copy through the
  elevated sideload smoke, and uploads the untouched original `*.msix`
  submission artifact for 14 days.
- `Updater Release` and `Updater Upgrade Smoke` are manual-only because they
  publish or consume real GitHub Release artifacts.
- `Snap Store Release` is manual-only, builds strict `core24` snaps on standard
  x86_64/arm64 runners, retains build artifacts for seven days, and publishes
  only when `publish_snap=true` and package-scoped `SNAP_STORE_LOGIN`
  credentials are present.

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

Use [`RELEASE_QA.md`](RELEASE_QA.md) with these workflows for the actual
architecture, installation, image-corpus, updater, and store-device acceptance
record. A green hosted-runner job alone is not release approval.

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
