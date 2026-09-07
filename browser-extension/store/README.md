# Browser-extension store draft

This directory contains the EXT-008 local draft for Chrome Web Store and Microsoft Edge Add-ons,
plus the EXT-009 pre-release evidence workflow. It does not authorize creating a listing, uploading
a package, submitting certification, or publishing.

## Reproduce

From the repository root:

```bash
pnpm extension:store:prepare
```

The preparation command:

1. renders the padded package/store icons and text-free promo art from the existing product icon;
2. builds both vendor packages with the HTTPS-only permission boundary;
3. launches the actual packaged Chrome build, imports two controlled repository images, converts
   them, and captures five 1280×800 screenshots per locale;
4. creates and structurally validates the Chrome and Edge ZIPs;
5. runs the npm license policy and generated-attribution check;
6. writes candidate ZIPs, `SHA256SUMS`, manifest comparison, inventories, and release evidence under
   ignored `.output/store-candidate/v0.3.4/`;
7. validates copy, dimensions, hashes, permissions, packages, and candidate evidence fail closed.

On Linux without an active display, the orchestrator uses `xvfb-run`. The HTTPS web-image smoke
fixture also requires OpenSSL, but store screenshots never make an HTTP(S) request.

## Asset provenance

`assets/v0.3.4/provenance.json` records the actual Chromium executable identity, packaged build
fingerprint, the product-icon and screenshot-input source hashes, and every generated asset hash.
The screenshot inputs are existing repository marketing images used only as controlled local
conversion inputs. Product screenshots are full-bleed captures of the running extension; promo
tiles contain no synthetic product UI.

`packaging/store-assets/v0.3.1/` is a separate desktop MAS/Microsoft Store workflow and is not read,
rewritten, or represented as browser-extension evidence.

## EXT-009 evidence and freeze

After `store:prepare`, run the production dependency audit, both decisions in both vendor browsers,
and the privacy verifier against the exact Cloudflare deployment being accepted. The native prompt
commands are intentionally interactive.

```bash
pnpm --dir browser-extension store:audit
pnpm --dir browser-extension smoke:web-import:chrome
pnpm --dir browser-extension smoke:web-import:chrome:deny
pnpm --dir browser-extension smoke:web-import:edge
pnpm --dir browser-extension smoke:web-import:edge:deny
pnpm --dir browser-extension store:privacy:verify -- --base-url=https://imgconvert.web.casa --environment=production --deployment-id=<uuid>
pnpm --dir browser-extension store:finalize -- --deployment-id=<uuid>
```

Reports remain under `.output/reports/`. Finalization reruns the full draft check and rejects a
changed build fingerprint, lockfile, package, source document, vendor identity/decision, privacy
environment, or deployment ID. A successful freeze still leaves publisher identity and every store
dashboard mutation as explicit external gates.

As of 2026-09-04, Chrome/Edge 152 Allow/Deny results belong to the earlier 0.3.1 candidate. The
0.3.2 Service Worker fix and 0.3.3 metadata correction change the build fingerprint, so both vendor
matrices must be rerun. The
updated bilingual privacy pages pass at the isolated Cloudflare Preview deployment, while the
canonical production pages still lack the extension disclosure; therefore no `final-evidence.json`
may claim a frozen production-ready candidate yet.

On 2026-09-06, version 0.3.3 updates both packaged summaries and both store descriptions after the
publisher-reported Yellow Argon rejection of 0.3.2. Use the versioned 0.3.3 ZIPs; the 0.3.2 files
remain historical artifacts. Rebuilding and validating the local candidate does not submit it to
either store or refresh production privacy and vendor permission-prompt evidence.

## 0.3.4 environmental scenarios

The new local candidate adds optional storage scenarios and offline methodology after conversion.
These are estimates, not measured savings. Permission declarations are unchanged. Versioned 0.3.3
ZIPs and assets remain separate historical submission materials. See
[the extension implementation review](../../docs/ENVIRONMENTAL_IMPACT_EXTENSION_REVIEW.md) for
current validation and the remaining vendor-browser/publication checks.
