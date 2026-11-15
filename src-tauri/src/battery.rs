//! Battery information for this PC and for paired Bluetooth devices.
//!
//! The Windows-specific calls live in `win` and are kept thin; everything else is plain
//! logic that is unit tested on any platform.
//!
//! What Windows can and cannot tell us:
//! - This PC's battery: `GetSystemPowerStatus` (reliable on laptops; no battery on desktops).
//! - Bluetooth devices: Windows stores a battery level on the device's PnP node for many
//!   devices (headphones, mice, keyboards, some phones). Devices that do not report one
//!   are listed without a percentage.
//! - Phone Link has no public interface, so a phone only appears if it is paired over
//!   Bluetooth, and only has a percentage if Windows reports one for it.

// The helpers below are only called from the Windows code (and tests) on other platforms.
#![cfg_attr(not(windows), allow(dead_code))]

use serde::Serialize;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PcBattery {
    pub percent: u8,
    pub plugged_in: bool,
    pub charging: bool,
    pub minutes_left: Option<u32>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BluetoothDevice {
    pub id: String,
    pub name: String,
    pub percent: Option<u8>,
    pub connected: Option<bool>,
}

#[derive(Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct BatteryReport {
    /// False when running somewhere other than Windows (nothing can be read).
    pub supported: bool,
    pub pc: Option<PcBattery>,
    pub devices: Vec<BluetoothDevice>,
    /// Set when the device scan failed; the PC battery may still be present.
    pub error: Option<String>,
}

/// Which kind of PnP node a reading came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeKind {
    /// The device itself: `BTHENUM\DEV_<address>\...` or `BTHLE\DEV_<address>\...`.
    Device,
    /// A service node of a classic device, e.g. Hands-Free:
    /// `BTHENUM\{0000111E-...}_..._VID&..\7&..&0&<address>_C00000000`.
    /// Windows can keep the battery level here instead of on the device node.
    Service,
}

/// One PnP node as read from Windows, before duplicates are merged.
#[derive(Debug, Clone, PartialEq)]
pub struct RawDevice {
    pub address: String,
    pub kind: NodeKind,
    pub name: String,
    pub percent: Option<u8>,
    pub connected: Option<bool>,
}

/// Turn the values from `GetSystemPowerStatus` into a `PcBattery`.
/// Returns `None` for a desktop (no battery) or when Windows can't tell.
pub fn pc_from_status(ac_line: u8, flag: u8, percent: u8, life_seconds: u32) -> Option<PcBattery> {
    const NO_BATTERY: u8 = 128;
    const CHARGING: u8 = 8;
    const UNKNOWN_PERCENT: u8 = 255;
    const UNKNOWN_LIFE: u32 = 0xFFFF_FFFF;

    if flag != 255 && flag & NO_BATTERY != 0 {
        return None;
    }
    if percent == UNKNOWN_PERCENT || percent > 100 {
        return None;
    }
    let plugged_in = ac_line == 1;
    let charging = flag != 255 && flag & CHARGING != 0;
    let minutes_left = if life_seconds == UNKNOWN_LIFE || plugged_in {
        None
    } else {
        Some(life_seconds / 60)
    };
    Some(PcBattery { percent, plugged_in, charging, minutes_left })
}

/// Extract the 12-hex-digit Bluetooth address from a device-level instance id such as
/// `BTHENUM\DEV_AABBCCDDEEFF\...` or `BTHLE\DEV_AABBCCDDEEFF\...`.
/// Service-level nodes (`BTHENUM\{uuid}_VID&...`) return `None`.
pub fn address_from_instance_id(instance_id: &str) -> Option<String> {
    let upper = instance_id.to_ascii_uppercase();
    let mut parts = upper.split('\\');
    let bus = parts.next()?;
    if bus != "BTHENUM" && bus != "BTHLE" {
        return None;
    }
    let dev = parts.next()?.strip_prefix("DEV_")?;
    if dev.len() == 12 && dev.bytes().all(|b| b.is_ascii_hexdigit()) {
        Some(dev.to_string())
    } else {
        None
    }
}

/// Work out which Bluetooth device a PnP node belongs to, and whether it is the device's own
/// node or one of its service nodes. Returns `None` for anything else.
pub fn classify_instance_id(instance_id: &str) -> Option<(String, NodeKind)> {
    if let Some(address) = address_from_instance_id(instance_id) {
        return Some((address, NodeKind::Device));
    }
    // Service nodes exist only under BTHENUM and end with `...&<address>_<hex suffix>`.
    let upper = instance_id.to_ascii_uppercase();
    let mut parts = upper.split('\\');
    if parts.next()? != "BTHENUM" {
        return None;
    }
    if !parts.next()?.starts_with('{') {
        return None;
    }
    let tail = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    let (_, last) = tail.rsplit_once('&')?;
    let (address, suffix) = last.split_once('_')?;
    let is_hex = |t: &str| !t.is_empty() && t.bytes().all(|b| b.is_ascii_hexdigit());
    if address.len() == 12 && is_hex(address) && is_hex(suffix) {
        Some((address.to_string(), NodeKind::Service))
    } else {
        None
    }
}

/// Build a `RawDevice` from the values read off one PnP node (`None` if it is not a Bluetooth node).
pub fn raw_from_node(
    instance_id: &str,
    name: String,
    percent: Option<u8>,
    connected: Option<bool>,
) -> Option<RawDevice> {
    let (address, kind) = classify_instance_id(instance_id)?;
    Some(RawDevice { address, kind, name, percent, connected })
}

/// Merge the several PnP nodes one physical device can have into one entry per address.
/// Prefers a node that has a battery reading, then one that is connected, and keeps the
/// first non-empty name. Service nodes only contribute a battery level, and only to a
/// device that has its own node. Result is sorted: connected devices first, then by name.
pub fn merge_devices(raw: Vec<RawDevice>) -> Vec<BluetoothDevice> {
    use std::collections::BTreeMap;
    let mut by_address: BTreeMap<String, BluetoothDevice> = BTreeMap::new();

    for r in raw.iter().filter(|r| r.kind == NodeKind::Device) {
        let entry = by_address.entry(r.address.clone()).or_insert_with(|| BluetoothDevice {
            id: r.address.clone(),
            name: String::new(),
            percent: None,
            connected: None,
        });
        if entry.name.is_empty() && !r.name.trim().is_empty() {
            entry.name = r.name.trim().to_string();
        }
        if entry.percent.is_none() {
            entry.percent = r.percent.filter(|p| *p <= 100);
        }
        entry.connected = match (entry.connected, r.connected) {
            (Some(true), _) | (_, Some(true)) => Some(true),
            (Some(false), _) | (_, Some(false)) => Some(false),
            _ => None,
        };
    }

    // Classic devices such as speakers keep the level on a service node (e.g. Hands-Free).
    for r in raw.iter().filter(|r| r.kind == NodeKind::Service) {
        if let Some(entry) = by_address.get_mut(&r.address) {
            if entry.percent.is_none() {
                entry.percent = r.percent.filter(|p| *p <= 100);
            }
        }
    }

    let mut devices: Vec<BluetoothDevice> = by_address
        .into_values()
        .map(|mut d| {
            if d.name.is_empty() {
                d.name = format!("Bluetooth device {}", &d.id[d.id.len() - 4..]);
            }
            d
        })
        .collect();
    devices.sort_by(|a, b| {
        let rank = |d: &BluetoothDevice| match d.connected {
            Some(true) => 0,
            None => 1,
            Some(false) => 2,
        };
        rank(a).cmp(&rank(b)).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    devices
}

/// Read everything. Blocking (a few milliseconds to a few hundred); call off the UI thread.
pub fn read_report() -> BatteryReport {
    #[cfg(windows)]
    {
        let pc = win::pc_battery();
        match win::bluetooth_devices() {
            Ok(raw) => BatteryReport { supported: true, pc, devices: merge_devices(raw), error: None },
            Err(e) => BatteryReport { supported: true, pc, devices: Vec::new(), error: Some(e) },
        }
    }
    #[cfg(not(windows))]
    {
        BatteryReport { supported: false, ..Default::default() }
    }
}

#[cfg(windows)]
mod win {
    use super::{classify_instance_id, pc_from_status, raw_from_node, PcBattery, RawDevice};
    use windows::core::{GUID, PCWSTR};
    use windows::Win32::Devices::DeviceAndDriverInstallation::{
        SetupDiDestroyDeviceInfoList, SetupDiEnumDeviceInfo, SetupDiGetClassDevsW,
        SetupDiGetDeviceInstanceIdW, SetupDiGetDevicePropertyW, DIGCF_ALLCLASSES, DIGCF_PRESENT,
        HDEVINFO, SP_DEVINFO_DATA,
    };
    use windows::Win32::Devices::Properties::DEVPROPTYPE;
    use windows::Win32::Foundation::DEVPROPKEY;
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

    // Battery level (percent, one byte) Windows stores on a Bluetooth device node.
    const BATTERY: DEVPROPKEY = DEVPROPKEY {
        fmtid: GUID::from_u128(0x104EA319_6EE2_4701_BD47_8DDBF425BBE5),
        pid: 2,
    };
    // DEVPKEY_Device_IsConnected (boolean).
    const IS_CONNECTED: DEVPROPKEY = DEVPROPKEY {
        fmtid: GUID::from_u128(0x83DA6326_97A6_4088_9453_A1923F573B29),
        pid: 15,
    };
    // DEVPKEY_Device_FriendlyName, then DEVPKEY_Device_DeviceDesc as a fallback.
    const FRIENDLY_NAME: DEVPROPKEY = DEVPROPKEY {
        fmtid: GUID::from_u128(0xA45C254E_DF1C_4EFD_8020_67D146A850E0),
        pid: 14,
    };
    const DEVICE_DESC: DEVPROPKEY = DEVPROPKEY {
        fmtid: GUID::from_u128(0xA45C254E_DF1C_4EFD_8020_67D146A850E0),
        pid: 2,
    };

    pub fn pc_battery() -> Option<PcBattery> {
        let mut status = SYSTEM_POWER_STATUS::default();
        unsafe { GetSystemPowerStatus(&mut status).ok()? };
        pc_from_status(status.ACLineStatus, status.BatteryFlag, status.BatteryLifePercent, status.BatteryLifeTime)
    }

    /// Frees the device info set when dropped.
    struct DevInfoSet(HDEVINFO);
    impl Drop for DevInfoSet {
        fn drop(&mut self) {
            unsafe {
                let _ = SetupDiDestroyDeviceInfoList(self.0);
            }
        }
    }

    pub fn bluetooth_devices() -> Result<Vec<RawDevice>, String> {
        let mut all = Vec::new();
        // Classic Bluetooth devices and Bluetooth LE devices enumerate under different buses.
        for bus in ["BTHENUM", "BTHLE"] {
            all.extend(scan_bus(bus)?);
        }
        Ok(all)
    }

    fn scan_bus(bus: &str) -> Result<Vec<RawDevice>, String> {
        let bus_w: Vec<u16> = bus.encode_utf16().chain(std::iter::once(0)).collect();
        let set = unsafe {
            SetupDiGetClassDevsW(None, PCWSTR(bus_w.as_ptr()), None, DIGCF_ALLCLASSES | DIGCF_PRESENT)
        }
        .map_err(|e| format!("device scan failed: {e}"))?;
        let set = DevInfoSet(set);

        let mut out = Vec::new();
        let mut index = 0u32;
        loop {
            let mut data = SP_DEVINFO_DATA {
                cbSize: std::mem::size_of::<SP_DEVINFO_DATA>() as u32,
                ..Default::default()
            };
            if unsafe { SetupDiEnumDeviceInfo(set.0, index, &mut data) }.is_err() {
                break; // no more devices
            }
            index += 1;

            let Some(instance_id) = instance_id(&set, &data) else { continue };
            // Skip nodes that are not Bluetooth devices or their service nodes.
            if classify_instance_id(&instance_id).is_none() { continue }

            let name = string_prop(&set, &data, &FRIENDLY_NAME)
                .or_else(|| string_prop(&set, &data, &DEVICE_DESC))
                .unwrap_or_default();
            let percent = byte_prop(&set, &data, &BATTERY);
            let connected = byte_prop(&set, &data, &IS_CONNECTED).map(|b| b != 0);
            out.extend(raw_from_node(&instance_id, name, percent, connected));
        }
        Ok(out)
    }

    fn instance_id(set: &DevInfoSet, data: &SP_DEVINFO_DATA) -> Option<String> {
        let mut buf = [0u16; 512];
        unsafe { SetupDiGetDeviceInstanceIdW(set.0, data, Some(&mut buf), None) }.ok()?;
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Some(String::from_utf16_lossy(&buf[..len]))
    }

    /// Read a property's raw bytes, or `None` if the device does not have it.
    fn raw_prop(set: &DevInfoSet, data: &SP_DEVINFO_DATA, key: &DEVPROPKEY) -> Option<Vec<u8>> {
        let mut ty = DEVPROPTYPE(0);
        let mut buf = vec![0u8; 512];
        let mut needed = 0u32;
        let ok = unsafe {
            SetupDiGetDevicePropertyW(set.0, data, key, &mut ty, Some(&mut buf), Some(&mut needed), 0)
        };
        if ok.is_err() {
            return None;
        }
        buf.truncate((needed as usize).min(buf.len()));
        Some(buf)
    }

    fn byte_prop(set: &DevInfoSet, data: &SP_DEVINFO_DATA, key: &DEVPROPKEY) -> Option<u8> {
        raw_prop(set, data, key)?.first().copied()
    }

    fn string_prop(set: &DevInfoSet, data: &SP_DEVINFO_DATA, key: &DEVPROPKEY) -> Option<String> {
        let bytes = raw_prop(set, data, key)?;
        let wide: Vec<u16> = bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        let len = wide.iter().position(|&c| c == 0).unwrap_or(wide.len());
        let s = String::from_utf16_lossy(&wide[..len]);
        if s.trim().is_empty() { None } else { Some(s) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(addr: &str, name: &str, pct: Option<u8>, conn: Option<bool>) -> RawDevice {
        RawDevice { address: addr.into(), kind: NodeKind::Device, name: name.into(), percent: pct, connected: conn }
    }

    #[test]
    fn laptop_on_battery() {
        let b = pc_from_status(0, 0, 63, 7260).unwrap();
        assert_eq!(b, PcBattery { percent: 63, plugged_in: false, charging: false, minutes_left: Some(121) });
    }

    #[test]
    fn laptop_charging_has_no_time_left() {
        let b = pc_from_status(1, 8, 80, 0xFFFF_FFFF).unwrap();
        assert!(b.plugged_in && b.charging);
        assert_eq!(b.minutes_left, None);
    }

    #[test]
    fn plugged_in_and_full_is_not_charging() {
        let b = pc_from_status(1, 0, 100, 0xFFFF_FFFF).unwrap();
        assert!(b.plugged_in && !b.charging);
    }

    #[test]
    fn desktop_without_battery() {
        assert_eq!(pc_from_status(1, 128, 255, 0xFFFF_FFFF), None);
    }

    #[test]
    fn unknown_values_are_handled() {
        assert_eq!(pc_from_status(255, 255, 255, 0xFFFF_FFFF), None);
        assert_eq!(pc_from_status(0, 255, 50, 0xFFFF_FFFF).unwrap().percent, 50);
        assert_eq!(pc_from_status(0, 0, 150, 0), None, "out-of-range percent is rejected");
    }

    #[test]
    fn instance_ids() {
        assert_eq!(
            address_from_instance_id(r"BTHENUM\DEV_AABBCCDDEEFF\7&1234&0&BLUETOOTHDEVICE_AABBCCDDEEFF").as_deref(),
            Some("AABBCCDDEEFF")
        );
        assert_eq!(
            address_from_instance_id(r"BTHLE\Dev_001122334455\8&abc&0&001122334455").as_deref(),
            Some("001122334455")
        );
        // service-level node, wrong bus, malformed address
        assert_eq!(address_from_instance_id(r"BTHENUM\{0000110B-0000-1000-8000-00805F9B34FB}_VID&0001004C\7&1&0&x"), None);
        assert_eq!(address_from_instance_id(r"USB\DEV_AABBCCDDEEFF\1"), None);
        assert_eq!(address_from_instance_id(r"BTHENUM\DEV_AABB\1"), None);
        assert_eq!(address_from_instance_id(r"BTHENUM\DEV_GGGGGGGGGGGG\1"), None);
        assert_eq!(address_from_instance_id(""), None);
    }

    #[test]
    fn merging_prefers_battery_and_connection() {
        let merged = merge_devices(vec![
            raw("A1A1A1A1A1A1", "Galaxy Buds", None, Some(false)),
            raw("A1A1A1A1A1A1", "", Some(71), Some(true)),
            raw("B2B2B2B2B2B2", "Mouse", Some(40), None),
            raw("C3C3C3C3C3C3", "Phone", None, Some(true)),
        ]);
        assert_eq!(merged.len(), 3);
        let buds = merged.iter().find(|d| d.id == "A1A1A1A1A1A1").unwrap();
        assert_eq!((buds.name.as_str(), buds.percent, buds.connected), ("Galaxy Buds", Some(71), Some(true)));
        // connected first (Buds, Phone alphabetically), unknown connection after
        let names: Vec<&str> = merged.iter().map(|d| d.name.as_str()).collect();
        assert_eq!(names, vec!["Galaxy Buds", "Phone", "Mouse"]);
    }

    #[test]
    fn nameless_devices_get_a_label_and_bad_percent_is_dropped() {
        let merged = merge_devices(vec![raw("D4D4D4D4D4D4", "  ", Some(200), Some(false))]);
        assert_eq!(merged[0].name, "Bluetooth device D4D4");
        assert_eq!(merged[0].percent, None);
    }

    // ---- Captured from a real PC (PnP entries Windows reported while the devices were connected).
    // (instance id, friendly name, battery byte, IsConnected)
    type Node = (&'static str, &'static str, Option<u8>, Option<bool>);
    const CAPTURED: [Node; 8] = [
        // OontZ speaker (classic Bluetooth): the level is on the Hands-Free service node, not the device node.
        (r"BTHENUM\DEV_19D7D47C3B3B\7&6540B43&0&BLUETOOTHDEVICE_19D7D47C3B3B", "OontZ Angle 3 DS 131", None, Some(true)),
        (r"BTHENUM\{0000111E-0000-1000-8000-00805F9B34FB}_HCIBYPASS_VID&000105D6_PID&000A\7&6540B43&0&19D7D47C3B3B_C00000000", "OontZ Angle 3 DS 131 Hands-Free AG", Some(70), None),
        (r"BTHENUM\{0000110E-0000-1000-8000-00805F9B34FB}_VID&000105D6_PID&000A\7&6540B43&0&19D7D47C3B3B_C00000000", "OontZ Angle 3 DS 131 Avrcp Transport", None, None),
        (r"BTHENUM\{0000110B-0000-1000-8000-00805F9B34FB}_VID&000105D6_PID&000A\7&6540B43&0&19D7D47C3B3B_C00000000", "OontZ Angle 3 DS 131", None, None),
        // Galaxy Buds4 Pro: one classic entry (not connected) and two low-energy entries that report levels.
        (r"BTHENUM\DEV_A8D162CFBC6F\7&6540B43&0&BLUETOOTHDEVICE_A8D162CFBC6F", "Yogeshwar's Buds4 Pro", None, Some(false)),
        (r"BTHLE\DEV_A8D162CF9073\7&267B7C&0&A8D162CF9073", "Yogeshwar's Buds4 Pro", Some(100), Some(true)),
        (r"BTHLE\DEV_60C1EBFEEE16\7&267B7C&0&60C1EBFEEE16", "Yogeshwar's Buds4 Pro", Some(100), Some(true)),
        // Not a Bluetooth entry at all: must be ignored.
        (r"SWD\MMDEVAPI\{0.0.0.00000000}.{18AAC99A-CBA5-483F-9D62-821FDD013F9F}", "Headphones (OontZ Angle 3 DS 131)", None, None),
    ];

    /// What the Windows scan does with each entry (it calls the same `raw_from_node`).
    fn scan(nodes: &[Node]) -> Vec<RawDevice> {
        nodes
            .iter()
            .filter_map(|(id, name, percent, connected)| raw_from_node(id, name.to_string(), *percent, *connected))
            .collect()
    }

    #[test]
    fn captured_speaker_level_comes_from_its_hands_free_node() {
        let devices = merge_devices(scan(&CAPTURED));
        let oontz = devices.iter().find(|d| d.id == "19D7D47C3B3B").expect("speaker is listed");
        assert_eq!(oontz.name, "OontZ Angle 3 DS 131", "name comes from the device node, not a service node");
        assert_eq!(oontz.connected, Some(true));
        assert_eq!(oontz.percent, Some(70), "Windows Settings shows 70%");
    }

    #[test]
    fn captured_buds_are_unchanged() {
        let devices = merge_devices(scan(&CAPTURED));
        let buds: Vec<_> = devices.iter().filter(|d| d.name.contains("Buds4")).collect();
        assert_eq!(buds.len(), 3, "classic entry plus two low-energy entries, as before");
        assert_eq!(buds.iter().filter(|d| d.percent == Some(100)).count(), 2);
        assert_eq!(devices.len(), 4, "service nodes and audio endpoints never become devices of their own");
    }

    #[test]
    fn service_nodes_are_classified_by_address() {
        let hfp = CAPTURED[1].0;
        assert_eq!(classify_instance_id(hfp), Some(("19D7D47C3B3B".to_string(), NodeKind::Service)));
        assert_eq!(classify_instance_id(CAPTURED[0].0), Some(("19D7D47C3B3B".to_string(), NodeKind::Device)));
        assert_eq!(classify_instance_id(CAPTURED[5].0), Some(("A8D162CF9073".to_string(), NodeKind::Device)));
        // not Bluetooth, no address, wrong bus, address too short, extra path segment
        assert_eq!(classify_instance_id(CAPTURED[7].0), None);
        assert_eq!(classify_instance_id(r"BTHENUM\{0000110B-0000-1000-8000-00805F9B34FB}_VID&0001004C\7&1&0&x"), None);
        assert_eq!(classify_instance_id(r"BTHLE\{0000110B-0000-1000-8000-00805F9B34FB}_VID&1\7&1&0&19D7D47C3B3B_C00000000"), None);
        assert_eq!(classify_instance_id(r"BTHENUM\{0000111E-0000-1000-8000-00805F9B34FB}_X\7&1&0&19D7D4_C00000000"), None);
        assert_eq!(classify_instance_id(r"BTHENUM\{0000111E-0000-1000-8000-00805F9B34FB}_X\a\7&1&0&19D7D47C3B3B_C00000000"), None);
    }

    #[test]
    fn a_service_node_never_creates_a_device_or_overrides_a_level() {
        let service = |addr: &str, pct| RawDevice { address: addr.into(), kind: NodeKind::Service, name: "svc".into(), percent: pct, connected: Some(false) };
        // service node alone (no device node): no device appears
        assert!(merge_devices(vec![service("A1A1A1A1A1A1", Some(50))]).is_empty());
        // device already has its own level: the service node does not replace it, name and connection stay
        let merged = merge_devices(vec![service("B2B2B2B2B2B2", Some(10)), raw("B2B2B2B2B2B2", "Mouse", Some(80), Some(true))]);
        assert_eq!(merged.len(), 1);
        assert_eq!((merged[0].name.as_str(), merged[0].percent, merged[0].connected), ("Mouse", Some(80), Some(true)));
        // out-of-range service level is dropped
        let merged = merge_devices(vec![raw("C3C3C3C3C3C3", "Speaker", None, Some(true)), service("C3C3C3C3C3C3", Some(250))]);
        assert_eq!(merged[0].percent, None);
    }

    #[test]
    fn report_serializes_camel_case() {
        let r = BatteryReport {
            supported: true,
            pc: Some(PcBattery { percent: 5, plugged_in: true, charging: true, minutes_left: None }),
            devices: vec![],
            error: None,
        };
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("\"pluggedIn\":true") && json.contains("\"minutesLeft\":null"), "{json}");
    }
}
