import { useEffect, useRef, useState } from "react";

export type AudioTransport = {
  currentTime: number;
  duration: number;
  progress: number;
  isPlaying: boolean;
  canPlay: boolean;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  skip: (seconds: number) => void;
  seek: (seconds: number) => void;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
  stop: () => void;
  release: () => void;
};

export function useAudioTransport(audioPath?: string, durationHint = 0, loopRange?: { start: number; end: number }, revision = 0): AudioTransport {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationHint);
  const [isPlaying, setIsPlaying] = useState(false);
  const [canPlay, setCanPlay] = useState(false);

  const stopAnimation = () => {
    if (animationFrameRef.current === null) {
      return;
    }

    cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
  };

  const startAnimation = (audio: HTMLAudioElement) => {
    stopAnimation();

    const tick = () => {
      if (audioRef.current !== audio) {
        animationFrameRef.current = null;
        return;
      }

      if (loopRange && loopRange.end > loopRange.start && audio.currentTime >= loopRange.end) {
        audio.currentTime = loopRange.start;
      }

      setCurrentTime(audio.currentTime || 0);

      if (audio.paused) {
        animationFrameRef.current = null;
        return;
      }

      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    const source = audioPathToFileUrl(audioPath);
    stopAnimation();
    setCurrentTime(0);
    setDuration(durationHint);
    setIsPlaying(false);
    setCanPlay(false);

    if (!source) {
      audioRef.current?.pause();
      audioRef.current = null;
      return;
    }

    const audio = new Audio(source);
    audio.preload = "metadata";
    audio.muted = false;
    audio.volume = 1;
    audioRef.current = audio;
    setCanPlay(true);

    const syncTime = () => {
      if (loopRange && loopRange.end > loopRange.start && audio.currentTime >= loopRange.end) {
        audio.currentTime = loopRange.start;
      }
      setCurrentTime(audio.currentTime || 0);
    };
    const syncDuration = () => {
      const nextDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : durationHint;
      setDuration(nextDuration);
      setCanPlay(true);
    };
    const markPlaying = () => {
      setIsPlaying(true);
      startAnimation(audio);
    };
    const markStopped = () => {
      stopAnimation();
      setCurrentTime(audio.currentTime || 0);
      setIsPlaying(false);
    };
    const handleEnded = () => {
      stopAnimation();
      audio.muted = false;
      audio.volume = 1;
      setIsPlaying(false);
      setCurrentTime(0);
      audio.currentTime = 0;
    };
    const handleError = () => {
      stopAnimation();
      audio.muted = false;
      audio.volume = 1;
      setCanPlay(false);
      setIsPlaying(false);
    };

    audio.addEventListener("loadedmetadata", syncDuration);
    audio.addEventListener("canplay", syncDuration);
    audio.addEventListener("timeupdate", syncTime);
    audio.addEventListener("play", markPlaying);
    audio.addEventListener("pause", markStopped);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);

    return () => {
      stopAnimation();
      audio.muted = false;
      audio.volume = 1;
      audio.pause();
      audio.removeEventListener("loadedmetadata", syncDuration);
      audio.removeEventListener("canplay", syncDuration);
      audio.removeEventListener("timeupdate", syncTime);
      audio.removeEventListener("play", markPlaying);
      audio.removeEventListener("pause", markStopped);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
      if (audioRef.current === audio) {
        audioRef.current = null;
      }
    };
  }, [audioPath, durationHint, loopRange?.end, loopRange?.start, revision]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio || !canPlay) {
      return;
    }

    if (!audio.paused) {
      stopAnimation();
      audio.muted = false;
      audio.volume = 1;
      audio.pause();
      audio.currentTime = 0;
      setCurrentTime(0);
      setIsPlaying(false);
      return;
    }

    if (loopRange && loopRange.end > loopRange.start && (audio.currentTime < loopRange.start || audio.currentTime >= loopRange.end)) {
      audio.currentTime = loopRange.start;
      setCurrentTime(loopRange.start);
    }

    void audio.play().catch(() => {
      setIsPlaying(false);
      setCanPlay(false);
    });
  };

  const play = () => {
    const audio = audioRef.current;
    if (!audio || !canPlay) {
      return;
    }

    if (loopRange && loopRange.end > loopRange.start && (audio.currentTime < loopRange.start || audio.currentTime >= loopRange.end)) {
      audio.currentTime = loopRange.start;
      setCurrentTime(loopRange.start);
    }

    void audio.play().catch(() => {
      setIsPlaying(false);
      setCanPlay(false);
    });
  };

  const pause = () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    stopAnimation();
    audio.pause();
    setCurrentTime(audio.currentTime || 0);
    setIsPlaying(false);
  };

  const skip = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !canPlay) {
      return;
    }

    const minTime = loopRange && loopRange.end > loopRange.start ? loopRange.start : 0;
    const maxTime = loopRange && loopRange.end > loopRange.start ? loopRange.end : Math.max(duration || durationHint, 0);
    const nextTime = clamp(audio.currentTime + seconds, minTime, maxTime);
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const seek = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !canPlay) {
      return;
    }

    const minTime = loopRange && loopRange.end > loopRange.start ? loopRange.start : 0;
    const durationLimit = loopRange && loopRange.end > loopRange.start ? loopRange.end : Math.max(duration || durationHint, seconds, 0);
    const nextTime = clamp(seconds, minTime, durationLimit);
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const setMuted = (muted: boolean) => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audio.muted = muted;
  };

  const setVolume = (volume: number) => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audio.volume = clamp(volume, 0, 1);
  };

  const stop = () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    stopAnimation();
    audio.muted = false;
    audio.volume = 1;
    audio.pause();
    const nextTime = loopRange && loopRange.end > loopRange.start ? loopRange.start : 0;
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
    setIsPlaying(false);
  };

  const release = () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    stopAnimation();
    audio.muted = false;
    audio.volume = 1;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    audioRef.current = null;
    setCurrentTime(0);
    setCanPlay(false);
    setIsPlaying(false);
  };

  const safeDuration = Math.max(0, duration || durationHint);
  return {
    currentTime,
    duration: safeDuration,
    progress: safeDuration > 0 ? clamp(currentTime / safeDuration, 0, 1) : 0,
    isPlaying,
    canPlay,
    toggle,
    play,
    pause,
    skip,
    seek,
    setMuted,
    setVolume,
    stop,
    release,
  };
}

function audioPathToFileUrl(path: string | undefined): string {
  const normalized = path?.trim().replace(/\\/gu, "/") ?? "";
  if (!normalized) {
    return "";
  }

  if (normalized.startsWith("guide://")) {
    return "";
  }

  const encodeSegments = (value: string) =>
    value
      .split("/")
      .map((segment) => encodeURIComponent(segment).replace(/^([A-Za-z])%3A$/u, "$1:"))
      .join("/");

  if (normalized.startsWith("//")) {
    return `file:${encodeSegments(normalized)}`;
  }

  return `file:///${encodeSegments(normalized.replace(/^\/+/u, ""))}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
