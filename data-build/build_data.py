#!/usr/bin/env python3
"""Build every data file the explorer loads, from the real experiment pipeline.

    python data-build/build_data.py [--stage STAGE ...]

Stages (default: all, each is cached on disk):
  hero_traces traces of the shipped hero streams (x264 is not bit-reproducible)
  subjects   per-subject traces for the 5 local UBFC-rPPG subjects  -> public/data/subjects/
  damage     42-subject compression sweep from the C1 pilot          -> public/data/damage.json
  windows    keyframe-test per-window results                        -> public/data/windows.json
  videos     hero clip: x264 streams (mp4 + webm), source copy       -> public/data/hero/
  tiles      per-tile colour means of the raw hero video             -> public/data/hero/tiles.*
  magnify    colour-magnified + decoded-minus-source videos          -> public/data/hero/
  crop       un-magnified crop of the source, same region as magnify -> public/data/hero/
  golden     Python reference outputs for the JS unit tests          -> tests/golden.json

Nothing is simulated: the rPPG code is qp-probe/pilot/extract.py, the encodes use
qp-probe/pilot/keyframe.py's recipe, and the traces are the arrays that run
produced (re-derived from the video for the hero, and checked against them).
"""
import argparse
import json
import pathlib
import subprocess
import sys

import cv2
import numpy as np
import pandas as pd
from scipy.signal import butter, filtfilt

ROOT = pathlib.Path(__file__).resolve().parents[1]
QP = pathlib.Path.home() / "Projects/qp-probe"
THESIS = pathlib.Path.home() / "WorkFolder/Documents/College/3rd Semester/Thesis/Proposal/experiments"
sys.path.insert(0, str(QP / "pilot"))
sys.path.insert(0, str(QP))
import extract as E  # noqa: E402
import keyframe as K  # noqa: E402

OUT = ROOT / "public/data"
TMP = ROOT / "data-build/.tmp"
SUBJECTS = [1, 10, 20, 30, 40]
HERO = 10
MODES = K.MODES                       # long g30 g60 g120 intra-refresh
RATE = "800k"
TILE = 32                             # px; tiles are NTX x NTY around the face box
NTX, NTY = 11, 10
MAG_ALPHA = 60                        # colour-magnification gain
MAG_BAND = (1.4, 2.2)                 # Hz, around the hero subject's heart rate (84-132 bpm)
MAG_DOWN = 16                         # spatial blur factor for the magnified clip
DIFF_GAIN = 12                        # decoded-minus-source gain on luma
NPZ_DIR = THESIS / "keyframe-2026-10-07/data"
DATA = QP / "ubfc-rppg"


def rnd(a, nd=4):
    return np.round(np.asarray(a, float), nd).tolist()


def inner_box(box):
    x0, y0, x1, y1 = box
    bw, bh = x1 - x0, y1 - y0
    return [x0 + int(round(bw * (1 - E.INNER) / 2)), y0 + int(round(bh * (1 - E.INNER) / 2)),
            x1 - int(round(bw * (1 - E.INNER) / 2)), y1 - int(round(bh * (1 - E.INNER) / 2))]


def run(cmd, **kw):
    return subprocess.run([str(c) for c in cmd], check=True, **kw)


def frames(path, vf=None, w=640, h=480):
    """Yield decoded RGB frames (h, w, 3) uint8 from any video via the system ffmpeg
    (OpenCV segfaults on UBFC's rawvideo AVIs)."""
    cmd = ["ffmpeg", "-v", "error", "-i", str(path)]
    if vf:
        cmd += ["-vf", vf]
    cmd += ["-f", "rawvideo", "-pix_fmt", "rgb24", "-fps_mode", "passthrough", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, bufsize=1 << 22)
    fsz = w * h * 3
    while True:
        b = p.stdout.read(fsz)
        if len(b) < fsz:
            break
        yield np.frombuffer(b, np.uint8).reshape(h, w, 3)
    p.stdout.close()
    p.wait()


def roi_trace(path, box, w=640, h=480):
    ix0, iy0, ix1, iy1 = inner_box(box)
    return np.array([f[iy0:iy1, ix0:ix1].reshape(-1, 3).mean(axis=0) for f in frames(path, None, w, h)])


# ----------------------------------------------------------------- subjects ----

def stage_subjects():
    hero_npz = TMP / "hero_traces.npz"
    for sid in SUBJECTS:
        d = dict(np.load(NPZ_DIR / f"s{sid}.npz"))
        if sid == HERO and hero_npz.exists():
            # x264 is not bit-reproducible between runs (see hero_traces), so the clip shipped to the
            # browser and the traces drawn next to it must come from the SAME encode.
            d.update(dict(np.load(hero_npz)))
        fps, usable = float(d["fps"]), int(d["usable"])
        n = len(d["rgb_source"])
        b, a = butter(3, E.BAND, btype="bandpass", fs=fps)
        conds = {}
        for name in ["source"] + MODES:
            c = {"rgb": rnd(d[f"rgb_{name}"].ravel(), 4)}
            if name != "source":
                isI = d[f"isI_{name}"]
                c["isI"] = np.flatnonzero(isI).tolist()
                c["qroi"] = rnd(d[f"qroi_{name}"], 2)
                c["qmean"] = rnd(d[f"qmean_{name}"], 2)
            conds[name] = c
        # receiver-side correction (the "phase" method of keyframe.py), as a POS trace
        for name in ["g30", "g60", "g120"]:
            rgb = K.corrected(d[f"rgb_{name}"], d[f"isI_{name}"], d[f"qroi_{name}"],
                              d[f"qmean_{name}"], fps, "phase")
            conds[name]["bvp_phase"] = rnd(E.pos(rgb[:usable], fps), 5)
        obj = dict(sid=sid, fps=fps, n=n, usable=usable, box=d["box"].tolist(),
                   inner=inner_box(d["box"].tolist()), ref=rnd(d["ref"], 4),
                   ba=dict(b=b.tolist(), a=a.tolist()), conds=conds)
        (OUT / "subjects" / f"s{sid}.json").write_text(json.dumps(obj, separators=(",", ":")))
        print(f"subjects: s{sid} n={n} fps={fps:.4f}")


# ------------------------------------------------------------------- damage ----

def stage_damage():
    files = sorted((THESIS / "c1-pilot/results-2026-10-07/data").glob("features-*.parquet"))
    df = pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)
    df = df[(df.aq != 0)]                                   # drop the aq=0 control
    conds = ["source", "1600k-aq1-long", "800k-aq1-long", "400k-aq1-long", "200k-aq1-long",
             "100k-aq1-long", "800k-aq1-g60", "800k-aq1-intra-refresh"]
    df = df[df.cond.isin(conds)]
    rows = []
    for r in df.itertuples():
        q = None if pd.isna(r.Q_mean) else round(float(r.Q_mean), 2)
        rows.append([int(r.subject), conds.index(r.cond), int(r.win_start), round(float(r.hr_ref), 2),
                     round(float(r.hr_pos), 2), round(float(r.hr_chrom), 2), q])
    meta = dict(conds=conds, columns=["subject", "cond", "win_start", "hr_ref", "hr_pos", "hr_chrom", "q_mean"],
                subjects=int(df.subject.nunique()), rows=rows)
    (OUT / "damage.json").write_text(json.dumps(meta, separators=(",", ":")))
    print(f"damage: {len(rows)} windows, {meta['subjects']} subjects")


def stage_windows():
    df = pd.read_csv(THESIS / "keyframe-2026-10-07/windows.csv")
    rows = [[int(r.subject), r.mode, r.method, int(r.win), round(float(r.hr_ref), 2), round(float(r.hr_pos), 2),
             None if pd.isna(r.harm_dist) else round(float(r.harm_dist), 2)] for r in df.itertuples()]
    (OUT / "windows.json").write_text(json.dumps(dict(
        columns=["subject", "mode", "method", "win", "hr_ref", "hr_pos", "harm_dist"], rows=rows),
        separators=(",", ":")))
    print(f"windows: {len(rows)} rows")


# ------------------------------------------------------------------- videos ----

def mp4_webm(raw, name):
    """Faststart remux of the *unchanged* x264 stream, plus a VP9 copy for browsers
    that cannot decode H.264. Traces always come from the H.264 stream."""
    run(["ffmpeg", "-y", "-v", "error", "-i", raw, "-c", "copy", "-movflags", "+faststart",
         OUT / "hero" / f"{name}.mp4"])
    run(["ffmpeg", "-y", "-v", "error", "-i", raw, "-c:v", "libvpx-vp9", "-crf", "22", "-b:v", "0",
         "-deadline", "good", "-cpu-used", "5", "-row-mt", "1", "-threads", "4", "-pix_fmt", "yuv420p", "-an", OUT / "hero" / f"{name}.webm"])


def stage_videos():
    TMP.mkdir(exist_ok=True, parents=True)
    d = np.load(NPZ_DIR / f"s{HERO}.npz")
    box = d["box"].tolist()
    src = DATA / f"subject{HERO}/vid.avi"
    report = {}
    for mode in MODES:
        raw = TMP / f"{mode}.mp4"
        if not raw.exists():
            K.encode(src, raw, RATE, mode)
        tr = roi_trace(raw, box)
        diff = float(np.abs(tr - d[f"rgb_{mode}"]).max())
        report[mode] = diff
        print(f"videos: {mode:14s} trace vs experiment max |diff| = {diff:.2e}")
        mp4_webm(raw, mode)
    # display copy of the source: near-lossless, short GOP for fast seeking
    sraw = TMP / "source.mp4"
    if not sraw.exists():
        run(["ffmpeg", "-y", "-v", "error", "-i", src, "-c:v", "libx264", "-crf", "18", "-preset", "slow",
             "-g", "15", "-pix_fmt", "yuv420p", sraw])
    mp4_webm(sraw, "source")
    (OUT / "hero" / "check.json").write_text(json.dumps(dict(max_abs_trace_diff=report)))


def stage_hero_traces():
    """Traces, frame types and QP of the hero clip, measured on the shipped H.264 streams."""
    d = np.load(NPZ_DIR / f"s{HERO}.npz")
    box = d["box"].tolist()
    out, report = {}, {}
    for mode in MODES:
        raw = TMP / f"{mode}.mp4"
        q = E.qp_summary(raw, box)
        out[f"rgb_{mode}"] = roi_trace(raw, box)
        out[f"isI_{mode}"] = (q.pict_type == "I").to_numpy()
        out[f"qroi_{mode}"] = q.roi_mean.to_numpy(float)
        out[f"qmean_{mode}"] = q.mean_qp.to_numpy(float)
        fps, usable = float(d["fps"]), int(d["usable"])
        ref = E.bandpass(d["ref"], fps)
        wn, hop = int(round(E.WIN_S * fps)), int(round(E.HOP_S * fps))
        err = {}
        for tag, rgb in (("experiment", d[f"rgb_{mode}"]), ("shipped", out[f"rgb_{mode}"])):
            p = E.pos(rgb[:usable], fps)
            err[tag] = float(np.median([abs(E.hr_bpm(p[a:a + wn], fps) - E.hr_bpm(ref[a:a + wn], fps))
                                        for a in range(0, usable - wn + 1, hop)]))
        report[mode] = dict(err, frames_I=int(out[f"isI_{mode}"].sum()))
        print(f"hero_traces: {mode:14s} median POS err experiment {err['experiment']:.1f}  shipped {err['shipped']:.1f}")
    np.savez(TMP / "hero_traces.npz", **out)
    (OUT / "hero" / "encode-check.json").write_text(json.dumps(report, indent=1))


# -------------------------------------------------------------------- tiles ----

def tile_region(box, w=640, h=480):
    cx, cy = (box[0] + box[2]) // 2, (box[1] + box[3]) // 2
    x0 = int(np.clip(cx - NTX * TILE // 2, 0, w - NTX * TILE))
    y0 = int(np.clip(cy - NTY * TILE // 2, 0, h - NTY * TILE))
    return x0, y0


def stage_tiles():
    d = np.load(NPZ_DIR / f"s{HERO}.npz")
    box = d["box"].tolist()
    x0, y0 = tile_region(box)
    src = DATA / f"subject{HERO}/vid.avi"
    out = []
    for f in frames(src, f"crop={NTX * TILE}:{NTY * TILE}:{x0}:{y0}", NTX * TILE, NTY * TILE):
        t = f.reshape(NTY, TILE, NTX, TILE, 3).astype(np.float32).mean(axis=(1, 3))
        out.append(t)
    arr = np.stack(out).astype(np.float32)                    # (n, NTY, NTX, 3)
    arr.tofile(OUT / "hero" / "tiles.f32")
    meta = dict(n=int(arr.shape[0]), ny=NTY, nx=NTX, tile=TILE, x0=x0, y0=y0, width=640, height=480,
                layout="frame-major [n][ny][nx][rgb] float32 little-endian")
    (OUT / "hero" / "tiles.json").write_text(json.dumps(meta))
    print(f"tiles: {arr.shape}, region x0={x0} y0={y0}")


# ----------------------------------------------------------------- magnify -----

def small_stack(path, x0, y0, w=640, h=480, f=4):
    vf = f"crop={NTX * TILE}:{NTY * TILE}:{x0}:{y0},scale={NTX * TILE // f}:{NTY * TILE // f}:flags=area"
    return np.stack(list(frames(path, vf, NTX * TILE // f, NTY * TILE // f)))   # (n, h, w, 3) uint8


def write_video(path, gen, fps, w, h):
    p = subprocess.Popen(
        ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}",
         "-r", repr(fps), "-i", "-", "-c:v", "libx264", "-crf", "20", "-preset", "slow", "-g", "15",
         "-pix_fmt", "yuv420p", str(path)], stdin=subprocess.PIPE)
    for fr in gen:
        p.stdin.write(np.ascontiguousarray(fr, np.uint8).tobytes())
    p.stdin.close()
    p.wait()


def up(a, w, h):
    return cv2.resize(a, (w, h), interpolation=cv2.INTER_CUBIC)


def stage_magnify(diffs=True):
    """Colour-magnified clip (Eulerian-style) and decoded-minus-source clips.

    The magnified clip: heavy spatial blur (1/16), temporal band-pass around this subject's heart-rate
    range ALONG TIME, amplify, add back. Motion inside that band is amplified too, so hair edges ghost."""
    TMP.mkdir(exist_ok=True, parents=True)
    d = np.load(NPZ_DIR / f"s{HERO}.npz")
    fps = float(d["fps"])
    x0, y0 = tile_region(d["box"].tolist())
    W, H = NTX * TILE, NTY * TILE
    src = DATA / f"subject{HERO}/vid.avi"
    small = small_stack(src, x0, y0, f=MAG_DOWN).astype(np.float32)          # (n, h, w, 3)
    b, a = butter(2, MAG_BAND, btype="bandpass", fs=fps)
    delta = filtfilt(b, a, small - small.mean(axis=0), axis=0).astype(np.float32)
    del small

    def gen_mag():
        for i, f in enumerate(frames(src, f"crop={W}:{H}:{x0}:{y0}", W, H)):
            big = np.dstack([up(delta[i, ..., c], W, H) for c in range(3)])
            yield np.clip(f.astype(np.float32) + MAG_ALPHA * big, 0, 255)

    mag_tmp = TMP / "magnified.mp4"
    write_video(mag_tmp, gen_mag(), fps, W, H)
    mp4_webm(mag_tmp, "magnified")
    del delta
    print("magnify: magnified done")
    (OUT / "hero" / "view.json").write_text(json.dumps(dict(
        x0=x0, y0=y0, w=W, h=H, mag_alpha=MAG_ALPHA, mag_band=list(MAG_BAND), diff_gain=DIFF_GAIN, fps=fps, rate=RATE)))
    if diffs:
        stage_diffs()


def stage_diffs():
    """Decoded minus source, luma only, mid-grey = identical. Low gain on purpose: this shows the
    SPATIAL error of compression (edges, blocks). The keyframe pump is a ~0.2 grey-level shift of the
    face AVERAGE and is invisible here at any gain, which is the point made in the Codec module."""
    d = np.load(NPZ_DIR / f"s{HERO}.npz")
    fps = float(d["fps"])
    x0, y0 = tile_region(d["box"].tolist())
    W, H = NTX * TILE, NTY * TILE
    src = DATA / f"subject{HERO}/vid.avi"
    src_small = small_stack(src, x0, y0, f=2).astype(np.float32)
    for mode in MODES:
        a_ = small_stack(TMP / f"{mode}.mp4", x0, y0, f=2).astype(np.float32)
        m = min(len(a_), len(src_small))
        dd = (a_[:m] - src_small[:m]).mean(axis=-1)
        del a_

        def gen_diff():
            for i in range(m):
                g = np.clip(128 + DIFF_GAIN * up(dd[i], W, H), 0, 255)
                yield np.dstack([g, g, g])

        t = TMP / f"diff_{mode}.mp4"
        write_video(t, gen_diff(), fps, W, H)
        mp4_webm(t, f"diff_{mode}")
        print(f"diffs: diff_{mode} done")


def stage_magnified():
    stage_magnify(diffs=False)


def stage_crop():
    """Un-magnified crop of the source over the same region, so magnified vs plain compare 1:1."""
    TMP.mkdir(exist_ok=True, parents=True)
    d = np.load(NPZ_DIR / f"s{HERO}.npz")
    fps = float(d["fps"])
    x0, y0 = tile_region(d["box"].tolist())
    W, H = NTX * TILE, NTY * TILE
    t = TMP / "crop.mp4"
    write_video(t, frames(DATA / f"subject{HERO}/vid.avi", f"crop={W}:{H}:{x0}:{y0}", W, H), fps, W, H)
    mp4_webm(t, "crop")
    print("crop done")


# ----------------------------------------------------------------------- qp ----

QPS = [10, 20, 24, 28, 34, 40, 46, 51]     # constant quantiser, single keyframe, one thread (reproducible)
QP_CLIPS = [20, 34, 46]
QP_STILL = 600                         # frame index of the still shown in the module


def stage_qp():
    """Subject 10 encoded at fixed QP (CQP, one keyframe, threads=1). Per QP: size, PSNR over the face
    region, POS heart-rate error, and how big the face-average brightness error is next to the pulse."""
    import cv2
    TMP.mkdir(exist_ok=True, parents=True)
    (OUT / "qp").mkdir(exist_ok=True, parents=True)
    d = np.load(NPZ_DIR / f"s{HERO}.npz")
    box = d["box"].tolist()
    fps, usable = float(d["fps"]), int(d["usable"])
    ix0, iy0, ix1, iy1 = inner_box(box)
    x0, y0 = tile_region(box)
    W, H = NTX * TILE, NTY * TILE
    src = DATA / f"subject{HERO}/vid.avi"
    ref = E.bandpass(d["ref"], fps)
    wn, hop = int(round(E.WIN_S * fps)), int(round(E.HOP_S * fps))
    starts = list(range(0, usable - wn + 1, hop))
    truth = [E.hr_bpm(ref[a:a + wn], fps) for a in starts]
    g_src = d["rgb_source"][:, 1]
    pulse_std = float(E.bandpass(g_src, fps).std())
    rows = []
    for qp in QPS:
        raw = TMP / f"qp{qp}.mp4"
        if not raw.exists():
            run(["ffmpeg", "-y", "-v", "error", "-i", src, "-c:v", "libx264", "-qp", qp, "-g", "9999",
                 "-x264-params", "threads=1:aq-mode=1", "-pix_fmt", "yuv420p", raw])
        nbytes = raw.stat().st_size
        tr, mse = [], []
        for i, (a, b) in enumerate(zip(frames(src), frames(raw))):
            tr.append(b[iy0:iy1, ix0:ix1].reshape(-1, 3).mean(axis=0))
            ca = a[y0:y0 + H, x0:x0 + W].astype(np.float32)
            cb = b[y0:y0 + H, x0:x0 + W].astype(np.float32)
            mse.append(((ca - cb) ** 2).mean())
            if i == QP_STILL:
                cv2.imwrite(str(OUT / "qp" / f"still_qp{qp}.png"), cv2.cvtColor(b[y0:y0 + H, x0:x0 + W], cv2.COLOR_RGB2BGR))
                if qp == QPS[0]:
                    cv2.imwrite(str(OUT / "qp" / "still_src.png"), cv2.cvtColor(a[y0:y0 + H, x0:x0 + W], cv2.COLOR_RGB2BGR))
        tr = np.array(tr)
        n = min(len(tr), len(g_src))
        psnr = float(np.mean(10 * np.log10(255 ** 2 / np.maximum(mse, 1e-9))))
        bvp = E.pos(tr[:usable], fps)
        est = [E.hr_bpm(bvp[a:a + wn], fps) for a in starts]
        err = [abs(e - t) for e, t in zip(est, truth)]
        err_std = float(E.bandpass(tr[:n, 1] - g_src[:n], fps).std())
        rows.append(dict(qp=qp, bytes=nbytes, kbps=nbytes * 8 / (len(tr) / fps) / 1000, psnr=psnr,
                         err_med=float(np.median(err)), err_bad=float(np.mean(np.array(err) > 5)),
                         err_std=err_std, est=rnd(est, 2), bvp=rnd(bvp, 5)))
        print(f"qp: {qp:2d}  {rows[-1]['kbps']:8.0f} kbps  psnr {psnr:5.1f}  med err {rows[-1]['err_med']:5.1f}  "
              f"pulse std {pulse_std:.3f}  error std {err_std:.3f}", flush=True)
        if qp in QP_CLIPS:
            t = TMP / f"qpclip{qp}.mp4"
            write_video(t, frames(raw, f"crop={W}:{H}:{x0}:{y0}", W, H), fps, W, H)
            mp4_webm(t, f"qp{qp}")
    out = dict(fps=fps, qps=QPS, clips=QP_CLIPS, w=W, h=H, still=QP_STILL, pulse_std=pulse_std,
               starts=starts, wn=wn, truth=rnd(truth, 2), rows=rows)
    (OUT / "qp" / "qp.json").write_text(json.dumps(out, separators=(",", ":")))
    print("qp: written")


# ------------------------------------------------------------------- golden ----

def stage_golden():
    """Python reference outputs, computed from the *shipped* (rounded) JSON so the JS tests
    compare like with like."""
    s = json.loads((OUT / "subjects" / f"s{HERO}.json").read_text())
    fps, usable = s["fps"], s["usable"]
    out = dict(sid=HERO, fps=fps, usable=usable, conds={})
    ref = E.bandpass(np.array(s["ref"]), fps)
    wn, hop = int(round(E.WIN_S * fps)), int(round(E.HOP_S * fps))
    starts = list(range(0, usable - wn + 1, hop))
    out["starts"], out["wn"] = starts, wn
    out["hr_ref"] = [E.hr_bpm(ref[s0:s0 + wn], fps) for s0 in starts]
    for name in ["source", "long", "g60"]:
        rgb = np.array(s["conds"][name]["rgb"]).reshape(-1, 3)[:usable]
        pos, chrom = E.pos(rgb, fps), E.chrom(rgb, fps)
        out["conds"][name] = dict(
            pos_head=pos[:40].tolist(), pos_tail=pos[-40:].tolist(), pos_sum=float(pos.sum()),
            pos_std=float(pos.std()), chrom_std=float(chrom.std()),
            hr_pos=[E.hr_bpm(pos[s0:s0 + wn], fps) for s0 in starts],
            hr_chrom=[E.hr_bpm(chrom[s0:s0 + wn], fps) for s0 in starts])
    f, p = E.spectrum(E.pos(np.array(s["conds"]["g60"]["rgb"]).reshape(-1, 3)[:usable], fps)[:wn], fps)
    out["spec_g60_first"] = dict(f=f[::200].tolist(), p=(p / p.max())[::200].tolist())
    (ROOT / "tests/golden.json").write_text(json.dumps(out))
    print("golden: written")


STAGES = dict(hero_traces=stage_hero_traces, subjects=stage_subjects, damage=stage_damage, windows=stage_windows, videos=stage_videos,
              tiles=stage_tiles, magnify=stage_magnify, magnified=stage_magnified, diffs=stage_diffs, crop=stage_crop, qp=stage_qp, golden=stage_golden)

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", nargs="*", default=list(STAGES))
    for st in ap.parse_args().stage:
        print(f"== {st}", flush=True)
        STAGES[st]()
