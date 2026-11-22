use crate::csv_io;
use crate::dataset::DatasetInfo;
use crate::model::{CustomColumn, Dataset, Filter};
use crate::query;
use crate::stdf;
use base64::Engine;
use serde::Serialize;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

pub struct AppState {
    pub ds: Arc<Mutex<Option<Dataset>>>,
    pub last_dir: Arc<Mutex<Option<PathBuf>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            ds: Arc::new(Mutex::new(None)),
            last_dir: Arc::new(Mutex::new(None)),
        }
    }
}

#[derive(Clone, Serialize)]
struct Progress {
    pct: f32,
    msg: String,
}

fn extension(path: &std::path::Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
}

#[tauri::command]
pub async fn pick_files(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let mut dlg = rfd::FileDialog::new()
        .add_filter(
            "Semiconductor data",
            &["stdf", "std", "atdf", "csv", "txt", "tsv", "z", "gz", "zip"],
        )
        .add_filter("STDF (including .Z, .gz and ZIP)", &["stdf", "std", "z", "gz", "zip"])
        .add_filter("CSV / text", &["csv", "txt", "tsv"])
        .add_filter("All files", &["*"]);
    if let Some(dir) = state.last_dir.lock().unwrap().clone() {
        dlg = dlg.set_directory(dir);
    }
    let files = dlg.pick_files().unwrap_or_default();
    if let Some(first) = files.first() {
        if let Some(parent) = first.parent() {
            *state.last_dir.lock().unwrap() = Some(parent.to_path_buf());
        }
    }
    Ok(files
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect())
}

#[tauri::command]
pub async fn pick_save_path(
    state: State<'_, AppState>,
    default_name: String,
    extensions: Vec<String>,
) -> Result<Option<String>, String> {
    let mut dlg = rfd::FileDialog::new().set_file_name(&default_name);
    if !extensions.is_empty() {
        let exts: Vec<&str> = extensions.iter().map(|s| s.as_str()).collect();
        dlg = dlg.add_filter("File", &exts);
    }
    if let Some(dir) = state.last_dir.lock().unwrap().clone() {
        dlg = dlg.set_directory(dir);
    }
    let picked = dlg.save_file();
    if let Some(p) = &picked {
        if let Some(parent) = p.parent() {
            *state.last_dir.lock().unwrap() = Some(parent.to_path_buf());
        }
    }
    Ok(picked.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn pick_template(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let mut dlg = rfd::FileDialog::new().add_filter("EWS template", &["json"]);
    if let Some(dir) = state.last_dir.lock().unwrap().clone() {
        dlg = dlg.set_directory(dir);
    }
    let picked = dlg.pick_file();
    if let Some(p) = &picked {
        if let Some(parent) = p.parent() {
            *state.last_dir.lock().unwrap() = Some(parent.to_path_buf());
        }
    }
    Ok(picked.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn open_in_explorer(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err(format!("Path does not exist: {path}"));
    }
    #[cfg(target_os = "windows")]
    {
        let arg: std::ffi::OsString = if target.is_dir() {
            target.clone().into_os_string()
        } else {
            format!("/select,{}", target.display()).into()
        };
        std::process::Command::new("explorer")
            .arg(arg)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    {
        let dir = if target.is_dir() {
            target
        } else {
            target.parent().unwrap_or(&target).to_path_buf()
        };
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[tauri::command]
pub async fn pick_folder(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let mut dlg = rfd::FileDialog::new();
    if let Some(dir) = state.last_dir.lock().unwrap().clone() {
        dlg = dlg.set_directory(dir);
    }
    let picked = dlg.pick_folder();
    if let Some(p) = &picked {
        *state.last_dir.lock().unwrap() = Some(p.clone());
    }
    Ok(picked.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn open_paths(
    app: AppHandle,
    state: State<'_, AppState>,
    paths: Vec<String>,
    mapping: Option<csv_io::CsvMapping>,
) -> Result<DatasetInfo, String> {
    if paths.is_empty() {
        return Err("No files selected".into());
    }
    let ds_arc = state.ds.clone();
    let paths2 = paths.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut ds = Dataset::new();
        let n = paths2.len().max(1) as f32;
        for (i, p) in paths2.iter().enumerate() {
            let path = PathBuf::from(p);
            let base = i as f32 / n * 90.0;
            let span = 90.0 / n;
            let app2 = app.clone();
            let mut cb = |pct: f32, msg: &str| {
                let _ = app2.emit(
                    "import-progress",
                    Progress {
                        pct: base + pct * span / 100.0,
                        msg: msg.to_string(),
                    },
                );
            };
            let ext = extension(&path);
            if ext == "zip" {
                crate::archive::import_zip(&path, &mut cb, &mut |name, imported| {
                    ds.files.push(name); ds.append_import(imported);
                })?;
                continue;
            }
            let mut imp = match ext.as_str() {
                "csv" | "txt" | "tsv" | "dat" => {
                    csv_io::import_csv_with_mapping(&path, &mut cb, mapping.as_ref())?
                }
                _ => stdf::import_stdf(&path, &mut cb)?,
            };
            let _ = app.emit(
                "import-progress",
                Progress {
                    pct: base + span,
                    msg: format!("Merging {}", path.file_name().and_then(|f| f.to_str()).unwrap_or("")),
                },
            );
            if !imp.csv_skipped_lines.is_empty() {
                ds.csv_warnings.push(crate::dataset::CsvImportWarning {
                    file: p.clone(),
                    lines: std::mem::take(&mut imp.csv_skipped_lines),
                });
            }
            ds.append_import(imp);
            ds.files.push(p.clone());
        }
        let _ = app.emit("import-progress", Progress {pct:92.0,msg:"Resolving retests…".into()});
        ds.resolve_retests();
        if ds.rows == 0 {
            if !ds.csv_warnings.is_empty() {
                let skipped: usize = ds.csv_warnings.iter().map(|warning| warning.lines.len()).sum();
                return Err(format!("No valid data rows found. Skipped {skipped} CSV rows with missing or invalid X/Y coordinates."));
            }
            return Err("No data rows were found in the selected file(s)".into());
        }
        stdf::prioritize_derived_tests(&mut ds);
        let _ = app.emit("import-progress", Progress {pct:99.0,msg:"Detecting numeric grouping labels…".into()});
        ds.detect_numeric_labels();
        ds.detect_data_categories();
        let info = ds.info();
        *ds_arc.lock().unwrap() = Some(ds);
        let _ = app.emit(
            "import-progress",
            Progress {
                pct: 100.0,
                msg: "Done".into(),
            },
        );
        Ok(info)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn inspect_csv(path: String) -> Result<csv_io::CsvInspection, String> {
    csv_io::inspect_csv(std::path::Path::new(&path))
}

#[tauri::command]
pub async fn import_product_metadata(
    state: State<'_, AppState>,
    paths: Option<Vec<String>>,
    path: Option<String>,
) -> Result<DatasetInfo, String> {
    let target = state.ds.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths = paths.unwrap_or_else(|| path.into_iter().collect());
        let source = stdf::import_metadata_files(paths.iter().map(std::path::Path::new))?;
        let mut guard = target.lock().map_err(|e| e.to_string())?;
        let ds = guard.as_mut().ok_or("Import CSV data before adding product metadata")?;
        ds.fill_product_metadata(source)?;
        Ok(ds.info())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn dataset_info(state: State<'_, AppState>) -> Result<Option<DatasetInfo>, String> {
    Ok(state.ds.lock().unwrap().as_ref().map(|d| d.info()))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnAssignment {
    pub wafer: u16,
    pub label: String,
}

#[tauri::command]
pub fn add_custom_column(
    state: State<'_, AppState>,
    name: String,
    assignments: Vec<ColumnAssignment>,
    original_name: Option<String>,
) -> Result<DatasetInfo, String> {
    let mut guard = state.ds.lock().unwrap();
    let ds = guard.as_mut().ok_or("No dataset loaded")?;
    let labels: Vec<(u16, String)> = assignments
        .into_iter()
        .map(|a| (a.wafer, a.label))
        .collect();
    ds.update_custom_column(&name, &labels, original_name.as_deref())?;
    Ok(ds.info())
}

#[tauri::command]
pub fn remove_custom_column(
    state: State<'_, AppState>,
    name: String,
) -> Result<DatasetInfo, String> {
    let mut guard = state.ds.lock().unwrap();
    let ds = guard.as_mut().ok_or("No dataset loaded")?;
    ds.remove_custom_column(&name);
    Ok(ds.info())
}

#[tauri::command]
pub fn restore_custom_columns(
    state: State<'_, AppState>,
    columns: Vec<CustomColumn>,
) -> Result<DatasetInfo, String> {
    let mut guard = state.ds.lock().unwrap();
    let ds = guard.as_mut().ok_or("No dataset loaded")?;
    ds.restore_custom_columns(columns)?;
    Ok(ds.info())
}

/// Run a heavy query off the UI thread so the window never freezes while a
/// 30-million-value aggregation is running.
async fn with_ds<T, F>(state: State<'_, AppState>, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&Dataset) -> T + Send + 'static,
{
    let arc = state.ds.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let guard = arc.lock().unwrap();
        let ds = guard.as_ref().ok_or("No dataset loaded")?;
        Ok(f(ds))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn box_plot(
    state: State<'_, AppState>,
    req: query::BoxRequest,
) -> Result<query::BoxResponse, String> {
    with_ds(state, move |ds| query::box_plot(ds, &req)).await
}

#[tauri::command]
pub async fn wafer_map(
    state: State<'_, AppState>,
    req: query::MapRequest,
) -> Result<query::MapResponse, String> {
    with_ds(state, move |ds| query::wafer_map(ds, &req)).await
}

#[tauri::command]
pub async fn wafer_maps(state: State<'_, AppState>, req: query::MapRequest) -> Result<Vec<query::MapResponse>, String> {
    with_ds(state, move |ds| query::wafer_maps(ds, &req)).await
}

#[tauri::command]
pub async fn pareto(
    state: State<'_, AppState>,
    req: query::ParetoRequest,
) -> Result<query::ParetoResponse, String> {
    with_ds(state, move |ds| query::pareto(ds, &req)).await
}

#[tauri::command]
pub async fn bin_overview(
    state: State<'_, AppState>,
    req: query::BinOverviewRequest,
) -> Result<query::BinOverviewResponse, String> {
    with_ds(state, move |ds| query::bin_overview(ds, &req)).await
}

#[tauri::command]
pub async fn test_iqr_limits(state: State<'_, AppState>, test: usize) -> Result<Option<[f64; 2]>, String> {
    with_ds(state, move |ds| query::test_iqr_limits(ds, test)).await
}

#[tauri::command]
pub async fn test_distribution(state: State<'_, AppState>, test: usize) -> Result<Option<query::TestDistribution>, String> {
    with_ds(state, move |ds| query::test_distribution(ds, test)).await
}

#[tauri::command]
pub async fn histogram(
    state: State<'_, AppState>,
    req: query::HistRequest,
) -> Result<query::HistResponse, String> {
    with_ds(state, move |ds| query::histogram(ds, &req)).await
}

#[tauri::command]
pub async fn limit_counts(state: State<'_, AppState>, req: query::LimitCountsRequest) -> Result<query::LimitCountsResponse, String> {
    with_ds(state, move |ds| query::limit_counts(ds, &req)).await
}

#[tauri::command]
pub async fn trend(
    state: State<'_, AppState>,
    req: query::TrendRequest,
) -> Result<query::TrendResponse, String> {
    with_ds(state, move |ds| query::trend(ds, &req)).await
}

#[tauri::command]
pub async fn scatter(
    state: State<'_, AppState>,
    req: query::ScatterRequest,
) -> Result<query::ScatterResponse, String> {
    with_ds(state, move |ds| query::scatter(ds, &req)).await
}

#[tauri::command]
pub async fn export_csv(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    filter: Filter,
) -> Result<String, String> {
    let arc = state.ds.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let guard = arc.lock().unwrap();
        let ds = guard.as_ref().ok_or("No dataset loaded")?;
        write_csv_progress(ds, &path, &filter, &mut |pct, msg| {
            let _ = app.emit("import-progress", Progress { pct, msg: msg.into() });
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
pub(crate) fn write_csv(ds: &Dataset, path: &str, filter: &Filter) -> Result<String, String> {
    write_csv_progress(ds, path, filter, &mut |_, _| {})
}

fn write_csv_progress(ds: &Dataset, path: &str, filter: &Filter,
    progress: &mut dyn FnMut(f32, &str)) -> Result<String, String> {
    progress(1.0, "Preparing CSV…");
    let mask = ds.base_mask(filter);
    // Plan columns once so headers, limit rows and data always use identical ordering.
    #[derive(Clone, Copy)]
    enum Column { Lot, Ocr, Wafer, X, Y, Hbin, Sbin, Site, Test(usize), Text(usize), Custom(usize) }
    let mut columns = vec![("Lot".to_string(), Column::Lot), ("OCR".into(), Column::Ocr), ("Wafer".into(), Column::Wafer)];
    let mut used: std::collections::HashSet<String> = ["Lot", "OCR", "Wafer", "X", "Y", "HBIN", "SBIN", "Site"]
        .into_iter().map(String::from).chain(ds.tests.iter().map(|t| t.display_with_units())).collect();
    let mut emitted_tests = std::collections::HashSet::new();
    let mut emitted_text = std::collections::HashSet::new();
    for (index, custom) in ds.custom_cols.iter().enumerate() {
        if let Some(&source) = ds.numeric_label_sources.get(&custom.name) {
            if emitted_tests.insert(source) { columns.push((ds.tests[source].display_with_units(), Column::Test(source))); }
        } else if let Some(source) = ds.text_label_sources.get(&custom.name)
            .and_then(|name| ds.text_cols.iter().position(|c| &c.name == name)) {
            if emitted_text.insert(source) {
                let mut name = ds.text_cols[source].name.clone();
                while used.contains(&name) { name.push_str(" text"); }
                used.insert(name.clone()); columns.push((name, Column::Text(source)));
            }
        } else {
            let mut name = custom.name.clone();
            // Preserve a raw text source separately when its derived label was edited.
            while used.contains(&name) || ds.text_cols.iter().any(|c| c.name == name) { name.push_str(" label"); }
            used.insert(name.clone()); columns.push((name, Column::Custom(index)));
        }
    }
    columns.extend([("X".into(),Column::X),("Y".into(),Column::Y),("HBIN".into(),Column::Hbin),("SBIN".into(),Column::Sbin),("Site".into(),Column::Site)]);
    for (index, test) in ds.tests.iter().enumerate() {
        if !emitted_tests.contains(&index) { columns.push((test.display_with_units(), Column::Test(index))); }
    }
    for (index, col) in ds.text_cols.iter().enumerate() {
        if emitted_text.contains(&index) { continue; }
        let mut name = col.name.clone();
        while used.contains(&name) { name.push_str(" text"); }
        used.insert(name.clone()); columns.push((name, Column::Text(index)));
    }
    let file = std::fs::File::create(&path).map_err(|e| format!("Cannot create file: {e}"))?;
    let mut w = std::io::BufWriter::with_capacity(1 << 20, file);
    writeln!(w, "{}", columns.iter().map(|(name,_)|csv_escape(name)).collect::<Vec<_>>().join(",")).map_err(|e|e.to_string())?;
    for (label, low) in [("LSL",true),("USL",false)] {
        write!(w,"{label}").map_err(|e|e.to_string())?;
        for (_, col) in columns.iter().skip(1) {
            write!(w,",").map_err(|e|e.to_string())?;
            if let Column::Test(index) = col {
                let t = &ds.tests[*index];
                let limit = if low { t.lo_spec.or(t.lo_limit) } else { t.hi_spec.or(t.hi_limit) };
                if let Some(value) = limit { write!(w,"{}",fmt_csv_num(value)).map_err(|e|e.to_string())?; }
            }
        }
        writeln!(w).map_err(|e|e.to_string())?;
    }

    let mut count = 0usize;
    let mut line = String::with_capacity(256);
    let mut last_percent = 1;
    for r in 0..ds.rows {
        let percent = 2 + (r as u64 * 96 / ds.rows.max(1) as u64) as u32;
        if percent > last_percent {
            progress(percent as f32, "Writing CSV rows…");
            last_percent = percent;
        }
        if !mask[r] {
            continue;
        }
        line.clear();
        let wref = &ds.wafers[ds.wafer_of_row[r] as usize];
        for (index, (_, col)) in columns.iter().enumerate() {
            if index > 0 { line.push(','); }
            match *col {
                Column::Lot => line.push_str(&csv_escape(ds.lot_name(wref.lot))),
                Column::Ocr => line.push_str(&csv_escape(&wref.name)),
                Column::Wafer => line.push_str(&csv_escape(wref.number.as_deref().unwrap_or(""))),
                Column::X => line.push_str(&ds.x[r].to_string()),
                Column::Y => line.push_str(&ds.y[r].to_string()),
                Column::Hbin => { if ds.hbin[r] != crate::model::UNKNOWN_BIN { line.push_str(&ds.hbin[r].to_string()); } },
                Column::Sbin => { if ds.sbin[r] != crate::model::UNKNOWN_BIN { line.push_str(&ds.sbin[r].to_string()); } },
                Column::Site => { if let Some(site) = ds.site.get(r).copied().flatten() { line.push_str(&site.to_string()); } },
                Column::Test(i) => { let value = ds.cols[i][r]; if value.is_finite() { line.push_str(&fmt_csv_num(value)); } },
                Column::Text(i) => { let col = &ds.text_cols[i]; line.push_str(&csv_escape(&col.values[col.codes[r] as usize])); },
                Column::Custom(i) => {
                    let col = &ds.custom_cols[i];
                    let code = col.wafer_values.get(ds.wafer_of_row[r] as usize).copied().unwrap_or(0);
                    line.push_str(&csv_escape(&col.label(code)));
                }
            }
        }
        line.push('\n');
        w.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
        count += 1;
    }
    progress(99.0, "Finalizing CSV…");
    w.flush().map_err(|e| e.to_string())?;
    progress(100.0, "CSV exported");
    Ok(format!("Exported {count} rows"))
}

/// Keep CSV numbers lossless enough for semiconductor measurements. Plain
/// `{:.6}` turned femto-amp and similar values into "0"; use scientific
/// notation for very small/large magnitudes and trim cosmetic trailing zeros
/// for ordinary values.
fn fmt_csv_num(v: f32) -> String {
    if !v.is_finite() {
        return String::new();
    }
    if v == 0.0 {
        return "0".into();
    }
    let a = v.abs();
    if a < 1e-4 || a >= 1e9 {
        // Rust's LowerExp uses the shortest round-tripping f32 representation,
        // so 1.2e-15 stays "1.2e-15" instead of "1.20000005e-15".
        return format!("{v:e}");
    }
    let s = format!("{v}");
    if s == "-0" {
        "0".into()
    } else {
        s
    }
}

fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

#[tauri::command]
pub fn save_binary(path: String, data_base64: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64)
        .map_err(|e| format!("Invalid image data: {e}"))?;
    std::fs::write(&path, bytes).map_err(|e| format!("Cannot write file: {e}"))
}

#[tauri::command]
pub fn create_report_folder(parent: String, name: String) -> Result<String, String> {
    let child = std::path::Path::new(&name);
    if child.components().count() != 1 || !matches!(child.components().next(), Some(std::path::Component::Normal(_))) || name.contains(['/', '\\', ':']) {
        return Err("Invalid report folder name.".into());
    }
    let parent = std::fs::canonicalize(parent).map_err(|e| format!("Cannot open output folder: {e}"))?;
    let path = parent.join(child);
    // create_dir fails if this run already exists. Completed reports are never reused.
    std::fs::create_dir(&path).map_err(|e| format!("Cannot create report folder: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn save_text(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("Cannot write file: {e}"))
}

#[tauri::command]
pub fn remove_report_images(folder: String, names: Vec<String>) -> Result<(), String> {
    let folder = PathBuf::from(folder);
    for name in &names {
        let path = std::path::Path::new(name);
        if path.components().count() != 1 || !name.ends_with(".jpg") || name.contains(['/', '\\', ':']) {
            return Err("Invalid report image name.".into());
        }
    }
    for name in names {
        match std::fs::remove_file(folder.join(name)) {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(format!("Cannot remove incomplete image: {e}")),
        }
    }
    Ok(())
}

#[tauri::command]
pub fn read_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Cannot read file: {e}"))
}

#[tauri::command]
pub fn file_name(path: String) -> String {
    PathBuf::from(path)
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or("")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::fmt_csv_num;

    #[test]
    fn report_runs_are_exclusive_and_cleanup_only_requested_images() {
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let parent = std::env::temp_dir().join(format!("ews-report-{}-{nonce}", std::process::id()));
        std::fs::create_dir(&parent).unwrap();
        let root = parent.to_string_lossy().to_string();
        assert!(super::create_report_folder(root.clone(), "../escape".into()).is_err());
        let folder = super::create_report_folder(root.clone(), "run".into()).unwrap();
        assert!(super::create_report_folder(root, "run".into()).is_err());
        let run = std::path::PathBuf::from(&folder);
        std::fs::write(run.join("01_plot.jpg"), b"image").unwrap();
        std::fs::write(run.join("index.html"), b"complete report").unwrap();
        assert!(super::remove_report_images(folder.clone(), vec!["../index.html".into()]).is_err());
        assert!(super::remove_report_images(folder.clone(), vec!["index.html".into()]).is_err());
        super::remove_report_images(folder, vec!["01_plot.jpg".into()]).unwrap();
        assert!(!run.join("01_plot.jpg").exists());
        assert_eq!(std::fs::read(run.join("index.html")).unwrap(), b"complete report");
        std::fs::remove_file(run.join("index.html")).unwrap();
        std::fs::remove_dir(run).unwrap();
        std::fs::remove_dir(parent).unwrap();
    }

    #[test]
    fn invalid_custom_label_restore_does_not_replace_existing_columns() {
        use crate::model::{CustomColumn, Dataset};
        let mut ds = Dataset::new();
        ds.custom_cols.push(CustomColumn {name:"Existing".into(),categories:vec!["".into()],wafer_values:vec![]});
        let bad = CustomColumn {name:"Bad".into(),categories:vec![],wafer_values:vec![]};
        assert!(ds.restore_custom_columns(vec![bad]).is_err());
        assert_eq!(ds.custom_cols[0].name, "Existing");
        let reserved = CustomColumn {name:"wafer".into(),categories:vec!["".into()],wafer_values:vec![]};
        assert!(ds.restore_custom_columns(vec![reserved]).is_err());
        assert_eq!(ds.custom_cols[0].name, "Existing");
    }

    #[test]
    fn csv_roundtrip_preserves_site_and_measurement_metadata() {
        let source = std::env::temp_dir().join(format!("ews-site-source-{}.csv", std::process::id()));
        let output = std::env::temp_dir().join(format!("ews-site-export-{}.csv", std::process::id()));
        std::fs::write(&source, "Lot,Wafer,X,Y,HBIN,SBIN,Site,V [V]\nL,W,1,2,1,1,0,1.25\nL,W,2,2,2,5,3,2.5\n").unwrap();
        let imp = crate::csv_io::import_csv(&source, &mut |_, _| {}).unwrap();
        assert_eq!(imp.site, vec![Some(0), Some(3)]);
        assert_eq!(imp.tests.len(), 1, "site must not become a measurement test");
        let mut ds = crate::model::Dataset::new(); ds.merge(imp);
        ds.tests[0].number = Some(1001); ds.tests[0].lo_spec = Some(1.0); ds.tests[0].hi_spec = Some(3.0);
        ds.tests[0].lo_limit = Some(0.5); ds.tests[0].hi_limit = Some(4.0);
        ds.custom_cols.push(crate::model::CustomColumn { name: "Split".into(), categories: vec!["".into(), "Group A".into()], wafer_values: vec![1] });
        let mut progress = Vec::new();
        super::write_csv_progress(&ds, output.to_str().unwrap(), &crate::model::Filter::default(),
            &mut |pct, _| progress.push(pct)).unwrap();
        assert_eq!(progress.first(), Some(&1.0));
        assert_eq!(progress.last(), Some(&100.0));
        assert!(progress.windows(2).all(|pair| pair[0] <= pair[1]));
        assert!(progress.iter().any(|pct| *pct > 25.0 && *pct < 99.0));
        let text = std::fs::read_to_string(&output).unwrap();
        assert!(text.lines().next().unwrap().contains("1001 - V [V]"));
        assert!(text.lines().nth(1).unwrap().starts_with("LSL,"));
        assert!(text.lines().nth(2).unwrap().starts_with("USL,"));
        assert!(!text.contains("Tests#") && !text.contains("\nUnit,"));
        let roundtrip = crate::csv_io::import_csv(&output, &mut |_, _| {}).unwrap();
        assert_eq!(roundtrip.site, ds.site);
        assert_eq!(roundtrip.cols, ds.cols);
        assert_eq!(roundtrip.tests[0].units, "V");
        assert_eq!(roundtrip.tests[0].number, Some(1001)); assert_eq!(roundtrip.tests[0].lo_spec, Some(1.0));
        let split = roundtrip.custom_cols.iter().find(|c| c.name == "Split").unwrap();
        assert_eq!(split.label(split.wafer_values[0]), "Group A");
        let _ = std::fs::remove_file(source); let _ = std::fs::remove_file(output);
    }

    #[test]
    fn csv_numbers_keep_tiny_values() {
        assert_eq!(fmt_csv_num(1.2e-15), "1.2e-15");
        assert_eq!(fmt_csv_num(-4.5e-12), "-4.5e-12");
        assert_eq!(fmt_csv_num(0.0), "0");
        assert_eq!(fmt_csv_num(0.41515), "0.41515");
        assert_eq!(fmt_csv_num(12.5), "12.5");
    }

    #[test]
    fn csv_exports_ocr_wafer_and_custom_columns_first_without_losing_limits() {
        use crate::model::{Dataset, Filter};
        let source = std::env::temp_dir().join(format!("ews-identities-{}.csv", std::process::id()));
        let output = source.with_extension("export.csv");
        std::fs::write(&source, "Lot,Wafer,OCR,X,Y,HBIN,SBIN,Site,Split,Current [A],PartID,Part ID\nLSL,,,,,,,,,0.1,,\nUSL,,,,,,,,,0.9,,\nL1,03,ABC-03,0,0,1,1,2,A,0.4,1,0001\nL1,03,ABC-03,1,0,,,2,A,0.5,2,0002\nL2,03,XYZ-03,0,0,2,7,1,B,0.6,3,0003\nL2,03,XYZ-03,1,0,1,1,1,B,0.7,4,0004\n").unwrap();
        let mut ds = Dataset::new();
        ds.merge(crate::csv_io::import_csv(&source, &mut |_, _| {}).unwrap());
        ds.set_custom_column("Manual", &[(0,"N2".into()), (1,"450".into())]).unwrap();
        super::write_csv(&ds, output.to_str().unwrap(), &Filter::default()).unwrap();
        let text = std::fs::read_to_string(&output).unwrap();
        assert!(text.starts_with("Lot,OCR,Wafer,Split,Manual,X,Y,HBIN,SBIN,Site,Current [A],PartID,Part ID\n"), "{text}");
        let mut loaded = Dataset::new();
        loaded.merge(crate::csv_io::import_csv(&output, &mut |_, _| {}).unwrap());
        assert_eq!(loaded.rows, 4);
        assert_eq!(loaded.wafers.iter().map(|w| (w.name.as_str(),w.number.as_deref())).collect::<Vec<_>>(), vec![("ABC-03",Some("03")),("XYZ-03",Some("03"))]);
        assert_eq!(loaded.tests.len(), 2);
        assert_eq!(loaded.tests[0].lo_spec, Some(0.1));
        assert_eq!(loaded.tests[0].hi_spec, Some(0.9));
        assert_eq!(loaded.tests[1].name, "PartID");
        assert_eq!(loaded.cols, ds.cols);
        assert_eq!(loaded.hbin, ds.hbin);
        assert_eq!(loaded.sbin, ds.sbin);
        let split = loaded.custom_column("Split").unwrap();
        assert_eq!(split.label(split.wafer_values[0]), "A");
        assert_eq!(split.label(split.wafer_values[1]), "B");
        let raw = loaded.text_cols.iter().find(|c|c.name == "Part ID").unwrap();
        assert_eq!(raw.values[raw.codes[0] as usize], "0001");
        std::fs::remove_file(source).unwrap(); std::fs::remove_file(output).unwrap();
    }

    #[test]
    fn custom_column_rename_is_atomic_and_uses_the_new_csv_header() {
        use crate::model::{Dataset, Filter};
        let mut imported = crate::dataset::Imported::new();
        let lot = imported.lot_index("L");
        for name in ["W1", "W2"] {
            let wafer = imported.wafer_index(lot, name);
            imported.new_row(lot, wafer);
        }
        let mut ds = Dataset::new();
        ds.merge(imported.finish());
        ds.set_custom_column("Split", &[(0, "A".into()), (1, "B".into())]).unwrap();
        ds.set_custom_column("Other", &[(0, "C".into())]).unwrap();
        ds.numeric_label_sources.insert("Split".into(), 0);
        let before = serde_json::to_value(&ds.custom_cols).unwrap();
        for name in ["", "wafer", "Other"] {
            assert!(ds.update_custom_column(name, &[(0, "Changed".into())], Some("Split")).is_err());
            assert_eq!(serde_json::to_value(&ds.custom_cols).unwrap(), before);
            assert!(ds.numeric_label_sources.contains_key("Split"));
        }
        ds.update_custom_column("Renamed split", &[(0, "Updated".into())], Some("Split")).unwrap();
        let column = ds.custom_column("Renamed split").unwrap();
        assert_eq!(column.label(column.wafer_values[0]), "Updated");
        assert_eq!(column.label(column.wafer_values[1]), "B");
        assert!(ds.custom_column("Split").is_none());
        assert!(!ds.numeric_label_sources.contains_key("Split"));
        assert!(ds.update_custom_column("Again", &[], Some("Split")).is_err());
        let output = std::env::temp_dir().join(format!("ews-renamed-column-{}.csv", std::process::id()));
        super::write_csv(&ds, output.to_str().unwrap(), &Filter::default()).unwrap();
        let csv = std::fs::read_to_string(&output).unwrap();
        assert!(csv.lines().next().unwrap().starts_with("Lot,OCR,Wafer,Renamed split,Other,X,Y,HBIN,SBIN,Site"));
        assert!(!csv.lines().next().unwrap().split(',').any(|name| name == "Split"));
        std::fs::remove_file(output).unwrap();
    }

    #[test]
    fn mixed_numeric_text_wafer_labels_roundtrip_independent_of_row_order() {
        use crate::model::{Dataset, Filter, TestInfo};
        let mut imported = crate::dataset::Imported::new();
        let lot = imported.lot_index("L");
        for wi in 0..21 {
            let wafer = imported.wafer_index(lot, &format!("W{:02}", wi + 1));
            for x in 0..300 {
                let row = imported.new_row(lot, wafer);
                imported.x[row] = x;
                imported.y[row] = 0;
            }
        }
        let mut test = TestInfo::new("Voltage");
        test.units = "V".into();
        imported.tests.push(test);
        imported.cols.push(vec![0.42; 21 * 300]);
        let mut original = Dataset::new();
        original.merge(imported.finish());
        let path = std::env::temp_dir().join(format!("ews-mixed-labels-{}.csv", std::process::id()));
        for numeric_label in ["450", "0450"] {
            let assignments = (0..21).map(|wi| (wi, if wi < 16 { numeric_label.into() } else { "N2".into() })).collect::<Vec<_>>();
            original.set_custom_column("Process", &assignments).unwrap();
            super::write_csv(&original, path.to_str().unwrap(), &Filter::default()).unwrap();
            let csv = std::fs::read_to_string(&path).unwrap();
            for text_first in [false, true] {
                let mut lines = csv.lines().map(str::to_string).collect::<Vec<_>>();
                if text_first {
                    let index = lines.iter().position(|line| line.starts_with("L,W17,")).unwrap();
                    let row = lines.remove(index);
                    lines.insert(3, row);
                }
                std::fs::write(&path, lines.join("\n") + "\n").unwrap();
                let mut loaded = Dataset::new();
                loaded.merge(crate::csv_io::import_csv(&path, &mut |_, _| {}).unwrap());
                loaded.detect_numeric_labels();
                loaded.detect_data_categories();
                assert_eq!(loaded.rows, 6300);
                assert_eq!(loaded.tests.len(), 1);
                let column = loaded.custom_column("Process").expect("original label name");
                for (i, wafer) in loaded.wafers.iter().enumerate() {
                    let number: usize = wafer.name[1..].parse().unwrap();
                    assert_eq!(column.label(column.wafer_values[i]), if number <= 16 { numeric_label } else { "N2" });
                }
                assert_eq!(loaded.cols, original.cols);
                super::write_csv(&loaded, path.to_str().unwrap(), &Filter::default()).unwrap();
                let exported = std::fs::read_to_string(&path).unwrap();
                assert_eq!(exported.lines().next().unwrap().split(',').filter(|name| *name == "Process").count(), 1);
                assert!(!exported.lines().next().unwrap().contains(" label"));
                let mut reader = csv::Reader::from_reader(exported.as_bytes());
                let index = reader.headers().unwrap().iter().position(|h| h == "Process").unwrap();
                let values = reader.records().skip(2).map(|r| r.unwrap()[index].to_string()).collect::<Vec<_>>();
                assert_eq!(values.iter().filter(|v| *v == "N2").count(), 1500);
                assert_eq!(values.iter().filter(|v| *v == numeric_label).count(), 4800);
            }
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn numeric_csv_labels_keep_source_values_and_roundtrip_without_duplicate_columns() {
        let source=std::env::temp_dir().join(format!("ews-numeric-source-{}.csv",std::process::id()));
        let output=std::env::temp_dir().join(format!("ews-numeric-export-{}.csv",std::process::id()));
        std::fs::write(&source,"Lot,Wafer,X,Y,Split,V [V]\nL,W1,0,0,1,0.1\nL,W1,1,0,1,0.2\nL,W2,0,0,2,0.3\nL,W2,1,0,2,0.4\n").unwrap();
        let mut ds=crate::model::Dataset::new();ds.merge(crate::csv_io::import_csv(&source,&mut |_,_|{}).unwrap());
        let values=ds.cols.clone();ds.detect_numeric_labels();
        assert_eq!(ds.tests.len(),2);assert_eq!(ds.cols,values);
        assert_eq!(ds.custom_cols[0].name,"Split");
        super::write_csv(&ds,output.to_str().unwrap(),&Default::default()).unwrap();
        let text=std::fs::read_to_string(&output).unwrap();
        assert!(!text.lines().next().unwrap().contains("Split label"));
        let mut loaded=crate::model::Dataset::new();loaded.merge(crate::csv_io::import_csv(&output,&mut |_,_|{}).unwrap());loaded.detect_numeric_labels();
        assert_eq!(loaded.cols,values);assert_eq!(loaded.tests.len(),2);assert_eq!(loaded.custom_cols[0].categories,ds.custom_cols[0].categories);
        ds.set_custom_column("Split",&[(0,"Manual A".into()),(1,"Manual B".into())]).unwrap();
        super::write_csv(&ds,output.to_str().unwrap(),&Default::default()).unwrap();
        let loaded=crate::csv_io::import_csv(&output,&mut |_,_|{}).unwrap();
        let manual=loaded.custom_cols.iter().find(|c|c.name=="Split label").unwrap();
        assert_eq!(manual.label(manual.wafer_values[0]),"Manual A");
        assert_eq!(manual.label(manual.wafer_values[1]),"Manual B");
        std::fs::remove_file(source).unwrap();std::fs::remove_file(output).unwrap();
    }

    #[test]
    fn per_die_csv_categories_roundtrip_and_keep_retested_text_alignment(){
        let source=std::env::temp_dir().join(format!("ews-row-category-{}.csv",std::process::id()));let output=source.with_extension("export.csv");
        let mut text="Lot,Wafer,X,Y,Mode,Code,Voltage [V]\n".to_string();
        for x in 0..40{text.push_str(&format!("L,W,{x},0,{},{},{}\n",if x%2==0{"A"}else{"B"},x%2,if x%2==0{0.8}else{1.2}));}
        text.push_str("L,W,0,0,B,1,1.2\n");std::fs::write(&source,text).unwrap();
        let mut ds=crate::model::Dataset::new();ds.append_import(crate::csv_io::import_csv(&source,&mut|_,_|{}).unwrap());ds.resolve_retests();ds.detect_numeric_labels();ds.detect_data_categories();
        assert_eq!(ds.rows,40);assert_eq!(ds.retest_count,1);assert!(ds.custom_column("Mode").is_none());
        assert_eq!(ds.data_category("data:text:Mode").unwrap().counts,vec![0,19,21]);assert!(ds.data_category("data:test:Code").is_some());assert!(ds.data_category("data:test:Voltage [V]").is_none());
        ds.set_data_category("data:test:Voltage [V]",true).unwrap();assert_eq!(ds.data_category("data:test:Voltage [V]").unwrap().counts,vec![0,19,21]);
        super::write_csv(&ds,output.to_str().unwrap(),&Default::default()).unwrap();
        let mut loaded=crate::model::Dataset::new();loaded.append_import(crate::csv_io::import_csv(&output,&mut|_,_|{}).unwrap());loaded.resolve_retests();loaded.detect_numeric_labels();loaded.detect_data_categories();
        assert_eq!(loaded.cols,ds.cols);assert_eq!(loaded.rows,ds.rows);assert_eq!(loaded.data_category("data:text:Mode").unwrap().counts,vec![0,19,21]);
        let by_coord=|data:&crate::model::Dataset|{let c=data.text_cols.iter().find(|c|c.name=="Mode").unwrap();(0..data.rows).map(|r|(data.x[r],c.values[c.codes[r]as usize].clone())).collect::<std::collections::HashMap<_,_>>()};
        assert_eq!(by_coord(&loaded),by_coord(&ds));
        ds.set_custom_column("Mode",&[(0,"Manual label".into())]).unwrap();super::write_csv(&ds,output.to_str().unwrap(),&Default::default()).unwrap();
        let original=crate::csv_io::import_csv(&output,&mut|_,_|{}).unwrap();assert!(original.text_cols.iter().any(|c|c.name=="Mode"));assert!(original.custom_cols.iter().any(|c|c.name=="Mode label"));
        std::fs::remove_file(source).unwrap();std::fs::remove_file(output).unwrap();
    }
}
