"use client";

import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_SETTINGS,
  type ExperienceSettings,
  type ExperienceSnapshot,
} from "./core";
import { HeartExperience } from "./engine";
import { ExperienceUI } from "./ui";
import { PulseAudio } from "./audio/PulseAudio";
import styles from "./CosmicHeartExperience.module.css";

const SETTINGS_KEY = "cosmic-pulse-settings-v1";

const initialSnapshot: ExperienceSnapshot = {
  phase: "PREWARM",
  phaseProgress: 0,
  charge: 0,
  qualityTier: "performance",
  fps: 60,
  isPaused: false,
  isReady: false,
  fallbackReason: null,
};

const fallbackParticles = Array.from({ length: 156 }, (_, index) => {
  const layer = index % 3;
  const t = ((index / 3) / 52) * Math.PI * 2;
  const scale = 1 - layer * 0.13;
  const sine = Math.sin(t);
  const x = 16 * sine * sine * sine * scale;
  const y =
    (13 * Math.cos(t) -
      5 * Math.cos(2 * t) -
      2 * Math.cos(3 * t) -
      Math.cos(4 * t)) *
    scale;
  return {
    x: Number((x * 10.5).toFixed(4)),
    y: Number((-y * 10.5).toFixed(4)),
    size: 2 + ((index * 17) % 4),
    delay: -((index * 37) % 1800),
  };
});

function loadSettings(): ExperienceSettings {
  const mediaReduced = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    const parsed = stored ? (JSON.parse(stored) as Partial<ExperienceSettings>) : {};
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      reducedMotion: parsed.reducedMotion ?? mediaReduced,
      muted: true,
    };
  } catch {
    return {
      ...DEFAULT_SETTINGS,
      reducedMotion: mediaReduced,
    };
  }
}

export function CosmicHeartExperience() {
  const stageRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<HeartExperience | null>(null);
  const audioRef = useRef<PulseAudio | null>(null);
  const pointerRef = useRef<{
    id: number;
    x: number;
    y: number;
    startedAt: number;
    charging: boolean;
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);
  const keyboardCharging = useRef(false);
  const [snapshot, setSnapshot] =
    useState<ExperienceSnapshot>(initialSnapshot);
  const [settings, setSettings] =
    useState<ExperienceSettings>(DEFAULT_SETTINGS);
  const [engineActive, setEngineActive] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) {
      return;
    }

    const loadedSettings = loadSettings();
    setSettings(loadedSettings);
    const audio = new PulseAudio();
    audioRef.current = audio;
    let contextProbeTimer: ReturnType<typeof setTimeout> | null = null;

    try {
      const engine = new HeartExperience(canvas, {
        settings: loadedSettings,
        callbacks: {
          onSnapshot: (nextSnapshot) => {
            setSnapshot(nextSnapshot);
            setEngineActive(nextSnapshot.fallbackReason === null);
          },
          onFallback: (reason) => {
            setEngineActive(false);
            setSnapshot((current) => ({
              ...current,
              fallbackReason: reason,
            }));
          },
        },
      });
      engineRef.current = engine;
      engine.start();
      if (
        new URLSearchParams(window.location.search).get("contextProbe") === "1"
      ) {
        contextProbeTimer = setTimeout(() => {
          engine.debugCycleContext();
        }, 1_500);
      }

      const observer = new ResizeObserver(() => engine.resize());
      observer.observe(stage);

      const reducedQuery = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      );
      const onReducedMotionChange = (event: MediaQueryListEvent) => {
        if (event.matches) {
          setSettings((current) => {
            const next = { ...current, reducedMotion: true };
            engine.setSettings({ reducedMotion: true });
            return next;
          });
        }
      };
      reducedQuery.addEventListener("change", onReducedMotionChange);

      return () => {
        if (contextProbeTimer !== null) {
          clearTimeout(contextProbeTimer);
        }
        observer.disconnect();
        reducedQuery.removeEventListener("change", onReducedMotionChange);
        engine.dispose();
        audio.dispose();
        engineRef.current = null;
        audioRef.current = null;
      };
    } catch (error) {
      if (contextProbeTimer !== null) {
        clearTimeout(contextProbeTimer);
      }
      const reason =
        error instanceof Error
          ? error.message
          : "图形引擎无法启动，已显示静态爱心。";
      queueMicrotask(() => {
        setSnapshot({
          ...initialSnapshot,
          phase: "IDLE_BEAT",
          isReady: true,
          fallbackReason: reason,
        });
        setEngineActive(false);
      });
      return () => audio.dispose();
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, input, select, textarea, [contenteditable]")) {
        return;
      }
      if (event.key === "Enter" && !event.repeat) {
        engineRef.current?.triggerPulse();
        audioRef.current?.pulse(0.9);
      }
      if (event.code === "Space" && !event.repeat) {
        event.preventDefault();
        keyboardCharging.current = engineRef.current?.startCharge() ?? false;
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space" && keyboardCharging.current) {
        event.preventDefault();
        keyboardCharging.current = false;
        engineRef.current?.releaseCharge(false);
        audioRef.current?.pulse(1);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const updatePointer = useCallback(
    (event: ReactPointerEvent<HTMLElement>, active = true) => {
      const stage = stageRef.current;
      if (!stage) {
        return;
      }
      const bounds = stage.getBoundingClientRect();
      const x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      const y = -(((event.clientY - bounds.top) / bounds.height) * 2 - 1);
      engineRef.current?.setPointer(x, y, active);
    },
    [],
  );

  const isUiTarget = (target: EventTarget | null) =>
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        "button, input, select, label, aside, [data-interface-control]",
      ),
    );

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (!event.isPrimary || isUiTarget(event.target)) {
      return;
    }
    updatePointer(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    const pointerState = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startedAt: performance.now(),
      charging: false,
      timer: null as ReturnType<typeof setTimeout> | null,
    };
    pointerState.timer = setTimeout(() => {
      pointerState.charging = engineRef.current?.startCharge() ?? false;
    }, 180);
    pointerRef.current = pointerState;
  };

  const handlePointerMove = (
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (!event.isPrimary) {
      return;
    }
    updatePointer(event);
  };

  const finishPointer = (
    event: ReactPointerEvent<HTMLElement>,
    cancelled: boolean,
  ) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) {
      return;
    }
    if (pointer.timer) {
      clearTimeout(pointer.timer);
    }
    const distance = Math.hypot(
      event.clientX - pointer.x,
      event.clientY - pointer.y,
    );
    const threshold = event.pointerType === "touch" ? 12 : 8;
    const duration = performance.now() - pointer.startedAt;

    if (pointer.charging) {
      engineRef.current?.releaseCharge(cancelled);
      if (!cancelled) {
        audioRef.current?.pulse(1);
      }
    } else if (!cancelled && duration < 180 && distance <= threshold) {
      engineRef.current?.triggerPulse();
      audioRef.current?.pulse(0.9);
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerRef.current = null;
  };

  const handleSettingsChange = (
    changes: Partial<ExperienceSettings>,
  ) => {
    setSettings((current) => {
      const next = { ...current, ...changes };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // Local preferences are optional.
      }
      return next;
    });
    engineRef.current?.setSettings(changes);
    if (typeof changes.bpm === "number") {
      audioRef.current?.setBpm(changes.bpm);
    }
    if (typeof changes.muted === "boolean") {
      void audioRef.current?.setEnabled(!changes.muted);
    }
  };

  const handlePause = () => {
    const next = !snapshot.isPaused;
    engineRef.current?.setPaused(next);
    audioRef.current?.setPaused(next);
    setSnapshot((current) => ({ ...current, isPaused: next }));
  };

  const handleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void stageRef.current?.requestFullscreen();
    }
  };

  return (
    <main
      ref={stageRef}
      className={styles.stage}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => finishPointer(event, false)}
      onPointerCancel={(event) => finishPointer(event, true)}
      onPointerLeave={() => {
        if (!pointerRef.current) {
          engineRef.current?.clearPointer();
        }
      }}
    >
      <div className={styles.nebula} aria-hidden="true" />
      <div className={styles.grid} aria-hidden="true" />

      <div
        className={
          engineActive ? styles.staticHeartHidden : styles.staticHeart
        }
        aria-hidden="true"
      >
        <div className={styles.staticCore} />
        {fallbackParticles.map((particle, index) => (
          <i
            key={index}
            style={
              {
                "--px": particle.x + "px",
                "--py": particle.y + "px",
                "--ps": particle.size + "px",
                "--pd": particle.delay + "ms",
              } as CSSProperties
            }
          />
        ))}
      </div>

      <canvas
        ref={canvasRef}
        className={`${styles.canvas} ${
          engineActive ? "" : styles.canvasFallback
        }`}
        aria-hidden="true"
      />

      <ExperienceUI
        snapshot={snapshot}
        settings={settings}
        onSettingsChange={handleSettingsChange}
        onPauseToggle={handlePause}
        onPulse={() => {
          engineRef.current?.triggerPulse();
          audioRef.current?.pulse(0.9);
        }}
        onReplay={() => engineRef.current?.replay()}
        onFullscreen={handleFullscreen}
        onRetry={() => {
          if (engineRef.current) {
            engineRef.current.retryGraphics();
          } else {
            window.location.reload();
          }
        }}
      />

      <div className={styles.frame} aria-hidden="true" />
    </main>
  );
}
