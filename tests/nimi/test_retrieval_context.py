from pathlib import Path
from types import SimpleNamespace

from llama_index.core.schema import NodeRelationship, NodeWithScore, RelatedNodeInfo, TextNode
from llama_index.core.storage.docstore import SimpleDocumentStore

from deeptutor.services.rag.pipelines.llamaindex import retrievers


def test_ranked_caption_keeps_adjacent_table_without_another_embedding_call(monkeypatch):
    caption = TextNode(
        id_="caption",
        text="--- Page 9 ---\nTable 3: model variations",
        relationships={
            NodeRelationship.NEXT: RelatedNodeInfo(node_id="table"),
        },
    )
    table = TextNode(
        id_="table",
        text="heads | PPL | BLEU\n1 | 5.29 | 24.9",
        relationships={
            NodeRelationship.PREVIOUS: RelatedNodeInfo(node_id="caption"),
        },
    )
    unrelated = TextNode(id_="unrelated", text="A different document")
    store = SimpleDocumentStore()
    store.add_documents([caption, table, unrelated])
    calls = []

    class Retriever:
        def retrieve(self, query):
            calls.append(query)
            return [NodeWithScore(node=caption, score=0.6)]

    index = SimpleNamespace(docstore=store)
    monkeypatch.setattr(retrievers, "build_retriever", lambda *args, **kwargs: Retriever())
    monkeypatch.setattr(
        retrievers,
        "retrieval_config_from_settings",
        lambda: SimpleNamespace(
            reranker_model=None,
            rerank_candidate_top_k=lambda count: count,
        ),
    )
    result = retrievers.retrieve_nodes(index, Path("unused"), "Table 3", top_k=1)
    assert calls == ["Table 3"]
    assert [item.node.node_id for item in result] == ["caption", "table"]
    assert "24.9" in result[1].node.text
    assert result[1].score is None  # Context is not presented as a ranked match.
