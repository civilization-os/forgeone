//! 标准桌面存储：以 JSON 文件持久化前端配置/数据到系统应用配置目录。
//!
//! 位置：`app_config_dir`（Windows 为 `%APPDATA%\com.forgeone.desktop`），
//! 每个 key 对应一个 `<key>.json` 文件。替代前端 localStorage，
//! 使数据与 WebView origin 解耦，打包版与 dev 模式共享同一份数据。

use tauri::Manager;

#[tauri::command]
pub fn store_read(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{key}.json"));
    match std::fs::read_to_string(&path) {
        Ok(value) => Ok(Some(value)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn store_write(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(format!("{key}.json")), value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn store_remove(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let path = dir.join(format!("{key}.json"));
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
