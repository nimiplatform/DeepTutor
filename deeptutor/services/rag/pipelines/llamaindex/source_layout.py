"""Bounded PDF layout evidence for retrieved table captions.

Coordinates preserve empty columns and multi-line headers. This renders source
text deterministically; it does not infer cell values or fill blank cells.
"""

from __future__ import annotations

from pathlib import Path
import re

_PAGE = re.compile(r"--- Page (\d+) ---")
_TABLE = re.compile(r"^\s*(?:Table|表)\s*\d+\s*[:：.]", re.IGNORECASE | re.MULTILINE)


def render_page_layout(page) -> str:
    rows: list[tuple[float, list[tuple[float, str]]]] = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            text = "".join(span["text"] for span in line["spans"])
            if not text.strip():
                continue
            x, y = line["bbox"][:2]
            row = next((r for r in rows if abs(r[0] - y) <= 2), None)
            if row is None:
                row = (y, [])
                rows.append(row)
            row[1].append((x, text))
    # One grid is shared by every row: proportional-font text extraction alone
    # otherwise left-aligns empty cells and shifts a value under another header.
    origin = min((x for _, cells in rows for x, _ in cells), default=0)
    result = []
    for y, cells in sorted(rows):
        rendered = ""
        for x, text in sorted(cells):
            column = max(round((x - origin) / 2.5), len(rendered) + (1 if rendered else 0))
            rendered = rendered.ljust(column) + text
        result.append(f"y={y:06.1f} {rendered}")
    return "\n".join(result)


def retrieved_table_layouts(nodes, kb_root: Path, *, limit: int = 2) -> list[dict]:
    import pymupdf

    results = []
    seen = set()
    for scored in nodes:
        node = scored.node
        path_text = (node.metadata or {}).get("file_path")
        if not path_text:
            continue
        path = Path(path_text).resolve()
        if path.suffix.lower() != ".pdf" or not path.is_relative_to(kb_root.resolve()):
            continue
        sections = list(_PAGE.finditer(node.text))
        for i, match in enumerate(sections):
            part = node.text[
                match.end() : sections[i + 1].start() if i + 1 < len(sections) else None
            ]
            if not _TABLE.search(part):
                continue
            page_number = int(match.group(1))
            key = (str(path), page_number)
            if key in seen:
                continue
            seen.add(key)
            if len(results) >= limit:
                results.append(
                    {
                        "chunk_id": node.node_id,
                        "page": page_number,
                        "source": str(path),
                        "text": "",
                        "omitted_reason": "Additional table page exceeds the per-query layout page limit.",
                    }
                )
                return results
            with pymupdf.open(path) as document:
                if not 1 <= page_number <= len(document):
                    continue
                page = document[page_number - 1]
                layout = render_page_layout(page)
                if len(layout) > 16000:
                    # No partial table masquerades as complete evidence.
                    results.append(
                        {
                            "chunk_id": node.node_id,
                            "page": page_number,
                            "source": str(path),
                            "text": "",
                            "omitted_reason": "This page exceeds the 16000-character layout limit.",
                        }
                    )
                    continue
                results.append(
                    {
                        "chunk_id": node.node_id,
                        "page": page_number,
                        "source": str(path),
                        "bbox": list(page.rect),
                        "text": layout,
                    }
                )
    return results
