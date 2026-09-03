export const RASTER_OUTPUT_FORMATS = ["jpeg", "png", "webp", "avif"] as const;
export const IMAGE_INPUT_FORMATS = [...RASTER_OUTPUT_FORMATS, "bmp", "gif", "svg", "pdf"] as const;

export type RasterOutputFormat = (typeof RASTER_OUTPUT_FORMATS)[number];
export type ImageInputFormat = (typeof IMAGE_INPUT_FORMATS)[number];
export type RasterizableInputFormat = Exclude<ImageInputFormat, "pdf">;

const rasterOutputFormats = new Set<string>(RASTER_OUTPUT_FORMATS);
const imageInputFormats = new Set<string>(IMAGE_INPUT_FORMATS);

export function isRasterOutputFormat(value: unknown): value is RasterOutputFormat {
  return typeof value === "string" && rasterOutputFormats.has(value);
}

export function isImageInputFormat(value: unknown): value is ImageInputFormat {
  return typeof value === "string" && imageInputFormats.has(value);
}
