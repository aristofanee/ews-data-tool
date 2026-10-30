use crate::{dataset::Imported, stdf};
use std::{fs::File, io::{Read, Seek}, path::Path};
use zip::ZipArchive;

fn is_stdf_member(name: &str) -> bool {
    let normalized = name.replace('\\', "/");
    let parts: Vec<_> = normalized.split('/').collect();
    let base = parts.last().copied().unwrap_or("");
    if base.is_empty() || base.starts_with("._") || parts.contains(&"__MACOSX") { return false; }
    matches!(base.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str(), "stdf" | "std" | "z")
}

/// Process one member at a time in archive order. Member paths are provenance
/// labels only: nothing is extracted to disk, including nested folder names.
pub fn import_zip(path: &Path, progress: &mut dyn FnMut(f32, &str), append: &mut dyn FnMut(String, Imported)) -> Result<(), String> {
    let file = File::open(path).map_err(|e| format!("Cannot open ZIP {}: {e}", path.display()))?;
    import_zip_reader(file, &path.display().to_string(), progress, append)
}

fn import_zip_reader<R: Read + Seek>(reader: R, source: &str, progress: &mut dyn FnMut(f32, &str), append: &mut dyn FnMut(String, Imported)) -> Result<(), String> {
    let mut archive = ZipArchive::new(reader).map_err(|e| format!("Cannot read ZIP {source}: {e}"))?;
    let members: Vec<_> = (0..archive.len()).filter_map(|index| {
        archive.name_for_index(index).filter(|name| is_stdf_member(name)).map(|name| (index, name.to_owned()))
    }).collect();
    if members.is_empty() { return Err(format!("ZIP {source} contains no .stdf, .std or .Z files")); }
    let count = members.len() as f32;
    for (position, (index, name)) in members.into_iter().enumerate() {
        let label = format!("{source}!{name}");
        let base = position as f32 * 100.0 / count;
        let span = 100.0 / count;
        progress(base, &format!("Reading ZIP member: {name}"));
        let mut entry = archive.by_index(index).map_err(|e| format!("Cannot open {label}: {e}"))?;
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).map_err(|e| format!("Cannot read {label}: {e}"))?;
        let mut member_progress = |pct: f32, message: &str| progress(base + span * (0.05 + pct * 0.0093), message);
        let imported = stdf::import_stdf_bytes(&bytes, &label, &mut member_progress)?;
        progress(base + span * 0.99, &format!("Merging ZIP member: {name}"));
        append(label, imported);
    }
    progress(100.0, "ZIP import complete");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

    fn record(typ: u8, sub: u8, body: &[u8], out: &mut Vec<u8>) {
        out.extend((body.len() as u16).to_le_bytes()); out.extend([typ, sub]); out.extend(body);
    }
    fn stdf(x: i16, value: f32) -> Vec<u8> {
        let mut out = Vec::new();
        record(0, 10, &[2, 4], &mut out); record(5, 10, &[1, 3], &mut out);
        let mut ptr = 100u32.to_le_bytes().to_vec();
        ptr.extend([1, 3, 0, 0]); ptr.extend(value.to_le_bytes()); ptr.extend([1, b'V', 0, 255]);
        record(15, 10, &ptr, &mut out);
        let mut prr = vec![1, 3, 0, 1, 0, 1, 0, 1, 0];
        prr.extend(x.to_le_bytes()); prr.extend(0i16.to_le_bytes()); record(5, 20, &prr, &mut out);
        out
    }
    fn zip(entries: &[(&str, Vec<u8>)], method: CompressionMethod) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in entries {
            writer.start_file(*name, SimpleFileOptions::default().compression_method(method)).unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }
    fn load(bytes: Vec<u8>) -> Result<crate::model::Dataset, String> {
        let mut ds = crate::model::Dataset::new();
        import_zip_reader(Cursor::new(bytes), "lot.zip", &mut |_, _| {}, &mut |name, imported| {
            ds.files.push(name); ds.append_import(imported);
        })?;
        ds.resolve_retests(); Ok(ds)
    }

    #[test]
    fn reads_nested_plain_and_z_stdf_from_stored_and_deflated_zip() {
        let entries = [
            ("nested/first.STDF.Z", crate::z_decode::tests::literal_stream(&stdf(0, 1.25))),
            ("nested/second.std", stdf(1, 2.5)),
            ("readme.txt", b"ignored".to_vec()),
            ("__MACOSX/._third.stdf.Z", b"resource fork ignored".to_vec()),
        ];
        for method in [CompressionMethod::Stored, CompressionMethod::Deflated] {
            let ds = load(zip(&entries, method)).unwrap();
            assert_eq!(ds.rows, 2); assert_eq!(ds.cols[0], vec![1.25, 2.5]);
            assert_eq!(ds.site, vec![Some(3), Some(3)]);
            assert_eq!(ds.files.len(), 2);
            assert_eq!(ds.files[0], "lot.zip!nested/first.STDF.Z");
        }
    }

    #[test]
    fn zip_member_order_determines_latest_retest() {
        let ds = load(zip(&[("a.Z", crate::z_decode::tests::literal_stream(&stdf(0, 1.0))),
            ("b.Z", crate::z_decode::tests::literal_stream(&stdf(0, 2.0)))], CompressionMethod::Stored)).unwrap();
        assert_eq!(ds.rows, 1); assert_eq!(ds.retest_count, 1); assert_eq!(ds.cols[0], vec![2.0]);
    }

    #[test]
    fn rejects_empty_corrupt_and_invalid_stdf_archives() {
        assert!(load(b"not a ZIP".to_vec()).is_err());
        assert!(load(zip(&[("notes.txt", vec![0])], CompressionMethod::Stored)).err().unwrap().contains("contains no"));
        assert!(load(zip(&[("broken.Z", vec![0x1f, 0x9d, 8])], CompressionMethod::Stored)).err().unwrap().contains("lot.zip!broken.Z"));
        let raw = stdf(0, 1.0);
        let mut bytes = zip(&[("bad.stdf", raw.clone())], CompressionMethod::Stored);
        let start = bytes.windows(raw.len()).position(|w| w == raw).unwrap();
        bytes[start + raw.len() - 1] ^= 1;
        assert!(load(bytes).err().unwrap().contains("Cannot read"), "CRC failures must not import a partial member");
    }
}
