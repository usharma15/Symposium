#!/usr/bin/env python3
"""Build and validate browser-compatible editions of historical PDFs.

Several supplied journal scans render in desktop PDF readers and Poppler but lose
their principal page layer in PDF.js. The compatibility set below is deliberately
declarative: every affected scan is rendered to an ordinary baseline RGB JPEG per
page, wrapped in a deterministic PDF, and rejected if any page has no meaningful
ink or does not use the expected PDF.js-safe image encoding.

The supplied Ion PDF is a separate case: a print-to-PDF of an old cached HTML page.
It is typeset as a clean, searchable reading edition from its embedded dialogue.
"""

from __future__ import annotations

import argparse
import io
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image
from pypdf import PdfReader
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_DIRECTORY = Path.home() / "Downloads" / "Characters and their papers"
OUTPUT_DIRECTORY = REPO_ROOT / "public" / "historical-world" / "papers"
COMPATIBILITY_PAPERS = (
    (
        "Meitner and Frisch.pdf",
        "meitner-frisch-disintegration-uranium.pdf",
        "Disintegration of Uranium by Neutrons: a New Type of Nuclear Reaction",
        "Lise Meitner and O. R. Frisch",
    ),
    (
        "Watson and Crick.pdf",
        "watson-crick-molecular-structure-nucleic-acids.pdf",
        "Molecular Structure of Nucleic Acids",
        "J. D. Watson and F. H. C. Crick",
    ),
    (
        "Heisenberg.pdf",
        "heisenberg-quantum-theoretical-kinematics.pdf",
        "Quantum-Theoretical Re-Interpretation of Kinematic and Mechanical Relations",
        "Werner Heisenberg",
    ),
    (
        "Feynman.pdf",
        "feynman-space-time-approach-qm.pdf",
        "Space-Time Approach to Non-Relativistic Quantum Mechanics",
        "Richard P. Feynman",
    ),
    (
        "Godel.pdf",
        "godel-incompleteness.pdf",
        "On Formally Undecidable Propositions",
        "Kurt Gödel",
    ),
    (
        "Nash.pdf",
        "nash-equilibrium-points-n-person-games.pdf",
        "Equilibrium Points in N-Person Games",
        "John F. Nash Jr.",
    ),
)
RENDER_DPI = 160
JPEG_QUALITY = 86
MINIMUM_PAGE_INK_RATIO = 0.002


def pdftoppm_binary() -> str:
    configured = os.environ.get("PDFTOPPM")
    discovered = configured or shutil.which("pdftoppm")
    if not discovered:
        raise RuntimeError("pdftoppm is required; install Poppler or set PDFTOPPM to its executable path")
    return discovered


def page_ink_ratio(image: Image.Image) -> float:
    """Return the fraction of pixels carrying visible content rather than paper."""

    grayscale = image.convert("L")
    histogram = grayscale.histogram()
    ink_pixels = sum(histogram[:245])
    return ink_pixels / (grayscale.width * grayscale.height)


def validate_compatibility_pdf(path: Path, expected_pages: int) -> None:
    """Assert that every output page is a single baseline RGB JPEG image."""

    reader = PdfReader(str(path))
    if len(reader.pages) != expected_pages:
        raise RuntimeError(f"Generated {len(reader.pages)} pages for {path.name}; expected {expected_pages}")
    for page_number, page in enumerate(reader.pages, start=1):
        resources = page.get("/Resources") or {}
        xobjects = resources.get("/XObject") or {}
        images = [entry.get_object() for entry in xobjects.values() if entry.get_object().get("/Subtype") == "/Image"]
        if len(images) != 1:
            raise RuntimeError(f"{path.name} page {page_number} has {len(images)} image layers; expected one")
        image = images[0]
        filters = image.get("/Filter")
        filter_names = {str(value) for value in filters} if isinstance(filters, list) else {str(filters)}
        if "/DCTDecode" not in filter_names or image.get("/ColorSpace") != "/DeviceRGB":
            raise RuntimeError(
                f"{path.name} page {page_number} is not a baseline RGB JPEG "
                f"({image.get('/Filter')}, {image.get('/ColorSpace')})"
            )


def compatibility_scan(source: Path, destination: Path, title: str, author: str) -> list[float]:
    """Re-encode scanned pages as baseline RGB JPEGs understood by PDF.js."""

    reader = PdfReader(str(source))
    with tempfile.TemporaryDirectory(prefix="historical-paper-") as temp_directory:
        prefix = Path(temp_directory) / "page"
        subprocess.run(
            [
                pdftoppm_binary(),
                "-jpeg",
                "-jpegopt",
                f"quality={JPEG_QUALITY},progressive=n,optimize=y",
                "-r",
                str(RENDER_DPI),
                str(source),
                str(prefix),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        rendered_pages = sorted(Path(temp_directory).glob("page-*.jpg"))
        if len(rendered_pages) != len(reader.pages):
            raise RuntimeError(f"Rendered {len(rendered_pages)} pages for {source.name}; expected {len(reader.pages)}")

        ink_ratios: list[float] = []
        temporary_output = Path(temp_directory) / destination.name
        pdf = canvas.Canvas(str(temporary_output), pageCompression=1, invariant=1)
        pdf.setTitle(title)
        pdf.setAuthor(author)
        pdf.setSubject("Browser-compatible edition generated from the supplied historical scan")
        pdf.setCreator("Science Rebirth historical paper compatibility pass")
        for page_number, (page, rendered_page) in enumerate(zip(reader.pages, rendered_pages), start=1):
            width = float(page.mediabox.width)
            height = float(page.mediabox.height)
            pdf.setPageSize((width, height))
            with Image.open(rendered_page) as image:
                if image.mode != "RGB":
                    image = image.convert("RGB")
                ink_ratio = page_ink_ratio(image)
                if ink_ratio < MINIMUM_PAGE_INK_RATIO:
                    raise RuntimeError(
                        f"{source.name} page {page_number} has only {ink_ratio:.3%} visible ink; "
                        "refusing to publish a blank compatibility page"
                    )
                ink_ratios.append(ink_ratio)
                normalized = io.BytesIO()
                image.save(normalized, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=False)
                normalized.seek(0)
                pdf.drawImage(
                    ImageReader(normalized),
                    0,
                    0,
                    width=width,
                    height=height,
                    preserveAspectRatio=False,
                    mask=None,
                )
            pdf.showPage()
        pdf.save()
        destination.write_bytes(temporary_output.read_bytes())
    validate_compatibility_pdf(destination, len(reader.pages))
    return ink_ratios


def ion_dialogue(source: Path) -> list[tuple[str | None, str]]:
    """Extract the dialogue while removing the captured browser chrome and footers."""

    reader = PdfReader(str(source))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    start = text.find("Ion\nBy Plato")
    end = text.find("THE END")
    if start < 0 or end < 0 or end <= start:
        raise RuntimeError("Could not locate the Ion dialogue boundaries in the supplied PDF")
    text = text[start:end]
    lines = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if re.fullmatch(r"\d{2}/\d{2}/\d{4},\s*\d{2}:\d{2}\s+classics\.mit\.edu/.+", line):
            continue
        if re.fullmatch(r"https://classics\.mit\.edu/.+\s+\d+/11", line):
            continue
        if line.startswith("Provided by The Internet Classics Archive") or line.startswith("See bottom for copyright"):
            continue
        if line.startswith("Available online at") or line.startswith("http://classics.mit.edu"):
            continue
        if set(line) == {"-"}:
            continue
        lines.append(line)

    dialogue_start = next(
        (index for index, line in enumerate(lines) if line.startswith("Socrates. Welcome, Ion")),
        None,
    )
    if dialogue_start is None:
        raise RuntimeError("Could not find the opening exchange in the supplied Ion text")
    dialogue_text = " ".join(lines[dialogue_start:])
    marker = re.compile(r"(?:^|(?<=[.!?])\s)(Socrates|Soc|Ion)\.\s+")
    matches = list(marker.finditer(dialogue_text))
    blocks: list[tuple[str | None, str]] = []
    for index, match in enumerate(matches):
        speaker = "Socrates" if match.group(1) in {"Socrates", "Soc"} else "Ion"
        body_start = match.end()
        body_end = matches[index + 1].start() if index + 1 < len(matches) else len(dialogue_text)
        body = dialogue_text[body_start:body_end].strip()
        if body:
            blocks.append((speaker, body))
    return blocks


def clean_ion_edition(source: Path, destination: Path) -> None:
    """Typeset a clean, searchable Ion reading edition from the supplied text."""

    styles = getSampleStyleSheet()
    title = ParagraphStyle(
        "IonTitle",
        parent=styles["Title"],
        fontName="Times-Bold",
        fontSize=28,
        leading=34,
        alignment=TA_CENTER,
        spaceAfter=18,
    )
    subtitle = ParagraphStyle(
        "IonSubtitle",
        parent=styles["Normal"],
        fontName="Times-Roman",
        fontSize=13,
        leading=18,
        alignment=TA_CENTER,
        spaceAfter=8,
    )
    dialogue = ParagraphStyle(
        "IonDialogue",
        parent=styles["BodyText"],
        fontName="Times-Roman",
        fontSize=10.5,
        leading=14.5,
        spaceAfter=7,
        allowWidows=0,
        allowOrphans=0,
    )
    note = ParagraphStyle(
        "IonNote",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=8.5,
        leading=12,
        textColor="#555555",
        alignment=TA_CENTER,
    )

    temporary_output = destination.with_suffix(".tmp.pdf")
    document = SimpleDocTemplate(
        str(temporary_output),
        pagesize=LETTER,
        rightMargin=0.8 * inch,
        leftMargin=0.8 * inch,
        topMargin=0.7 * inch,
        bottomMargin=0.65 * inch,
        title="Ion",
        author="Plato; translated by Benjamin Jowett",
        subject="Clean reading edition made from the user-supplied text",
    )
    story = [
        Spacer(1, 1.2 * inch),
        Paragraph("ION", title),
        Paragraph("Plato", subtitle),
        Paragraph("Translated by Benjamin Jowett", subtitle),
        Spacer(1, 0.5 * inch),
        Paragraph(
            "Clean reading edition prepared for the Symposium historical simulation. "
            "The captured browser markup and print footers in the supplied PDF have been removed; "
            "the dialogue text is otherwise retained.",
            note,
        ),
        PageBreak(),
    ]

    for speaker, text in ion_dialogue(source):
        escaped = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        prefix = f"<b>{speaker}.</b> " if speaker else ""
        story.append(Paragraph(prefix + escaped, dialogue))

    def page_footer(pdf: canvas.Canvas, doc: SimpleDocTemplate) -> None:
        pdf.saveState()
        pdf.setFont("Helvetica", 7.5)
        pdf.setFillColorRGB(0.35, 0.35, 0.35)
        label = f"Plato, Ion - Benjamin Jowett translation  |  {doc.page}"
        pdf.drawString((LETTER[0] - stringWidth(label, "Helvetica", 7.5)) / 2, 0.35 * inch, label)
        pdf.restoreState()

    def deterministic_canvas(*args: object, **kwargs: object) -> canvas.Canvas:
        kwargs["invariant"] = 1
        return canvas.Canvas(*args, **kwargs)

    document.build(
        story,
        onFirstPage=page_footer,
        onLaterPages=page_footer,
        canvasmaker=deterministic_canvas,
    )
    destination.write_bytes(temporary_output.read_bytes())
    temporary_output.unlink()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-directory", type=Path, default=DEFAULT_SOURCE_DIRECTORY)
    args = parser.parse_args()
    source_directory = args.source_directory.expanduser().resolve()
    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)

    clean_ion_edition(source_directory / "ION, Plato.pdf", OUTPUT_DIRECTORY / "plato-ion.pdf")
    print(f"plato-ion.pdf: {(OUTPUT_DIRECTORY / 'plato-ion.pdf').stat().st_size} bytes (searchable clean edition)")
    for source_name, output_name, title, author in COMPATIBILITY_PAPERS:
        output = OUTPUT_DIRECTORY / output_name
        ink_ratios = compatibility_scan(source_directory / source_name, output, title, author)
        print(
            f"{output_name}: {output.stat().st_size} bytes, {len(ink_ratios)} pages, "
            f"minimum ink {min(ink_ratios):.2%}"
        )


if __name__ == "__main__":
    main()
