#!/usr/bin/env python3
"""Audit all Astro routes using an already authenticated agent-browser session.

Requires the agent-browser CLI and a superuser session on the target origin.
Creates JSON results and screenshots; exits nonzero for failures. No mutations.
"""
import argparse
import json
import pathlib
import subprocess
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--base-url", default="http://localhost:4321")
parser.add_argument("--session", required=True)
parser.add_argument("--output", type=pathlib.Path, required=True)
parser.add_argument("--theme", choices=["light", "dark"], default="dark")
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)


def browser(*command):
    result = subprocess.run(
        ["agent-browser", "--session", args.session, *command],
        capture_output=True, text=True, timeout=45,
    )
    if result.returncode:
        raise RuntimeError(result.stderr or result.stdout)
    return result.stdout


pages = pathlib.Path(__file__).resolve().parents[1] / "src" / "pages"
routes = []
for page in sorted(pages.rglob("*.astro")):
    route = "/" + str(page.relative_to(pages).with_suffix(""))
    routes.append(route.removesuffix("/index") or "/")
results = []
failures = []
for route in routes:
    try:
        browser("open", args.base_url.rstrip("/") + route)
        browser("eval", f'localStorage.setItem("gateway-theme", "{args.theme}")')
        browser("reload")
        browser("wait", "--fn", '!!document.querySelector("h1") && !document.body.innerText.includes("Loading page…")')
        time.sleep(0.5)
        for width, height in [(1440, 900), (768, 1024), (390, 844), (320, 740)]:
            browser("set", "viewport", str(width), str(height))
            name = (route.strip("/").replace("/", "-") or "landing") + f"-{width}"
            audit = json.loads(browser("a11y", "--json"))["data"]
            (args.output / f"{name}-axe.json").write_text(json.dumps(audit, indent=2))
            raw = browser("eval", 'JSON.stringify({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,h1:document.querySelectorAll("h1").length,main:document.querySelectorAll("main").length,title:document.title,errorBoundary:document.body.innerText.includes("Unable to load this page"),denied:document.body.innerText.includes("Access denied"),login:location.pathname.startsWith("/login")})')
            dimensions = json.loads(json.loads(raw))
            errors = []
            if audit["violations"]:
                errors.append("axe violations")
            if dimensions["scrollWidth"] > width:
                errors.append("document overflow")
            if dimensions["h1"] != 1 or dimensions["main"] != 1:
                errors.append("heading/landmark count")
            if dimensions["errorBoundary"] or dimensions["denied"]:
                errors.append("page failed to render")
            if route.startswith("/dashboard") and dimensions["login"]:
                errors.append("authentication required")
            results.append({"route": route, "viewport": [width, height], "dimensions": dimensions, "violations": audit["violations"], "incomplete": audit["incomplete"], "errors": errors})
            browser("screenshot", str((args.output / f"{name}.png").resolve()))
            if errors:
                failures.append({"route": route, "width": width, "errors": errors})
        print(route, "checked", flush=True)
    except (RuntimeError, subprocess.TimeoutExpired, ValueError, KeyError) as error:
        failures.append({"route": route, "error": str(error)})
(args.output / "results.json").write_text(json.dumps({"results": results, "failures": failures}, indent=2))
print(f"{len(results)} viewport checks; {len(failures)} failures")
raise SystemExit(bool(failures))
