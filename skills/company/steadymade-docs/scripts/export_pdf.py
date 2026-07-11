#!/usr/bin/env python3
"""
steadymade-docs PDF exporter
Usage: python3 export_pdf.py <path/to/document.html>
Output: <path/to/document.pdf> (same folder, same name)
"""
import sys
import os
from pathlib import Path

def export(html_path: str):
    html_path = Path(html_path).resolve()
    if not html_path.exists():
        print(f"Error: file not found: {html_path}")
        sys.exit(1)

    pdf_path = html_path.with_suffix(".pdf")

    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.goto(f"file://{html_path}", wait_until="networkidle")
            page.pdf(
                path=str(pdf_path),
                format="A4",
                print_background=True,
                margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
            )
            browser.close()
        print(f"PDF: {pdf_path}")
        return str(pdf_path)

    except ImportError:
        print("Playwright not available — trying weasyprint...")
        try:
            import weasyprint
            weasyprint.HTML(filename=str(html_path)).write_pdf(str(pdf_path))
            print(f"PDF: {pdf_path}")
            return str(pdf_path)
        except ImportError:
            print("Neither playwright nor weasyprint available.")
            print("Install: pip install playwright && playwright install chromium")
            print(f"Fallback: open {html_path} in Chrome → Cmd+P → PDF speichern")
            sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 export_pdf.py <document.html>")
        sys.exit(1)
    export(sys.argv[1])
