<!-- SPDX-License-Identifier: Apache-2.0 -->

# Real Image Corpus

Place local real-world test images here when you want to seed fuzzing or corpus
smoke tests.

Do not commit the images. Use only files you are allowed to process locally.
`pnpm run fuzz:prepare` imports supported JPEG/PNG/WebP/AVIF/SVG/GIF/BMP files into the
ignored `fuzz/corpus/` directories and writes a local manifest under `target/`.
