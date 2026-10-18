# About this Raspberry Pi

Raspberry Pi 5 (8 GB RAM), hostname `pi5`, user `admin`, Raspberry Pi OS Trixie 64-bit
desktop. Runs headless (no monitor). The owner reaches it through Raspberry Pi Connect
(connect.raspberrypi.com: remote shell / screen sharing) or SSH from a Windows laptop.
Known Wi-Fi: "Maya" (home) and "Lan" (owner's phone hotspot, used when away from home).

## The SD card is counterfeit: read this before touching storage

The card claims 32 GB but only ~14.6 GiB is real. Anything written past that is silently
discarded, which corrupted earlier installs, froze the Pi and once stopped it booting.
It was set up on 2026-10-14 like this:

| Partition | Size | Mount | Notes |
|---|---|---|---|
| mmcblk0p1 | 512 MB | /boot/firmware | FAT boot files, cmdline.txt |
| mmcblk0p2 | 9.5 GB (ends at 10 GiB) | / | **read-only** (overlayroot) |
| mmcblk0p3 | 3.3 GB (ends ~13.3 GiB) | /data | writable ext4: project + Claude settings |
| (rest) | ~16 GB | none | FAKE capacity, never use |

Rules:
- NEVER grow, add or move partitions, run resize2fs/growpart, or use raspi-config
  "Expand Filesystem". Nothing may be written past ~14 GiB of the disk.
- Keep an eye on free space (`df -h / /data`); warn before large installs or downloads.
- If you see `EXT4-fs error` in `dmesg`, stop and tell the owner.

## Read-only mode (overlayroot)

The root filesystem is an overlay: changes to it go to RAM and **vanish on reboot**.
Only `/data` is persistent.
- `~/project` is a symlink to `/data/project`. Keep all project work there.
- Claude Code config lives in `/data/claude` (`CLAUDE_CONFIG_DIR`, set in ~/.bashrc);
  auto-updates are disabled (`DISABLE_AUTOUPDATER=1`).
- `pi-mode status` shows the mode. To install packages or change system settings
  permanently: `sudo pi-mode rw` (reboots writable) → make changes → `sudo pi-mode ro`
  (reboots protected). Tell the owner when a change needs this, since each switch reboots
  and drops their Connect/SSH session.
- `apt install` in read-only mode works only until the next reboot. Use a Python venv
  inside `~/project` for project libraries so they persist without switching modes.
- Kernel cmdline also has `systemd.watchdog_sec=15` (auto-reboot on hang) and
  `fsck.mode=force`. Setup script: `/usr/local/sbin/pi-harden`.

## Working with the owner

- They're new to Linux and the Pi: explain steps simply, one command at a time, and say
  whether a command runs on the Pi or on the laptop.
- Pasting into the desktop terminal through Connect screen sharing adds junk like
  `^[[200~`. Suggest the Connect remote shell or SSH instead, or
  `bind 'set enable-bracketed-paste off'` for the current session.
- Shut down with `sudo poweroff`. Pulling power can't damage the OS now, but it can
  still hurt `/data`.
- The real fix is a genuine SD card (SanDisk/Samsung from an official store); recommend
  it if storage problems come back.
