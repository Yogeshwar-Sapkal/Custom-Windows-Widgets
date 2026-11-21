# Manage Launch at login ourselves, per user only

On Windows the autostart plugin's default mode writes the machine-wide Run key (HKLM) whenever the app has admin rights, only falling back to the current user's key (HKCU) otherwise, and the plugin gives no way to choose. Switching it off from a normal session cannot remove an HKLM entry, so one was left behind next to the HKCU one and Windows started two copies at sign-in. We replaced the plugin with a small module that reads and writes only HKCU (the Run value plus the Task Manager "StartupApproved" flag), behind an interface so its rules are unit tested, and added a single-instance guard so a second launch can never open a second set of widgets.

## Considered Options

- **Keep the plugin and only add the single-instance guard.** Stops the duplicate windows, but leaves an HKLM entry that the tray toggle can neither report correctly nor remove.
- **Patch or fork the plugin to force per-user mode.** Fixes the cause, but means maintaining a fork of a dependency for about a hundred lines of registry code.

## Consequences

- We own a little Windows-specific registry code, including the StartupApproved convention (enabled when the last 8 bytes are zero), which Microsoft does not document.
- An HKLM entry written by an older version is not touched by the new code; it needs a one-time manual removal from an administrator PowerShell (see the README). With the guard it is harmless in the meantime, because the extra launch exits immediately.
- Start at login is Windows-only; other platforms get stubs that report it as off.
