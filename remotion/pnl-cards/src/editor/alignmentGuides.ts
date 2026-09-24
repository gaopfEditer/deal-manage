/** 靠近对齐时显示参考线并吸附（像素） */
export const SNAP_THRESHOLD = 6;

export type Bounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type GuideLine =
  | { orientation: "vertical"; x: number }
  | { orientation: "horizontal"; y: number };

export type SnapResult = {
  x: number;
  y: number;
  guides: GuideLine[];
};

function edges(b: Bounds) {
  return {
    left: b.left,
    right: b.left + b.width,
    centerX: b.left + b.width / 2,
    top: b.top,
    bottom: b.top + b.height,
    centerY: b.top + b.height / 2,
  };
}

function snapOneAxis(
  movingEdges: [number, number, number],
  anchor: number,
  targets: number[],
  threshold: number
): { anchor: number; guidePos: number | null } {
  let best: { dist: number; target: number; delta: number } | null = null;

  for (const edge of movingEdges) {
    for (const target of targets) {
      const dist = Math.abs(edge - target);
      if (dist <= threshold && (!best || dist < best.dist)) {
        best = { dist, target, delta: target - edge };
      }
    }
  }

  if (!best) return { anchor, guidePos: null };
  return { anchor: anchor + best.delta, guidePos: best.target };
}

/** 根据锚点 (x,y) 与相对左上偏移，计算吸附后的坐标与参考线 */
export function snapPosition(
  anchorX: number,
  anchorY: number,
  offsetLeft: number,
  offsetTop: number,
  width: number,
  height: number,
  others: Bounds[],
  canvas: { width: number; height: number },
  threshold = SNAP_THRESHOLD
): SnapResult {
  const left = anchorX + offsetLeft;
  const top = anchorY + offsetTop;
  const moving = edges({ left, top, width, height });

  const xTargets: number[] = [0, canvas.width / 2, canvas.width];
  const yTargets: number[] = [0, canvas.height / 2, canvas.height];
  for (const o of others) {
    const e = edges(o);
    xTargets.push(e.left, e.centerX, e.right);
    yTargets.push(e.top, e.centerY, e.bottom);
  }

  const guides: GuideLine[] = [];

  const xSnap = snapOneAxis(
    [moving.left, moving.centerX, moving.right],
    anchorX,
    xTargets,
    threshold
  );
  let nx = xSnap.anchor;
  if (xSnap.guidePos !== null) {
    guides.push({ orientation: "vertical", x: xSnap.guidePos });
  }

  const moved = edges({
    left: nx + offsetLeft,
    top,
    width,
    height,
  });
  const ySnap = snapOneAxis(
    [moved.top, moved.centerY, moved.bottom],
    anchorY,
    yTargets,
    threshold
  );
  const ny = ySnap.anchor;
  if (ySnap.guidePos !== null) {
    guides.push({ orientation: "horizontal", y: ySnap.guidePos });
  }

  return {
    x: Math.round(nx),
    y: Math.round(ny),
    guides,
  };
}
