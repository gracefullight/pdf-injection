"""Combine a hidden PDF policy channel with a low-luminance raster channel."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path

from PIL import Image
from pypdf import PdfReader, PdfWriter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from make_chroma_policy_sweep import render_notice_mask


def make_overlay(
    notice: str,
    font: Path,
    dpi: int,
    page_width: float,
    page_height: float,
    top_pt: float,
    delta: int,
) -> bytes:
    pixel_size = (round(page_width * dpi / 72), round(page_height * dpi / 72))
    glyph_mask, _ = render_notice_mask(pixel_size, notice, font, dpi, top_pt)
    rgba = Image.new("RGBA", pixel_size, (255, 255, 255 - delta, 0))
    rgba.putalpha(glyph_mask)
    image_buffer = io.BytesIO()
    rgba.save(image_buffer, "PNG")
    glyph_mask.close()
    rgba.close()

    pdf_buffer = io.BytesIO()
    pdf = canvas.Canvas(pdf_buffer, pagesize=(page_width, page_height), pageCompression=1)
    pdf.drawImage(
        ImageReader(io.BytesIO(image_buffer.getvalue())),
        0,
        0,
        width=page_width,
        height=page_height,
        mask="auto",
    )
    pdf.showPage()
    pdf.save()
    return pdf_buffer.getvalue()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="PDF containing the hidden policy channel")
    parser.add_argument("notice", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--delta", type=int, action="append", required=True)
    parser.add_argument("--page", type=int, default=4)
    parser.add_argument("--top-pt", type=float, default=115.0)
    parser.add_argument("--dpi", type=int, default=180)
    parser.add_argument(
        "--font",
        type=Path,
        default=Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
    )
    args = parser.parse_args()

    if not args.source.is_file() or not args.notice.is_file() or not args.font.is_file():
        parser.error("source, notice, and font must exist")
    if args.output_dir.exists():
        parser.error("refusing to overwrite an existing output directory")
    if any(not 1 <= delta <= 255 for delta in args.delta):
        parser.error("delta must be between 1 and 255")
    args.output_dir.mkdir(parents=True)

    notice = args.notice.read_text().strip()
    artifacts: list[dict[str, object]] = []
    for delta in args.delta:
        reader = PdfReader(str(args.source))
        page_index = args.page - 1
        if not 0 <= page_index < len(reader.pages):
            parser.error(f"page must be between 1 and {len(reader.pages)}")
        target = reader.pages[page_index]
        width = float(target.mediabox.width)
        height = float(target.mediabox.height)
        overlay_bytes = make_overlay(
            notice,
            args.font,
            args.dpi,
            width,
            height,
            args.top_pt,
            delta,
        )
        overlay = PdfReader(io.BytesIO(overlay_bytes)).pages[0]
        target.merge_page(overlay, over=True)

        writer = PdfWriter()
        for page in reader.pages:
            writer.add_page(page)
        if reader.metadata:
            writer.add_metadata(dict(reader.metadata))
        output = args.output_dir / f"uts-policy-hybrid-blue-d{delta:03d}.pdf"
        with output.open("wb") as stream:
            writer.write(stream)
        artifacts.append(
            {
                "delta": delta,
                "filename": output.name,
                "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
                "visual_channel": "blue-only raster policy glyphs",
                "structural_channel": str(args.source),
                "estimated_rec709_luminance_delta": delta * 0.0722,
            }
        )

    manifest = {
        "source": str(args.source),
        "notice": str(args.notice),
        "page": args.page,
        "method": "hidden PDF policy channel plus blue-only raster policy channel",
        "artifacts": artifacts,
    }
    (args.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
