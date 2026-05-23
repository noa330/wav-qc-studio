import { useEffect, useState } from "react";
import type { DataTableRow } from "@shared/ipc";

export function numberFromRow(row: DataTableRow | undefined, key: string): number {
  if (!row) {
    return 0;
  }

  const value = row.raw?.[key] || row.cells[key] || "";
  const numeric = Number(String(value).replace(/[^0-9.+-]/gu, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

export function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const totalSeconds = Math.floor(safeSeconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function fileName(path: string | undefined): string {
  const parts = (path ?? "").split(/[\\/]/u).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export function findSelectedRow(rows: DataTableRow[], selectedRowId?: string): DataTableRow | undefined {
  return selectedRowId ? rows.find((row) => row.id === selectedRowId) : undefined;
}

export function useRunProgress(isRunning: boolean, tableProgress: number): number {
  const [localProgress, setLocalProgress] = useState(0);

  useEffect(() => {
    if (!isRunning) {
      setLocalProgress(0);
      return;
    }

    setLocalProgress((current) => Math.max(current, tableProgress, 4));
    const intervalId = window.setInterval(() => {
      setLocalProgress((current) => {
        const target = Math.max(current, tableProgress);
        if (target >= 95) {
          return target;
        }

        return Math.min(95, target + Math.max(1, Math.round((95 - target) * 0.08)));
      });
    }, 650);

    return () => window.clearInterval(intervalId);
  }, [isRunning, tableProgress]);

  return isRunning ? Math.max(localProgress, tableProgress) : 0;
}

export function computeProgress(rows: DataTableRow[]): number {
  if (rows.length === 0) {
    return 0;
  }

  const completed = rows.filter((row) => Object.values(row.cells).some(isCompletedStatus)).length;
  return Math.round((completed / rows.length) * 100);
}

function isCompletedStatus(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return ["완료", "검사됨", "completed", "complete", "done", "success", "succeeded", "ok"].includes(normalized);
}
