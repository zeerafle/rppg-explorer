"""Condense Proposal/experiments/deep-keyframe-2026-10-08/report.md into src/lib/deep.json.
Pure text parsing (no pandas): per method x rate x mode median error, share of windows on a keyframe
harmonic, its chance level, and the pre-registered verdict. Re-run if the report changes."""
import json, pathlib, re, sys

REPORT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else
                      "/home/zeerafle/WorkFolder/Documents/College/3rd Semester/Thesis/Proposal/experiments/deep-keyframe-2026-10-08/report.md")
OUT = pathlib.Path(__file__).resolve().parents[1] / "src/lib/deep.json"
txt = REPORT.read_text()
pct = lambda s: None if s.strip() in ("-", "") else float(s.strip().rstrip("%"))

g1 = {}
for m in re.finditer(r"^\| (POS|CHROM|TSCAN|PHYSNET) \| (\d+) \| ([\d.]+) \| ([\d.]+) \| (\w+) \| (\w*) \|", txt, re.M):
    g1[m[1]] = dict(mae=float(m[3]), r=float(m[4]), gated=m[5] == "yes", result=m[6] or None)

res = {}
for sec in re.split(r"^### ", txt, flags=re.M)[1:]:
    head = sec.split("\n", 1)[0]
    m = re.match(r"(\w+) @ (\d+)k", head)
    if not m:
        continue
    meth, rate = m[1], int(m[2])
    for r in re.finditer(r"^\| (long|g30|g60|g120|intra-refresh) \| (\d+) \| ([\d.]+) \| (\d+)% \| ([\d%-]+) \| ([\d%-]+) \|", sec, re.M):
        d = res.setdefault(meth, {}).setdefault(str(rate), {})
        d[r[1]] = dict(err=float(r[3]), bad=float(r[4]) / 100, harm=pct(r[5]), chance=pct(r[6]))
    for v in re.finditer(r"^VERDICT \w+ \d+k (g\d+): \*\*([^*]+)\*\*", sec, re.M):
        res[meth][str(rate)][v[1]]["verdict"] = v[2].split(" (")[0].strip()
    for v in re.finditer(r"^VERDICT \w+ \d+k (g\d+): \*\*BASELINE FAILS", sec, re.M):
        res[meth][str(rate)][v[1]]["verdict"] = "No verdict"

OUT.write_text(json.dumps(dict(source="Proposal/experiments/deep-keyframe-2026-10-08", g1=g1, results=res), indent=1))
print("written", OUT, {k: {r: sorted(v) for r, v in d.items()} for k, d in res.items()}["TSCAN"])
