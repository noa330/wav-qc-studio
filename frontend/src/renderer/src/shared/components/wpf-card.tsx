import { motion, type HTMLMotionProps } from "motion/react";
import { cn } from "@/lib/utils";

export function WpfCard({ children, className, ...props }: HTMLMotionProps<"section">) {
  return (
    <motion.section
      {...props}
      className={cn("wpf-card overflow-hidden text-[var(--primary-text)]", className)}
    >
      {children}
    </motion.section>
  );
}
