import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { cn } from "@/lib/utils";

type WorkspacePtyTerminalProps = {
  text: string;
  className?: string;
  fontSize?: number;
  scrollback?: number;
};

export function WorkspacePtyTerminal({ text, className, fontSize = 13, scrollback = 5000 }: WorkspacePtyTerminalProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const writeVersionRef = useRef(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const terminal = new XTerm({
      allowTransparency: true,
      convertEol: false,
      cursorBlink: false,
      disableStdin: true,
      fontFamily: "Consolas, 'Cascadia Mono', 'Noto Sans Mono', monospace",
      fontSize,
      lineHeight: 1.35,
      scrollback,
      theme: {
        background: "#0d131c",
        foreground: "#d7deea",
        cursor: "#d7deea",
        black: "#0d131c",
        brightBlack: "#5d6878",
        red: "#ff8c96",
        brightRed: "#ffabb2",
        green: "#8ee6b0",
        brightGreen: "#b5f4cc",
        yellow: "#fbbf24",
        brightYellow: "#ffd166",
        blue: "#8fb7ff",
        brightBlue: "#b6ceff",
        magenta: "#b99cff",
        brightMagenta: "#d1bdff",
        cyan: "#7dd3fc",
        brightCyan: "#a5e4ff",
        white: "#d7deea",
        brightWhite: "#ffffff",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    terminalRef.current = terminal;

    const fit = () => {
      try {
        fitAddon.fit();
      } catch {
        // Hidden animated containers report zero size; ResizeObserver retries later.
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(host);

    return () => {
      observer.disconnect();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [fontSize, scrollback]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    const writeVersion = writeVersionRef.current + 1;
    writeVersionRef.current = writeVersion;
    terminal.reset();
    if (text) {
      terminal.write(text, () => {
        if (writeVersionRef.current === writeVersion) {
          terminal.scrollToBottom();
        }
      });
      return;
    }
    terminal.scrollToBottom();
  }, [text]);

  return <div ref={hostRef} className={cn("min-h-0 min-w-0 overflow-hidden [&_.xterm]:h-full [&_.xterm-viewport]:bg-transparent", className)} />;
}
