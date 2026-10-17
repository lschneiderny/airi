# /// script
# requires-python = ">=3.13"
# dependencies = ["pyarrow", "numpy"]
# ///
"""Export timestamped VTS model values without copying recordings into git."""
import io
import json
import sys
import zipfile
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq

CHANNELS = [
    "ParamAngleX", "ParamAngleY", "ParamAngleZ",
    "ParamBodyAngleX", "ParamBodyAngleY", "ParamBodyAngleZ",
    "ParamEyeBallX", "ParamEyeBallY", "ParamEyeLOpen", "ParamEyeROpen",
    "ParamBrowLY", "ParamMouthOpenY", "ParamMouthForm", "ParamBreath",
]


def main():
    source, destination = sys.argv[1:]
    with zipfile.ZipFile(source) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        parquet = pq.ParquetFile(io.BytesIO(archive.read("semantic_channels.parquet")))
        columns = ["t_rel_ms", "tracking_ok"] + [
            f"raw.{name}" for name in CHANNELS if f"raw.{name}" in parquet.schema.names
        ]
        table = parquet.read(columns=columns).to_pydict()
    t = np.asarray(table["t_rel_ms"], dtype=float) / 1000
    channels = {name: table[f"raw.{name}"] for name in CHANNELS if f"raw.{name}" in table}
    valid = np.asarray(table["tracking_ok"], dtype=bool)
    neutral = np.logical_and.reduce([
        np.abs(np.asarray(channels[name], dtype=float)) < 0.01
        for name in CHANNELS[:3]
    ])
    start = 0
    for end in range(1, len(t) + 1):
        if end < len(t) and neutral[end] == neutral[start] and t[end] - t[end - 1] <= 0.2:
            continue
        if neutral[start] and t[end - 1] - t[start] >= 5:
            valid[(t >= t[start] - 1) & (t <= t[end - 1] + 1)] = False
        start = end
    ranges = {
        p["name"]: {key: p[key] for key in ("min", "max", "default")}
        for p in manifest["source_metadata"]["parameters"] if p["name"] in CHANNELS
    }
    result = dict(sessionId=manifest["session_id"], t=t.tolist(), channels=channels,
                  valid=valid.tolist(), ranges=ranges)
    Path(destination).parent.mkdir(parents=True, exist_ok=True)
    Path(destination).write_text(json.dumps(result, allow_nan=False, separators=(",", ":")))
    print(json.dumps(dict(sessionId=result["sessionId"], samples=len(t),
                          validSamples=int(valid.sum()), durationSeconds=float(t[-1] - t[0]))))


if __name__ == "__main__":
    main()
