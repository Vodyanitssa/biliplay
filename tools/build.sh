#!/usr/bin/env bash
#
# 打包成可以直接上传 AMO 的 zip。
#
#   tools/build.sh          # 生成 dist/biliplay-<version>.zip
#
# 只放进运行时真正需要的文件（manifest + icons + src + LICENSE/README），
# tests/、store/、dist/、.git 一律不进包。
# 不依赖 node/web-ext，只用 python3，保证在任何机器上都能出包。
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(python3 -c "import json;print(json.load(open('manifest.json', encoding='utf-8'))['version'])")"
OUT="dist/biliplay-${VERSION}.zip"

mkdir -p dist
rm -f "$OUT"

python3 - "$OUT" <<'PY'
import sys, zipfile
from pathlib import Path

out = Path(sys.argv[1])

# 包内固定带上的单文件，其余按目录递归收
files = [Path("manifest.json"), Path("LICENSE"), Path("README.md")]
for d in ("icons", "src"):
    files += sorted(p for p in Path(d).rglob("*") if p.is_file())

files = [p for p in files if p.exists()]
files.sort(key=lambda p: p.as_posix())

with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for p in files:
        z.write(p, p.as_posix())

print(f"  写入 {out}  （{len(files)} 个文件，{out.stat().st_size / 1024:.1f} KB）")
for p in files:
    print(f"    {p.as_posix()}")
PY
