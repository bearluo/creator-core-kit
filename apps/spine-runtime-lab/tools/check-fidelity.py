"""保真度比对：VAT（左）与 REALTIME Spine（右）同帧并排，逐像素比较。

用法：python check-fidelity.py <logcat.txt> <page0.png> [page1.png ...] [--out <dir>]

日志行（SpineLabDriver.runFidelity）：
  [SpineFidelity] page=P clip=C frame=F lerp=L fps=R rect=x0,y0,x1,y1 dx=D window=WxH
rect 是左侧 VAT 的屏幕矩形（左下原点），右侧 Spine 同一矩形平移 dx。
输出每行：平均绝对差、最大通道差 >16 / >48 的像素占比；--out 时另存 左|右|差×4 拼图。
"""
import re
import sys

from PIL import Image, ImageChops

LINE = re.compile(
    r"\[SpineFidelity\] page=(\d+) clip=(\S+) frame=([\d.]+) lerp=(\d) fps=\S+ "
    r"rect=(-?\d+),(-?\d+),(-?\d+),(-?\d+) dx=(-?\d+) window=(\d+)x(\d+)"
)


def main() -> int:
    args = sys.argv[1:]
    out = None
    if "--out" in args:
        out = args[args.index("--out") + 1]
        del args[args.index("--out"):args.index("--out") + 2]
    log, shots = args[0], args[1:]
    rows = {}
    for line in open(log, encoding="utf-8", errors="replace"):
        match = LINE.search(line)
        if match:
            rows[(int(match.group(1)), float(match.group(3)))] = match  # 同页同帧取最后一条
    worst = {}  # (半帧?, lerp) → 最差 >48
    for page, shot in enumerate(shots):
        image = Image.open(shot).convert("RGB")
        for (row_page, frame), match in sorted(rows.items()):
            if row_page != page:
                continue
            x0, y0, x1, y1, dx = (int(match.group(i)) for i in (5, 6, 7, 8, 9))
            window_w, window_h = int(match.group(10)), int(match.group(11))
            sx, sy = image.width / window_w, image.height / window_h
            box = (round(x0 * sx), round((window_h - y1) * sy), round(x1 * sx), round((window_h - y0) * sy))
            shift = round(dx * sx)
            left = image.crop(box)
            right = image.crop((box[0] + shift, box[1], box[2] + shift, box[3]))
            diff = ImageChops.difference(left, right)
            pixels = list(diff.getdata())
            total = len(pixels)
            mean = sum(sum(p) for p in pixels) / (total * 3)
            over16 = sum(1 for p in pixels if max(p) > 16) / total
            over48 = sum(1 for p in pixels if max(p) > 48) / total
            variant = ("half" if frame % 1 else "whole", match.group(4))
            worst[variant] = max(worst.get(variant, 0.0), over48)
            print(f"page={page} clip={match.group(2)} frame={frame} lerp={match.group(4)} mean={mean:.2f} >16={over16:.2%} >48={over48:.2%}")
            if out:
                strip = Image.new("RGB", (left.width * 3, left.height))
                strip.paste(left, (0, 0))
                strip.paste(right, (left.width, 0))
                strip.paste(diff.point(lambda v: min(255, v * 4)), (left.width * 2, 0))
                strip.save(f"{out}/fidelity-p{page}-{match.group(2)}-{frame}.png")
    for (kind, lerp), value in sorted(worst.items()):
        print(f"worst >48 frame={kind} lerp={lerp}: {value:.2%}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
