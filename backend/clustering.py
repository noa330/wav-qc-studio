from __future__ import annotations

from collections import defaultdict
from typing import Any

import numpy as np
from sklearn.cluster import AgglomerativeClustering


def cluster_speaker_embeddings(items: list[dict[str, Any]], distance_threshold: float = 0.30) -> dict[str, str]:
    if not items:
        return {}

    X = np.stack([np.asarray(it["embedding"], dtype=np.float32) for it in items], axis=0)
    if len(items) == 1:
        labels = np.array([0], dtype=np.int32)
    else:
        clusterer = AgglomerativeClustering(
            n_clusters=None,
            metric="cosine",
            linkage="average",
            distance_threshold=distance_threshold,
        )
        labels = clusterer.fit_predict(X)

    unique = sorted(set(int(x) for x in labels.tolist()))
    remap = {old: f"G{idx+1:03d}" for idx, old in enumerate(unique)}

    out: dict[str, str] = {}
    for item, lab in zip(items, labels.tolist()):
        out[item["id"]] = remap[int(lab)]
    return out


def reduce_file_groups(local_items: list[dict[str, Any]], id_to_group: dict[str, str]) -> dict[str, str]:
    grouped = defaultdict(list)
    for item in local_items:
        file_path = item["file_path"]
        gid = id_to_group.get(item["id"])
        if gid:
            grouped[file_path].append(gid)

    out: dict[str, str] = {}
    for file_path, groups in grouped.items():
        uniq = sorted(set(groups))
        out[file_path] = ";".join(uniq)
    return out
