#!/usr/bin/env python3
"""How much does the median POS error of ONE subject move when the same encode is repeated?

x264 with default threading is not bit-reproducible (timing-dependent rate control), so every
number in the experiments is one draw. This re-encodes subject 10 several times per setting
(default threads) and once with threads=1 (deterministic), and reports the median error of each.
"""
import json, pathlib, subprocess, sys
import numpy as np
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import build_data as B
E, K = B.E, B.K

REPEATS = 4
d = np.load(B.NPZ_DIR / f"s{B.HERO}.npz")
fps, usable = float(d["fps"]), int(d["usable"])
ref = E.bandpass(d["ref"], fps)
wn, hop = int(round(E.WIN_S * fps)), int(round(E.HOP_S * fps))
src = B.DATA / f"subject{B.HERO}/vid.avi"
box = d["box"].tolist()
out = {}
for mode in ["long", "g60", "g120", "intra-refresh"]:
    res = {"default_threads": [], "threads1": []}
    for tag, extra in (("default_threads", None), ("threads1", "threads=1")):
        for r in range(REPEATS if tag == "default_threads" else 2):
            mp = B.TMP / f"var_{mode}_{tag}_{r}.mp4"
            if mode == "long": g, p = "9999", "aq-mode=1"
            elif mode == "intra-refresh": g, p = "250", "aq-mode=1:intra-refresh=1"
            else: g, p = mode[1:], "aq-mode=1"
            if extra: p += ":" + extra
            cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-c:v", "libx264", "-b:v", "800k", "-minrate", "800k",
                   "-maxrate", "800k", "-bufsize", "800k", "-tune", "zerolatency", "-g", g, "-x264-params", p, mp]
            if extra: cmd[cmd.index("-c:v") + 2:cmd.index("-c:v") + 2] = ["-threads", "1"]
            B.run(cmd)
            pos = E.pos(B.roi_trace(mp, box)[:usable], fps)
            e = [abs(E.hr_bpm(pos[a:a + wn], fps) - E.hr_bpm(ref[a:a + wn], fps)) for a in range(0, usable - wn + 1, hop)]
            res[tag].append(round(float(np.median(e)), 1))
            mp.unlink()
    out[mode] = res
    print(mode, res, flush=True)
(B.OUT / "hero" / "encode-variance.json").write_text(json.dumps(out, indent=1))
