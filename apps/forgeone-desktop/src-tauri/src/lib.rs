pub mod mcp_server;
pub mod store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|_app, args, _cwd| {
            println!("Another instance tried to launch with args: {:?}", args);
            // In a real app, we would focus the main window here
        }))
        .invoke_handler(tauri::generate_handler![
            store::store_read,
            store::store_write,
            store::store_remove,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            
            // Spawn the MCP server in a background Tokio task
            let runtime = std::sync::Arc::new(forgeone_runtime::RuntimeCore::default());
            tauri::async_runtime::spawn(async move {
                mcp_server::start_mcp_server(runtime).await;
            });
            
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
