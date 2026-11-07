#!/bin/bash
# Point ~/.local/bin/t3code-appimage (the desktop entry's Exec) at the mod launcher.
#   bin/install.sh            install (backs up the original once)
#   bin/install.sh uninstall  restore the original
# Neither restarts T3: the change applies the next time T3 is launched.
set -euo pipefail
TARGET="$HOME/.local/bin/t3code-appimage"
BACKUP="$TARGET.t3mod-backup"
LAUNCH="$(cd "$(dirname "$0")" && pwd)/t3code-launch.mjs"

if [[ "${1:-}" == "uninstall" ]]; then
  [[ -f "$BACKUP" ]] || { echo "no backup at $BACKUP" >&2; exit 1; }
  mv -f "$BACKUP" "$TARGET"
  echo "restored $TARGET"
  exit 0
fi

if [[ -f "$TARGET" && ! -f "$BACKUP" ]] && ! grep -q "t3mod" "$TARGET"; then
  cp -p "$TARGET" "$BACKUP"
  echo "backed up original to $BACKUP"
fi

cat > "$TARGET" <<EOF
#!/bin/bash
# t3mod launcher (installed by $0; undo with: $0 uninstall)
# Starts the newest T3 Code AppImage with mods. Falls back to plain T3 whenever
# node or the mod repo is missing (e.g. the drive is not mounted).
LAUNCH="$LAUNCH"
if [[ "\$1" == "--appimage" ]]; then
  LATEST="\$2"; shift 2
else
  LATEST=\$(ls -t "\$HOME/.cache/t3code-updater/pending/T3-Code-"*.AppImage 2>/dev/null | head -n1)
fi
if [[ -n "\$LATEST" && -x "\$LATEST" ]]; then
  if [[ -z "\$T3MOD_DISABLE" && -f "\$LAUNCH" ]]; then
    for NODE in "\$T3MOD_NODE" /usr/bin/node "\$HOME/.local/share/mise/shims/node"; do
      [[ -n "\$NODE" && -x "\$NODE" ]] && exec "\$NODE" "\$LAUNCH" --appimage "\$LATEST" -- "\$@"
    done
  fi
  exec "\$LATEST" "\$@"
fi
EOF
chmod +x "$TARGET"
echo "installed $TARGET -> $LAUNCH"
