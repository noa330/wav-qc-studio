import { cardCollapsedSize, cardCollapseSnapSize, clampResizablePanelSize, workspaceSplitterSize } from "./workspace-panel-sizing";

export type WorkspaceOuterLayoutSizes = {
  left: number;
  right: number;
  totalWidth?: number;
};

export const defaultOuterLayoutSizes: WorkspaceOuterLayoutSizes = {
  left: 350,
  right: 350,
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
  
  let leftTarget = sizes.left;
  let rightTarget = sizes.right;
  const isFirstLoad = !sizes.totalWidth;

  if (isFirstLoad) {
    // On reset or first load, use default 350 but prevent them from squishing the center panel too much.
    // Max 30% of window width per side panel (so center gets at least 40%).
    const maxSideWidth = Math.max(cardCollapseSnapSize + 1, Math.floor(availableWidth * 0.3));
    leftTarget = Math.min(defaultOuterLayoutSizes.left, maxSideWidth);
    rightTarget = Math.min(defaultOuterLayoutSizes.right, maxSideWidth);
  } else if (sizes.totalWidth && sizes.totalWidth > 0 && availableWidth !== sizes.totalWidth) {
    const scale = availableWidth / sizes.totalWidth;
    
    const threshold = cardCollapseSnapSize + 1;
    if (visible.left && sizes.left > outerPanelMin.left) {
      let scaled = Math.round(sizes.left * scale);
      if (sizes.left >= threshold && scaled < threshold) {
        scaled = threshold;
      }
      leftTarget = scaled;
    }
    if (visible.right && sizes.right > outerPanelMin.right) {
      let scaled = Math.round(sizes.right * scale);
      if (sizes.right >= threshold && scaled < threshold) {
        scaled = threshold;
      }
      rightTarget = scaled;
    }
  }

  const leftMax = visible.left ? Math.max(leftMin, availableForSidePanels - rightMin) : leftTarget;
  const rightMax = visible.right ? Math.max(rightMin, availableForSidePanels - leftMin) : rightTarget;

  let left = visible.left ? clampResizablePanelSize(leftTarget, leftMin, leftMax) : leftTarget;
  let right = visible.right ? clampResizablePanelSize(rightTarget, rightMin, rightMax) : rightTarget;

  const sideTotal = (visible.left ? left : 0) + (visible.right ? right : 0);
  if (sideTotal <= availableForSidePanels) {
    return { left, right, totalWidth: availableWidth };
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
  return { left, right, totalWidth: availableWidth };
}
