# `@imgconvert/environmental-impact`

Pure TypeScript calculations for ImgConvert's measured byte reduction and scenario-based storage
energy and CO2 estimates. The package has no browser, DOM, telemetry, or network dependency, so
the desktop app, web app, browser extension, and website can share one versioned model.

The API deliberately distinguishes measurements from estimates:

- `measureByteReduction` reports bytes derived from actual input and output sizes.
- `estimateStorageImpact` models operational storage energy and CO2 under explicit assumptions.
- `calculateConversionImpact` prevents non-comparable outputs or retained originals from being
  presented as avoided storage emissions.
- `estimateDailyAccumulationImpact` supports transparent population scenarios without collecting
  user telemetry.

See [`docs/ENVIRONMENTAL_IMPACT_METHODOLOGY.md`](../../docs/ENVIRONMENTAL_IMPACT_METHODOLOGY.md) for
the formulas, sources, exclusions, and product-language requirements.

The [environmental feature development plan](../../docs/ENVIRONMENTAL_IMPACT_DEVELOPMENT_PLAN.md)
describes the staged integrations and acceptance criteria. The bilingual website calculators and
Web, extension and desktop result panels are implemented locally. See the
[Web implementation review](../../docs/ENVIRONMENTAL_IMPACT_WEB_REVIEW.md) for validation and deployment status.

The [extension review](../../docs/ENVIRONMENTAL_IMPACT_EXTENSION_REVIEW.md) records the 0.3.4 candidate.
`measureComparableRasterReduction` and `summarizeComparableRasterReductions` share artifact eligibility
and net byte accounting between Web and extension consumers without a DOM or runtime dependency.

The [desktop review](../../docs/ENVIRONMENTAL_IMPACT_DESKTOP_REVIEW.md) records native result evidence,
conservative static-source eligibility and pending platform release validation.
