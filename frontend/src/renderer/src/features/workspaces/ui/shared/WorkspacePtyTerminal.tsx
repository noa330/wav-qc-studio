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

    const getTheme = (isLight: boolean) => ({
      background: "rgba(0, 0, 0, 0)",
      foreground: isLight ? "#1A1A24" : "#d7deea",
      cursor: isLight ? "#1A1A24" : "#d7deea",
      black: isLight ? "#FAFAFC" : "#0B1016",
      brightBlack: isLight ? "#98A2B3" : "#5d6878",
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
      white: isLight ? "#1A1A24" : "#d7deea",
      brightWhite: isLight ? "#000000" : "#ffffff",
    });

    const isLightInitial = document.documentElement.classList.contains("light");

    const terminal = new XTerm({
      allowTransparency: true,
      convertEol: false,
      cursorBlink: false,
      disableStdin: true,
      fontFamily: "Consolas, 'Cascadia Mono', 'Noto Sans Mono', monospace",
      fontSize,
      lineHeight: 1.35,
      scrollback,
      theme: getTheme(isLightInitial),
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
    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(host);

    // Watch for light/dark mode theme changes on html tag dynamically
    const themeObserver = new MutationObserver(() => {
      const isLight = document.documentElement.classList.contains("light");
      terminal.options.theme = getTheme(isLight);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
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

  return (
    <div ref={hostRef} className={cn("relative min-h-0 min-w-0 overflow-hidden [&_.xterm]:h-full", className)}>
      <style>{`
        .xterm,
        .xterm .xterm-viewport,
        .xterm .xterm-screen,
        .xterm .xterm-rows {
          background-color: transparent !important;
        }
      `}</style>
    </div>
  );
}
