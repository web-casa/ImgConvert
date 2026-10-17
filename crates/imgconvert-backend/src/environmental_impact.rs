// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Storage and environmental scenario model (port of the TypeScript package
//! `@imgconvert/environmental-impact`, model v1.0.0). Pure arithmetic over
//! byte counts: a measured byte reduction, a bounded cloud-storage scenario
//! and the energy / CO₂ range it implies. Nothing here claims an achieved
//! saving; the shell shows the result with the model's own boundary text.
//!
//! Byte counts are `u64` but, like the TypeScript original, anything beyond
//! JavaScript's safe-integer range is rejected so both shells agree.

use std::fmt;

/// Largest byte count the model accepts (JavaScript's `MAX_SAFE_INTEGER`).
pub const MAX_SAFE_BYTES: u64 = (1 << 53) - 1;
/// Upper bound of the retention-days input of the scenario panel.
pub const MAX_SCENARIO_RETENTION_DAYS: u32 = 3650;
/// Default retention of the model's documented one-year example.
pub const DEFAULT_RETENTION_DAYS: u32 = 365;

const BYTES_PER_DECIMAL_TERABYTE: f64 = 1_000_000_000_000.0;
const HOURS_PER_DAY: f64 = 24.0;
const WATT_HOURS_PER_KILOWATT_HOUR: f64 = 1_000.0;

/// A violated precondition of the model (mirrors the TypeScript `RangeError`s).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImpactError(String);

impl fmt::Display for ImpactError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ImpactError {}

#[non_exhaustive]
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NumberRange {
    pub min: f64,
    pub max: f64,
}

impl NumberRange {
    pub const fn new(min: f64, max: f64) -> Self {
        Self { min, max }
    }

    fn checked(self, name: &str, minimum: f64) -> Result<Self, ImpactError> {
        assert_finite_at_least(self.min, minimum, &format!("{name}.min"))?;
        assert_finite_at_least(self.max, minimum, &format!("{name}.max"))?;
        if self.min > self.max {
            return Err(ImpactError(format!("{name}.min cannot exceed {name}.max")));
        }
        Ok(self)
    }
}

#[non_exhaustive]
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StorageImpactFactors {
    pub grid_intensity_grams_co2_per_kilowatt_hour: NumberRange,
    pub pue: NumberRange,
    pub replication_factor: NumberRange,
    pub storage_energy_watt_hours_per_terabyte_hour: NumberRange,
}

#[non_exhaustive]
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StorageImpactAssumptions {
    pub factors: StorageImpactFactors,
    pub retention_days: f64,
}

/// Measured byte change of one conversion or of a batch.
#[non_exhaustive]
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ByteReductionMeasurement {
    /// Positive when the output is smaller, negative when it is larger.
    pub byte_difference: i64,
    pub input_bytes: u64,
    pub output_bytes: u64,
    pub reduction_fraction: f64,
    /// Never negative.
    pub saved_bytes: u64,
}

#[non_exhaustive]
#[derive(Debug, Clone, PartialEq)]
pub struct StorageImpactEstimate {
    pub assumptions: StorageImpactAssumptions,
    pub carbon_grams_co2: NumberRange,
    pub energy_watt_hours: NumberRange,
    pub model_id: &'static str,
    pub model_version: &'static str,
    pub saved_bytes: u64,
    pub terabyte_hours: f64,
}

/// What the person says happened to the originals.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplacementStatus {
    /// Assume the outputs replace the originals.
    Hypothetical,
    /// Self-reported: the originals were replaced.
    Confirmed,
    /// The originals stay; no storage is freed.
    Retained,
}

impl ReplacementStatus {
    pub const ALL: [Self; 3] = [Self::Hypothetical, Self::Confirmed, Self::Retained];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Hypothetical => "hypothetical",
            Self::Confirmed => "confirmed",
            Self::Retained => "retained",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|status| status.as_str() == text)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnavailableReason {
    NoReduction,
    NotComparable,
    OriginalRetained,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ConversionImpactResult {
    Estimate {
        basis: ReplacementStatus,
        estimate: StorageImpactEstimate,
        measurement: ByteReductionMeasurement,
    },
    Unavailable {
        measurement: ByteReductionMeasurement,
        reason: UnavailableReason,
    },
}

#[non_exhaustive]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModelSource {
    pub id: &'static str,
    pub title: &'static str,
    pub url: &'static str,
    pub accessed_on: &'static str,
}

#[non_exhaustive]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StorageImpactModel {
    pub id: &'static str,
    pub version: &'static str,
    pub released_on: &'static str,
    pub byte_unit: &'static str,
    pub exclusions: &'static [&'static str],
    pub sources: &'static [ModelSource],
}

pub const STORAGE_IMPACT_MODEL_V1: StorageImpactModel = StorageImpactModel {
    id: "imgconvert.storage-operational-impact",
    version: "1.0.0",
    released_on: "2026-09-05",
    byte_unit: "decimal-si",
    exclusions: &[
        "conversion-energy",
        "storage-hardware-embodied-emissions",
        "network-transfer-energy",
        "marginal-capacity-effects",
    ],
    sources: &[
        ModelSource {
            id: "cloud-carbon-footprint-methodology",
            title: "Cloud Carbon Footprint methodology",
            url: "https://www.cloudcarbonfootprint.org/docs/methodology/",
            accessed_on: "2026-09-05",
        },
        ModelSource {
            id: "ember-global-electricity-review-2025",
            title: "Ember Global Electricity Review 2025",
            url: "https://ember-energy.org/app/uploads/2025/04/Report-Global-Electricity-Review-2025.pdf",
            accessed_on: "2026-09-05",
        },
    ],
};

pub const DEFAULT_STORAGE_IMPACT_FACTORS_V1: StorageImpactFactors = StorageImpactFactors {
    grid_intensity_grams_co2_per_kilowatt_hour: NumberRange::new(473.0, 473.0),
    pue: NumberRange::new(1.1, 1.185),
    replication_factor: NumberRange::new(1.0, 3.0),
    storage_energy_watt_hours_per_terabyte_hour: NumberRange::new(0.65, 1.2),
};

pub const DEFAULT_STORAGE_IMPACT_ASSUMPTIONS_V1: StorageImpactAssumptions =
    StorageImpactAssumptions {
        factors: DEFAULT_STORAGE_IMPACT_FACTORS_V1,
        retention_days: 365.0,
    };

fn assert_finite_at_least(value: f64, minimum: f64, name: &str) -> Result<(), ImpactError> {
    if !value.is_finite() || value < minimum {
        return Err(ImpactError(format!(
            "{name} must be a finite number greater than or equal to {minimum}"
        )));
    }
    Ok(())
}

fn assert_safe_bytes(value: u64, name: &str) -> Result<(), ImpactError> {
    if value > MAX_SAFE_BYTES {
        return Err(ImpactError(format!(
            "{name} must be a non-negative safe integer"
        )));
    }
    Ok(())
}

fn assert_finite_result(value: f64, name: &str) -> Result<(), ImpactError> {
    if !value.is_finite() {
        return Err(ImpactError(format!(
            "{name} exceeds the supported numeric range"
        )));
    }
    Ok(())
}

/// Validates factors the way the TypeScript constructor does.
pub fn create_storage_impact_factors(
    input: StorageImpactFactors,
) -> Result<StorageImpactFactors, ImpactError> {
    Ok(StorageImpactFactors {
        grid_intensity_grams_co2_per_kilowatt_hour: input
            .grid_intensity_grams_co2_per_kilowatt_hour
            .checked("gridIntensityGramsCo2PerKilowattHour", 0.0)?,
        pue: input.pue.checked("pue", 1.0)?,
        replication_factor: input.replication_factor.checked("replicationFactor", 1.0)?,
        storage_energy_watt_hours_per_terabyte_hour: input
            .storage_energy_watt_hours_per_terabyte_hour
            .checked("storageEnergyWattHoursPerTerabyteHour", 0.0)?,
    })
}

pub fn create_storage_impact_assumptions(
    input: StorageImpactAssumptions,
) -> Result<StorageImpactAssumptions, ImpactError> {
    assert_finite_at_least(input.retention_days, 0.0, "retentionDays")?;
    Ok(StorageImpactAssumptions {
        factors: create_storage_impact_factors(input.factors)?,
        retention_days: input.retention_days,
    })
}

/// The measured change between an input and its output.
pub fn measure_byte_reduction(
    input_bytes: u64,
    output_bytes: u64,
) -> Result<ByteReductionMeasurement, ImpactError> {
    assert_safe_bytes(input_bytes, "inputBytes")?;
    assert_safe_bytes(output_bytes, "outputBytes")?;
    // Both fit in 53 bits, so the difference fits in i64.
    let byte_difference = input_bytes as i64 - output_bytes as i64;
    let saved_bytes = input_bytes.saturating_sub(output_bytes);
    Ok(ByteReductionMeasurement {
        byte_difference,
        input_bytes,
        output_bytes,
        reduction_fraction: if input_bytes == 0 {
            0.0
        } else {
            saved_bytes as f64 / input_bytes as f64
        },
        saved_bytes,
    })
}

fn impact_from_terabyte_hours(
    terabyte_hours: f64,
    factors: &StorageImpactFactors,
) -> Result<(NumberRange, NumberRange), ImpactError> {
    let energy_min = terabyte_hours
        * factors.storage_energy_watt_hours_per_terabyte_hour.min
        * factors.pue.min
        * factors.replication_factor.min;
    let energy_max = terabyte_hours
        * factors.storage_energy_watt_hours_per_terabyte_hour.max
        * factors.pue.max
        * factors.replication_factor.max;
    let carbon_min = energy_min / WATT_HOURS_PER_KILOWATT_HOUR
        * factors.grid_intensity_grams_co2_per_kilowatt_hour.min;
    let carbon_max = energy_max / WATT_HOURS_PER_KILOWATT_HOUR
        * factors.grid_intensity_grams_co2_per_kilowatt_hour.max;
    assert_finite_result(energy_min, "minimum energy estimate")?;
    assert_finite_result(energy_max, "maximum energy estimate")?;
    assert_finite_result(carbon_min, "minimum carbon estimate")?;
    assert_finite_result(carbon_max, "maximum carbon estimate")?;
    Ok((
        NumberRange::new(energy_min, energy_max),
        NumberRange::new(carbon_min, carbon_max),
    ))
}

/// Operational storage energy and CO₂ for keeping `saved_bytes` less data
/// over the assumed retention.
pub fn estimate_storage_impact(
    saved_bytes: u64,
    input: StorageImpactAssumptions,
) -> Result<StorageImpactEstimate, ImpactError> {
    assert_safe_bytes(saved_bytes, "savedBytes")?;
    let assumptions = create_storage_impact_assumptions(input)?;
    let terabyte_hours = saved_bytes as f64 / BYTES_PER_DECIMAL_TERABYTE
        * assumptions.retention_days
        * HOURS_PER_DAY;
    assert_finite_result(terabyte_hours, "terabyte-hours")?;
    let (energy_watt_hours, carbon_grams_co2) =
        impact_from_terabyte_hours(terabyte_hours, &assumptions.factors)?;
    Ok(StorageImpactEstimate {
        assumptions,
        carbon_grams_co2,
        energy_watt_hours,
        model_id: STORAGE_IMPACT_MODEL_V1.id,
        model_version: STORAGE_IMPACT_MODEL_V1.version,
        saved_bytes,
        terabyte_hours,
    })
}

/// The scenario result for one comparable (or not) conversion.
pub fn calculate_conversion_impact(
    comparable: bool,
    input_bytes: u64,
    output_bytes: u64,
    replacement: ReplacementStatus,
    assumptions: StorageImpactAssumptions,
) -> Result<ConversionImpactResult, ImpactError> {
    let assumptions = create_storage_impact_assumptions(assumptions)?;
    let measurement = measure_byte_reduction(input_bytes, output_bytes)?;
    if !comparable {
        return Ok(ConversionImpactResult::Unavailable {
            measurement,
            reason: UnavailableReason::NotComparable,
        });
    }
    if measurement.saved_bytes == 0 {
        return Ok(ConversionImpactResult::Unavailable {
            measurement,
            reason: UnavailableReason::NoReduction,
        });
    }
    if replacement == ReplacementStatus::Retained {
        return Ok(ConversionImpactResult::Unavailable {
            measurement,
            reason: UnavailableReason::OriginalRetained,
        });
    }
    Ok(ConversionImpactResult::Estimate {
        basis: replacement,
        estimate: estimate_storage_impact(measurement.saved_bytes, assumptions)?,
        measurement,
    })
}

/// Bounded panel inputs (`scenarioAssumptions`): whole days up to
/// [`MAX_SCENARIO_RETENTION_DAYS`]; `copies` 0 keeps the model's 1–3 range,
/// 1–3 fixes the replication factor.
pub fn scenario_assumptions(
    days: u32,
    copies: u8,
) -> Result<StorageImpactAssumptions, ImpactError> {
    if days > MAX_SCENARIO_RETENTION_DAYS {
        return Err(ImpactError(
            "retention days must be an integer from 0 to 3650".into(),
        ));
    }
    if copies > 3 {
        return Err(ImpactError("unsupported replica count".into()));
    }
    let mut factors = DEFAULT_STORAGE_IMPACT_FACTORS_V1;
    if copies > 0 {
        factors.replication_factor = NumberRange::new(f64::from(copies), f64::from(copies));
    }
    create_storage_impact_assumptions(StorageImpactAssumptions {
        factors,
        retention_days: f64::from(days),
    })
}

/// Parses the panel's days field like `Number(value)` + the scenario bounds:
/// blank and anything that is not a whole number in range is `None`.
pub fn parse_scenario_days(text: &str) -> Option<u32> {
    let trimmed = text.trim();
    if trimmed.is_empty() || !trimmed.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    trimmed
        .parse::<u32>()
        .ok()
        .filter(|days| *days <= MAX_SCENARIO_RETENTION_DAYS)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImpactQuantity {
    Energy,
    Carbon,
}

/// One unit for the whole range with three significant digits
/// (`formatImpactRange`): `2.96–17.7 mg CO₂`, `0.00626–0.0374 Wh`.
pub fn format_impact_range(
    range: NumberRange,
    quantity: ImpactQuantity,
) -> Result<String, ImpactError> {
    if !range.min.is_finite() || !range.max.is_finite() || range.min < 0.0 || range.max < range.min
    {
        return Err(ImpactError("invalid impact range".into()));
    }
    let units: &[(f64, &str)] = match quantity {
        ImpactQuantity::Energy => &[(1e9, "GWh"), (1e6, "MWh"), (1e3, "kWh"), (1.0, "Wh")],
        ImpactQuantity::Carbon => &[
            (1e6, "t CO₂"),
            (1e3, "kg CO₂"),
            (1.0, "g CO₂"),
            (0.001, "mg CO₂"),
        ],
    };
    let (divisor, unit) = units
        .iter()
        .copied()
        .find(|(threshold, _)| range.max >= *threshold)
        .unwrap_or(units[units.len() - 1]);
    let low = format_significant(range.min / divisor, 3);
    let high = format_significant(range.max / divisor, 3);
    Ok(if low == high {
        format!("{low} {unit}")
    } else {
        format!("{low}–{high} {unit}")
    })
}

/// `Intl.NumberFormat` with `maximumSignificantDigits` and `en-US`
/// grouping: rounds half away from zero on the decimal value, drops
/// trailing zeros, groups thousands (`12,300`, `17.7`, `0.00626`).
pub fn format_significant(value: f64, digits: u32) -> String {
    if value == 0.0 || !value.is_finite() {
        return "0".to_string();
    }
    let digits = digits.max(1) as i32;
    let negative = value < 0.0;
    let magnitude = value.abs();
    let mut exponent = magnitude.log10().floor() as i32;
    // Scale so the kept digits are the integer part, round half up, and
    // move up one exponent when rounding carried (9.996 → 10.0).
    let mut scaled = round_half_up(magnitude * 10f64.powi(digits - 1 - exponent));
    if scaled >= 10f64.powi(digits) {
        exponent += 1;
        scaled = round_half_up(magnitude * 10f64.powi(digits - 1 - exponent));
    }
    let mantissa = scaled as u128;
    let text = if exponent >= digits - 1 {
        let integer = mantissa * 10u128.pow((exponent - (digits - 1)) as u32);
        group_thousands(&integer.to_string())
    } else {
        let decimals = (digits - 1 - exponent) as usize;
        let raw = format!("{mantissa:0>width$}", width = decimals + 1);
        let (integer, fraction) = raw.split_at(raw.len() - decimals);
        let fraction = fraction.trim_end_matches('0');
        if fraction.is_empty() {
            group_thousands(integer)
        } else {
            format!("{}.{fraction}", group_thousands(integer))
        }
    };
    if negative && text != "0" {
        format!("-{text}")
    } else {
        text
    }
}

fn round_half_up(value: f64) -> f64 {
    (value + 0.5).floor()
}

fn group_thousands(integer: &str) -> String {
    let mut grouped = String::with_capacity(integer.len() + integer.len() / 3);
    for (count, digit) in integer.chars().enumerate() {
        if count > 0 && (integer.len() - count).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(digit);
    }
    grouped
}

/// Binary byte sizes with three significant digits and IEC labels, as the
/// Svelte panel's `formatBytes` (`124 KiB`, `1.5 KiB`, `512 B`).
pub fn format_binary_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KiB", "MiB", "GiB", "TiB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    format!("{} {}", format_significant(value, 3), UNITS[unit])
}

/// Net byte change over several comparable results (larger outputs offset
/// smaller ones); `None` without any eligible result.
pub fn summarize_measurements<I>(
    pairs: I,
) -> Result<Option<(ByteReductionMeasurement, usize)>, ImpactError>
where
    I: IntoIterator<Item = (u64, u64)>,
{
    let mut input: u64 = 0;
    let mut output: u64 = 0;
    let mut count = 0usize;
    for (in_bytes, out_bytes) in pairs {
        let measurement = measure_byte_reduction(in_bytes, out_bytes)?;
        input = input.checked_add(measurement.input_bytes).ok_or_else(|| {
            ImpactError("queue byte totals exceed the supported numeric range".into())
        })?;
        output = output
            .checked_add(measurement.output_bytes)
            .ok_or_else(|| {
                ImpactError("queue byte totals exceed the supported numeric range".into())
            })?;
        count += 1;
    }
    if count == 0 {
        return Ok(None);
    }
    if input > MAX_SAFE_BYTES || output > MAX_SAFE_BYTES {
        return Err(ImpactError(
            "queue byte totals exceed the supported numeric range".into(),
        ));
    }
    Ok(Some((measure_byte_reduction(input, output)?, count)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const DECIMAL_MEGABYTE: u64 = 1_000_000;

    fn close(actual: f64, expected: f64, places: i32) {
        let tolerance = 10f64.powi(-places) / 2.0;
        assert!(
            (actual - expected).abs() < tolerance,
            "{actual} != {expected} within {places} places"
        );
    }

    #[test]
    fn reports_measured_savings_without_negative_savings() {
        let measurement = measure_byte_reduction(12_400_000, 3_100_000).unwrap();
        assert_eq!(measurement.byte_difference, 9_300_000);
        assert_eq!(measurement.saved_bytes, 9_300_000);
        assert!((measurement.reduction_fraction - 0.75).abs() < f64::EPSILON);
        let growth = measure_byte_reduction(100, 120).unwrap();
        assert_eq!(growth.byte_difference, -20);
        assert_eq!(growth.saved_bytes, 0);
        assert_eq!(growth.reduction_fraction, 0.0);
    }

    #[test]
    fn rejects_unsafe_byte_counts() {
        let error = measure_byte_reduction(MAX_SAFE_BYTES + 1, 0).unwrap_err();
        assert!(error.to_string().contains("inputBytes"));
        let error = measure_byte_reduction(1, MAX_SAFE_BYTES + 1).unwrap_err();
        assert!(error.to_string().contains("outputBytes"));
    }

    #[test]
    fn matches_the_documented_one_megabyte_one_year_range() {
        let estimate =
            estimate_storage_impact(DECIMAL_MEGABYTE, DEFAULT_STORAGE_IMPACT_ASSUMPTIONS_V1)
                .unwrap();
        assert_eq!(estimate.model_version, "1.0.0");
        close(estimate.terabyte_hours, 0.00876, 12);
        close(estimate.energy_watt_hours.min, 0.0062634, 12);
        close(estimate.energy_watt_hours.max, 0.03737016, 10);
        close(estimate.carbon_grams_co2.min, 0.0029625882, 12);
        close(estimate.carbon_grams_co2.max, 0.01767608568, 10);
    }

    #[test]
    fn rejects_physically_invalid_factors_and_overflow() {
        let mut bad_pue = DEFAULT_STORAGE_IMPACT_ASSUMPTIONS_V1;
        bad_pue.factors.pue = NumberRange::new(0.9, 1.1);
        assert!(create_storage_impact_assumptions(bad_pue)
            .unwrap_err()
            .to_string()
            .contains("pue.min"));
        let mut inverted = DEFAULT_STORAGE_IMPACT_ASSUMPTIONS_V1;
        inverted.factors.replication_factor = NumberRange::new(2.0, 1.0);
        assert!(create_storage_impact_assumptions(inverted)
            .unwrap_err()
            .to_string()
            .contains("cannot exceed"));
        let mut huge = DEFAULT_STORAGE_IMPACT_ASSUMPTIONS_V1;
        huge.retention_days = f64::MAX;
        let error = estimate_storage_impact(MAX_SAFE_BYTES, huge).unwrap_err();
        assert!(error.to_string().contains("numeric range"));
    }

    #[test]
    fn marks_confirmed_and_hypothetical_replacement_differently() {
        let confirmed = calculate_conversion_impact(
            true,
            12_400_000,
            3_100_000,
            ReplacementStatus::Confirmed,
            DEFAULT_STORAGE_IMPACT_ASSUMPTIONS_V1,
        )
        .unwrap();
        let hypothetical = calculate_conversion_impact(
            true,
            12_400_000,
            3_100_000,
            ReplacementStatus::Hypothetical,
            DEFAULT_STORAGE_IMPACT_ASSUMPTIONS_V1,
        )
        .unwrap();
        assert!(matches!(
            confirmed,
            ConversionImpactResult::Estimate {
                basis: ReplacementStatus::Confirmed,
                ..
            }
        ));
        assert!(matches!(
            hypothetical,
            ConversionImpactResult::Estimate {
                basis: ReplacementStatus::Hypothetical,
                ..
            }
        ));
    }

    #[test]
    fn refuses_claims_for_retained_incomparable_and_larger_outputs() {
        let retained = calculate_conversion_impact(
            true,
            200,
            100,
            ReplacementStatus::Retained,
            DEFAULT_STORAGE_IMPACT_ASSUMPTIONS_V1,
        )
        .unwrap();
        assert!(matches!(
            retained,
            ConversionImpactResult::Unavailable {
                reason: UnavailableReason::OriginalRetained,
                ..
            }
        ));
        let incomparable = calculate_conversion_impact(
            false,
            200,
            100,
            ReplacementStatus::Hypothetical,
            DEFAULT_STORAGE_IMPACT_ASSUMPTIONS_V1,
        )
        .unwrap();
        assert!(matches!(
            incomparable,
            ConversionImpactResult::Unavailable {
                reason: UnavailableReason::NotComparable,
                ..
            }
        ));
        let larger = calculate_conversion_impact(
            true,
            100,
            120,
            ReplacementStatus::Hypothetical,
            DEFAULT_STORAGE_IMPACT_ASSUMPTIONS_V1,
        )
        .unwrap();
        assert!(matches!(
            larger,
            ConversionImpactResult::Unavailable {
                reason: UnavailableReason::NoReduction,
                ..
            }
        ));
    }

    #[test]
    fn keeps_a_one_megabyte_one_year_hypothetical_visible_in_milligrams() {
        let estimate =
            estimate_storage_impact(DECIMAL_MEGABYTE, scenario_assumptions(365, 0).unwrap())
                .unwrap();
        assert_eq!(
            format_impact_range(estimate.carbon_grams_co2, ImpactQuantity::Carbon).unwrap(),
            "2.96–17.7 mg CO₂"
        );
        assert_eq!(
            format_impact_range(estimate.energy_watt_hours, ImpactQuantity::Energy).unwrap(),
            "0.00626–0.0374 Wh"
        );
        assert_ne!(
            format_impact_range(NumberRange::new(1e-9, 2e-9), ImpactQuantity::Carbon).unwrap(),
            "0 mg CO₂"
        );
    }

    #[test]
    fn fixed_copy_count_does_not_compound_default_replication() {
        let one = estimate_storage_impact(DECIMAL_MEGABYTE, scenario_assumptions(365, 1).unwrap())
            .unwrap();
        let three =
            estimate_storage_impact(DECIMAL_MEGABYTE, scenario_assumptions(365, 3).unwrap())
                .unwrap();
        close(
            three.energy_watt_hours.max,
            one.energy_watt_hours.max * 3.0,
            12,
        );
        assert_eq!(scenario_assumptions(0, 0).unwrap().retention_days, 0.0);
    }

    #[test]
    fn rejects_out_of_bounds_scenario_values_and_ranges() {
        assert!(scenario_assumptions(3651, 1).is_err());
        assert!(scenario_assumptions(365, 4).is_err());
        assert!(
            format_impact_range(NumberRange::new(1.0, f64::INFINITY), ImpactQuantity::Energy)
                .is_err()
        );
        assert!(format_impact_range(NumberRange::new(2.0, 1.0), ImpactQuantity::Carbon).is_err());
        for text in ["", " ", "-1", "1.5", "abc", "3651", "1e3"] {
            assert_eq!(parse_scenario_days(text), None, "{text:?}");
        }
        assert_eq!(parse_scenario_days(" 365 "), Some(365));
        assert_eq!(parse_scenario_days("0"), Some(0));
        assert_eq!(parse_scenario_days("3650"), Some(3650));
    }

    #[test]
    fn summary_deducts_larger_outputs_and_rejects_unsafe_totals() {
        let (measurement, count) = summarize_measurements([(1000, 100), (100, 1200)])
            .unwrap()
            .unwrap();
        assert_eq!(count, 2);
        assert_eq!(measurement.byte_difference, -200);
        assert_eq!(measurement.saved_bytes, 0);
        assert!(summarize_measurements(std::iter::empty())
            .unwrap()
            .is_none());
        let error = summarize_measurements([(MAX_SAFE_BYTES, 1), (1, 1)]).unwrap_err();
        assert!(error.to_string().contains("numeric range"));
    }

    #[test]
    fn model_metadata_is_versioned_and_source_linked() {
        assert_eq!(
            STORAGE_IMPACT_MODEL_V1.id,
            "imgconvert.storage-operational-impact"
        );
        assert_eq!(STORAGE_IMPACT_MODEL_V1.sources.len(), 2);
    }

    #[test]
    fn significant_digit_formatting_matches_intl() {
        assert_eq!(format_significant(2.9625882, 3), "2.96");
        assert_eq!(format_significant(17.67608568, 3), "17.7");
        assert_eq!(format_significant(0.0062634, 3), "0.00626");
        assert_eq!(format_significant(1230.0, 3), "1,230");
        assert_eq!(format_significant(12345.0, 3), "12,300");
        assert_eq!(format_significant(1_234_567.0, 3), "1,230,000");
        assert_eq!(format_significant(100.0, 3), "100");
        assert_eq!(
            format_significant(1.125, 3),
            "1.13",
            "half rounds away from zero"
        );
        assert_eq!(format_significant(9.996, 3), "10");
        assert_eq!(format_significant(999.6, 3), "1,000");
        assert_eq!(format_significant(0.5, 3), "0.5");
        assert_eq!(format_significant(-2.5, 2), "-2.5");
        assert_eq!(format_significant(0.0, 3), "0");
        assert_eq!(
            format_impact_range(NumberRange::new(1.0, 1.0004), ImpactQuantity::Energy).unwrap(),
            "1 Wh",
            "equal ends after rounding collapse to one value"
        );
    }

    #[test]
    fn binary_byte_sizes_follow_the_panel_contract() {
        assert_eq!(format_binary_bytes(0), "0 B");
        assert_eq!(format_binary_bytes(512), "512 B");
        assert_eq!(format_binary_bytes(1023), "1,020 B");
        assert_eq!(format_binary_bytes(1024), "1 KiB");
        assert_eq!(format_binary_bytes(1536), "1.5 KiB");
        assert_eq!(format_binary_bytes(126_464), "124 KiB");
        assert_eq!(format_binary_bytes(9_300_000), "8.87 MiB");
    }
}
