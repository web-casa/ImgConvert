# ImgConvert environmental impact methodology

Status: normative for model `imgconvert.storage-operational-impact` version `1.0.0`  
Model release date: 2026-09-05

## Purpose and claim boundary

ImgConvert measures file sizes exactly. It does not directly measure electricity use or carbon
emissions. Environmental figures produced by ImgConvert are scenario estimates of operational
storage demand under explicit assumptions. Version 1 uses Ember's operational power-sector CO2
intensity and therefore reports CO2, not CO2e.

Product copy must distinguish these levels:

1. **Measured:** "The output is 9.3 MB smaller."
2. **Hypothetical estimate:** "If this output replaces the original and is stored for one year..."
3. **Confirmed replacement estimate:** the user has explicitly indicated that the original was
   replaced; this is still a modeled estimate, not measured avoided emissions.

The product must not say that converting, downloading, or creating a smaller copy by itself reduced
carbon emissions. A smaller output is ineligible for an avoided-storage estimate when:

- it is not comparable with the input, such as PDF-to-images or a multi-artifact transformation;
- the output is the same size or larger; or
- the original and output are both retained.

## Version 1 assumptions

| Factor | Version 1 value | Source and interpretation |
| --- | ---: | --- |
| Byte unit | Decimal SI: 1 MB = 1,000,000 bytes; 1 TB = 10^12 bytes | Display and model contract |
| Storage energy | 0.65-1.2 Wh/TB-hour | Cloud Carbon Footprint HDD/SSD coefficients |
| PUE | 1.10-1.185 | Published provider values used by Cloud Carbon Footprint |
| Replication | 1-3 copies | Explicit ImgConvert scenario range, not a provider claim |
| Retention | 365 days | Default user-adjustable scenario |
| Grid intensity | 473 gCO2/kWh | 2024 global power-sector CO2 intensity reported by Ember |

Primary sources:

- [Cloud Carbon Footprint methodology](https://www.cloudcarbonfootprint.org/docs/methodology/)
- [Ember Global Electricity Review 2025](https://ember-energy.org/app/uploads/2025/04/Report-Global-Electricity-Review-2025.pdf)

Cloud Carbon Footprint describes its output as an estimate and notes that storage replication may
make physical infrastructure larger than allocated storage. ImgConvert therefore presents a range
and exposes every assumption rather than presenting a point estimate as measured fact.

## Formulas

For comparable input and output artifacts:

```text
saved_bytes = max(input_bytes - total_comparable_output_bytes, 0)
terabyte_hours = saved_bytes / 10^12 * retention_days * 24
storage_Wh = terabyte_hours * storage_Wh_per_TB_hour * PUE * replication_factor
storage_CO2_g = storage_Wh / 1000 * grid_intensity_g_per_kWh
```

All factors are non-negative, so range endpoints are calculated by multiplying all minimum values
for the lower bound and all maximum values for the upper bound.

For a scenario where the same amount is saved once per day and every daily addition remains active
until the end of the modeled period:

```text
cohort_days = active_days * (active_days + 1) / 2
terabyte_hours = daily_saved_bytes / 10^12 * cohort_days * 24
```

The first addition is retained for the full period and the last addition for one day. This prevents
the common error of charging every daily addition for a full year during the first-year estimate.

## Reproducible reference values

Under the version 1 defaults, saving 1 decimal MB for one year produces:

- 0.0062634-0.037370 Wh of modeled storage electricity;
- 0.002963-0.017676 g CO2, or approximately 3-18 mg CO2.

Using the 2025 ITU estimate of six billion internet users, one daily megabyte per user equals 6 PB
per day. If that action repeats for 365 days and each daily addition remains through year end, the
period ends with a modeled 2.19 EB reduction. With one storage copy, the first-year model produces
approximately 6.88-13.68 GWh and 3.25-6.47 thousand tonnes CO2. A three-copy scenario multiplies
those operational figures by three.

Population source:

- [ITU Facts and Figures 2025: Internet use](https://www.itu.int/itu-d/reports/statistics/2025/10/15/ff25-internet-use/)

This is a transparent scenario, not a community total and not evidence that physical infrastructure
or electricity generation changed by that amount.

## Exclusions

Version 1 does not include:

- energy used by the conversion itself;
- embodied emissions from manufacturing storage devices or other hardware;
- network transfer, end-user device, or repeated-download energy;
- marginal grid emissions or proof that capacity investment was deferred; or
- rebound effects, such as keeping more files because compression makes storage cheaper.

Storage hardware embodied emissions are excluded because the adopted source does not provide a
sufficient public storage-specific embodied-carbon factor. Electronic-waste and material impacts
may be discussed separately as education, but must not be added to the per-file number.

## Privacy and implementation requirements

- The calculation runs locally and requires no telemetry or network request.
- A global counter must be a labeled scenario calculator, never an inferred total of ImgConvert
  users.
- Model outputs must include `modelId`, `modelVersion`, and the assumptions used.
- UI formatting may round numbers, but calculations must retain full precision.
- A new source value or formula requires a model-version change, fixture updates, and release notes.
- Transfer emissions, if added later, must be shown as a separate model and must not be merged into
  storage emissions without a visible breakdown.
