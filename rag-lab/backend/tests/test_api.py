"""HTTP API: routers, streaming runs, file-backed stores (incl. path safety), settings locks, SPA serving."""
import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client():
    from app.main import app

    with TestClient(app) as c:  # runs the lifespan (sample ingest; warm-up is off in tests)
        yield c


def _sample_id(client) -> str:
    return next(d["id"] for d in client.get("/api/documents").json() if "style_guide_sample" in d["name"])


def _sse(text: str) -> list[tuple[str, dict]]:
    out, ev = [], None
    for line in text.splitlines():
        if line.startswith("event:"):
            ev = line[6:].strip()
        elif line.startswith("data:"):
            out.append((ev, json.loads(line[5:])))
    return out


def test_health_components_and_defaults(client):
    assert client.get("/api/health").json() == {"ok": True}
    comp = client.get("/api/components").json()
    assert [p["name"] for p in comp["default_panes"]] == ["BM25", "Semantic", "Hybrid RRF"]
    assert {s["stage"] for s in comp["stages"]} >= {"chunking", "retrieval", "generation"}
    assert "vector_store" in comp["kinds"]
    st = client.get("/api/status").json()
    assert "chroma" in st["suggest"]["vector_stores"] and "ollama" in st


def test_streamed_bm25_run_without_llm_and_history(client, monkeypatch):
    monkeypatch.setenv("RAG_LAB_ALLOW_LLM", "false")
    pane = client.get("/api/components").json()["default_panes"][0]
    r = client.post("/api/run", json={"doc_id": _sample_id(client), "pipelines": [pane],
                                      "question": "Which code name must never appear in public documentation?"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    events = _sse(r.text)
    done = next(d for e, d in events if e == "done")
    assert "Halcyon" in done["answer"] and done["answer_source"]["kind"] == "extractive_fallback"
    hid = next(d["id"] for e, d in events if e == "history")
    assert client.get(f"/api/history/{hid}").json()["question"].startswith("Which code name")
    assert any(h["id"] == hid for h in client.get("/api/history").json())


def test_file_stores_reject_path_tricks(client):
    from app.core.storage import safe_name

    for bad in ("../../etc/passwd", "..\\..\\secret", "a/../../b"):
        assert "/" not in safe_name(bad) and "\\" not in safe_name(bad) and ".." not in safe_name(bad)
    assert client.get("/api/history/..%2F..%2Fsettings").status_code == 404
    assert client.get("/api/evals/..%2F..%2Fsettings").status_code == 404


def test_presets_round_trip(client):
    pane = client.get("/api/components").json()["default_panes"][0]
    assert client.post("/api/presets", json={"name": "My BM25", "pipeline": pane}).json() == {"ok": True}
    assert any(p["name"] == "My BM25" and not p["builtin"] for p in client.get("/api/presets").json())
    client.delete("/api/presets/My BM25")
    assert not any(p["name"] == "My BM25" for p in client.get("/api/presets").json())


def test_settings_validation_and_env_lock(client, monkeypatch):
    assert client.put("/api/settings", json={"vector_store": "nope"}).status_code == 400
    monkeypatch.setenv("RAG_LAB_ALLOW_LLM", "false")
    r = client.put("/api/settings", json={"allow_llm": True})
    assert r.status_code == 403 and "locked" in r.json()["detail"]
    caps = client.get("/api/capabilities").json()
    assert caps["mode"] in ("no_llm", "offline") and caps["locks"]["allow_llm"]


def test_serves_built_frontend_with_spa_fallback(tmp_path, monkeypatch):
    from app import config

    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<!doctype html><div id=root></div>", encoding="utf-8")
    (tmp_path / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
    monkeypatch.setattr(config, "FRONTEND_DIST", tmp_path)
    from app.main import create_app

    with TestClient(create_app()) as c:
        assert "id=root" in c.get("/").text
        assert "id=root" in c.get("/some/client/route").text  # SPA fallback
        assert c.get("/assets/app.js").text == "console.log(1)"
        assert c.get("/api/health").json() == {"ok": True}  # API still wins over the fallback
        assert c.get("/api/no-such-route").status_code == 404  # unknown API paths are 404, not the UI
