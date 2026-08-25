# ImgConvert Privacy Policy

Effective date: August 25, 2026

Chinese version: <https://web-casa.github.io/ImgConvert/privacy/#zh-CN>

## Scope

This policy covers the current official ImgConvert desktop releases. Where a
data practice differs by distribution channel, this policy identifies that
channel specifically. It does not replace the privacy policies of Apple,
Microsoft, GitHub, or your operating-system provider.

ImgConvert is a local image batch-conversion tool. We process data according to
the principles of local-first operation and minimal collection.

## Core commitments

- Image conversion, compression, thumbnail generation, and processing run on
  your device.
- We do not upload or collect your images, file paths, clipboard content, or
  conversion results for us or a third party.
- ImgConvert contains no advertising SDK, behavioral analytics SDK,
  third-party tracking, or account system.
- The Mac App Store and Microsoft Store editions do not enable an in-app
  updater. Their software updates are delivered by the respective store.

## Data we do not collect

ImgConvert does not upload, collect, or transmit the following information to a
third party for image-conversion or analytics purposes:

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

## Apple platform access and HEIC decoding

The Mac App Store edition does not access Apple Music, your Apple Music library,
or your Photos library. It does not request access to contacts, camera,
microphone, or location data.

When you actively select a HEIC file in the Mac App Store edition, ImgConvert
may use the built-in macOS ImageIO framework to decode that selected file on
your device. It does not create HEIC output, bundle an external HEIC/HEVC codec,
or discover third-party codec helpers in that edition.

## Windows HEIC decoding

The Microsoft Store edition does not bundle external HEIC/HEVC codecs and does
not automatically discover third-party helpers. If Microsoft HEIF Image
Extensions or HEVC Video Extensions are installed on your system, ImgConvert may
use Windows system interfaces to read HEIC files. This processing remains local
to your device. ImgConvert does not create HEIC output files.

## Local settings, caches, and temporary files

ImgConvert stores conversion preferences locally. If you actively choose a
custom output directory, its path is stored in local settings for your next use.
On editions that allow a user-selected HEIC helper, that selected helper path
may also be stored locally.

During conversion, ImgConvert may create temporary files, thumbnail caches, and
result-cache records in the local temporary directory or app-data directory.
Result-cache records contain only hashes and file sizes used to verify or reuse
conversion results; they do not contain image bytes or file paths and may remain
after a task completes until you clear them. Temporary files are used only to
complete the current conversion task, and you may delete them at any time.
Settings, caches, and temporary files are never synchronized to a server; you
can disable result reuse in the app. To remove saved settings and cache records,
delete the relevant local app-data or cache directory.

## Metadata handling

Output images do not preserve source metadata by default. Only when you
explicitly enable the Preserve metadata setting does ImgConvert write supported
ICC, EXIF, XMP, or IPTC metadata to the output file.

## Updates and third-party services

The Mac App Store and Microsoft Store editions do not use an in-app update
channel. A separately configured direct-distribution build can contact GitHub
Releases only after you choose to check for or install an update; that connection
is governed by GitHub's privacy practices and does not upload your images or
conversion data.

Apart from that optional, user-initiated direct-update connection, ImgConvert
does not call third-party network services for app operation. It does not include
analytics, advertising, crash reporting, or remote-configuration services.

## Children's privacy

ImgConvert does not provide targeted content for children and does not actively
collect personal information from any user.

## Policy updates

If our data practices change, we will update this policy and its effective date
before releasing the affected version.

## Contact

For support or questions about this policy, use the project issue tracker:

<https://github.com/web-casa/ImgConvert/issues>
