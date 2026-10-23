#!/usr/bin/env python3
"""Generates the ImgConvert "pixel half-circle" logo masters as SVG.

Left half: the disc rasterised into square pixels (a bitmap); right half: the
same disc as a smooth gradient (the converted image). Writes six files into
the directory given as the only argument.
"""
import math
import sys
from pathlib import Path

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)

BLUE_TOP, BLUE_BOTTOM = "#7fd6ff", "#1670f0"
LEVELS = 4


def mix(a, b, t):
    """Linear blend of two #rrggbb colours."""
    ca = [int(a[i:i + 2], 16) for i in (1, 3, 5)]
    cb = [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(x + (y - x) * t):02x}" for x, y in zip(ca, cb))


def pixel_colour(t, odd):
    """The smooth half's colour at height t, quantised like a low-depth bitmap,
    with alternate pixels a touch lighter so the grid reads."""
    level = min(LEVELS - 1, int(t * LEVELS))
    base = mix(BLUE_TOP, BLUE_BOTTOM, level / (LEVELS - 1))
    return mix(base, "#ffffff", 0.16 if odd else 0.0)


def disc(cx, cy, r, rows, prefix, divider):
    """The split disc centred at (cx, cy) with radius r, `rows` pixel rows."""
    cell = 2 * r / rows
    parts = [
        f'<path d="M{cx} {cy - r} A{r} {r} 0 0 1 {cx} {cy + r} Z" fill="url(#{prefix}-drop)"/>',
        # A soft highlight on the smooth half.
        f'<path d="M{cx + r * 0.22:.1f} {cy - r * 0.82:.1f} A{r * 0.86:.1f} {r * 0.86:.1f} 0 0 1 {cx + r * 0.84:.1f} {cy - r * 0.18:.1f}" '
        f'fill="none" stroke="#ffffff" stroke-opacity="0.45" stroke-width="{r * 0.07:.1f}" stroke-linecap="round"/>',
    ]
    for row in range(rows):
        y0 = cy - r + row * cell
        mid = y0 + cell / 2
        half = math.sqrt(max(r * r - (mid - cy) ** 2, 0))
        cols = max(1, round(half / cell))
        for col in range(cols):
            x0 = cx - (col + 1) * cell
            shade = pixel_colour((mid - (cy - r)) / (2 * r), (row + col) % 2 == 1)
            parts.append(
                f'<rect x="{x0:.1f}" y="{y0:.1f}" width="{cell + 0.6:.1f}" height="{cell + 0.6:.1f}" fill="{shade}"/>'
            )
    parts.append(
        f'<rect x="{cx - divider / 2:.1f}" y="{cy - r:.1f}" width="{divider:.1f}" height="{2 * r:.1f}" fill="#ffffff"/>'
    )
    return "\n".join(parts)


def gradients(prefix):
    return f"""<linearGradient id="{prefix}-tile" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#fbfcfe"/><stop offset="1" stop-color="#dfe6f1"/></linearGradient>
<linearGradient id="{prefix}-drop" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="{BLUE_TOP}"/><stop offset="1" stop-color="{BLUE_BOTTOM}"/></linearGradient>"""


def tile(x, y, size, prefix):
    radius = size * 0.225
    edge = max(size * 0.004, 1)
    return f"""<rect x="{x}" y="{y}" width="{size}" height="{size}" rx="{radius:.1f}" fill="url(#{prefix}-tile)"/>
<rect x="{x + edge / 2:.1f}" y="{y + edge / 2:.1f}" width="{size - edge:.1f}" height="{size - edge:.1f}" rx="{radius - edge / 2:.1f}" fill="none" stroke="#0f1624" stroke-opacity="0.08" stroke-width="{edge:.1f}"/>
<rect x="{x + edge * 2:.1f}" y="{y + edge * 2:.1f}" width="{size - edge * 4:.1f}" height="{size - edge * 4:.1f}" rx="{radius - edge * 2:.1f}" fill="none" stroke="#ffffff" stroke-opacity="0.9" stroke-width="{edge * 2:.1f}"/>"""


def svg(body, defs, size=1024):
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">
<title>ImgConvert</title>
<defs>
{defs}
</defs>
{body}
</svg>
"""


# Full-bleed app icon (Windows, Linux, web): the tile fills the canvas.
(OUT / "logo.svg").write_text(svg(tile(0, 0, 1024, "a") + "\n" + disc(512, 512, 340, 12, "a", 16), gradients("a")))

# Small sizes (32 px and below): fewer, larger pixels and a wider gap.
(OUT / "logo-small.svg").write_text(svg(tile(0, 0, 1024, "s") + "\n" + disc(512, 512, 360, 6, "s", 44), gradients("s")))

# macOS: an 824 px tile on the 1024 grid with a soft shadow.
shadow = """<filter id="m-shadow" x="-20%" y="-20%" width="140%" height="140%">
<feGaussianBlur in="SourceAlpha" stdDeviation="14"/><feOffset dy="10" result="b"/>
<feComponentTransfer><feFuncA type="linear" slope="0.28"/></feComponentTransfer>
<feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>"""
(OUT / "logo-macos.svg").write_text(svg(
    '<g filter="url(#m-shadow)">' + tile(100, 100, 824, "m") + "</g>\n" + disc(512, 512, 275, 12, "m", 13),
    gradients("m") + "\n" + shadow,
))

# macOS at 32 px and below: the same frame with the coarse disc.
(OUT / "logo-macos-small.svg").write_text(svg(
    '<g filter="url(#m-shadow)">' + tile(100, 100, 824, "m") + "</g>\n" + disc(512, 512, 290, 6, "m", 36),
    gradients("m") + "\n" + shadow,
))

# The mark alone, without a tile (title bar, website header).
(OUT / "logo-mark.svg").write_text(svg(disc(512, 512, 470, 8, "k", 36), gradients("k")))

# The mark at title-bar size (about 28 px): fewer pixels and a wider gap.
(OUT / "logo-mark-small.svg").write_text(svg(disc(512, 512, 480, 5, "q", 80), gradients("q")))
print("\n".join(sorted(p.name for p in OUT.glob("*.svg"))))
