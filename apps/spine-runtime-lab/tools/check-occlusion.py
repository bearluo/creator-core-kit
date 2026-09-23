"""遮挡像素判定：读设备截图 + SpinePerf 日志里的 [SpineOcclusion] 屏幕矩形，按像素给 PASS/FAIL。

用法：python check-occlusion.py <screenshot.png> <logcat.txt> [--mode VAT_UI]

判定（方块是不透明纯色，被测实例定格在包围盒最大的一帧）：
- back  （方块在前、实例在后渲染 → 实例应盖住方块）：方块内非纯色像素占比 >= BACK_MIN
- front （实例在前、方块在后渲染 → 方块应盖住实例）：方块内非纯色像素占比 <= FRONT_MAX
- 自检：方块内纯色像素占比 < SANITY_MIN 说明矩形映射错了，判 INCONCLUSIVE 而不是 PASS/FAIL。
"""
import re
import sys

from PIL import Image

TOLERANCE = 12      # 每通道容差，吃掉截图压缩/抖动
SHRINK = 4          # 矩形内缩像素，避开方块边缘抗锯齿
BACK_MIN = 0.05     # 实例盖在方块上时，至少 5% 像素不是方块色
FRONT_MAX = 0.005   # 方块盖住实例时，非方块色 <= 0.5%
SANITY_MIN = 0.30   # 方块色至少占 30%，否则矩形没对上

LINE = re.compile(
    r"\[SpineOcclusion\] case=(\w+) sprite=(\d+),(\d+),(\d+) expect=\S+ "
    r"rect=(-?\d+),(-?\d+),(-?\d+),(-?\d+) window=(\d+)x(\d+).*? mode=(\S+)"
)


def main() -> int:
    shot, log = sys.argv[1], sys.argv[2]
    mode = sys.argv[sys.argv.index("--mode") + 1] if "--mode" in sys.argv else None
    cases = {}
    for line in open(log, encoding="utf-8", errors="replace"):
        match = LINE.search(line)
        if match and (mode is None or match.group(11) == mode):
            cases[match.group(1)] = match  # 同 case 取最后一条
    if not cases:
        print(f"NO_DATA mode={mode}")
        return 2

    image = Image.open(shot).convert("RGB")
    failed = False
    for name, match in sorted(cases.items()):
        target = tuple(int(match.group(i)) for i in (2, 3, 4))
        x0, y0, x1, y1 = (int(match.group(i)) for i in (5, 6, 7, 8))
        window_w, window_h = int(match.group(9)), int(match.group(10))
        sx, sy = image.width / window_w, image.height / window_h
        # worldToScreen 是左下角原点，截图是左上角原点。
        box = (
            round(x0 * sx) + SHRINK, round((window_h - y1) * sy) + SHRINK,
            round(x1 * sx) - SHRINK, round((window_h - y0) * sy) - SHRINK,
        )
        region = image.crop(box)
        pixels = list(region.getdata())
        same = sum(1 for p in pixels if all(abs(p[i] - target[i]) <= TOLERANCE for i in range(3)))
        other = 1 - same / len(pixels)
        if same / len(pixels) < SANITY_MIN:
            verdict = "INCONCLUSIVE"
        elif name == "back":
            verdict = "PASS" if other >= BACK_MIN else "FAIL"
        else:
            verdict = "PASS" if other <= FRONT_MAX else "FAIL"
        failed |= verdict != "PASS"
        print(f"{verdict} case={name} mode={match.group(11)} box={box} pixels={len(pixels)}"
              f" nonSprite={other:.2%}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
