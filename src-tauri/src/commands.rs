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
            &["stdf", "std", "atdf", "csv", "txt", "tsv", "z", "zip"],
        )
        .add_filter("STDF (including .Z and ZIP)", &["stdf", "std", "z", "zip"])
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
            let base = i as f32 / n * 100.0;
            let span = 100.0 / n;
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
            let imp = match ext.as_str() {
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
            ds.append_import(imp);
            ds.files.push(p.clone());
        }
        ds.resolve_retests();
        if ds.rows == 0 {
            return Err("No data rows were found in the selected file(s)".into());
        }
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
) -> Result<DatasetInfo, String> {
    let mut guard = state.ds.lock().unwrap();
    let ds = guard.as_mut().ok_or("No dataset loaded")?;
    let labels: Vec<(u16, String)> = assignments
        .into_iter()
        .map(|a| (a.wafer, a.label))
        .collect();
    ds.set_custom_column(&name, &labels)?;
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
pub async fn histogram(
    state: State<'_, AppState>,
    req: query::HistRequest,
) -> Result<query::HistResponse, String> {
    with_ds(state, move |ds| query::histogram(ds, &req)).await
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
    state: State<'_, AppState>,
    path: String,
    filter: Filter,
) -> Result<String, String> {
    let arc = state.ds.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let guard = arc.lock().unwrap();
        let ds = guard.as_ref().ok_or("No dataset loaded")?;
        write_csv(ds, &path, &filter)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn write_csv(ds: &Dataset, path: &str, filter: &Filter) -> Result<String, String> {
    let mask = ds.base_mask(filter);
    let file = std::fs::File::create(&path).map_err(|e| format!("Cannot create file: {e}"))?;
    let mut w = std::io::BufWriter::with_capacity(1 << 20, file);

    write!(w, "lot,wafer,x,y,hbin,sbin,site").map_err(|e| e.to_string())?;
    for t in ds.tests.iter() {
        // Keep units in the header so the export can be re-imported with them.
        write!(w, ",{}", csv_escape(&t.display_with_units())).map_err(|e| e.to_string())?;
    }
    for c in ds.custom_cols.iter() {
        write!(w, ",{}", csv_escape(&c.name)).map_err(|e| e.to_string())?;
    }
    writeln!(w).map_err(|e| e.to_string())?;

    // Metadata rows understood by the importer. Keeping test numbers, units
    // and limits here makes an exported CSV a complete round-trip instead of
    // losing everything except the measurements.
    let mut meta = String::from("Tests#");
    for _ in 0..6 {
        meta.push(',');
    }
    for t in ds.tests.iter() {
        meta.push(',');
        if let Some(n) = t.number {
            meta.push_str(&n.to_string());
        }
    }
    for _ in ds.custom_cols.iter() {
        meta.push(',');
    }
    writeln!(w, "{meta}").map_err(|e| e.to_string())?;

    let mut units = String::from("Unit");
    for _ in 0..6 {
        units.push(',');
    }
    for t in ds.tests.iter() {
        units.push(',');
        units.push_str(&csv_escape(&t.units));
    }
    for _ in ds.custom_cols.iter() {
        units.push(',');
    }
    writeln!(w, "{units}").map_err(|e| e.to_string())?;

    let mut lows = String::from("LowL");
    for _ in 0..6 {
        lows.push(',');
    }
    for t in ds.tests.iter() {
        lows.push(',');
        if let Some(v) = t.lo_limit.or(t.lo_spec) {
            lows.push_str(&fmt_csv_num(v));
        }
    }
    for _ in ds.custom_cols.iter() {
        lows.push(',');
    }
    writeln!(w, "{lows}").map_err(|e| e.to_string())?;

    let mut highs = String::from("HighL");
    for _ in 0..6 {
        highs.push(',');
    }
    for t in ds.tests.iter() {
        highs.push(',');
        if let Some(v) = t.hi_limit.or(t.hi_spec) {
            highs.push_str(&fmt_csv_num(v));
        }
    }
    for _ in ds.custom_cols.iter() {
        highs.push(',');
    }
    writeln!(w, "{highs}").map_err(|e| e.to_string())?;

    let mut count = 0usize;
    let mut line = String::with_capacity(256);
    for r in 0..ds.rows {
        if !mask[r] {
            continue;
        }
        line.clear();
        let wref = &ds.wafers[ds.wafer_of_row[r] as usize];
        line.push_str(&format!(
            "{},{},{},{},{},{}",
            csv_escape(ds.lot_name(wref.lot)),
            csv_escape(&wref.name),
            ds.x[r],
            ds.y[r],
            ds.hbin[r],
            ds.sbin[r]
        ));
        line.push(',');
        if let Some(site) = ds.site.get(r).copied().flatten() { line.push_str(&site.to_string()); }
        for c in ds.cols.iter() {
            let v = c[r];
            if v.is_finite() {
                line.push(',');
                line.push_str(&fmt_csv_num(v));
            } else {
                line.push(',');
            }
        }
        for c in ds.custom_cols.iter() {
            let code = c
                .wafer_values
                .get(ds.wafer_of_row[r] as usize)
                .copied()
                .unwrap_or(0);
            line.push(',');
            line.push_str(&csv_escape(&c.label(code)));
        }
        line.push('\n');
        w.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
        count += 1;
    }
    w.flush().map_err(|e| e.to_string())?;
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
pub fn save_text(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("Cannot write file: {e}"))
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
    fn csv_roundtrip_preserves_site_and_measurement_metadata() {
        let source = std::env::temp_dir().join(format!("ews-site-source-{}.csv", std::process::id()));
        let output = std::env::temp_dir().join(format!("ews-site-export-{}.csv", std::process::id()));
        std::fs::write(&source, "Lot,Wafer,X,Y,HBIN,SBIN,Site,V [V]\nL,W,1,2,1,1,0,1.25\nL,W,2,2,2,5,3,2.5\n").unwrap();
        let imp = crate::csv_io::import_csv(&source, &mut |_, _| {}).unwrap();
        assert_eq!(imp.site, vec![Some(0), Some(3)]);
        assert_eq!(imp.tests.len(), 1, "site must not become a measurement test");
        let mut ds = crate::model::Dataset::new(); ds.merge(imp);
        super::write_csv(&ds, output.to_str().unwrap(), &crate::model::Filter::default()).unwrap();
        let roundtrip = crate::csv_io::import_csv(&output, &mut |_, _| {}).unwrap();
        assert_eq!(roundtrip.site, ds.site);
        assert_eq!(roundtrip.cols, ds.cols);
        assert_eq!(roundtrip.tests[0].units, "V");
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
}
