mod commands;
mod archive;
mod csv_io;
mod dataset;
mod model;
mod query;
mod stats;
mod stdf;
mod z_decode;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(commands::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::pick_files,
            commands::pick_save_path,
            commands::pick_template,
            commands::open_in_explorer,
            commands::pick_folder,
            commands::open_paths,
            commands::inspect_csv,
            commands::dataset_info,
            commands::add_custom_column,
            commands::remove_custom_column,
            commands::restore_custom_columns,
            commands::box_plot,
            commands::wafer_map,
            commands::wafer_maps,
            commands::bin_overview,
            commands::pareto,
            commands::histogram,
            commands::trend,
            commands::scatter,
            commands::export_csv,
            commands::save_binary,
            commands::save_text,
            commands::read_text,
            commands::file_name,
        ])
        .run(tauri::generate_context!())
        .expect("error while running EWS Data Tool");
}
