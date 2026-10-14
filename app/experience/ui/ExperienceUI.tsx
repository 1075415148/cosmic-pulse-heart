"use client";

import { useEffect, useId, useState } from "react";
import type {
  ExperienceSettings,
  ExperienceSnapshot,
  QualityMode,
} from "../core";
import styles from "./ExperienceUI.module.css";

const PHASE_LABELS: Record<ExperienceSnapshot["phase"], string> = {
  PREWARM: "粒子预热",
  ASSEMBLE: "粒子汇聚",
  AWAKEN: "星核苏醒",
  IDLE_BEAT: "稳定脉动",
  CHARGE: "勇气蓄积",
  FRACTURE: "心跳失序",
  BURST: "粒子绽放",
  SUSPEND: "时间停驻",
  VORTEX_RETURN: "涡旋回归",
  OVERSHOOT: "心动回响",
  SETTLE: "星核稳定",
};

export interface ExperienceUIProps {
  snapshot: ExperienceSnapshot;
  settings: ExperienceSettings;
  onSettingsChange: (changes: Partial<ExperienceSettings>) => void;
  onPauseToggle: () => void;
  onPulse: () => void;
  onReplay: () => void;
  onFullscreen: () => void;
  onRetry?: () => void;
}

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className={styles.toggleRow}>
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <i aria-hidden="true" />
    </label>
  );
}

export function ExperienceUI({
  snapshot,
  settings,
  onSettingsChange,
  onPauseToggle,
  onPulse,
  onReplay,
  onFullscreen,
  onRetry,
}: ExperienceUIProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const panelId = useId();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPanelOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const phaseLabel = PHASE_LABELS[snapshot.phase];
  const loading = !snapshot.isReady;

  return (
    <div className={styles.interfaceRoot}>
      <p className={styles.screenReaderDescription}>
        由粒子构成并会呼吸和自愈的交互式三维爱心。
      </p>

      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>心</span>
          <span>
            <b>COSMIC PULSE</b>
            <small>INTERACTIVE PARTICLE ART</small>
          </span>
        </div>

        <div className={styles.systemStatus} aria-label={"当前状态：" + phaseLabel}>
          <i className={styles.liveDot} aria-hidden="true" />
          <span>{phaseLabel}</span>
          <em>{snapshot.qualityTier.toUpperCase()}</em>
        </div>
      </header>

      <section
        className={
          snapshot.phase === "IDLE_BEAT"
            ? styles.heroCopy
            : styles.heroCopyHidden
        }
        aria-labelledby="experience-heading"
      >
        <p>EVERY PARTICLE FINDS ITS ORBIT</p>
        <h1 id="experience-heading">
          星核脉冲
          <br />
          粒子爱心
        </h1>
        <button type="button" onClick={onPulse} className={styles.pulseButton}>
          <span>感受心跳</span>
          <i aria-hidden="true">↗</i>
        </button>
      </section>

      {snapshot.phase === "CHARGE" ? (
        <div className={styles.chargeMeter} aria-label="蓄能进度">
          <span>COURAGE</span>
          <div>
            <i style={{ transform: "scaleX(" + snapshot.charge + ")" }} />
          </div>
          <strong>{Math.round(snapshot.charge * 100)}%</strong>
        </div>
      ) : null}

      {loading ? (
        <div className={styles.loading} aria-live="polite">
          <span>{phaseLabel}</span>
          <div>
            <i style={{ transform: "scaleX(" + snapshot.phaseProgress + ")" }} />
          </div>
        </div>
      ) : null}

      {snapshot.fallbackReason ? (
        <div className={styles.fallback} role="status" aria-live="polite">
          <strong>已切换至兼容模式</strong>
          <span>{snapshot.fallbackReason}</span>
          {onRetry ? (
            <button type="button" onClick={onRetry}>
              重新尝试
            </button>
          ) : null}
        </div>
      ) : null}

      <footer className={styles.footer}>
        <div className={styles.instructions} aria-hidden="true">
          <span>
            <i>01</i> 靠近这颗心
          </span>
          <span>
            <i>02</i> 轻点听心跳
          </span>
          <span>
            <i>03</i> 按住攒勇气
          </span>
          <span>
            <i>04</i> 松开让粒子绽放
          </span>
        </div>

        <div className={styles.footerActions}>
          <button
            type="button"
            onClick={onPauseToggle}
            aria-label={snapshot.isPaused ? "继续动画" : "暂停动画"}
          >
            {snapshot.isPaused ? "继续" : "暂停"}
          </button>
          <button
            type="button"
            className={panelOpen ? styles.activeAction : undefined}
            aria-expanded={panelOpen}
            aria-controls={panelId}
            onClick={() => setPanelOpen((open) => !open)}
          >
            参数
          </button>
        </div>
      </footer>

      <aside
        id={panelId}
        className={panelOpen ? styles.panelOpen : styles.panel}
        aria-label="体验参数"
        aria-hidden={!panelOpen}
        inert={!panelOpen}
      >
        <div className={styles.panelHead}>
          <span>
            <small>LIVE CONTROLS</small>
            <b>生命参数</b>
          </span>
          <button
            type="button"
            onClick={() => setPanelOpen(false)}
            aria-label="关闭参数面板"
          >
            ×
          </button>
        </div>

        <div className={styles.field}>
          <span>
            <label htmlFor={panelId + "-quality"}>画质</label>
            <em>{settings.qualityMode.toUpperCase()}</em>
          </span>
          <select
            id={panelId + "-quality"}
            value={settings.qualityMode}
            onChange={(event) =>
              onSettingsChange({
                qualityMode: event.currentTarget.value as QualityMode,
              })
            }
          >
            <option value="auto">自动</option>
            <option value="ultra">Ultra</option>
            <option value="balanced">Balanced</option>
            <option value="performance">Performance</option>
          </select>
        </div>

        <div className={styles.field}>
          <span>
            <label htmlFor={panelId + "-bloom"}>辉光</label>
            <em>{settings.bloom.toFixed(1)}</em>
          </span>
          <input
            id={panelId + "-bloom"}
            type="range"
            min="0.1"
            max="1.2"
            step="0.1"
            value={settings.bloom}
            onChange={(event) =>
              onSettingsChange({ bloom: Number(event.currentTarget.value) })
            }
          />
        </div>

        <div className={styles.field}>
          <span>
            <label htmlFor={panelId + "-bpm"}>心率</label>
            <em>{settings.bpm} BPM</em>
          </span>
          <input
            id={panelId + "-bpm"}
            type="range"
            min="48"
            max="96"
            step="1"
            value={settings.bpm}
            onChange={(event) =>
              onSettingsChange({ bpm: Number(event.currentTarget.value) })
            }
          />
        </div>

        <div className={styles.toggles}>
          <Toggle
            checked={settings.autoCamera}
            label="自动镜头"
            onChange={(autoCamera) => onSettingsChange({ autoCamera })}
          />
          <Toggle
            checked={!settings.muted}
            label="环境音效"
            onChange={(enabled) => onSettingsChange({ muted: !enabled })}
          />
          <Toggle
            checked={settings.reducedMotion}
            label="减少动态"
            onChange={(reducedMotion) => onSettingsChange({ reducedMotion })}
          />
        </div>

        <div className={styles.panelActions}>
          <button type="button" onClick={onReplay}>
            重播聚合
          </button>
          <button type="button" onClick={onFullscreen}>
            全屏体验
          </button>
        </div>

        <div className={styles.telemetry}>
          <span>
            <i>FPS</i>
            <b>{Math.round(snapshot.fps)}</b>
          </span>
          <span>
            <i>STATE</i>
            <b>{snapshot.phase}</b>
          </span>
        </div>
      </aside>
    </div>
  );
}
