# Synthetic test fixtures

These project-owned fixtures contain no user data.

- `minimal.pdf`: one red 72 × 72 point page, copied from the project-generated fuzz seed and checked into this directory so tests work in a clean checkout.
- `animated.png`: a real two-frame 1 × 1 APNG, red then blue, frame delay 1/10 second. PNG chunks are IHDR, acTL (two frames), fcTL (sequence 0), IDAT, fcTL (sequence 1), fdAT (sequence 2), IEND. Each frame uses a filter-0 RGBA8 scanline compressed with zlib; chunks include CRC32.
- `precision16.png`: 16 × 16 RGBA16 PNG, filter-0 rows. Samples are big-endian unsigned 16-bit: red `(x*4093+997)%65536`, green `(y*4073+27113)%65536`, blue `61003`, alpha `32767`. IHDR uses bit depth 16 and color type 6. IDAT is zlib-compressed and all chunks include CRC32. Values deliberately require more than 8 bits and alpha is not opaque.

Binary attributes preserve PDF offsets and PNG bytes across checkouts.
