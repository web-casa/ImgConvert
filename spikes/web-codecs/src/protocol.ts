export const RASTER_FORMATS = ["jpeg", "png", "webp", "avif"] as const;

export type RasterFormat = (typeof RASTER_FORMATS)[number];

export interface CodecDescriptor {
  format: RasterFormat;
  implementation: string;
  packageName: string;
  version: string;
}

export interface EncodedImageSummary {
  bytes: number;
  format: RasterFormat;
  hasAlpha: boolean;
  height: number;
  metadataMarkerPresent: boolean;
  opaque: boolean;
  width: number;
}

export interface MatrixCell extends EncodedImageSummary {
  durationMs: number;
  input: RasterFormat;
  output: RasterFormat;
}

export interface MatrixResult {
  codecs: CodecDescriptor[];
  coldStartMs: number;
  matrix: MatrixCell[];
  sourceBytes: Record<RasterFormat, number>;
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

export interface BenchmarkResult extends EncodedImageSummary {
  durationMs: number;
  inputBytes: number;
  iterations: number;
  output: RasterFormat;
}

export type WorkerRequest =
  | {
      bytes: ArrayBuffer;
      id: number;
      iterations: number;
      output: RasterFormat;
      type: "benchmark";
    }
  | { bytes: ArrayBuffer; id: number; type: "matrix" }
  | { bytes: ArrayBuffer; id: number; iterations: number; type: "stress" };

export type WorkerSuccess =
  | { id: number; result: BenchmarkResult; type: "benchmark-result" }
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
