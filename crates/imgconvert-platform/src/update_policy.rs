// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 ImgConvert contributors

//! Compatibility gate for the GPUI update channel. Metadata is evaluated
//! before any package download; signatures remain the installer's responsibility.

use serde_json::Value;

#[derive(Debug, thiserror::Error)]
pub enum UpdatePolicyError {
    #[error("Invalid minimum_system_version or host version")]
    InvalidVersion,
    #[error("Update manifest has no minimum_system_version for this system")]
    MissingMinimum,
    #[error("Update manifest lowers the supported system baseline")]
    BaselineLowered,
    #[error("Unsupported update platform")]
    UnsupportedPlatform,
    #[error("This update requires {os} {minimum} or later")]
    SystemTooOld { os: String, minimum: String },
    #[error(
        "This update requires a hardware Vulkan 1.3 device; use the web edition on this machine"
    )]
    HardwareVulkanRequired,
    #[error("Update manifest has no version")]
    MissingVersion,
    #[error("Cannot determine the kernel version")]
    HostVersionUnknown,
}

fn version(value: &str) -> Result<[u32; 3], UpdatePolicyError> {
    let parts: Vec<_> = value.split('.').collect();
    if parts.is_empty() || parts.len() > 3 {
        return Err(UpdatePolicyError::InvalidVersion);
    }
    let mut result = [0; 3];
    for (ix, part) in parts.iter().enumerate() {
        if part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
            return Err(UpdatePolicyError::InvalidVersion);
        }
        result[ix] = part
            .parse()
            .map_err(|_| UpdatePolicyError::InvalidVersion)?;
    }
    Ok(result)
}

/// Legacy 0.3.x updates do not require a Vulkan-capable GPUI host.
pub fn requires_gpui_guard(release: &str) -> Result<bool, UpdatePolicyError> {
    let value = release
        .trim_start_matches('v')
        .split('-')
        .next()
        .unwrap_or("");
    let value = value.split('+').next().unwrap_or("");
    let [major, minor, _] = version(value)?;
    Ok(major > 0 || minor >= 4)
}

/// `minimum_system_version` maps OS names to numeric dotted versions. Linux
/// compares kernel versions; GPU eligibility is an independent mandatory gate.
pub fn validate(
    manifest: &Value,
    os: &str,
    host_version: &str,
    hardware_vulkan_13: bool,
) -> Result<(), UpdatePolicyError> {
    let minimum = manifest
        .get("minimum_system_version")
        .and_then(|v| v.get(os))
        .and_then(Value::as_str)
        .ok_or(UpdatePolicyError::MissingMinimum)?;
    let required = version(minimum)?;
    let floor = match os {
        "macos" => [12, 0, 0],
        "windows" => [10, 0, 18362],
        "linux" => [0, 0, 0],
        _ => return Err(UpdatePolicyError::UnsupportedPlatform),
    };
    if required < floor {
        return Err(UpdatePolicyError::BaselineLowered);
    }
    if version(host_version)? < required {
        return Err(UpdatePolicyError::SystemTooOld {
            os: os.into(),
            minimum: minimum.into(),
        });
    }
    if os == "linux" && !hardware_vulkan_13 {
        return Err(UpdatePolicyError::HardwareVulkanRequired);
    }
    Ok(())
}

/// Checks real host facts without touching settings or application caches.
pub fn validate_on_host(manifest: &Value) -> Result<(), UpdatePolicyError> {
    let release = manifest
        .get("version")
        .and_then(Value::as_str)
        .ok_or(UpdatePolicyError::MissingVersion)?;
    if !requires_gpui_guard(release)? {
        return Ok(());
    }
    let os = std::env::consts::OS;
    #[cfg(target_os = "linux")]
    let host = {
        let mut info = std::mem::MaybeUninit::<libc::utsname>::uninit();
        // SAFETY: uname initializes the provided structure on success.
        if unsafe { libc::uname(info.as_mut_ptr()) } != 0 {
            return Err(UpdatePolicyError::HostVersionUnknown);
        }
        // SAFETY: successful uname produced a NUL-terminated release buffer.
        let info = unsafe { info.assume_init() };
        let release = unsafe { std::ffi::CStr::from_ptr(info.release.as_ptr()) };
        release
            .to_string_lossy()
            .split('-')
            .next()
            .unwrap_or("")
            .to_string()
    };
    #[cfg(not(target_os = "linux"))]
    let host = os_info::get().version().to_string();
    validate(manifest, os, &host, hardware_vulkan_13())
}

#[cfg(not(target_os = "linux"))]
fn hardware_vulkan_13() -> bool {
    true
}

#[cfg(target_os = "linux")]
fn hardware_vulkan_13() -> bool {
    // SAFETY: all Vulkan objects are used synchronously while their loader
    // remains alive; the instance is destroyed on every post-creation path.
    unsafe {
        let Ok(entry) = ash::Entry::load() else {
            return false;
        };
        let info = ash::vk::InstanceCreateInfo::default();
        let Ok(instance) = entry.create_instance(&info, None) else {
            return false;
        };
        let supported = instance.enumerate_physical_devices().is_ok_and(|devices| {
            devices.iter().any(|device| {
                let properties = instance.get_physical_device_properties(*device);
                matches!(
                    properties.device_type,
                    ash::vk::PhysicalDeviceType::DISCRETE_GPU
                        | ash::vk::PhysicalDeviceType::INTEGRATED_GPU
                        | ash::vk::PhysicalDeviceType::VIRTUAL_GPU
                ) && properties.api_version >= ash::vk::API_VERSION_1_3
            })
        });
        instance.destroy_instance(None);
        supported
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn rejects_missing_malformed_or_weakened_minimum() {
        for value in [
            json!({}),
            json!({"minimum_system_version":{"macos":"12.beta"}}),
            json!({"minimum_system_version":{"macos":"11.0"}}),
        ] {
            assert!(validate(&value, "macos", "13.6", true).is_err());
        }
    }
    #[test]
    fn compares_versions_numerically_and_fails_closed_on_unknown_hosts() {
        let value = json!({"minimum_system_version":{"windows":"10.0.19045"}});
        assert!(validate(&value, "windows", "10.0.18362", true).is_err());
        assert!(validate(&value, "windows", "10.0.22631", true).is_ok());
        assert!(validate(&value, "windows", "unknown", true).is_err());
    }
    #[test]
    fn linux_rejects_no_gpu_and_software_only_gpu() {
        let value = json!({"minimum_system_version":{"linux":"5.4"}});
        assert!(validate(&value, "linux", "6.8", false).is_err());
        assert!(validate(&value, "linux", "6.8", true).is_ok());
    }
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[test]
    fn native_host_version_can_be_compared_with_the_supported_baseline() {
        let value = json!({"version":"0.4.1", "minimum_system_version":{
            "macos":"12", "windows":"10.0.18362"
        }});
        validate_on_host(&value).unwrap();
    }

    #[test]
    fn old_updates_still_work_on_pre_gpui_hosts() {
        assert!(!requires_gpui_guard("0.3.2").unwrap());
        assert!(requires_gpui_guard("v0.4.0-beta.1").unwrap());
        assert!(requires_gpui_guard("1.0.0").unwrap());
        assert!(requires_gpui_guard("bad").is_err());
    }
}
