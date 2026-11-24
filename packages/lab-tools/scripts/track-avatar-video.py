# /// script
# requires-python = ">=3.12"
# dependencies = ["dghs-imgutils", "onnxruntime", "opencv-python-headless", "numpy"]
# ///
"""Track an illustrated avatar's head in a video and write a natural-track file.

usage: track-avatar-video.py <video> <out track.json> [--step n] [--start s] [--end s]

The output holds per-frame head channels and the voice envelope, never the video's path or name.
"""
import argparse
import json
import math
import subprocess
import sys

import onnxruntime

# A GPU install of onnxruntime loads its CUDA libraries only after this call; the CPU build lacks it.
if hasattr(onnxruntime, "preload_dlls"):
    onnxruntime.preload_dlls()

import cv2  # noqa: E402
import numpy as np  # noqa: E402
from imgutils.detect import detect_eyes, detect_faces  # noqa: E402
from PIL import Image  # noqa: E402

TRACKER = "track-avatar-video 1"
SAMPLE_RATE = 16000
VOICED_DB_BELOW_P95 = 25


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("video")
    parser.add_argument("out")
    parser.add_argument("--step", type=int, default=1, help="process every n-th frame")
    parser.add_argument("--start", type=float, default=0.0, help="start time in seconds")
    parser.add_argument("--end", type=float, default=None, help="end time in seconds")
    args = parser.parse_args()
    if args.step < 1 or args.start < 0 or (args.end is not None and args.end <= args.start):
        parser.error("--step must be at least 1 and --end must be after --start")
    return args


def centre(box):
    return np.array([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2])


def detect(frame):
    """Best face box and the two highest-scoring eye boxes inside it, ordered left to right."""
    img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    faces = detect_faces(img)
    if not faces:
        return None, None
    face = max(faces, key=lambda d: d[2])[0]
    x0, y0, x1, y1 = face
    eyes = []
    for box, _, score in detect_eyes(img):
        cx, cy = centre(box)
        if x0 <= cx <= x1 and y0 <= cy <= y1:
            eyes.append((score, box))
    if len(eyes) < 2:
        return face, None
    pair = [box for _, box in sorted(eyes, key=lambda e: -e[0])[:2]]
    pair.sort(key=lambda b: b[0])
    return face, pair


def read_frames(video, step, start, end):
    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        sys.exit(f"cannot open video: {video}")
    video_fps = cap.get(cv2.CAP_PROP_FPS)
    first = round(start * video_fps)
    last = math.inf if end is None else round(end * video_fps)
    rows = []
    index = 0
    while index < last:
        if index < first or (index - first) % step:
            if not cap.grab():
                break
        else:
            ok, frame = cap.read()
            if not ok:
                break
            rows.append(detect(frame))
            if len(rows) % 1500 == 0:
                print(f"{len(rows)} frames", file=sys.stderr, flush=True)
        index += 1
    cap.release()
    return video_fps / step, rows


def read_voice(video, start, fps, frames):
    command = ["ffmpeg", "-nostdin", "-v", "error", "-ss", str(start), "-i", video, "-t", str(frames / fps),
               "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"]
    pcm = np.frombuffer(subprocess.run(command, check=True, capture_output=True).stdout, dtype=np.float32)
    hop = SAMPLE_RATE / fps
    env = np.full(frames, 1e-6)
    for i in range(frames):
        chunk = pcm[int(i * hop):int((i + 1) * hop)]
        if chunk.size:
            env[i] = math.sqrt(float(np.mean(chunk.astype(np.float64) ** 2)) + 1e-12)
    db = 20 * np.log10(env + 1e-6)
    voiced = db > np.percentile(db, 95) - VOICED_DB_BELOW_P95
    level = np.clip(env / np.percentile(env, 95), 0, 1)
    return [round(float(v), 4) for v in level], [bool(v) for v in voiced]


def channels(rows):
    widths = [face[2] - face[0] for face, _ in rows if face is not None]
    if not widths:
        sys.exit("no face found in the video")
    width = float(np.median(widths))
    out = {"tilt": [], "x": [], "y": [], "scale": [], "eyeOpen": []}

    def put(**values):
        for key in out:
            v = values.get(key)
            out[key].append(None if v is None else round(float(v), 4))

    for face, eyes in rows:
        if face is None:
            put()
            continue
        scale = (face[2] - face[0]) / width
        if eyes is None:
            put(scale=scale)
            continue
        left, right = eyes
        lc, rc = centre(left), centre(right)
        mid = (lc + rc) / 2
        e = rc - lc
        aspect = [(b[3] - b[1]) / (b[2] - b[0]) for b in eyes]
        put(tilt=math.degrees(math.atan2(e[1], e[0])), x=mid[0] / width, y=mid[1] / width,
            scale=scale, eyeOpen=sum(aspect) / 2)
    return out


def main():
    args = parse_args()
    fps, rows = read_frames(args.video, args.step, args.start, args.end)
    if not rows:
        sys.exit("no frames read")
    level, voiced = read_voice(args.video, args.start, fps, len(rows))
    track = {
        "format": "natural-track",
        "version": 1,
        "source": "video",
        "tracker": TRACKER,
        "fps": round(fps, 4),
        "channels": channels(rows),
        "voice": {"level": level, "voiced": voiced},
    }
    with open(args.out, "w") as f:
        json.dump(track, f, separators=(",", ":"))
    print(f"frames {len(rows)} fps {fps:.3f} voiced {sum(voiced) / len(voiced):.3f}", file=sys.stderr)


if __name__ == "__main__":
    main()
