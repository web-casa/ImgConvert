<!-- SPDX-License-Identifier: Apache-2.0 -->

# UI redesign image provenance

Generated with the built-in `imagegen` tool on 2026-08-31. The source images were used as visual and
feature references, not as edit targets.

## `ui-redesign-reference-v1.png`

References:

- `/home/ivmm/jietu/099.png`: desired visual/layout direction.
- `docs/assets/screenshots/main-workspace.png`: current ImgConvert feature inventory.

Final prompt:

```text
Use case: ui-mockup
Asset type: high-fidelity desktop application redesign reference for ImgConvert
Input images: Image 1 is the desired visual/layout reference only; Image 2 is the current ImgConvert
application and feature inventory. Generate a new interface, do not merely edit either screenshot.
Primary request: Design a shippable 16:10 desktop UI for a local-first batch image converter.
Preserve the practical workflow and controls from Image 2 while adopting Image 1's warm, calm,
premium visual language.
Layout: compact top toolbar with app icon, ImgConvert, green Core ready status,
theme/language/settings/info actions; main area split roughly 68/32. Left side has a compact dashed
import zone at top and a dense vertical queue underneath with three realistic image rows,
thumbnails, dimensions/file size, source-to-target format, per-item preview action, and clear status.
Right side is one unified conversion settings surface: workflow preset dropdown, target format WebP,
quality slider 82, resize toggle with compact rule summary, target file size toggle, privacy metadata
selector, concurrency, existing-file behavior, filename suffix, and a collapsed Advanced settings
row. Fixed bottom action bar contains authorized output destination, honest batch progress/status
summary (no fake predicted savings), Clear, and a prominent Start conversion button with count 3.
Style/medium: realistic production desktop UI, not concept art; warm off-white background, subtle
peach-tinted borders, single coral-orange accent, navy text, restrained green success, almost no drop
shadows, crisp Solar-style line icons, varied radii with tighter inner controls; comfortable but
information-dense.
Typography: modern humanist sans-serif, strong hierarchy, tabular numbers.
Text (verbatim where practical): "ImgConvert", "Core ready", "Drop images or folders",
"Choose images", "Choose folder", "Paste screenshot", "File queue", "Conversion settings",
"Web sharing", "Target format", "WebP", "Quality 82", "Resize", "Target size",
"Privacy metadata", "Color only", "Concurrency", "Auto", "Existing files", "Skip",
"Advanced settings", "Output to", "Clear", "Start conversion", "3 files".
Constraints: show one coherent app window only; no sidebar; no browser chrome; no marketing sections;
no glassmorphism; no purple or blue gradient; no fake savings estimate; no charts; no logos beyond
ImgConvert; no watermark; controls must look implementable in Svelte/Tailwind; preserve generous
touch targets and accessible contrast.
```

## `src/lib/assets/dropzone-upload-v2.png`

The final file is a 768x512 RGBA resize of the generated cutout. Alpha was checked after generation.

Generation prompt:

```text
Use case: stylized-concept
Asset type: transparent empty-state/drop-zone illustration for the ImgConvert desktop app
Input images: the supplied and generated UI mockups are style references only. Generate a new
standalone illustration, not a screenshot and not an edit.
Primary request: A compact premium upload illustration: one upright photo tile with a warm coral
mountain-and-sun picture, a soft cream cloud in front containing a coral upward arrow, a shallow
peach oval platform underneath, and two very small restrained green leaf sprigs at the sides.
Style/medium: clean soft 3D clay/vector hybrid suitable for a production desktop UI; crisp silhouette;
subtle depth; no photorealism.
Composition/framing: single centered object cluster, roughly 4:3, generous transparent padding,
readable at 180-240 CSS pixels.
Lighting/mood: soft upper-left studio light, calm and welcoming.
Color palette: coral orange, peach, warm cream, muted sage green, tiny navy edge accents only if
needed.
Materials/textures: matte ceramic/plastic, extremely subtle grain.
Constraints: genuinely transparent background with alpha; no panel, no border, no text, no logo, no
watermark, no UI controls or full app window.
```

Background correction prompt:

```text
Use case: background-extraction
Asset type: production drop-zone illustration
Input images: Image 1 is the edit target.
Primary request: Remove only the checkerboard/background and return the illustration as a clean
cutout on a genuinely transparent background with alpha.
Constraints: preserve the photo tile, coral mountains and sun, cloud, upload arrow, peach platform,
green leaves, exact composition, colors, lighting, proportions, soft object shadows, and clean edges;
change only the background; no checkerboard pixels; no white rectangle; no text; no watermark;
transparent pixels outside the object cluster.
```
