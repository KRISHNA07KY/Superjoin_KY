"""Generates a handful of tiny synthetic PDFs with deliberately overlapping
facts, used to cheaply exercise cross-document reasoning (corroboration,
contradiction, reconciliation) end-to-end without burning LLM-call budget on
the full 100-page starter datasets. Not part of the product — a dev/eval tool.

These are NOT the same as the real starter datasets and must never be
hard-coded into the application itself; they only exist to sanity-check that
the reasoning pipeline behaves correctly on known, controlled inputs before
trusting it on real documents.
"""
import pathlib

import fitz  # PyMuPDF

OUT_DIR = pathlib.Path(__file__).parent / "synthetic"
OUT_DIR.mkdir(exist_ok=True)


def make_pdf(filename: str, lines: list[str]) -> None:
    doc = fitz.open()
    page = doc.new_page()
    y = 72
    for line in lines:
        page.insert_text((72, y), line, fontsize=12)
        y += 20
    doc.save(OUT_DIR / filename)
    doc.close()
    print(f"wrote {OUT_DIR / filename}")


# Corroboration: same fact, different wording/units.
make_pdf(
    "01-corroboration-annual-report.pdf",
    [
        "Acme Retail Holdings Ltd. — Annual Report FY2025",
        "",
        "Consolidated revenue for the financial year 2025 was Rs. 840 crore,",
        "compared to Rs. 720 crore in the previous fiscal year FY2024.",
    ],
)
make_pdf(
    "01-corroboration-investor-deck.pdf",
    [
        "Acme Retail Holdings — Investor Presentation Q4 FY25",
        "",
        "FY25 turnover reached INR 8.4 billion, representing strong growth",
        "over the prior year.",
    ],
)

# Genuine / likely contradiction: same entity, metric, period — different value.
make_pdf(
    "02-contradiction-press-release.pdf",
    [
        "Acme Retail Holdings Ltd. — Press Release",
        "",
        "Acme Retail Holdings today announced FY2025 consolidated revenue",
        "of Rs. 910 crore, up sharply year over year.",
    ],
)

# Apparent contradiction reconciled by scope/period.
make_pdf(
    "03-reconciliation-q1-update.pdf",
    [
        "Acme Retail Holdings Ltd. — Q1 FY2026 Business Update",
        "",
        "Revenue for the first quarter of FY2026 (Q1 FY26) was Rs. 80 crore,",
        "in line with management's full-year guidance.",
    ],
)
make_pdf(
    "03-reconciliation-fy-guidance.pdf",
    [
        "Acme Retail Holdings Ltd. — FY2026 Guidance",
        "",
        "The Board reaffirmed full-year FY2026 revenue guidance of",
        "Rs. 320 crore, consistent with the growth trajectory outlined",
        "at the start of the fiscal year.",
    ],
)

# Extraction-risk case: a growth percentage sitting right next to the actual
# value, similar to the real risk found in the Delhivery annual report.
make_pdf(
    "04-extraction-risk.pdf",
    [
        "Acme Retail Holdings Ltd. — MD&A Excerpt",
        "",
        "Total income increased by 14.1% to Rs. 950 crore for FY2025.",
        "Revenue from customers increased by 12.7% to Rs. 840 crore for FY2025.",
    ],
)

print("done.")
