from types import SimpleNamespace

from llama_index.core.schema import NodeWithScore, TextNode
import pytest

from deeptutor.book.blocks import section
from deeptutor.book.blocks.base import BlockContext
from deeptutor.book.models import Block, Chapter, Page
from deeptutor.services.rag.pipelines.llamaindex.pipeline import LlamaIndexPipeline


def test_book_can_request_complete_source_without_growing_chat_previews():
    text = "Source introduction. " * 150 + "\nTable row: measured result at the end."
    nodes = [NodeWithScore(node=TextNode(text=text, id_="chunk-1"), score=0.4)]
    pipeline = LlamaIndexPipeline.__new__(LlamaIndexPipeline)
    preview = pipeline._nodes_to_result("query", nodes)
    complete = pipeline._nodes_to_result("query", nodes, include_source_content=True)
    assert len(preview["sources"][0]["content"]) == 200
    assert "text" not in preview["sources"][0]
    assert complete["sources"][0]["text"] == text
    assert complete["sources"][0]["chunk_id"] == "chunk-1"


@pytest.mark.asyncio
async def test_section_outline_and_body_both_receive_complete_evidence(monkeypatch):
    evidence = "Retrieved source paragraph. " * 150 + "\nFINAL TABLE ROW"
    seen = []

    async def outline(**kwargs):
        seen.append(kwargs["user_prompt"])
        return {"subsections": [{"heading": "Evidence", "target_words": 180}]}

    async def body(**kwargs):
        seen.append(kwargs["user_prompt"])
        return "### Evidence\nSupported explanation."

    monkeypatch.setattr(section, "llm_json", outline)
    monkeypatch.setattr(section, "llm_text", body)
    chapter = Chapter(id="ch1", title="Chapter")
    ctx = BlockContext(
        book_id="b1",
        chapter=chapter,
        page=Page(id="p1", book_id="b1", chapter_id="ch1"),
        block=Block(type="section"),
    )
    generator = section.SectionGenerator()
    await generator._make_outline(
        ctx=ctx,
        chapter_title="Chapter",
        chapter_summary="",
        objectives=[],
        focus_topic="Evidence",
        section_role="core",
        target_words=180,
        rag_context=evidence,
    )
    await generator._fill_subsection(
        ctx=ctx,
        chapter_title="Chapter",
        section_focus="Evidence",
        outline_intro="",
        sub={"heading": "Evidence"},
        chunks=[],
        retrieved_evidence=evidence,
    )
    assert len(seen) == 2
    assert all(evidence in prompt for prompt in seen)


@pytest.mark.asyncio
async def test_book_writer_uses_shared_budget_before_consuming_ai(monkeypatch):
    from deeptutor.book.blocks import _llm_writer
    from deeptutor.services.llm.exceptions import AppContextBudgetExceeded

    monkeypatch.setattr(
        _llm_writer,
        "get_llm_config",
        lambda: SimpleNamespace(
            binding="nimi",
            model="text.generate",
            working_context_budget=5000,
        ),
    )
    calls = []

    async def consume(**kwargs):
        calls.append(kwargs)
        return "unexpected"

    monkeypatch.setattr(_llm_writer, "llm_complete", consume)
    with pytest.raises(AppContextBudgetExceeded):
        await _llm_writer.llm_text(
            system_prompt="Use complete evidence",
            user_prompt="evidence " * 10000,
            max_tokens=1200,
        )
    assert calls == []


def test_pdf_layout_keeps_blank_columns_and_multiline_header():
    from deeptutor.services.rag.pipelines.llamaindex.source_layout import render_page_layout

    def line(x, y, text):
        return {"bbox": [x, y, x + 10, y + 5], "spans": [{"text": text}]}

    page = SimpleNamespace(
        get_text=lambda kind: {
            "blocks": [
                {
                    "lines": [
                        line(10, 10, "heads"),
                        line(60, 10, "key"),
                        line(110, 10, "score"),
                        line(60, 18, "width"),
                        line(10, 30, "8"),
                        line(60, 30, "64"),
                        line(110, 30, "1.0"),
                        line(60, 40, "16"),
                        line(110, 40, "0.9"),
                    ]
                }
            ]
        }
    )
    rows = render_page_layout(page).splitlines()
    assert rows[0].index("key") == rows[1].index("width") == rows[3].index("16")
    assert rows[0].index("score") == rows[3].index("0.9")
    assert not rows[3][9 : rows[3].index("16")].strip()


def test_pdf_layout_is_confined_to_kb_and_reports_capacity_omissions(tmp_path, monkeypatch):
    import pymupdf

    from deeptutor.services.rag.pipelines.llamaindex import source_layout

    root = tmp_path / "kb"
    root.mkdir()
    path = root / "paper.pdf"
    with pymupdf.open() as doc:
        for i in range(3):
            page = doc.new_page()
            page.insert_text((60, 60), f"Table {i + 1}: data")
        doc.save(path)
    nodes = [
        NodeWithScore(
            node=TextNode(
                id_=f"chunk-{i}",
                text=f"--- Page {i + 1} ---\nTable {i + 1}: data",
                metadata={"file_path": str(path)},
            )
        )
        for i in range(3)
    ]
    layouts = source_layout.retrieved_table_layouts(nodes, root)
    assert [item["page"] for item in layouts if item["text"]] == [1, 2]
    assert layouts[-1]["page"] == 3 and layouts[-1]["omitted_reason"]
    assert source_layout.retrieved_table_layouts(nodes, root / "other") == []
    monkeypatch.setattr(source_layout, "render_page_layout", lambda page: "x" * 16001)
    oversized = source_layout.retrieved_table_layouts(nodes[:1], root)
    assert oversized[0]["text"] == "" and oversized[0]["omitted_reason"]
