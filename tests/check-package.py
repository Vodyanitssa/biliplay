#!/usr/bin/env python3
"""校验打包产物（dist/*.zip）能不能被 AMO / Firefox 接受。

比 web-ext lint 管得更细的地方：**真的让 Firefox 临时装载一遍**，
所以「manifest 里某个字段被当成保留属性拒收」这类问题跑一次就能发现。

用法：
  python3 tests/check-package.py                 # 自动找 dist/ 里最新的 zip
  python3 tests/check-package.py dist/xx.zip     # 指定 zip
  MARIONETTE_PORT=3333 python3 tests/check-package.py   # 复用已有 Firefox

没有正在跑的 Marionette 时会自己起一个 headless Firefox，跑完自动关。
"""
import atexit
import glob
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get("MARIONETTE_PORT", "2828"))
FIREFOX = os.environ.get("FIREFOX", "firefox")


# --------------------------------------------------------------------------- #
# 结构检查（不需要浏览器）
# --------------------------------------------------------------------------- #

def version_tuple(v):
    parts = []
    for chunk in str(v).split("."):
        digits = "".join(c for c in chunk if c.isdigit())
        parts.append(int(digits) if digits else 0)
    return tuple(parts)


def manifest_refs(manifest):
    """manifest 里所有指向包内文件的路径。"""
    refs = list((manifest.get("icons") or {}).values())

    action = manifest.get("action") or manifest.get("browser_action") or {}
    refs += list((action.get("default_icon") or {}).values())
    if action.get("default_popup"):
        refs.append(action["default_popup"])

    for key in ("options_ui", "options_page", "background", "sidebar_action"):
        section = manifest.get(key)
        if isinstance(section, dict):
            for field in ("page", "default_page"):
                if section.get(field):
                    refs.append(section[field])
        elif isinstance(section, str):
            refs.append(section)

    for cs in manifest.get("content_scripts", []):
        refs += cs.get("js", []) + cs.get("css", [])

    return [r for r in refs if isinstance(r, str)]


def check_structure(zip_path):
    rows = []
    with zipfile.ZipFile(zip_path) as z:
        names = set(z.namelist())

        rows.append((
            "manifest.json 在包根目录",
            "manifest.json" in names,
            "顶层：" + ", ".join(sorted({n.split("/")[0] for n in names})),
        ))

        manifest = json.loads(z.read("manifest.json").decode("utf-8"))

        for key in ("manifest_version", "name", "version", "description"):
            rows.append((f"manifest 有 {key}", bool(manifest.get(key)), manifest.get(key)))

        rows.append((
            "version 是 AMO 认的格式",
            bool(manifest.get("version")) and all(
                p.isdigit() for p in manifest["version"].split(".")[:4]
            ),
            manifest.get("version"),
        ))

        # 引用的文件必须真的在包里（改名/漏打包最容易在这里露馅）
        refs = manifest_refs(manifest)
        missing = sorted({r for r in refs if r not in names})
        rows.append((
            f"manifest 引用的 {len(refs)} 个文件都在包里",
            not missing,
            "缺少：" + ", ".join(missing) if missing else "",
        ))

        # 不该进包的东西
        junk = sorted({n.split("/")[0] for n in names} & {"tests", ".git", "dist", "store", "node_modules"})
        rows.append(("包里没有 tests/.git/等杂物", not junk, junk))

        # 扩展自带的图标
        icon_sizes = sorted((manifest.get("icons") or {}), key=version_tuple)
        rows.append((
            "有 48/96/128 图标",
            {"48", "96", "128"} <= set(icon_sizes),
            {"48": "48" in icon_sizes, "96": "96" in icon_sizes, "128": "128" in icon_sizes},
        ))

        # —— 2025-11-03 起 AMO 对新提交的硬性要求 ——
        gecko = (manifest.get("browser_specific_settings") or {}).get("gecko") or {}
        dcp = gecko.get("data_collection_permissions")
        rows.append((
            "声明了 data_collection_permissions（AMO 必需）",
            isinstance(dcp, dict) and bool(dcp.get("required")),
            dcp,
        ))

        minver = gecko.get("strict_min_version")
        if isinstance(dcp, dict):
            rows.append((
                "data_collection_permissions 要求 strict_min_version ≥ 140",
                minver is not None and version_tuple(minver) >= (140,),
                f"strict_min_version = {minver}",
            ))

        rows.append((
            "有固定的 gecko.id（签名后不可改）",
            bool(gecko.get("id")),
            gecko.get("id"),
        ))

    return rows


# --------------------------------------------------------------------------- #
# 真实装载检查（需要 Firefox）
# --------------------------------------------------------------------------- #

def port_open(port, timeout=0.5):
    s = socket.socket()
    s.settimeout(timeout)
    try:
        s.connect(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def spawn_firefox():
    if not shutil.which(FIREFOX):
        return None
    profile = tempfile.mkdtemp(prefix="biliplay-check-")
    proc = subprocess.Popen(
        [FIREFOX, "--headless", "--no-remote", "--marionette", "--profile", profile, "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )

    def cleanup():
        try:
            proc.terminate()
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)

    atexit.register(cleanup)

    deadline = time.time() + 90
    while time.time() < deadline:
        if port_open(PORT):
            return proc
        if proc.poll() is not None:
            return None
        time.sleep(0.5)
    return None


def recv_packet(s):
    buf = b""
    while b":" not in buf:
        chunk = s.recv(1)
        if not chunk:
            raise EOFError("Marionette 连接断了")
        buf += chunk
    length, _, rest = buf.partition(b":")
    need = int(length)
    while len(rest) < need:
        rest += s.recv(need - len(rest))
    return json.loads(rest[:need])


def send_packet(s, msg):
    data = json.dumps(msg).encode()
    s.sendall(str(len(data)).encode() + b":" + data)


def check_load(zip_path):
    """让 Firefox 以临时扩展的方式真实装载一遍。"""
    if not port_open(PORT):
        if spawn_firefox() is None:
            return [("Firefox 真实装载", False, f"起不来 Firefox（{FIREFOX}）或端口 {PORT} 不通")]
        if not port_open(PORT):
            return [("Firefox 真实装载", False, f"等不到 Marionette 端口 {PORT}")]

    s = socket.create_connection(("127.0.0.1", PORT), timeout=20)
    try:
        recv_packet(s)  # 握手包
        send_packet(s, [0, 1, "WebDriver:NewSession", {"capabilities": {"alwaysMatch": {}}}])
        if recv_packet(s)[2]:
            return [("Firefox 真实装载", False, "NewSession 失败")]

        send_packet(s, [0, 2, "Addon:Install",
                        {"path": os.path.abspath(zip_path), "temporary": True}])
        r = recv_packet(s)
        if r[2]:
            return [("Firefox 真实装载", False, json.dumps(r[2], ensure_ascii=False))]

        addon_id = r[3].get("value", r[3]) if isinstance(r[3], dict) else r[3]
        rows = [("Firefox 真实装载", True, addon_id)]

        # 装载成功后再查一次 AddonManager，确认它真的在已装列表里
        send_packet(s, [0, 3, "Addon:ListAddons", {}])
        r = recv_packet(s)
        if not r[2]:
            listed = r[3].get("value", r[3])
            ids = [a.get("id") for a in listed] if isinstance(listed, list) else []
            rows.append(("出现在已装扩展列表里", addon_id in ids, ids))
        return rows
    finally:
        s.close()


# --------------------------------------------------------------------------- #

def find_zip():
    if len(sys.argv) > 1 and not sys.argv[1].startswith("-"):
        return sys.argv[1]
    candidates = glob.glob(os.path.join(ROOT, "dist", "*.zip"))
    if not candidates:
        sys.exit("dist/ 里没有 zip，先跑 tools/build.sh")
    return max(candidates, key=os.path.getmtime)


def main():
    zip_path = find_zip()
    print(f"检查 {os.path.relpath(zip_path, ROOT)}\n")

    rows = check_structure(zip_path)
    if "--no-load" not in sys.argv:
        rows += check_load(zip_path)

    width = max(len(r[0]) for r in rows)
    for label, ok, detail in rows:
        line = f"{'PASS' if ok else 'FAIL'}  {label.ljust(width)}"
        if not ok and detail not in ("", None):
            line += "   ← " + json.dumps(detail, ensure_ascii=False)
        print(line)

    passed = sum(1 for r in rows if r[1])
    print(f"\n{passed}/{len(rows)} 通过")
    return 0 if passed == len(rows) else 1


if __name__ == "__main__":
    sys.exit(main())
