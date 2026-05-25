import { cardCollapsedSize, clampResizablePanelSize, workspaceSplitterSize } from "./workspace-panel-sizing";

export type WorkspaceOuterLayoutSizes = {
  left: number;
  right: number;
};

export const defaultOuterLayoutSizes: WorkspaceOuterLayoutSizes = {
  left: 292,
  right: 322,
};

export const outerPanelMin = {
  left: cardCollapsedSize,
  right: cardCollapsedSize,
  center: cardCollapsedSize,
};

export function fitOuterLayoutSizes(
  sizes: WorkspaceOuterLayoutSizes,
  availableWidth: number,
  visible: { left: boolean; right: boolean },
): WorkspaceOuterLayoutSizes {
  const handleWidth = (visible.left ? workspaceSplitterSize : 0) + (visible.right ? workspaceSplitterSize : 0);
  const availableForSidePanels = Math.max(0, availableWidth - handleWidth - outerPanelMin.center);
  const leftMin = visible.left ? outerPanelMin.left : 0;
  const rightMin = visible.right ? outerPanelMin.right : 0;
  const leftMax = visible.left ? Math.max(leftMin, availableForSidePanels - rightMin) : sizes.left;
  const rightMax = visible.right ? Math.max(rightMin, availableForSidePanels - leftMin) : sizes.right;
  let left = visible.left ? clampResizablePanelSize(sizes.left, leftMin, leftMax) : sizes.left;
  let right = visible.right ? clampResizablePanelSize(sizes.right, rightMin, rightMax) : sizes.right;

  const sideTotal = (visible.left ? left : 0) + (visible.right ? right : 0);
  if (sideTotal <= availableForSidePanels) {
    return left === sizes.left && right === sizes.right ? sizes : { left, right };
  }

  const overflow = sideTotal - availableForSidePanels;
  const leftFlex = visible.left ? Math.max(0, left - leftMin) : 0;
  const rightFlex = visible.right ? Math.max(0, right - rightMin) : 0;
  const flexTotal = leftFlex + rightFlex;
  if (flexTotal > 0) {
    if (visible.left) {
      left -= overflow * (leftFlex / flexTotal);
    }
    if (visible.right) {
      right -= overflow * (rightFlex / flexTotal);
    }
  }

  left = visible.left ? clampResizablePanelSize(left, leftMin, leftMax) : left;
  right = visible.right ? clampResizablePanelSize(right, rightMin, rightMax) : right;
  return left === sizes.left && right === sizes.right ? sizes : { left, right };
}
