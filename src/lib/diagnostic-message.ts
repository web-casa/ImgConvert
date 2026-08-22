// SPDX-License-Identifier: Apache-2.0

/**
 * Returns backend diagnostic detail only in development builds. Production
 * diagnostics retain their localized status while avoiding accidental path or
 * host-data disclosure in the UI.
 */
export function diagnosticDetailForDisplay(
  detail: string | null | undefined,
  isDevelopment: boolean,
  hiddenDetail: string,
): string {
  return isDevelopment && detail ? detail : hiddenDetail;
}
