"""Shared helpers for generated Syncpedia Basics domain banks."""
from __future__ import annotations

from collections import Counter

from _gen_syncpedia_basics_banks import nearest, q


def scenario(case: str, correct: str, w1: str, w2: str, w3: str) -> tuple:
    prompt = "Workplace case. " + case + " Which response is the sound one?"
    return q("scenario", prompt, correct, w1, w2, w3, "a")


def bank(items: list[tuple]) -> list[tuple]:
    rows = []
    for diff, topic, correct, w1, w2, w3 in items:
        if diff == "scenario":
            rows.append(scenario(topic, correct, w1, w2, w3))
        else:
            rows.append(nearest(diff, topic, correct, w1, w2, w3, "a"))
    return rows


def check(name: str, rows: list[tuple]) -> list[tuple]:
    counts = Counter(row[0] for row in rows)
    expected = {"medium": 40, "hard": 30, "expert": 15, "scenario": 15}
    if dict(counts) != expected:
        raise SystemExit(f"{name} counts {dict(counts)}")
    prompts = [row[1] for row in rows]
    if len(prompts) != len(set(prompts)):
        dupes = [p for p in prompts if prompts.count(p) > 1]
        raise SystemExit(f"{name} duplicate prompts {dupes[:3]}")
    for row in rows:
        opts = row[2:6]
        if len(set(opts)) < 4 or any(not str(opt).strip() for opt in opts):
            raise SystemExit(f"{name} bad options: {row[1][:80]}")
    return rows
