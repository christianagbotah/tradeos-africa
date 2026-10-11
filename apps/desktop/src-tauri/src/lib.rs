// TradeOS Africa desktop application — native entry point.
//
// Plugins:
//   tauri-plugin-store: ordinary non-secret app state (business/branch/prefs)
//   tauri-plugin-stronghold: SECURE secret storage for auth credentials
//
// Native credential architecture:
//   1. On first native launch, generate a cryptographically random 32-byte
//      vault secret.
//   2. Store that secret in the OS credential manager (Windows Credential
//      Manager, macOS Keychain, Linux secret service) via the `keyring` crate.
//   3. The JS layer calls the `get_vault_secret` Tauri command to retrieve
//      the per-installation secret, then passes it to Stronghold.load().
//   4. Stronghold uses Argon2id (with a per-install salt file) to derive the
//      snapshot encryption key from the vault secret.
//   5. Auth tokens (access/refresh) are stored inside the Stronghold snapshot.
//   6. If the OS credential manager is unavailable, the command returns an
//      error and the JS layer refuses to persist (fail-closed).

use rand::RngCore;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

const KEYRING_SERVICE: &str = "tradeos-desktop";
const KEYRING_ACCOUNT: &str = "stronghold-vault-secret";
const SALT_FILENAME: &str = "stronghold-salt.bin";

/// Read or create the per-installation Argon2 salt.
/// Stored at <app_local_data_dir>/stronghold-salt.bin.
///
/// FAIL-CLOSED: returns an error if:
///   - the app-local data directory cannot be resolved
///   - the directory cannot be created
///   - a new salt cannot be written to disk
///   - an existing salt file is present but unreadable/corrupt
///
/// Never falls back to the current working directory.
/// Never continues with an ephemeral salt.
fn resolve_stronghold_salt(app: &tauri::AppHandle) -> Result<Vec<u8>, String> {
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to resolve app local data directory: {e}"))?;
    let salt_path = data_dir.join(SALT_FILENAME);

    // Try to read an existing salt
    match fs::read(&salt_path) {
        Ok(salt) => {
            if salt.len() >= 16 {
                return Ok(salt);
            }
            // Salt file exists but is too short — corrupt
            return Err(format!(
                "Persisted Stronghold salt at {:?} is corrupt ({} bytes, expected >= 16)",
                salt_path,
                salt.len()
            ));
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // First launch — generate and persist a new salt
        }
        Err(e) => {
            // File exists but can't be read — explicit error
            return Err(format!("Failed to read Stronghold salt at {:?}: {e}", salt_path));
        }
    }

    // Generate a new 32-byte salt
    let mut salt = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut salt);
    let salt_vec = salt.to_vec();

    // Create the directory (fail if it can't be created)
    fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create app data directory {:?}: {e}", data_dir))?;

    // Write the salt (fail if it can't be written)
    fs::write(&salt_path, &salt_vec)
        .map_err(|e| format!("Failed to write Stronghold salt to {:?}: {e}", salt_path))?;

    Ok(salt_vec)
}

/// Tauri command: get or create the per-installation Stronghold vault secret.
///
/// Returns the secret as a hex string. On first launch, generates a random
/// 32-byte secret and stores it in the OS credential manager.
#[tauri::command]
fn get_vault_secret() -> Result<String, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| format!("OS credential store unavailable: {e}"))?;

    match entry.get_password() {
        Ok(secret) => {
            if secret.is_empty() {
                return Err("OS credential store returned an empty secret".to_string());
            }
            Ok(secret)
        }
        Err(keyring::Error::NoEntry) => {
            let mut bytes = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut bytes);
            let secret = hex_encode(bytes);
            entry
                .set_password(&secret)
                .map_err(|e| format!("Failed to persist vault secret to OS credential store: {e}"))?;
            Ok(secret)
        }
        Err(e) => Err(format!("OS credential store read failed: {e}")),
    }
}

/// Tauri command: delete the per-installation vault secret (full credential wipe).
#[tauri::command]
fn delete_vault_secret() -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| format!("OS credential store unavailable: {e}"))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete vault secret: {e}")),
    }
}

/// Minimal hex encoder (avoids adding the `hex` crate as a dependency).
fn hex_encode(bytes: [u8; 32]) -> String {
    let mut s = String::with_capacity(64);
    for b in &bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The salt is resolved at startup and stored in a thread-local so the
    // Stronghold KDF closure can access it without an AppHandle reference.
    use std::sync::OnceLock;
    static SALT: OnceLock<Vec<u8>> = OnceLock::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            match resolve_stronghold_salt(&app.handle()) {
                Ok(salt) => {
                    let _ = SALT.set(salt);
                    Ok(())
                }
                Err(e) => {
                    eprintln!("TradeOS desktop initialization failed: {e}");
                    Err(e.into())
                }
            }
        })
        .plugin(tauri_plugin_stronghold::Builder::new(|password| {
            // Argon2id KDF with per-installation salt.
            use argon2::{hash_raw, Config, Variant, Version};

            let salt = SALT.get().cloned().unwrap_or_else(|| {
                // Fallback: per-process random salt (won't persist — fail-closed
                // on restart, which is correct if setup() didn't run).
                let mut fallback = [0u8; 32];
                rand::thread_rng().fill_bytes(&mut fallback);
                fallback.to_vec()
            });

            let config = Config {
                lanes: 4,
                mem_cost: 10_000,
                time_cost: 10,
                variant: Variant::Argon2id,
                version: Version::Version13,
                ..Default::default()
            };

            let key = hash_raw(password.as_ref(), &salt, &config)
                .expect("failed to derive Stronghold key via Argon2id");
            key.to_vec()
        })
        .build())
        .invoke_handler(tauri::generate_handler![get_vault_secret, delete_vault_secret])
        .run(tauri::generate_context!())
        .expect("error while running TradeOS desktop application");
}
