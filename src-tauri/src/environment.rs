// SPDX-License-Identifier: Apache-2.0
use imgconvert_core::Format;

/// Called only after the existing core probe succeeds. No decoding, allocation or additional I/O.
/// AVIF/HEIC are deliberately excluded until sequence information is carried by their decoders.
pub(crate) fn comparable_static_source(bytes: &[u8]) -> bool {
    match Format::from_magic(bytes) {
        Some(Format::Jpeg | Format::Bmp | Format::WebP) => true,
        Some(Format::Png) => static_png(bytes),
        _ => false,
    }
}

fn static_png(bytes: &[u8]) -> bool {
    let mut offset = 8usize;
    for _ in 0..10_000 {
        let Some(header) = bytes.get(offset..offset.saturating_add(8)) else {
            return false;
        };
        let length = u32::from_be_bytes(header[..4].try_into().unwrap()) as usize;
        let Some(end) = offset
            .checked_add(12)
            .and_then(|start| start.checked_add(length))
        else {
            return false;
        };
        if end > bytes.len() {
            return false;
        }
        match &header[4..8] {
            b"acTL" | b"fcTL" | b"fdAT" => return false,
            b"IEND" => return length == 0 && end == bytes.len(),
            _ => offset = end,
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    fn chunk(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
        let mut bytes = (data.len() as u32).to_be_bytes().to_vec();
        bytes.extend_from_slice(kind);
        bytes.extend_from_slice(data);
        bytes.extend_from_slice(&[0; 4]); // CRC validation remains the converter's responsibility.
        bytes
    }
    #[test]
    fn png_animation_and_truncation_fail_closed() {
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        bytes.extend(chunk(b"IDAT", &[1, 2, 3]));
        bytes.extend(chunk(b"IEND", &[]));
        assert!(comparable_static_source(&bytes));
        let mut animated = b"\x89PNG\r\n\x1a\n".to_vec();
        animated.extend(chunk(b"acTL", &[0; 8]));
        animated.extend_from_slice(&bytes[8..]);
        assert!(!comparable_static_source(&animated));
        for length in 0..bytes.len() {
            assert!(!comparable_static_source(&bytes[..length]));
        }
        bytes.extend([0]);
        assert!(!comparable_static_source(&bytes));
        assert!(!comparable_static_source(b"%PDF-1.7"));
        assert!(!comparable_static_source(b"GIF89a"));
    }
    #[test]
    fn oversized_chunks_do_not_overflow() {
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        bytes.extend_from_slice(&u32::MAX.to_be_bytes());
        bytes.extend_from_slice(b"IDAT");
        assert!(!comparable_static_source(&bytes));
    }
}
