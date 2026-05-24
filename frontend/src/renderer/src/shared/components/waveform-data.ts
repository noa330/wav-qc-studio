import { useEffect, useState } from "react";
import type { WaveformData } from "@shared/ipc";
import { studioBackend } from "@/services/studio-backend";
import { emptyWaveform } from "./waveform-types";

export function useWaveform(audioPath: string | undefined, bucketCount: number, revision: number) {
  const [data, setData] = useState<WaveformData>(emptyWaveform);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let disposed = false;
    const path = audioPath?.trim();
    if (!path) {
      setData(emptyWaveform);
      setLoading(false);
      return;
    }

    if (path.startsWith("guide://")) {
      setData(createGuideWaveform(path, bucketCount));
      setLoading(false);
      return;
    }

    setLoading(true);
    void studioBackend
      .readWaveform(path, bucketCount)
      .then((nextData) => {
        if (!disposed) {
          setData(nextData);
        }
      })
      .catch((error) => {
        if (!disposed) {
          setData({ path, durationSeconds: 0, peaks: [], error: error instanceof Error ? error.message : String(error) });
        }
      })
      .finally(() => {
        if (!disposed) {
          setLoading(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [audioPath, bucketCount, revision]);

  return { data, loading };
}

function createGuideWaveform(path: string, bucketCount: number): WaveformData {
  const durationSeconds = guideDuration(path);
  const count = Math.max(128, bucketCount);
  const seed = Array.from(path).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 2166136261);
  const peaks = Array.from({ length: count }, (_, index) => {
    const t = index / Math.max(1, count - 1);
    const envelope = Math.sin(Math.PI * t) ** 0.42;
    const carrier = Math.abs(Math.sin(t * 28 + seed * 0.00003));
    const detail = Math.abs(Math.sin(t * 93 + seed * 0.00011)) * 0.38;
    return Math.min(1, Math.max(0.08, envelope * (0.32 + carrier * 0.5 + detail * 0.28)));
  });

  return {
    path,
    durationSeconds,
    peaks,
  };
}

function guideDuration(path: string): number {
  const lower = path.toLowerCase();
  if (lower.includes("dialogue")) {
    return 3.2;
  }
  if (lower.includes("result")) {
    return 5.8;
  }
  if (lower.includes("reference") || lower.includes("prompt")) {
    return 4.9;
  }
  return 6.4;
}
