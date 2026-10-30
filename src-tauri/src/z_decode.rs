//! Unix compress decoder adapted from newtua-lzw-z 0.1.0.
//! Copyright (c) 2026 The Newtua Authors, MIT license; see
//! ../licenses/newtua-lzw-z-LICENSE-MIT. Code-group alignment and dictionary
//! semantics are unchanged. Whole-code reads replace the per-bit loop, and
//! callers decode directly from a slice without the Read-adapter copies.

use lzw_z::Error;

const MAGIC: [u8; 2] = [0x1f, 0x9d];
const BLOCK_MODE_FLAG: u8 = 0x80;
const MAXBITS_MASK: u8 = 0x1f;
const INIT_BITS: u32 = 9;
const MAX_MAXBITS: u32 = 16;
const CLEAR: u32 = 256;

/// Decode a complete `.Z` byte stream (magic included).
pub(crate) fn decompress(input: &[u8]) -> Result<Vec<u8>, Error> {
    // `compress` encodes empty input as an empty file.
    if input.is_empty() {
        return Ok(Vec::new());
    }
    if input.len() < 2 {
        return Err(Error::Truncated);
    }
    if input[0] != MAGIC[0] || input[1] != MAGIC[1] {
        return Err(Error::BadMagic);
    }
    if input.len() < 3 {
        return Err(Error::Truncated);
    }
    let flags = input[2];
    let block_mode = (flags & BLOCK_MODE_FLAG) != 0;
    let maxbits = (flags & MAXBITS_MASK) as u32;
    if !(INIT_BITS..=MAX_MAXBITS).contains(&maxbits) {
        return Err(Error::BadMaxBits);
    }
    decode_codes(&input[3..], block_mode, maxbits)
}

/// Read `n_bits` bits at absolute bit offset `bitpos` from `data`, LSB-first.
/// Returns `None` if fewer than `n_bits` bits remain.
fn read_code(data: &[u8], total_bits: u64, bitpos: u64, n_bits: u32) -> Option<u32> {
    if bitpos + n_bits as u64 > total_bits {
        return None;
    }
    let byte = (bitpos >> 3) as usize;
    let shift = (bitpos & 7) as u32;
    // At most 16 bits starting at bit 7 need three input bytes. The total-bit
    // check above guarantees the requested code exists, including the tail.
    let word = data[byte] as u32
        | ((data.get(byte + 1).copied().unwrap_or(0) as u32) << 8)
        | ((data.get(byte + 2).copied().unwrap_or(0) as u32) << 16);
    Some((word >> shift) & ((1u32 << n_bits) - 1))
}

/// Advance `bitpos` to the next code-group boundary, mirroring the ncompress
/// encoder's `boff`-relative group alignment.
///
/// ncompress writes (and reads) codes in groups of 8 at the current width.
/// At each code-width change it aligns to the next `n_bits × 8`-bit boundary
/// measured from `boff` — the bit position of the *previous* alignment point.
/// Using `boff = 0` for the first transition and updating it on every transition
/// matches the encoder exactly.
///
/// The formula mirrors the ncompress encoder:
/// ```text
/// p   = bitpos - 1          // position before the last advance
/// rel = p - boff            // offset since the last alignment
/// g   = n_bits × 8         // group size in bits
/// new = p + (g − rel mod g) // start of next group after p
/// ```
/// When `rel` is already a multiple of `g`, this advances by exactly one group,
/// which is correct (the encoder already moved to the next group).
fn align_to_group(bitpos: u64, n_bits: u32, boff: u64) -> u64 {
    debug_assert!(bitpos > 0, "align_to_group requires a prior code read");
    let g = (n_bits as u64) * 8;
    let p = bitpos - 1;
    let rel = p - boff;
    let pad = g - (rel + g) % g;
    p + pad
}

fn decode_codes(data: &[u8], block_mode: bool, maxbits: u32) -> Result<Vec<u8>, Error> {
    let maxmaxcode = 1u32 << maxbits;
    let mut prefix = vec![0u16; maxmaxcode as usize];
    let mut suffix = vec![0u8; maxmaxcode as usize];
    for (i, s) in suffix.iter_mut().enumerate().take(256) {
        *s = i as u8;
    }

    let first_free = if block_mode { CLEAR + 1 } else { 256 };
    let mut free_ent = first_free;
    let mut n_bits = INIT_BITS;
    let mut maxcode = (1u32 << n_bits) - 1;

    let total_bits = (data.len() as u64) * 8;
    let mut bitpos: u64 = 0;
    // `boff` mirrors the ncompress encoder's same-named variable: the bit offset
    // of the most recent group-alignment point (updated on every width change or
    // CLEAR reset).
    let mut boff: u64 = 0;
    let mut out: Vec<u8> = Vec::new();
    // A phrase cannot exceed the number of dictionary entries. Fill this
    // scratch buffer backwards, then append the phrase with one bulk copy.
    let mut stack = vec![0u8; maxmaxcode as usize + 1];

    // The first code is always a literal.
    let mut oldcode = match read_code(data, total_bits, bitpos, n_bits) {
        Some(c) => {
            bitpos += n_bits as u64;
            c
        }
        None => return Ok(out),
    };
    if oldcode >= 256 {
        return Err(Error::InvalidCode);
    }
    let mut finchar = oldcode as u8;
    out.push(finchar);

    'outer: while let Some(raw) = read_code(data, total_bits, bitpos, n_bits) {
        bitpos += n_bits as u64;
        let mut code = raw;

        // Code 256 is CLEAR only in block mode; in non-block mode it is a normal dictionary entry.
        if block_mode && code == CLEAR {
            let new_bp = align_to_group(bitpos, n_bits, boff);
            boff = new_bp;
            bitpos = new_bp;
            free_ent = CLEAR + 1;
            n_bits = INIT_BITS;
            maxcode = (1u32 << n_bits) - 1;
            // The code right after CLEAR is a fresh literal.
            let Some(lit) = read_code(data, total_bits, bitpos, n_bits) else {
                break 'outer;
            };
            bitpos += n_bits as u64;
            if lit >= 256 {
                return Err(Error::InvalidCode);
            }
            oldcode = lit;
            finchar = lit as u8;
            out.push(finchar);
            continue;
        }

        let incode = code;

        // KwKwK: a code one past the table references "oldcode + finchar".
        if code > free_ent {
            return Err(Error::InvalidCode);
        }
        let mut stack_pos = stack.len();
        if code == free_ent {
            stack_pos -= 1; stack[stack_pos] = finchar;
            code = oldcode;
        }

        // Unwind the dictionary entry onto the stack (reverse order).
        while code >= 256 {
            stack_pos -= 1; stack[stack_pos] = suffix[code as usize];
            code = prefix[code as usize] as u32;
        }
        finchar = code as u8;
        stack_pos -= 1; stack[stack_pos] = finchar;
        out.extend_from_slice(&stack[stack_pos..]);

        // Add the new dictionary entry, growing the code width as needed.
        if free_ent < maxmaxcode {
            prefix[free_ent as usize] = oldcode as u16;
            suffix[free_ent as usize] = finchar;
            free_ent += 1;
            if free_ent > maxcode && n_bits < maxbits {
                let new_bp = align_to_group(bitpos, n_bits, boff);
                boff = new_bp;
                bitpos = new_bp;
                n_bits += 1;
                maxcode = if n_bits == maxbits {
                    maxmaxcode
                } else {
                    (1u32 << n_bits) - 1
                };
            }
        }

        oldcode = incode;
    } // 'outer

    Ok(out)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    #[test]
    fn word_reads_match_bitwise_reader_at_all_offsets_and_widths() {
        let data: Vec<u8> = (0..257).map(|i| (i * 73 + 19) as u8).collect();
        let total = data.len() as u64 * 8;
        for width in 9..=16 {
            for offset in 0..=total {
                let expected = if offset + width as u64 > total { None } else {
                    Some((0..width).fold(0u32, |code, bit| {
                        let p = offset + bit as u64;
                        code | ((((data[(p >> 3) as usize] >> (p & 7)) & 1) as u32) << bit)
                    }))
                };
                assert_eq!(read_code(&data, total, offset, width), expected);
            }
        }
    }

    #[test]
    fn public_reference_fixtures_match_original_decoder() {
        let cases: &[(&[u8], &[u8])] = &[
            (include_bytes!("../test-data/lzw/small.Z"), include_bytes!("../test-data/lzw/small.in")),
            (include_bytes!("../test-data/lzw/rep.Z"), include_bytes!("../test-data/lzw/rep.in")),
            (include_bytes!("../test-data/lzw/large.Z"), include_bytes!("../test-data/lzw/large.in")),
            (include_bytes!("../test-data/lzw/large12.Z"), include_bytes!("../test-data/lzw/large.in")),
            (include_bytes!("../test-data/lzw/binary.Z"), include_bytes!("../test-data/lzw/binary.in")),
        ];
        for (compressed, expected) in cases {
            assert_eq!(decompress(compressed).unwrap(), *expected);
            assert_eq!(decompress(compressed).unwrap(), lzw_z::decompress_slice(compressed).unwrap());
        }
        for invalid in [&[0x1f][..], &[0, 1, 0x90], &[0x1f, 0x9d], &[0x1f, 0x9d, 8], &[0x1f, 0x9d, 17]] {
            assert!(decompress(invalid).is_err());
        }
        assert_eq!(decompress(&[0x1f, 0x9d, 0x10, 0x41, 0x84, 0x00]).unwrap(), b"AB");
    }

    /// Valid fixed-nine-bit literal stream, useful for nested ZIP tests.
    pub(crate) fn literal_stream(bytes: &[u8]) -> Vec<u8> {
        let mut out = vec![0x1f, 0x9d, 9];
        let mut word = 0u32; let mut bits = 0;
        for &byte in bytes {
            word |= (byte as u32) << bits; bits += 9;
            while bits >= 8 { out.push(word as u8); word >>= 8; bits -= 8; }
        }
        if bits > 0 { out.push(word as u8); }
        out
    }

    #[test]
    #[ignore = "public-fixture .Z decompression benchmark; run with --ignored --nocapture"]
    fn z_decode_benchmark() {
        let compressed = include_bytes!("../test-data/lzw/large.Z");
        let expected = include_bytes!("../test-data/lzw/large.in");
        for run in 1..=3 {
            let start = std::time::Instant::now();
            let original = lzw_z::decompress_slice(std::hint::black_box(compressed)).unwrap();
            let original_us = start.elapsed().as_micros();
            let start = std::time::Instant::now();
            let optimized = decompress(std::hint::black_box(compressed)).unwrap();
            let optimized_us = start.elapsed().as_micros();
            assert_eq!(optimized, original); assert_eq!(optimized, *expected);
            eprintln!(".Z run {run}: {} -> {} bytes; original={original_us}us optimized={optimized_us}us", compressed.len(), optimized.len());
        }
    }
}

