# ImgConvert Privacy Policy

Effective date: August 19, 2026

Chinese version: <https://web-casa.github.io/ImgConvert/privacy/#zh-CN>

ImgConvert is a local image batch-conversion tool. We process data according to
the principles of local-first operation and minimal collection.

## Core commitments

- Image conversion, compression, thumbnail generation, and processing run on
  your device.
- We do not upload or collect your images, file paths, clipboard content, or
  conversion results for us or a third party.
- ImgConvert contains no advertising SDK, behavioral analytics SDK,
  third-party tracking, or account system.
- The Microsoft Store edition does not enable an in-app updater; software
  updates are delivered by Microsoft Store.

## Data we do not collect

ImgConvert does not upload, collect, or transmit the following information to a
third party:

- The content of images you import or convert.
- Image file names, complete paths, or directory structures.
- Images or text in the clipboard.
- Converted output files.
- Image metadata such as EXIF, XMP, ICC, or IPTC.
- Device identifiers, hardware information, system logs, or usage behavior.

## File access and permissions

ImgConvert accesses only files or folders that you actively select when they are
needed:

- Input files authorized through the system file picker.
- The output directory you choose.
- Clipboard images only when you actively choose the clipboard-import feature.

The app does not scan photo libraries, disks, or network locations in the
background.

## Local settings, caches, and temporary files

ImgConvert stores conversion preferences locally. If you actively choose a custom
output directory or a HEIC helper, its path is stored in local settings for your
next use. During conversion, ImgConvert may also create temporary files,
thumbnail caches, and result-cache records in the local temporary directory or
app-data directory. Result-cache records contain only hashes and file sizes used
to verify or reuse conversion results; they do not contain image bytes or file
paths and may remain after a task completes until you clear them. Temporary files
are used only to complete the current conversion task, and you may delete them at
any time. Settings, caches, and temporary files are never synchronized to a
server; you can disable result reuse in the app. To remove saved settings and
cache records, delete the relevant local app-data or cache directory.

## Windows HEIC decoding

The Microsoft Store edition does not bundle external HEIC/HEVC codecs and does
not automatically discover third-party helpers. If Microsoft HEIF Image
Extensions or HEVC Video Extensions are installed on your system, ImgConvert may
use Windows system interfaces to read HEIC files. This processing remains local
to your device. ImgConvert does not create HEIC output files.

## Metadata handling

Output images do not preserve source metadata by default. Only when you
explicitly enable the Preserve metadata setting does ImgConvert write supported
ICC, EXIF, XMP, or IPTC metadata to the output file.

## Children's privacy

ImgConvert does not provide targeted content for children and does not actively
collect personal information from any user.

## Third-party services

The Microsoft Store edition does not call third-party network services. It does
not include analytics, advertising, crash reporting, or remote-configuration
services.

## Policy updates

If our data practices change, we will update this policy and its effective date
before releasing the affected version.

## Contact

For questions about this policy, open an issue in the project repository:

<https://github.com/web-casa/ImgConvert/issues>
