// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

/**
 * 纯格式化助手:从 App.svelte 提取,供各设计变体的区域组件复用。
 * App.svelte 内的同名函数委托到这里,行为完全一致。
 */

import type { RasterOutputFormat } from "@imgconvert/conversion-contract";
import { measureByteReduction } from "@imgconvert/environmental-impact";

import type { FormatMismatchWarning, QueueEntry } from "./queue";

export function formatBytes(bytes: number, numberLocale: string): string {
  if (bytes < 1024) return `${new Intl.NumberFormat(numberLocale).format(bytes)}\u00A0B`;
  const units = ["KiB", "MiB", "GiB"] as const;
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 1 }).format(value)}\u00A0${units[unitIndex]}`;
}

export function formatDimensions(entry: QueueEntry, numberLocale: string): string {
  if (!entry.probe) return "—";
  if (entry.probe.format === "pdf") return `v${entry.probe.version}`;
  const formatter = new Intl.NumberFormat(numberLocale);
  return `${formatter.format(entry.probe.width)} × ${formatter.format(entry.probe.height)}`;
}

export function formatResultDimensions(entry: QueueEntry, numberLocale: string): string {
  if (!entry.result) return "—";
  const formatter = new Intl.NumberFormat(numberLocale);
  return `${formatter.format(entry.result.width)} × ${formatter.format(entry.result.height)}`;
}

export function formatDuration(durationMs: number, numberLocale: string): string {
  const value = durationMs < 1000 ? durationMs : durationMs / 1000;
  const unit = durationMs < 1000 ? "ms" : "s";
  return `${new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 1 }).format(value)}\u00A0${unit}`;
}

export function resultDelta(
  entry: QueueEntry,
  numberLocale: string,
  reductionTemplate: string,
  largerTemplate: string,
  sameSizeLabel: string,
): string {
  if (!entry.result || entry.size === 0) return "";
  const measurement = measureByteReduction(entry.size, entry.result.size);
  if (measurement.byteDifference === 0) return sameSizeLabel;
  const percentage = new Intl.NumberFormat(numberLocale, {
    maximumFractionDigits: 1,
    style: "percent",
  }).format(Math.abs(measurement.byteDifference) / entry.size);
  const template = measurement.byteDifference > 0 ? reductionTemplate : largerTemplate;
  return template
    .replace("{percent}", percentage)
    .replace("{size}", formatBytes(Math.abs(measurement.byteDifference), numberLocale));
}

export function warningText(warning: FormatMismatchWarning, mismatchTemplate: string): string {
  return mismatchTemplate
    .replace("{expected}", warning.expected.toUpperCase())
    .replace("{actual}", warning.actual.toUpperCase());
}

export function outputLabel(format: RasterOutputFormat): string {
  return format === "jpeg" ? "JPEG" : format === "webp" ? "WebP" : format.toUpperCase();
}
