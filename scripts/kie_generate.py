#!/usr/bin/env python3
"""
Kie.ai Bildgenerator (nano-banana-pro) für Steadymade OS.

Liest den API-Key aus der Umgebung (KIE_AI_API_KEY / KIE_API_KEY) oder aus
~/.claude/kie.env. Submit → poll → download.

Nutzung:
  python3 kie_generate.py --preset cover
  python3 kie_generate.py --preset hero
  python3 kie_generate.py --prompt "..." --aspect 1:1 --out /pfad/bild.jpg
"""
import argparse, json, os, sys, time, ssl, urllib.request, urllib.error, pathlib, re

# python.org-Builds haben oft kein System-CA-Bundle → certifi verwenden.
try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    SSL_CTX = ssl.create_default_context()

BASE = "https://api.kie.ai/api/v1"
CREATE = BASE + "/jobs/createTask"
POLL = BASE + "/jobs/recordInfo"
OUTDIR = "/Users/alexanderblancke/Documents/Steadymade/output/creative"

# ── Prompt-Presets (aus Noahs Kie.ai-Paket, Option B) ─────────────────────────
COVER_PROMPT = (
    "Create a calm, editorial cover illustration for a strategic business "
    "proposal document, portrait orientation. A minimal geometric composition on "
    "a deep dark-green background (#0B2218). One clearly larger rounded-square node "
    "sits in the upper third of the frame, representing an orchestrating system. "
    "Thin, precise straight connector lines extend downward from it to four smaller "
    "nodes of varying size, loosely and asymmetrically clustered in the lower "
    "two-thirds, representing specialized subagents. Nodes are flat matte surfaces "
    "in muted green (#148A3F) and soft off-white, with exactly one node or one "
    "connector line accented in warm apricot (#C46A38) as a single focal point. "
    "Flat 2D perspective with very slight isometric depth cues only through line "
    "angle, not through shading. No gradients, no glow, no glass, no shine, no drop "
    "shadows, no lens depth blur. Subtle fine paper-like grain across the background "
    "for a tactile, printed quality rather than a digital-screen look. Composition "
    "is centered with slight asymmetry, generous negative space above and below the "
    "structure reserved for title typography. The mood is quiet, precise, "
    "architectural — like a clean structural blueprint or systems diagram, not a "
    "technological or futuristic visual. High resolution, sharp edges, print-ready "
    "finish, vertical portrait canvas."
)
HERO_PROMPT = (
    "Create a calm, editorial hero banner illustration for a strategic business "
    "proposal, wide landscape orientation. A minimal geometric composition on a "
    "deep dark-green background (#0B2218). One clearly larger rounded-square node "
    "sits on the left side of the frame, representing an orchestrating system. Thin, "
    "precise straight connector lines extend rightward from it to four smaller nodes "
    "of varying size, loosely and asymmetrically clustered on the right, "
    "representing specialized subagents. Nodes are flat matte surfaces in muted "
    "green (#148A3F) and soft off-white, with exactly one node or one connector line "
    "accented in warm apricot (#C46A38) as a single focal point. Flat 2D "
    "perspective, depth only through line angle, not shading. No gradients, no glow, "
    "no glass, no shine, no drop shadows, no lens blur. Subtle fine paper-like grain "
    "across the background. Generous negative space, quiet, precise, architectural "
    "mood — a clean structural systems diagram, not a futuristic visual. High "
    "resolution, sharp edges, print-ready finish."
)
NEG = (
    "glowing AI brain, neural network web, circuit board texture, robot hand, blue "
    "neon, cyberpunk lighting, futuristic hologram, sci-fi interface, glossy 3D "
    "render, glass morphism, gradient background, drop shadows, lens flare, chrome "
    "material, floating particles, sparkles, generic corporate clipart, stock icon "
    "pack, more than 6 nodes, cluttered composition, overlapping random connecting "
    "lines, illegible fake text, watermark, logo, low resolution, blurry edges, "
    "human figures, hands, faces, photographic texture, overprocessed HDR, symmetric "
    "perfect grid, decorative shadows, plastic sheen"
)
PRESETS = {
    "cover": {"prompt": COVER_PROMPT, "aspect": "9:16", "out": "dossier-cover-9x16.jpg"},
    "hero":  {"prompt": HERO_PROMPT,  "aspect": "16:9", "out": "dossier-hero-16x9.jpg"},
}


def load_key():
    for var in ("KIE_AI_API_KEY", "KIE_API_KEY"):
        v = os.environ.get(var)
        if v and v.strip():
            return v.strip()
    envfile = pathlib.Path.home() / ".claude" / "kie.env"
    if envfile.exists():
        for line in envfile.read_text().splitlines():
            m = re.match(r"\s*(?:export\s+)?(KIE_AI_API_KEY|KIE_API_KEY)\s*=\s*(.+)", line)
            if m and m.group(2).strip():
                return m.group(2).strip().strip('"').strip("'")
    sys.exit("FEHLER: Kein API-Key gefunden (KIE_AI_API_KEY env oder ~/.claude/kie.env).")


def http_json(url, key, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=60, context=SSL_CTX) as r:
        return json.loads(r.read().decode())


def create_task(key, prompt, aspect, out_fmt):
    body = {"model": "nano-banana-pro", "input": {
        "prompt": prompt + "\n\nAvoid: " + NEG,
        "resolution": "1K", "aspect_ratio": aspect, "output_format": out_fmt,
    }}
    resp = http_json(CREATE, key, "POST", body)
    if resp.get("code") != 200:
        sys.exit(f"createTask fehlgeschlagen: {resp.get('msg')}")
    tid = (resp.get("data") or {}).get("taskId")
    if not tid:
        sys.exit(f"Kein taskId in Response: {resp}")
    return tid


def poll(key, tid, interval=3, max_attempts=60):
    for i in range(max_attempts):
        resp = http_json(f"{POLL}?taskId={tid}", key)
        d = resp.get("data") or {}
        state = d.get("state", "")
        if state == "success":
            rj = d.get("resultJson")
            if isinstance(rj, str):
                rj = json.loads(rj)
            urls = (rj or {}).get("resultUrls") or []
            if not urls:
                sys.exit("state=success aber keine resultUrls")
            return urls[0]
        if state == "fail":
            sys.exit(f"Generierung fehlgeschlagen: {d.get('failMsg')}")
        time.sleep(interval)  # leerer state = weiter pollen
    sys.exit("Timeout: Job nicht rechtzeitig fertig.")


def download(url, out_path):
    pathlib.Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120, context=SSL_CTX) as r:
        pathlib.Path(out_path).write_bytes(r.read())
    return out_path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preset", choices=list(PRESETS))
    ap.add_argument("--prompt")
    ap.add_argument("--aspect", default="1:1")
    ap.add_argument("--out")
    ap.add_argument("--format", default="jpg")
    a = ap.parse_args()

    if a.preset:
        p = PRESETS[a.preset]
        prompt, aspect = p["prompt"], p["aspect"]
        out = a.out or os.path.join(OUTDIR, p["out"])
    else:
        if not a.prompt:
            sys.exit("--prompt oder --preset erforderlich.")
        prompt, aspect = a.prompt, a.aspect
        out = a.out or os.path.join(OUTDIR, "kie-output.jpg")

    key = load_key()
    print(f"→ createTask (aspect {aspect}) …", flush=True)
    tid = create_task(key, prompt, aspect, a.format)
    print(f"  taskId: {tid}\n→ poll …", flush=True)
    url = poll(key, tid)
    print(f"  fertig: {url}\n→ download …", flush=True)
    path = download(url, out)
    print(f"GESPEICHERT: {path}")


if __name__ == "__main__":
    main()
