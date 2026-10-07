#!/usr/bin/env bash
# Paws of Sherwood bot - Linux / macOS installer
#   curl -fsSL https://raw.githubusercontent.com/rygroup-dev/paws-bot/main/install.sh | bash
# Installs to ~/paws-bot (or $PAWS_DIR). Re-running updates the code and keeps .env and data/.
# On Linux with systemd it also installs a service so the bot runs 24/7 and after reboots.
set -euo pipefail
REPO="rygroup-dev/paws-bot"
DIR="${PAWS_DIR:-$HOME/paws-bot}"
say() { printf '\033[1;33m%s\033[0m\n' "$*"; }
ok() { printf '\033[1;32m[ok]\033[0m %s\n' "$*"; }

say "== Paws of Sherwood bot installer =="
echo "Folder: $DIR"
command -v curl >/dev/null || { echo "curl is required"; exit 1; }
command -v tar >/dev/null || { echo "tar is required"; exit 1; }

# 1. code
mkdir -p "$DIR"
TMP="$(mktemp -d)"
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/main" | tar -xz -C "$TMP"
cp -R "$TMP"/*/. "$DIR"/
rm -rf "$TMP"
chmod +x "$DIR/run.sh" "$DIR/install.sh" 2>/dev/null || true
ok "kode terpasang"

# 2. node 20+ (system, else a private copy in .runtime/node)
NODE=""
if command -v node >/dev/null && [ "$(node -v | sed 's/v//;s/\..*//')" -ge 20 ]; then NODE="$(command -v node)"; fi
if [ -z "$NODE" ] && [ ! -x "$DIR/.runtime/node/bin/node" ]; then
  say "Node.js 20+ tidak ada, unduh versi portable..."
  OS="$(uname -s | tr '[:upper:]' '[:lower:]')"; ARCH="$(uname -m)"
  case "$ARCH" in x86_64|amd64) ARCH=x64;; aarch64|arm64) ARCH=arm64;; armv7l) ARCH=armv7l;; *) echo "arch $ARCH tidak didukung"; exit 1;; esac
  VER="$(curl -fsSL https://nodejs.org/dist/index.json | grep -o '"version":"v[0-9.]*"[^}]*"lts":"[A-Za-z]*"' | head -1 | grep -o 'v[0-9.]*')"
  mkdir -p "$DIR/.runtime"
  curl -fsSL "https://nodejs.org/dist/$VER/node-$VER-$OS-$ARCH.tar.gz" | tar -xz -C "$DIR/.runtime"
  rm -rf "$DIR/.runtime/node"; mv "$DIR/.runtime/node-$VER-$OS-$ARCH" "$DIR/.runtime/node"
fi
[ -z "$NODE" ] && NODE="$DIR/.runtime/node/bin/node"
export PATH="$(dirname "$NODE"):$PATH"
ok "node $("$NODE" -v)"

# 3. dependencies
( cd "$DIR" && npm install --omit=dev --no-fund --no-audit --loglevel=error )
ok "dependencies"

# 4. .env (asked once; read from the terminal even when piped through curl)
if [ ! -f "$DIR/.env" ]; then
  say "Isi data bot (disimpan hanya di $DIR/.env):"
  exec 3</dev/tty
  read -r -s -p "Private key wallet game (0x...): " PK <&3; echo
  read -r -p "Telegram bot token (dari @BotFather): " TOK <&3
  read -r -p "Telegram chat id (kosongkan kalau belum tahu): " CHAT <&3
  umask 077
  printf 'PRIVATE_KEY=%s\nTELEGRAM_BOT_TOKEN=%s\nTELEGRAM_CHAT_ID=%s\nREFERRAL_CODE=TGPEMVTV\nRPC_URL=\n' "$PK" "$TOK" "$CHAT" > "$DIR/.env"
  unset PK
  ok ".env dibuat"
else
  ok ".env lama dipakai"
fi

# 5. run 24/7 with systemd when available, else print how to start
if command -v systemctl >/dev/null && [ -d /run/systemd/system ]; then
  SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
  $SUDO tee /etc/systemd/system/paws-bot.service >/dev/null <<EOF
[Unit]
Description=Paws of Sherwood bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(id -un)
WorkingDirectory=$DIR
Environment=PATH=$(dirname "$NODE"):/usr/local/bin:/usr/bin:/bin
ExecStart=$NODE src/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable --now paws-bot
  ok "service paws-bot aktif (log: journalctl -u paws-bot -f)"
else
  say "Jalankan bot: cd $DIR && ./run.sh"
fi
say "Selesai! Kirim /menu ke bot Telegram kamu."
echo "Akun baru butuh captcha sekali: jalankan 'run.sh human' di komputer yang ada Chrome/Edge,"
echo "atau buat akun di PC lalu salin folder data/ ke server."
