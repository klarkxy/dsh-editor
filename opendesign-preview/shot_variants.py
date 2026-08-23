from pathlib import Path
import http.server
import socketserver
import threading
import subprocess
import os

root = Path(r"D:\0 code\dsh-editor\opendesign-preview")
html = (root / "index.html").read_text(encoding="utf-8")
needle = 'data-view="write" data-ghost="ready"'
(root / "patch.html").write_text(html.replace(needle, 'data-view="patch" data-ghost="off"', 1), encoding="utf-8")
(root / "empty.html").write_text(html.replace(needle, 'data-view="empty" data-ghost="off"', 1), encoding="utf-8")

os.chdir(root)
httpd = socketserver.TCPServer(("127.0.0.1", 8767), http.server.SimpleHTTPRequestHandler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
chrome = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
for name in ("patch.html", "empty.html"):
    out = root / (name.replace(".html", ".png"))
    subprocess.run(
        [
            chrome,
            "--headless=new",
            "--disable-gpu",
            "--window-size=1440,900",
            f"--screenshot={out}",
            "--hide-scrollbars",
            f"http://127.0.0.1:8767/{name}",
        ],
        check=False,
    )
    print(name, out.exists(), out.stat().st_size if out.exists() else 0)
httpd.shutdown()
