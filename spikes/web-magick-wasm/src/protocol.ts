export const RASTER_FORMATS = ["jpeg", "png", "webp", "avif"] as const;

export type RasterFormat = (typeof RASTER_FORMATS)[number];

export interface EncodedImageSummary {
  bytes: number;
  format: RasterFormat;
  hasAlpha: boolean;
  height: number;
  opaque: boolean;
  profileNames: string[];
  width: number;
}

export interface MatrixCell extends EncodedImageSummary {
  durationMs: number;
  input: RasterFormat;
  output: RasterFormat;
}

export interface MatrixResult {
  delegates: string;
  engineVersion: string;
  features: string;
  initializationMs: number;
  matrix: MatrixCell[];
  sourceBytes: Partial<Record<RasterFormat, number>>;
  supportedFormats: Array<{
    format: string;
    mimeType: string | null;
    supportsMultipleFrames: boolean;
    supportsReading: boolean;
    supportsWriting: boolean;
  }>;
}

export interface NativeDecodeResult {
  error?: string;
  format: RasterFormat;
  height?: number;
  supported: boolean;
  width?: number;
}

export interface BrowserMatrixResult extends MatrixResult {
  nativeDecodes: NativeDecodeResult[];
}

export type WorkerRequest =
  | { bytes: ArrayBuffer; id: number; type: "matrix" }
  | { bytes: ArrayBuffer; id: number; iterations: number; type: "stress" };

export type WorkerSuccess =
  | {
      id: number;
      result: MatrixResult;
      samples: Array<{ bytes: ArrayBuffer; format: RasterFormat }>;
      type: "matrix-result";
    }
  | { completedIterations: number; id: number; type: "stress-result" };

export interface WorkerFailure {
  error: string;
  id: number;
  type: "error";
}

export type WorkerResponse = WorkerFailure | WorkerSuccess;
