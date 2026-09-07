import {
  WEB_V1_DESKTOP_LIMITS,
  type ConversionSettings,
  type RasterOutputFormat,
} from "@imgconvert/conversion-contract";
import type { RasterCodecAdapter } from "@imgconvert/web-image-engine";
import avifEncoderModuleFactory from "@jsquash/avif/codec/enc/avif_enc.js";
import type { AVIFModule } from "@jsquash/avif/codec/enc/avif_enc.js";
import avifEncoderWasmUrl from "@jsquash/avif/codec/enc/avif_enc.wasm?url";
import { defaultOptions as defaultAvifOptions } from "@jsquash/avif/meta.js";

import { retryableLazy } from "./retryable-lazy.js";

async function decodeBmp(bytes: ArrayBuffer): Promise<ImageData> {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/bmp" }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  try {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("BMP canvas context is unavailable.");
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
    canvas.width = 1;
    canvas.height = 1;
  }
}

async function decodeGif(bytes: ArrayBuffer): Promise<ImageData> {
  const { decompressFrames, parseGIF } = await import("gifuct-js");
  const parsed = parseGIF(bytes);
  const frames = decompressFrames(parsed, true);
  if (frames.length !== 1) throw new Error("GIF must contain exactly one image frame.");
  const frame = frames[0];
  if (!frame) throw new Error("GIF decoder returned no frame.");
  const { height, width } = parsed.lsd;
  const { height: frameHeight, left, top, width: frameWidth } = frame.dims;
  const logicalPixels = width * height;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    !Number.isSafeInteger(logicalPixels) ||
    width < 1 ||
    height < 1 ||
    logicalPixels > WEB_V1_DESKTOP_LIMITS.maxRuntimePixels ||
    frameWidth < 1 ||
    frameHeight < 1 ||
    left < 0 ||
    top < 0 ||
    left + frameWidth > width ||
    top + frameHeight > height ||
    frame.patch.byteLength !== frameWidth * frameHeight * 4
  ) {
    throw new Error("GIF decoder returned invalid frame dimensions.");
  }

  const pixels = new Uint8ClampedArray(width * height * 4);
  const hasTransparency = Number.isInteger(frame.transparentIndex);
  const background = parsed.gct[parsed.lsd.backgroundColorIndex];
  if (!hasTransparency && background) {
    for (let offset = 0; offset < pixels.byteLength; offset += 4) {
      pixels[offset] = background[0];
      pixels[offset + 1] = background[1];
      pixels[offset + 2] = background[2];
      pixels[offset + 3] = 255;
    }
  }
  for (let y = 0; y < frameHeight; y += 1) {
    for (let x = 0; x < frameWidth; x += 1) {
      const sourceOffset = (y * frameWidth + x) * 4;
      if (frame.patch[sourceOffset + 3] === 0) continue;
      const destinationOffset = ((top + y) * width + left + x) * 4;
      pixels.set(frame.patch.subarray(sourceOffset, sourceOffset + 4), destinationOffset);
    }
  }
  return new ImageData(pixels, width, height);
}

const ensureAvifEncoder = retryableLazy(
  () =>
    avifEncoderModuleFactory({
      locateFile: () => new URL(avifEncoderWasmUrl, location.href).href,
      noInitialRun: true,
    }) as Promise<AVIFModule>,
);

export const rasterCodecs: RasterCodecAdapter = {
  async decode(format, bytes) {
    switch (format) {
      case "jpeg": {
        const { default: decode } = await import("@jsquash/jpeg/decode.js");
        return decode(bytes, { preserveOrientation: true });
      }
      case "png": {
        const { default: decode } = await import("@jsquash/png/decode.js");
        return decode(bytes);
      }
      case "webp": {
        const { default: decode } = await import("@jsquash/webp/decode.js");
        return decode(bytes);
      }
      case "avif": {
        const { default: decode } = await import("@jsquash/avif/decode.js");
        const image = await decode(bytes);
        if (!image) throw new Error("AVIF decoder returned no pixels.");
        return image;
      }
      case "bmp":
        return decodeBmp(bytes);
      case "gif":
        return decodeGif(bytes);
    }
  },
  async encode(
    format: RasterOutputFormat,
    image: ImageData,
    settings: ConversionSettings,
  ): Promise<ArrayBuffer> {
    switch (format) {
      case "jpeg": {
        const { default: encode } = await import("@jsquash/jpeg/encode.js");
        return encode(image, { quality: settings.quality ?? 82 });
      }
      case "png": {
        const { default: encode } = await import("@jsquash/png/encode.js");
        return encode(image);
      }
      case "webp": {
        const { default: encode } = await import("@jsquash/webp/encode.js");
        return encode(image, {
          exact: 1,
          lossless: settings.lossless ? 1 : 0,
          quality: settings.quality ?? 100,
        });
      }
      case "avif": {
        const module = await ensureAvifEncoder();
        const { lossless: _lossless, ...encoderDefaults } = defaultAvifOptions;
        const output = module.encode(image.data, image.width, image.height, {
          ...encoderDefaults,
          quality: settings.lossless ? 100 : (settings.quality ?? 82),
          speed: 8,
          subsample: settings.lossless ? 3 : 1,
        });
        if (!output) throw new Error("AVIF encoder returned no bytes.");
        return new Uint8Array(output).slice().buffer;
      }
    }
  },
};
