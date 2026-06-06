export const uiSpring = {
  type: "spring",
  stiffness: 520,
  damping: 38,
  mass: 0.75,
} as const;

export const subtleSpring = {
  type: "spring",
  stiffness: 360,
  damping: 34,
  mass: 0.85,
} as const;

export const progressSpring = {
  type: "spring",
  stiffness: 230,
  damping: 30,
  mass: 0.9,
} as const;

export const workspacePageSpring = {
  type: "spring",
  stiffness: 190,
  damping: 28,
  mass: 1.05,
} as const;

export const workspaceCardSpring = {
  type: "spring",
  stiffness: 170,
  damping: 27,
  mass: 1.08,
} as const;

export const resizeHandleLineVariants = {
  idle: { opacity: 0, scale: 0.16 },
  active: { opacity: 1, scale: 1 },
} as const;

export const resizeHandleLineTransition = {
  duration: 0.16,
  ease: "easeOut",
} as const;

export const tabUnderlineTransition = {
  type: "spring",
  stiffness: 520,
  damping: 42,
  mass: 0.72,
} as const;

export const workspacePageMotion = {
  initial: { clipPath: "inset(0 2.8% 0 2.8% round 10px)" },
  animate: { clipPath: "inset(0 0% 0 0% round 0px)" },
  exit: { clipPath: "inset(0 3.8% 0 3.8% round 14px)" },
  transition: workspacePageSpring,
} as const;

export const quickEase = {
  duration: 0.14,
  ease: "easeOut",
} as const;

export const workspaceContentMotion = {
  initial: { opacity: 0, y: 5 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.18, ease: "easeOut" },
} as const;

export const pressTap = {
  scale: 0.97,
} as const;

export const tightPressTap = {
  scale: 0.92,
} as const;

export const softPressTap = {
  scale: 0.985,
} as const;

export const menuMotion = {
  initial: { opacity: 0, y: -4, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -4, scale: 0.985 },
  transition: quickEase,
} as const;

export const dialogPanelMotion = {
  initial: { opacity: 0, y: 8, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -6, scale: 0.985 },
  transition: { duration: 0.16, ease: "easeOut" },
} as const;

export const fadeSlideUpMotion = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: quickEase,
} as const;

export const tableRowMotion = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: quickEase,
} as const;

export const tableEmptyMotion = {
  initial: { opacity: 0, y: 6, scale: 0.995 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -6, scale: 0.995 },
  transition: quickEase,
} as const;

export const timelineFocusItemVariants = {
  idle: {
    scale: 1,
    boxShadow: "inset 0 0 0 0 rgba(124, 77, 255, 0)",
  },
  active: {
    scale: 1,
    boxShadow: "inset 0 0 0 1px rgba(124, 77, 255, .58)",
  },
} as const;

export const timelineFocusTransition = workspaceCardSpring;

export const checkPopMotion = {
  initial: { opacity: 0, scale: 0.65 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.65 },
  transition: { duration: 0.12, ease: "easeOut" },
} as const;

export const loadingSpinnerTransition = {
  duration: 1.1,
  ease: "linear",
  repeat: Infinity,
} as const;

export const loadingDotTransition = {
  duration: 0.75,
  ease: "easeInOut",
  repeat: Infinity,
} as const;

export const shapeMorphVariants = {
  circle: { borderRadius: "9999px" },
  square: { borderRadius: "3px" },
} as const;

export const shapeMorphTransition = {
  duration: 0.24,
  ease: "easeInOut",
} as const;
