// SPDX-License-Identifier: Apache-2.0
import {
  measureByteReduction,
  type ByteReductionMeasurement,
} from "@imgconvert/environmental-impact";
export interface DesktopImpactMeasurement {
  readonly measurement: ByteReductionMeasurement;
  readonly comparable: boolean;
}
export function captureDesktopImpact(
  result: {
    input: string;
    inSize: number;
    outSize: number;
    environmentComparable?: boolean;
    outputCount?: number;
    skippedOutputCount?: number;
  },
  expectedInput: string,
): DesktopImpactMeasurement | undefined {
  if (
    result.input !== expectedInput ||
    !Number.isSafeInteger(result.inSize) ||
    !Number.isSafeInteger(result.outSize) ||
    result.inSize <= 0 ||
    result.outSize <= 0
  )
    return undefined;
  return Object.freeze({
    measurement: measureByteReduction(result.inSize, result.outSize),
    comparable:
      result.environmentComparable === true &&
      result.outputCount === 1 &&
      (result.skippedOutputCount ?? 0) === 0,
  });
}
export function summarizeDesktopImpact(
  items: readonly { status: string; impact?: DesktopImpactMeasurement }[],
) {
  const eligible = items.filter(
    (item) => item.status === "done" && item.impact?.comparable === true,
  );
  if (!eligible.length) return undefined;
  const input = eligible.reduce((sum, item) => sum + item.impact!.measurement.inputBytes, 0);
  const output = eligible.reduce((sum, item) => sum + item.impact!.measurement.outputBytes, 0);
  if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output)) return undefined;
  return {
    measurement: measureByteReduction(input, output),
    count: eligible.length,
    excluded: items.filter((item) => item.status === "done").length - eligible.length,
  };
}
