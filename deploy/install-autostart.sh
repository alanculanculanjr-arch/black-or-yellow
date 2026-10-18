#!/bin/bash
# One-time setup, run in WRITABLE mode:  sudo bash ~/project/deploy/install-autostart.sh
#  - installs and starts the black-or-yellow service (auto-start at boot, restart on crash)
#  - adds the project's Node.js to admin's PATH so "node" and "npm" work in any terminal
set -e
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo: sudo bash $0"; exit 1; }
if ! pi-mode status | grep -q "now: WRITABLE"; then
  echo "The Pi is in READ-ONLY mode, so this setup would vanish at the next reboot."
  echo "First run: sudo pi-mode rw   (the Pi reboots), then run this script again."
  exit 1
fi
if pgrep -u admin -f "node src/server.js" >/dev/null && ! systemctl is-active --quiet black-or-yellow; then
  echo "A game server is already running in a terminal. Stop it with Ctrl+C first, then run this again."
  exit 1
fi

cp /data/project/deploy/black-or-yellow.service /etc/systemd/system/black-or-yellow.service
systemctl daemon-reload
systemctl enable --now black-or-yellow
echo "Service installed and started."

LINE='export PATH=/data/project/.tools/node/bin:$PATH  # Black or Yellow Node.js'
grep -qF '/data/project/.tools/node/bin' /home/admin/.bashrc || { echo "$LINE" >> /home/admin/.bashrc; echo "Node.js added to PATH."; }

sleep 2
systemctl --no-pager --lines=5 status black-or-yellow || true
IP=$(hostname -I | awk '{print $1}')
echo
echo "Players: http://$IP/    Banker: http://$IP/banker"
echo "Now protect the Pi again:  sudo pi-mode ro   (it reboots; the game starts by itself)"
