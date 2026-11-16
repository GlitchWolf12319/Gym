import React, { useMemo, useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Check, TrendingDown, TrendingUp, Minus, ArrowRight } from 'lucide-react';
import { format, parseISO, differenceInDays, addDays, startOfWeek } from 'date-fns';
import {
  ArchiveEntry,
  BodyMeasurementEntry,
  MeasurementUnit,
  MuscleGroupKey,
  WorkoutItem,
} from '../types';

interface MuscleDefinition {
  key: MuscleGroupKey;
  label: string;
  shortLabel: string;
  guide: string;
}

export const MUSCLE_DEFINITIONS: MuscleDefinition[] = [
  {
    key: 'chest',
    label: 'Chest',
    shortLabel: 'Chest',
    guide: 'Fullest part of the chest across the nipple line, including lats.',
  },
  {
    key: 'biceps',
    label: 'Biceps / Arms',
    shortLabel: 'Biceps',
    guide: 'Thickest part of the upper arm (biceps/triceps belly), relaxed or flexed consistently.',
  },
  {
    key: 'forearms',
    label: 'Forearms',
    shortLabel: 'Forearms',
    guide: 'Widest point of the forearm with wrist straight.',
  },
  {
    key: 'waist',
    label: 'Waist',
    shortLabel: 'Waist',
    guide: 'Narrowest point or navel level while relaxed.',
  },
  {
    key: 'hips',
    label: 'Hips / Glutes',
    shortLabel: 'Hips',
    guide: 'Widest part of the hips and glutes standing with feet together.',
  },
  {
    key: 'thighs',
    label: 'Thighs (Legs)',
    shortLabel: 'Thighs',
    guide: 'Midpoint of the thigh (~25 cm / 10 in above the kneecap).',
  },
  {
    key: 'calves',
    label: 'Calves',
    shortLabel: 'Calves',
    guide: 'Widest part of the lower leg standing relaxed (not on toes).',
  },
];

const CM_PER_INCH = 2.54;

function toDisplayValue(cmValue: number, unit: MeasurementUnit): number {
  const val = unit === 'in' ? cmValue / CM_PER_INCH : cmValue;
  return Math.round(val * 10) / 10;
}

function toCanonicalCm(displayValue: number, unit: MeasurementUnit): number {
  const cm = unit === 'in' ? displayValue * CM_PER_INCH : displayValue;
  return Math.round(cm * 100) / 100;
}

function formatMeasurement(cmValue: number | undefined, unit: MeasurementUnit): string {
  if (cmValue === undefined || isNaN(cmValue)) return '--';
  return `${toDisplayValue(cmValue, unit).toFixed(1)} ${unit}`;
}

function formatDelta(deltaCm: number, unit: MeasurementUnit): string {
  const converted = unit === 'in' ? deltaCm / CM_PER_INCH : deltaCm;
  const rounded = Math.round(converted * 10) / 10;
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded.toFixed(1)} ${unit}`;
}

interface StatsViewProps {
  measurementHistory: BodyMeasurementEntry[];
  measurementUnit: MeasurementUnit;
  onChangeUnit: (unit: MeasurementUnit) => void;
  onSaveEntry: (entry: BodyMeasurementEntry) => void;
  onDeleteEntry: (id: string) => void;
  archive: ArchiveEntry[];
  workout: WorkoutItem[];
  programStartDate: string;
  cycleLength?: number;
}

interface WeekExerciseAggregate {
  key: string;
  name: string;
  totalVolume: number;
  bestSessionVolume: number;
  maxWeight: number;
  weightUnit: string;
  bestSetWeight: number;
  bestSetReps: number;
  best1RM: number;
  bestSessionReps: number;
  sessionsCount: number;
}

interface WeekBucket {
  weekKey: string;
  label: string;
  dateRange: string;
  sortTime: number;
  totalVolume: number;
  workoutDays: number;
  exercises: Record<string, WeekExerciseAggregate>;
}

function parseWeightParts(raw: string | undefined): { value: number; unit: string } {
  if (!raw) return { value: 0, unit: 'kg' };
  const str = String(raw).trim();
  const num = parseFloat(str.replace(/[^0-9.]/g, '')) || 0;
  const unitMatch = str.match(/[a-zA-Z]+/);
  return { value: num, unit: unitMatch ? unitMatch[0].toLowerCase() : 'kg' };
}

export const StatsView: React.FC<StatsViewProps> = ({
  measurementHistory,
  measurementUnit,
  onChangeUnit,
  onSaveEntry,
  onDeleteEntry,
  archive,
  workout,
  programStartDate,
  cycleLength = 7,
}) => {
  const [todayStr, setTodayStr] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'));
  const [activeDate, setActiveDate] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'));
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleGroupKey>('biceps');
  const [hoveredMuscle, setHoveredMuscle] = useState<MuscleGroupKey | null>(null);
  const [inputValue, setInputValue] = useState<string>('');
  const [justLogged, setJustLogged] = useState<boolean>(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const isEditingInputRef = useRef<boolean>(false);
  const prevContextKeyRef = useRef<string>(`${selectedMuscle}|${activeDate}|${measurementUnit}`);
  const pendingCommitRef = useRef<{ raw: string; muscle: MuscleGroupKey; date: string } | null>(null);

  // Roll over automatically to the new day when midnight passes
  useEffect(() => {
    const checkDayRollover = () => {
      const currentDay = format(new Date(), 'yyyy-MM-dd');
      setTodayStr((prevToday) => {
        if (currentDay !== prevToday) {
          setActiveDate((prevActive) => (prevActive === prevToday ? currentDay : prevActive));
          return currentDay;
        }
        return prevToday;
      });
    };

    const interval = window.setInterval(checkDayRollover, 30000);
    document.addEventListener('visibilitychange', checkDayRollover);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', checkDayRollover);
    };
  }, []);

  // Flush any pending auto-save when switching away from Stats tab
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (pendingCommitRef.current) {
        const { raw, muscle, date } = pendingCommitRef.current;
        pendingCommitRef.current = null;
        commitValue(raw, muscle, date);
      }
    };
  }, []);

  // Sort chronological ascending for the progression graph
  const sortedAsc = useMemo(() => {
    return [...measurementHistory].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
  }, [measurementHistory]);

  // Measurements currently shown on the guy (for activeDate)
  const activeEntry = useMemo(() => {
    return measurementHistory.find((e) => e.date === activeDate) || null;
  }, [measurementHistory, activeDate]);

  // Sync text input when changing muscle, active date, or unit (avoid clobbering active typing)
  useEffect(() => {
    const contextKey = `${selectedMuscle}|${activeDate}|${measurementUnit}`;
    const contextChanged = prevContextKeyRef.current !== contextKey;
    prevContextKeyRef.current = contextKey;

    if (!contextChanged && isEditingInputRef.current) return;

    const valCm = activeEntry?.measurements?.[selectedMuscle];
    if (typeof valCm === 'number' && !isNaN(valCm)) {
      setInputValue(toDisplayValue(valCm, measurementUnit).toFixed(1));
    } else {
      setInputValue('');
    }
  }, [selectedMuscle, activeDate, measurementUnit, activeEntry]);

  // Persist a numeric input value automatically for activeDate
  const commitValue = (rawText: string, targetMuscle: MuscleGroupKey, targetDate: string) => {
    pendingCommitRef.current = null;
    const trimmed = rawText.trim();
    const existing = measurementHistory.find((e) => e.date === targetDate);

    if (trimmed === '') {
      if (existing && existing.measurements[targetMuscle] !== undefined) {
        const nextMeasurements = { ...existing.measurements };
        delete nextMeasurements[targetMuscle];
        if (Object.keys(nextMeasurements).length === 0) {
          onDeleteEntry(existing.id);
        } else {
          onSaveEntry({
            ...existing,
            measurements: nextMeasurements,
          });
        }
      }
      return;
    }

    const parsed = parseFloat(trimmed);
    if (isNaN(parsed) || parsed <= 0) return;

    const newCm = toCanonicalCm(parsed, measurementUnit);
    if (existing && existing.measurements[targetMuscle] === newCm) return;

    const updatedEntry: BodyMeasurementEntry = {
      id: existing?.id || Math.random().toString(36).slice(2, 11),
      date: targetDate,
      measurements: {
        ...(existing?.measurements || {}),
        [targetMuscle]: newCm,
      },
    };

    onSaveEntry(updatedEntry);
    setJustLogged(true);
    window.setTimeout(() => setJustLogged(false), 1800);
  };

  const handleInputChange = (nextRaw: string) => {
    setInputValue(nextRaw);
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    const targetMuscle = selectedMuscle;
    const targetDate = activeDate;
    pendingCommitRef.current = { raw: nextRaw, muscle: targetMuscle, date: targetDate };
    saveTimerRef.current = window.setTimeout(() => {
      commitValue(nextRaw, targetMuscle, targetDate);
    }, 350);
  };

  const handleInputBlur = () => {
    isEditingInputRef.current = false;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    commitValue(inputValue, selectedMuscle, activeDate);
  };

  const handleSelectMuscle = (key: MuscleGroupKey) => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      commitValue(inputValue, selectedMuscle, activeDate);
    }
    setSelectedMuscle(key);
    window.setTimeout(() => {
      inputRef.current?.focus();
    }, 20);
  };

  const handleSelectGraphDot = (date: string) => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      commitValue(inputValue, selectedMuscle, activeDate);
    }
    setActiveDate(date);
  };

  const activeMuscleDef =
    MUSCLE_DEFINITIONS.find((m) => m.key === selectedMuscle) || MUSCLE_DEFINITIONS[0];
  const highlightMuscle = hoveredMuscle || selectedMuscle;
  const isViewingToday = activeDate === todayStr;

  // Points for the selected muscle's progression graph
  const musclePoints = useMemo(() => {
    return sortedAsc
      .filter(
        (e) =>
          typeof e.measurements[selectedMuscle] === 'number' &&
          !isNaN(e.measurements[selectedMuscle]!)
      )
      .map((e) => ({
        id: e.id,
        date: e.date,
        valueCm: e.measurements[selectedMuscle]!,
      }));
  }, [sortedAsc, selectedMuscle]);

  // Delta calculation from first point to currently active point (or latest)
  const growthSummary = useMemo(() => {
    if (musclePoints.length < 2) return null;
    const firstCm = musclePoints[0].valueCm;
    const latestCm = musclePoints[musclePoints.length - 1].valueCm;
    const deltaCm = latestCm - firstCm;
    const pct = firstCm > 0 ? (deltaCm / firstCm) * 100 : 0;
    return { deltaCm, pct };
  }, [musclePoints]);

  // Graph SVG geometry
  const chartData = useMemo(() => {
    if (musclePoints.length === 0) return null;

    const width = 680;
    const height = 210;
    const padLeft = 48;
    const padRight = 24;
    const padTop = 22;
    const padBottom = 34;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const displayVals = musclePoints.map((p) => toDisplayValue(p.valueCm, measurementUnit));
    const minRaw = Math.min(...displayVals);
    const maxRaw = Math.max(...displayVals);
    const span = maxRaw - minRaw;
    const padY = span < 0.5 ? 1.5 : span * 0.25;
    const yMin = Math.max(0, Math.floor((minRaw - padY) * 10) / 10);
    const yMax = Math.ceil((maxRaw + padY) * 10) / 10;
    const yRange = Math.max(0.5, yMax - yMin);

    const coords = musclePoints.map((p, idx) => {
      const val = displayVals[idx];
      const x =
        musclePoints.length === 1
          ? padLeft + plotW / 2
          : padLeft + (idx / (musclePoints.length - 1)) * plotW;
      const y = padTop + plotH - ((val - yMin) / yRange) * plotH;
      return { ...p, displayVal: val, x, y };
    });

    const linePath = coords
      .map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
      .join(' ');
    const areaPath =
      coords.length > 1
        ? `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${(padTop + plotH).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(padTop + plotH).toFixed(1)} Z`
        : '';

    const yTicks = [0, 0.5, 1].map((t) => ({
      val: (yMin + t * yRange).toFixed(1),
      y: padTop + plotH - t * plotH,
    }));

    return { width, height, padLeft, padRight, padTop, plotW, plotH, coords, linePath, areaPath, yTicks };
  }, [musclePoints, measurementUnit]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Simple Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="font-label text-primary-container text-xs tracking-[0.35em]">
            Body Telemetry
          </span>
          <h2 className="font-sans font-semibold text-2xl font-bold text-on-surface mt-1">
            Anatomical Measurement Map
          </h2>
        </div>

        <div className="flex items-center gap-3">
          {!isViewingToday && (
            <button
              type="button"
              onClick={() => handleSelectGraphDot(todayStr)}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-primary-container/15 text-primary-container border border-primary-container/40 hover:bg-primary-container/25 transition-colors min-h-[40px]"
            >
              Back to Today
            </button>
          )}
          <div
            className="flex items-center bg-surface-container-low border border-white/10 p-1 rounded-xl"
            role="group"
            aria-label="Measurement unit"
          >
            {(['cm', 'in'] as MeasurementUnit[]).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => onChangeUnit(u)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold uppercase transition-all min-h-[36px] ${
                  measurementUnit === u
                    ? 'bg-primary-container text-on-primary-container'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Anatomical Measurement Map */}
      <div className="bg-surface-container-low border border-white/5 p-4 md:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-mono text-primary-container font-semibold">
            {isViewingToday
              ? `Today · ${format(parseISO(activeDate), 'MMM d, yyyy')}`
              : `Viewing · ${format(parseISO(activeDate), 'MMM d, yyyy')}`}
          </span>
          <span className="text-on-surface-variant">
            Click a muscle group to enter its size
          </span>
        </div>

        <div className="relative bg-background/60 border border-primary-container/15 rounded-2xl p-2 md:p-4 max-w-3xl mx-auto overflow-hidden">
          <svg
            viewBox="0 0 640 480"
            className="w-full h-auto select-none"
            role="img"
            aria-label="Interactive anatomical measurement map"
          >
            <defs>
              <radialGradient id="bodyScannerGlow" cx="50%" cy="42%" r="48%">
                <stop offset="0%" stopColor="rgba(0, 229, 255, 0.14)" />
                <stop offset="100%" stopColor="rgba(0, 229, 255, 0)" />
              </radialGradient>
              <filter id="cyanGlow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <rect x="0" y="0" width="640" height="480" fill="url(#bodyScannerGlow)" />
            <line
              x1="320"
              y1="16"
              x2="320"
              y2="466"
              stroke="rgba(0, 229, 255, 0.08)"
              strokeDasharray="4 6"
            />

            {/* Human Outline */}
            <g
              fill="rgba(0, 229, 255, 0.04)"
              stroke="rgba(224, 247, 250, 0.45)"
              strokeWidth="1.75"
              strokeLinejoin="round"
              strokeLinecap="round"
            >
              <ellipse cx="320" cy="48" rx="18" ry="22" />
              <path
                d="
                  M 309 68
                  L 307 84
                  L 262 94
                  C 250 97, 242 108, 236 126
                  L 224 168
                  L 206 218
                  L 196 248
                  C 194 256, 204 260, 210 250
                  L 222 224
                  L 242 178
                  L 256 144
                  L 262 152
                  L 272 192
                  C 264 212, 260 228, 262 248
                  L 255 292
                  L 264 344
                  C 257 368, 255 388, 265 412
                  L 272 440
                  L 262 454
                  L 292 454
                  L 292 436
                  L 296 392
                  C 300 374, 298 358, 294 342
                  L 304 288
                  L 315 248
                  L 325 248
                  L 336 288
                  L 346 342
                  C 342 358, 340 374, 344 392
                  L 348 436
                  L 348 454
                  L 378 454
                  L 368 440
                  L 375 412
                  C 385 388, 383 368, 376 344
                  L 385 292
                  L 378 248
                  C 380 228, 376 212, 368 192
                  L 378 152
                  L 384 144
                  L 398 178
                  L 418 224
                  L 430 250
                  C 436 260, 446 256, 444 248
                  L 434 218
                  L 416 168
                  L 404 126
                  C 398 108, 390 97, 378 94
                  L 333 84
                  L 331 68
                  Z
                "
              />
            </g>

            {/* Anatomical Contour Lines */}
            <g
              fill="none"
              stroke="rgba(0, 229, 255, 0.2)"
              strokeWidth="1.1"
              strokeLinecap="round"
            >
              <path d="M 276 96 Q 302 103 320 99 Q 338 103 364 96" />
              <path d="M 268 126 Q 294 136 318 128" />
              <path d="M 372 126 Q 346 136 322 128" />
              <path d="M 298 144 Q 300 176 296 206" />
              <path d="M 342 144 Q 340 176 344 206" />
              <line x1="302" y1="162" x2="338" y2="162" />
              <line x1="302" y1="184" x2="338" y2="184" />
              <path d="M 275 216 Q 295 232 320 242 Q 345 232 365 216" />
              <path d="M 270 264 Q 278 296 276 330" />
              <path d="M 370 264 Q 362 296 364 330" />
              <path d="M 270 362 Q 282 378 278 398" />
              <path d="M 370 362 Q 358 378 362 398" />
            </g>

            {/* Interactive Muscle Hit Zones */}
            <g
              className="cursor-pointer"
              onClick={() => handleSelectMuscle('chest')}
              onMouseEnter={() => setHoveredMuscle('chest')}
              onMouseLeave={() => setHoveredMuscle(null)}
            >
              <rect
                x="262"
                y="104"
                width="116"
                height="34"
                rx="10"
                fill={highlightMuscle === 'chest' ? 'rgba(0, 229, 255, 0.26)' : 'rgba(0, 229, 255, 0.05)'}
                stroke={highlightMuscle === 'chest' ? '#00e5ff' : 'transparent'}
                strokeWidth="1.5"
              />
              {highlightMuscle === 'chest' && (
                <line x1="262" y1="121" x2="378" y2="121" stroke="#00e5ff" strokeWidth="2" strokeDasharray="4 3" filter="url(#cyanGlow)" />
              )}
            </g>

            <g
              className="cursor-pointer"
              onClick={() => handleSelectMuscle('biceps')}
              onMouseEnter={() => setHoveredMuscle('biceps')}
              onMouseLeave={() => setHoveredMuscle(null)}
            >
              <ellipse
                cx="396"
                cy="138"
                rx="13"
                ry="22"
                transform="rotate(-16 396 138)"
                fill={highlightMuscle === 'biceps' ? 'rgba(0, 229, 255, 0.28)' : 'rgba(0, 229, 255, 0.05)'}
                stroke={highlightMuscle === 'biceps' ? '#00e5ff' : 'transparent'}
                strokeWidth="1.5"
              />
              <ellipse
                cx="244"
                cy="138"
                rx="13"
                ry="22"
                transform="rotate(16 244 138)"
                fill={highlightMuscle === 'biceps' ? 'rgba(0, 229, 255, 0.18)' : 'transparent'}
              />
              {highlightMuscle === 'biceps' && (
                <line x1="383" y1="142" x2="409" y2="134" stroke="#00e5ff" strokeWidth="2" strokeDasharray="3 2" filter="url(#cyanGlow)" />
              )}
            </g>

            <g
              className="cursor-pointer"
              onClick={() => handleSelectMuscle('forearms')}
              onMouseEnter={() => setHoveredMuscle('forearms')}
              onMouseLeave={() => setHoveredMuscle(null)}
            >
              <ellipse
                cx="417"
                cy="196"
                rx="10"
                ry="22"
                transform="rotate(-22 417 196)"
                fill={highlightMuscle === 'forearms' ? 'rgba(0, 229, 255, 0.28)' : 'rgba(0, 229, 255, 0.05)'}
                stroke={highlightMuscle === 'forearms' ? '#00e5ff' : 'transparent'}
                strokeWidth="1.5"
              />
              <ellipse
                cx="223"
                cy="196"
                rx="10"
                ry="22"
                transform="rotate(22 223 196)"
                fill={highlightMuscle === 'forearms' ? 'rgba(0, 229, 255, 0.18)' : 'transparent'}
              />
              {highlightMuscle === 'forearms' && (
                <line x1="406" y1="201" x2="428" y2="191" stroke="#00e5ff" strokeWidth="2" strokeDasharray="3 2" filter="url(#cyanGlow)" />
              )}
            </g>

            <g
              className="cursor-pointer"
              onClick={() => handleSelectMuscle('waist')}
              onMouseEnter={() => setHoveredMuscle('waist')}
              onMouseLeave={() => setHoveredMuscle(null)}
            >
              <rect
                x="272"
                y="175"
                width="96"
                height="28"
                rx="8"
                fill={highlightMuscle === 'waist' ? 'rgba(0, 229, 255, 0.26)' : 'rgba(0, 229, 255, 0.05)'}
                stroke={highlightMuscle === 'waist' ? '#00e5ff' : 'transparent'}
                strokeWidth="1.5"
              />
              {highlightMuscle === 'waist' && (
                <line x1="272" y1="190" x2="368" y2="190" stroke="#00e5ff" strokeWidth="2" strokeDasharray="4 3" filter="url(#cyanGlow)" />
              )}
            </g>

            <g
              className="cursor-pointer"
              onClick={() => handleSelectMuscle('hips')}
              onMouseEnter={() => setHoveredMuscle('hips')}
              onMouseLeave={() => setHoveredMuscle(null)}
            >
              <rect
                x="262"
                y="214"
                width="116"
                height="32"
                rx="10"
                fill={highlightMuscle === 'hips' ? 'rgba(0, 229, 255, 0.26)' : 'rgba(0, 229, 255, 0.05)'}
                stroke={highlightMuscle === 'hips' ? '#00e5ff' : 'transparent'}
                strokeWidth="1.5"
              />
              {highlightMuscle === 'hips' && (
                <line x1="262" y1="231" x2="378" y2="231" stroke="#00e5ff" strokeWidth="2" strokeDasharray="4 3" filter="url(#cyanGlow)" />
              )}
            </g>

            <g
              className="cursor-pointer"
              onClick={() => handleSelectMuscle('thighs')}
              onMouseEnter={() => setHoveredMuscle('thighs')}
              onMouseLeave={() => setHoveredMuscle(null)}
            >
              <ellipse
                cx="281"
                cy="288"
                rx="21"
                ry="36"
                fill={highlightMuscle === 'thighs' ? 'rgba(0, 229, 255, 0.28)' : 'rgba(0, 229, 255, 0.05)'}
                stroke={highlightMuscle === 'thighs' ? '#00e5ff' : 'transparent'}
                strokeWidth="1.5"
              />
              <ellipse
                cx="359"
                cy="288"
                rx="21"
                ry="36"
                fill={highlightMuscle === 'thighs' ? 'rgba(0, 229, 255, 0.18)' : 'transparent'}
              />
              {highlightMuscle === 'thighs' && (
                <line x1="258" y1="286" x2="303" y2="286" stroke="#00e5ff" strokeWidth="2" strokeDasharray="3 2" filter="url(#cyanGlow)" />
              )}
            </g>

            <g
              className="cursor-pointer"
              onClick={() => handleSelectMuscle('calves')}
              onMouseEnter={() => setHoveredMuscle('calves')}
              onMouseLeave={() => setHoveredMuscle(null)}
            >
              <ellipse
                cx="363"
                cy="380"
                rx="16"
                ry="28"
                fill={highlightMuscle === 'calves' ? 'rgba(0, 229, 255, 0.28)' : 'rgba(0, 229, 255, 0.05)'}
                stroke={highlightMuscle === 'calves' ? '#00e5ff' : 'transparent'}
                strokeWidth="1.5"
              />
              <ellipse
                cx="277"
                cy="380"
                rx="16"
                ry="28"
                fill={highlightMuscle === 'calves' ? 'rgba(0, 229, 255, 0.18)' : 'transparent'}
              />
              {highlightMuscle === 'calves' && (
                <line x1="346" y1="380" x2="380" y2="380" stroke="#00e5ff" strokeWidth="2" strokeDasharray="3 2" filter="url(#cyanGlow)" />
              )}
            </g>

            {/* Leader Lines & Callout Labels */}
            {[
              {
                key: 'chest' as MuscleGroupKey,
                title: 'CHEST',
                anchor: [292, 121],
                elbow: [198, 108],
                end: [164, 108],
                box: { x: 14, y: 83, w: 150, h: 50 },
              },
              {
                key: 'waist' as MuscleGroupKey,
                title: 'WAIST',
                anchor: [280, 190],
                elbow: [198, 190],
                end: [164, 190],
                box: { x: 14, y: 165, w: 150, h: 50 },
              },
              {
                key: 'thighs' as MuscleGroupKey,
                title: 'THIGHS',
                anchor: [280, 286],
                elbow: [198, 286],
                end: [164, 286],
                box: { x: 14, y: 261, w: 150, h: 50 },
              },
              {
                key: 'biceps' as MuscleGroupKey,
                title: 'BICEPS',
                anchor: [396, 138],
                elbow: [446, 108],
                end: [476, 108],
                box: { x: 476, y: 83, w: 150, h: 50 },
              },
              {
                key: 'forearms' as MuscleGroupKey,
                title: 'FOREARMS',
                anchor: [418, 196],
                elbow: [448, 184],
                end: [476, 184],
                box: { x: 476, y: 159, w: 150, h: 50 },
              },
              {
                key: 'hips' as MuscleGroupKey,
                title: 'HIPS / GLUTES',
                anchor: [368, 231],
                elbow: [446, 258],
                end: [476, 258],
                box: { x: 476, y: 233, w: 150, h: 50 },
              },
              {
                key: 'calves' as MuscleGroupKey,
                title: 'CALVES',
                anchor: [364, 380],
                elbow: [446, 380],
                end: [476, 380],
                box: { x: 476, y: 355, w: 150, h: 50 },
              },
            ].map((item) => {
              const isActive = highlightMuscle === item.key;
              const valueForDateCm = activeEntry?.measurements?.[item.key];
              const valueStr = formatMeasurement(valueForDateCm, measurementUnit);

              return (
                <g
                  key={item.key}
                  className="cursor-pointer"
                  onClick={() => handleSelectMuscle(item.key)}
                  onMouseEnter={() => setHoveredMuscle(item.key)}
                  onMouseLeave={() => setHoveredMuscle(null)}
                >
                  <polyline
                    points={`${item.anchor[0]},${item.anchor[1]} ${item.elbow[0]},${item.elbow[1]} ${item.end[0]},${item.end[1]}`}
                    fill="none"
                    stroke={isActive ? '#00e5ff' : 'rgba(0, 229, 255, 0.35)'}
                    strokeWidth={isActive ? '2.2' : '1.25'}
                    filter={isActive ? 'url(#cyanGlow)' : undefined}
                  />
                  <circle
                    cx={item.anchor[0]}
                    cy={item.anchor[1]}
                    r={isActive ? 5 : 3.5}
                    fill={isActive ? '#00e5ff' : '#121212'}
                    stroke="#00e5ff"
                    strokeWidth={isActive ? 2 : 1.5}
                  />
                  <rect
                    x={item.box.x}
                    y={item.box.y}
                    width={item.box.w}
                    height={item.box.h}
                    rx="8"
                    fill={isActive ? 'rgba(0, 229, 255, 0.14)' : 'rgba(24, 24, 27, 0.92)'}
                    stroke={isActive ? '#00e5ff' : 'rgba(255, 255, 255, 0.12)'}
                    strokeWidth={isActive ? '1.75' : '1'}
                  />
                  <text
                    x={item.box.x + 12}
                    y={item.box.y + 19}
                    fill={isActive ? '#00e5ff' : '#e4e4e7'}
                    fontSize="10.5"
                    fontWeight="700"
                    letterSpacing="0.08em"
                  >
                    {item.title}
                  </text>
                  <text
                    x={item.box.x + 12}
                    y={item.box.y + 39}
                    fill={valueForDateCm !== undefined ? '#ffffff' : 'rgba(255,255,255,0.4)'}
                    fontSize="14"
                    fontWeight="700"
                    fontFamily="monospace"
                  >
                    {valueStr}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Inline Auto-Logging Input for the Selected Muscle */}
        <div className="max-w-3xl mx-auto bg-surface-container-high/70 border border-primary-container/25 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-bold text-primary-container">
              {activeMuscleDef.label} · {format(parseISO(activeDate), 'MMM d, yyyy')}
            </div>
            <p className="text-xs text-on-surface-variant mt-0.5 leading-relaxed">
              {activeMuscleDef.guide}
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <div className="flex items-center bg-background/80 border border-primary-container/40 rounded-xl px-3 py-1.5 focus-within:border-primary-container">
              <input
                ref={inputRef}
                type="number"
                step="0.1"
                min="1"
                max="300"
                inputMode="decimal"
                value={inputValue}
                onFocus={() => {
                  isEditingInputRef.current = true;
                }}
                onChange={(e) => handleInputChange(e.target.value)}
                onBlur={handleInputBlur}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
                placeholder="0.0"
                aria-label={`${activeMuscleDef.label} size in ${measurementUnit}`}
                className="w-24 bg-transparent text-lg font-mono tabular-nums font-bold text-on-surface outline-none"
              />
              <span className="text-xs font-mono text-on-surface-variant ml-1">
                {measurementUnit}
              </span>
            </div>

            {justLogged && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
                <Check className="w-4 h-4" />
                Saved
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Progression Graph */}
      <div className="bg-surface-container-low border border-white/5 p-4 md:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-sans font-semibold text-base md:text-lg font-bold text-on-surface">
              {activeMuscleDef.label} Progression
            </h3>
            <p className="text-xs text-on-surface-variant">
              Click any dot on the graph to view all measurements from that day
            </p>
          </div>

          <div className="font-mono tabular-nums text-sm font-bold flex items-center gap-1.5">
            {growthSummary ? (
              growthSummary.deltaCm > 0.05 ? (
                <span className="text-emerald-400 flex items-center gap-1">
                  <TrendingUp className="w-4 h-4" />
                  {formatDelta(growthSummary.deltaCm, measurementUnit)} ({growthSummary.pct > 0 ? '+' : ''}
                  {growthSummary.pct.toFixed(1)}%)
                </span>
              ) : growthSummary.deltaCm < -0.05 ? (
                <span className="text-amber-400 flex items-center gap-1">
                  <TrendingDown className="w-4 h-4" />
                  {formatDelta(growthSummary.deltaCm, measurementUnit)} ({growthSummary.pct.toFixed(1)}%)
                </span>
              ) : (
                <span className="text-primary-container flex items-center gap-1">
                  <Minus className="w-4 h-4" />
                  0.0 {measurementUnit}
                </span>
              )
            ) : (
              <span className="text-xs text-on-surface-variant font-normal">
                {musclePoints.length === 1 ? 'Baseline set' : 'No data yet'}
              </span>
            )}
          </div>
        </div>

        <div className="bg-background/60 border border-white/5 rounded-2xl p-3 md:p-4">
          {chartData ? (
            <svg
              viewBox={`0 0 ${chartData.width} ${chartData.height}`}
              className="w-full h-auto overflow-visible"
              role="img"
              aria-label={`${activeMuscleDef.label} growth graph`}
            >
              <defs>
                <linearGradient id="muscleAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00e5ff" stopOpacity="0.30" />
                  <stop offset="100%" stopColor="#00e5ff" stopOpacity="0.01" />
                </linearGradient>
              </defs>

              {chartData.yTicks.map((tick, idx) => (
                <g key={idx}>
                  <line
                    x1={chartData.padLeft}
                    y1={tick.y}
                    x2={chartData.width - chartData.padRight}
                    y2={tick.y}
                    stroke="rgba(255, 255, 255, 0.07)"
                  />
                  <text
                    x={chartData.padLeft - 8}
                    y={tick.y + 4}
                    textAnchor="end"
                    fill="rgba(255, 255, 255, 0.45)"
                    fontSize="10"
                    fontFamily="monospace"
                  >
                    {tick.val}
                  </text>
                </g>
              ))}

              {chartData.areaPath && (
                <path d={chartData.areaPath} fill="url(#muscleAreaGrad)" />
              )}

              {chartData.coords.length > 1 && (
                <path
                  d={chartData.linePath}
                  fill="none"
                  stroke="#00e5ff"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {chartData.coords.map((pt, idx) => {
                const isSelectedDate = pt.date === activeDate;
                const showXLabel =
                  chartData.coords.length <= 7 ||
                  idx === 0 ||
                  idx === chartData.coords.length - 1 ||
                  isSelectedDate;

                return (
                  <g
                    key={pt.id}
                    className="cursor-pointer"
                    onClick={() => handleSelectGraphDot(pt.date)}
                  >
                    <circle cx={pt.x} cy={pt.y} r={18} fill="transparent" />
                    {isSelectedDate && (
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r={10}
                        fill="rgba(0, 229, 255, 0.25)"
                      />
                    )}
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={isSelectedDate ? 5.5 : 4}
                      fill={isSelectedDate ? '#00e5ff' : '#121212'}
                      stroke="#00e5ff"
                      strokeWidth="2"
                    />
                    {isSelectedDate && (
                      <text
                        x={pt.x}
                        y={pt.y - 12}
                        textAnchor="middle"
                        fill="#00e5ff"
                        fontSize="10.5"
                        fontWeight="700"
                        fontFamily="monospace"
                      >
                        {pt.displayVal.toFixed(1)} {measurementUnit}
                      </text>
                    )}
                    {showXLabel && (
                      <text
                        x={pt.x}
                        y={chartData.height - 10}
                        textAnchor="middle"
                        fill={isSelectedDate ? '#00e5ff' : 'rgba(255, 255, 255, 0.5)'}
                        fontSize="10"
                        fontFamily="monospace"
                      >
                        {format(parseISO(pt.date), 'MMM d')}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          ) : (
            <div className="h-[170px] flex flex-col items-center justify-center text-center px-4">
              <div className="text-sm font-semibold text-on-surface">
                No {activeMuscleDef.label} logs yet
              </div>
              <p className="text-xs text-on-surface-variant mt-1">
                Click {activeMuscleDef.shortLabel} on the map above and enter a size to start your graph.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Weekly Progressive Overload Comparison Box */}
      {(() => {
        // Combine archived workouts with today's live workout if not yet archived
        const sessionsByDate = new Map<string, WorkoutItem[]>();
        for (const entry of archive) {
          if (entry.exercises && entry.exercises.length > 0) {
            sessionsByDate.set(entry.date, entry.exercises);
          }
        }
        if (workout.length > 0) {
          const todayLive = workout.filter(
            (ex) =>
              ex.completed ||
              (ex.setData &&
                ex.setData.some((s) => parseWeightParts(s.weight || ex.weight).value > 0 && Number(s.reps) > 0))
          );
          if (todayLive.length > 0) {
            sessionsByDate.set(todayStr, todayLive);
          }
        }

        const safeCycle = Math.max(1, cycleLength || 7);
        let parsedProgramStart: Date | null = null;
        try {
          if (programStartDate) parsedProgramStart = parseISO(programStartDate);
        } catch {
          parsedProgramStart = null;
        }

        const bucketsMap = new Map<string, WeekBucket>();

        sessionsByDate.forEach((exercises, dateStr) => {
          let entryDate: Date;
          try {
            entryDate = parseISO(dateStr);
            if (isNaN(entryDate.getTime())) return;
          } catch {
            return;
          }

          let weekKey = '';
          let label = '';
          let dateRange = '';
          let sortTime = entryDate.getTime();

          if (parsedProgramStart && !isNaN(parsedProgramStart.getTime())) {
            const diffDays = differenceInDays(entryDate, parsedProgramStart);
            if (diffDays >= 0) {
              const weekNum = Math.floor(diffDays / safeCycle) + 1;
              const startD = addDays(parsedProgramStart, (weekNum - 1) * safeCycle);
              const endD = addDays(startD, safeCycle - 1);
              weekKey = `P-${weekNum}`;
              label = `Week ${weekNum}`;
              dateRange = `${format(startD, 'MMM d')} – ${format(endD, 'MMM d')}`;
              sortTime = startD.getTime();
            }
          }

          if (!weekKey) {
            const weekStart = startOfWeek(entryDate, { weekStartsOn: 1 });
            const weekEnd = addDays(weekStart, 6);
            weekKey = `C-${format(weekStart, 'yyyy-MM-dd')}`;
            label = `Week of ${format(weekStart, 'MMM d')}`;
            dateRange = `${format(weekStart, 'MMM d')} – ${format(weekEnd, 'MMM d')}`;
            sortTime = weekStart.getTime();
          }

          if (!bucketsMap.has(weekKey)) {
            bucketsMap.set(weekKey, {
              weekKey,
              label,
              dateRange,
              sortTime,
              totalVolume: 0,
              workoutDays: 0,
              exercises: {},
            });
          }

          const bucket = bucketsMap.get(weekKey)!;
          let sessionHasValidExercise = false;

          for (const ex of exercises) {
            if (!ex.name) continue;
            const setsList =
              ex.setData && ex.setData.length > 0
                ? ex.setData
                : Array.from({ length: parseInt(String(ex.sets || '1')) || 1 }, () => ({
                    weight: ex.weight,
                    reps: ex.reps,
                  }));

            let sessionVolume = 0;
            let sessionReps = 0;
            let sessionMaxWeight = 0;
            let bestSetWeight = 0;
            let bestSetReps = 0;
            let bestSetScore = -1;
            let best1RM = 0;
            let weightUnit = 'kg';

            for (const s of setsList) {
              const { value: w, unit } = parseWeightParts(s.weight || ex.weight);
              const r = Number(s.reps ?? ex.reps) || 0;
              if (w > 0) weightUnit = unit;
              const setVol = w * r;
              sessionVolume += setVol;
              sessionReps += r;
              if (w > sessionMaxWeight) sessionMaxWeight = w;
              const score = w > 0 ? setVol : r;
              if (score > bestSetScore) {
                bestSetScore = score;
                bestSetWeight = w;
                bestSetReps = r;
              }
              if (w > 0 && r > 0) {
                const e1rm = w * (1 + r / 30);
                if (e1rm > best1RM) best1RM = e1rm;
              }
            }

            if (!ex.completed && sessionVolume === 0) continue;
            if (sessionVolume === 0 && sessionReps === 0) continue;

            sessionHasValidExercise = true;
            const exKey = ex.name.trim().toUpperCase();
            const prevAgg = bucket.exercises[exKey];

            if (!prevAgg) {
              bucket.exercises[exKey] = {
                key: exKey,
                name: ex.name,
                totalVolume: sessionVolume,
                bestSessionVolume: sessionVolume,
                maxWeight: sessionMaxWeight,
                weightUnit,
                bestSetWeight,
                bestSetReps,
                best1RM,
                bestSessionReps: sessionReps,
                sessionsCount: 1,
              };
            } else {
              prevAgg.totalVolume += sessionVolume;
              prevAgg.sessionsCount += 1;
              if (sessionVolume > prevAgg.bestSessionVolume) {
                prevAgg.bestSessionVolume = sessionVolume;
                prevAgg.bestSetWeight = bestSetWeight;
                prevAgg.bestSetReps = bestSetReps;
              }
              if (sessionMaxWeight > prevAgg.maxWeight) {
                prevAgg.maxWeight = sessionMaxWeight;
              }
              if (best1RM > prevAgg.best1RM) {
                prevAgg.best1RM = best1RM;
              }
              if (sessionReps > prevAgg.bestSessionReps) {
                prevAgg.bestSessionReps = sessionReps;
              }
            }

            bucket.totalVolume += sessionVolume;
          }

          if (sessionHasValidExercise) {
            bucket.workoutDays += 1;
          }
        });

        const weeks = Array.from(bucketsMap.values())
          .filter((w) => Object.keys(w.exercises).length > 0)
          .sort((a, b) => a.sortTime - b.sortTime);

        return (
          <WeeklyOverloadBox weeks={weeks} />
        );
      })()}
    </motion.div>
  );
};

const WeeklyOverloadBox: React.FC<{ weeks: WeekBucket[] }> = ({ weeks }) => {
  const [weekAKey, setWeekAKey] = useState<string>('');
  const [weekBKey, setWeekBKey] = useState<string>('');

  useEffect(() => {
    if (weeks.length === 0) return;
    const latest = weeks[weeks.length - 1].weekKey;
    const prev = weeks.length >= 2 ? weeks[weeks.length - 2].weekKey : latest;

    if (!weekBKey || !weeks.some((w) => w.weekKey === weekBKey)) {
      setWeekBKey(latest);
    }
    if (!weekAKey || !weeks.some((w) => w.weekKey === weekAKey)) {
      setWeekAKey(prev);
    }
  }, [weeks, weekAKey, weekBKey]);

  const weekA = weeks.find((w) => w.weekKey === weekAKey) || weeks[Math.max(0, weeks.length - 2)];
  const weekB = weeks.find((w) => w.weekKey === weekBKey) || weeks[weeks.length - 1];

  const comparisons = useMemo(() => {
    if (!weekA || !weekB) return [];

    const allKeys = Array.from(
      new Set([...Object.keys(weekB.exercises), ...Object.keys(weekA.exercises)])
    );

    return allKeys
      .map((exKey) => {
        const a = weekA.exercises[exKey];
        const b = weekB.exercises[exKey];

        if (a && b) {
          const usingWeight = a.maxWeight > 0 || b.maxWeight > 0;
          let pct = 0;
          let status: 'improving' | 'backwards' | 'same' = 'same';

          if (usingWeight) {
            if (a.bestSessionVolume > 0) {
              pct = ((b.bestSessionVolume - a.bestSessionVolume) / a.bestSessionVolume) * 100;
            }
            if (
              b.bestSessionVolume > a.bestSessionVolume + 0.01 ||
              b.maxWeight > a.maxWeight + 0.01 ||
              (b.maxWeight === a.maxWeight && b.bestSessionReps > a.bestSessionReps)
            ) {
              status = 'improving';
            } else if (
              b.bestSessionVolume < a.bestSessionVolume - 0.01 ||
              b.maxWeight < a.maxWeight - 0.01
            ) {
              status = 'backwards';
            }
          } else {
            if (a.bestSessionReps > 0) {
              pct = ((b.bestSessionReps - a.bestSessionReps) / a.bestSessionReps) * 100;
            }
            if (b.bestSessionReps > a.bestSessionReps) status = 'improving';
            else if (b.bestSessionReps < a.bestSessionReps) status = 'backwards';
          }

          return {
            key: exKey,
            name: b.name || a.name,
            a,
            b,
            pct,
            status: status as 'improving' | 'backwards' | 'same' | 'only-a' | 'only-b',
          };
        }

        if (b && !a) {
          return {
            key: exKey,
            name: b.name,
            a: undefined,
            b,
            pct: 0,
            status: 'only-b' as const,
          };
        }

        return {
          key: exKey,
          name: a!.name,
          a,
          b: undefined,
          pct: 0,
          status: 'only-a' as const,
        };
      })
      .sort((x, y) => {
        const rank = (s: string) =>
          s === 'improving' ? 0 : s === 'backwards' ? 1 : s === 'same' ? 2 : 3;
        return rank(x.status) - rank(y.status);
      });
  }, [weekA, weekB]);

  const matched = comparisons.filter(
    (c) => c.status === 'improving' || c.status === 'backwards' || c.status === 'same'
  );
  const improvedCount = matched.filter((c) => c.status === 'improving').length;
  const backwardsCount = matched.filter((c) => c.status === 'backwards').length;
  const sameCount = matched.filter((c) => c.status === 'same').length;
  const avgOverloadPct =
    matched.length > 0
      ? matched.reduce((acc, c) => acc + c.pct, 0) / matched.length
      : 0;

  let overallVerdict: 'improving' | 'backwards' | 'same' = 'same';
  if (matched.length > 0) {
    if (avgOverloadPct > 0.25 || (avgOverloadPct >= 0 && improvedCount > backwardsCount)) {
      overallVerdict = 'improving';
    } else if (avgOverloadPct < -0.25 || (avgOverloadPct <= 0 && backwardsCount > improvedCount)) {
      overallVerdict = 'backwards';
    }
  }

  const maxWeekVol = Math.max(1, ...weeks.map((w) => w.totalVolume));

  const formatBest = (agg?: WeekExerciseAggregate) => {
    if (!agg) return '--';
    if (agg.bestSetWeight > 0) {
      return `${agg.bestSetWeight}${agg.weightUnit} × ${agg.bestSetReps}`;
    }
    return `${agg.bestSessionReps} reps`;
  };

  return (
    <div className="bg-surface-container-low border border-white/5 p-4 md:p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="font-sans font-semibold text-base md:text-lg font-bold text-on-surface">
            Weekly Progressive Overload
          </h3>
          <p className="text-xs text-on-surface-variant mt-0.5">
            Compare any two weeks to see if your lifts are improving or going backwards
          </p>
        </div>

        {weeks.length >= 2 && weekA && weekB && (
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={weekA.weekKey}
              onChange={(e) => setWeekAKey(e.target.value)}
              aria-label="Baseline week"
              className="bg-surface-container-high border border-white/10 rounded-xl px-3 py-2 text-xs font-mono font-semibold text-on-surface focus:border-primary-container outline-none min-h-[40px]"
            >
              {weeks.map((w) => (
                <option key={w.weekKey} value={w.weekKey}>
                  {w.label}
                </option>
              ))}
            </select>
            <ArrowRight className="w-4 h-4 text-on-surface-variant shrink-0" />
            <select
              value={weekB.weekKey}
              onChange={(e) => setWeekBKey(e.target.value)}
              aria-label="Comparison week"
              className="bg-surface-container-high border border-primary-container/40 rounded-xl px-3 py-2 text-xs font-mono font-semibold text-primary-container focus:border-primary-container outline-none min-h-[40px]"
            >
              {weeks.map((w) => (
                <option key={w.weekKey} value={w.weekKey}>
                  {w.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {weeks.length === 0 ? (
        <div className="bg-background/60 border border-white/5 rounded-2xl p-8 text-center">
          <div className="text-sm font-semibold text-on-surface">No workout history logged yet</div>
          <p className="text-xs text-on-surface-variant mt-1">
            Complete workouts in Quest or Schedule with your weights and reps to compare weekly overload.
          </p>
        </div>
      ) : weeks.length === 1 ? (
        <div className="bg-background/60 border border-white/5 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-primary-container">
              {weeks[0].label} Baseline Recorded ({weeks[0].dateRange})
            </div>
            <div className="text-xs text-on-surface-variant mt-1">
              {Object.keys(weeks[0].exercises).length} exercises logged · Total volume{' '}
              <span className="font-mono text-on-surface font-semibold">
                {Math.round(weeks[0].totalVolume).toLocaleString()} kg
              </span>
            </div>
          </div>
          <div className="text-xs text-on-surface-variant">
            Log workouts next week to compare progression.
          </div>
        </div>
      ) : (
        <>
          {/* Clickable Week-by-Week Trend Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
            {weeks.map((w, idx) => {
              const prevW = idx > 0 ? weeks[idx - 1] : null;
              const volDeltaPct =
                prevW && prevW.totalVolume > 0
                  ? ((w.totalVolume - prevW.totalVolume) / prevW.totalVolume) * 100
                  : null;
              const isSelectedB = weekB?.weekKey === w.weekKey;
              const isSelectedA = weekA?.weekKey === w.weekKey;
              const barPct = Math.max(10, Math.round((w.totalVolume / maxWeekVol) * 100));

              return (
                <button
                  key={w.weekKey}
                  type="button"
                  onClick={() => {
                    setWeekBKey(w.weekKey);
                    if (idx > 0) setWeekAKey(weeks[idx - 1].weekKey);
                  }}
                  className={`text-left p-3 rounded-xl border transition-all ${
                    isSelectedB
                      ? 'bg-primary-container/15 border-primary-container/60'
                      : isSelectedA
                        ? 'bg-surface-container-high border-white/25'
                        : 'bg-background/50 border-white/5 hover:border-white/15'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono text-xs font-bold text-on-surface">{w.label}</span>
                    {volDeltaPct !== null && (
                      <span
                        className={`font-mono text-[10px] font-bold ${
                          volDeltaPct > 0.5
                            ? 'text-emerald-400'
                            : volDeltaPct < -0.5
                              ? 'text-error'
                              : 'text-on-surface-variant'
                        }`}
                      >
                        {volDeltaPct > 0 ? '+' : ''}
                        {volDeltaPct.toFixed(0)}%
                      </span>
                    )}
                  </div>
                  <div className="font-mono tabular-nums text-xs text-on-surface-variant mt-1">
                    {Math.round(w.totalVolume).toLocaleString()} kg
                  </div>
                  <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden mt-2">
                    <div
                      className={`h-full rounded-full ${
                        isSelectedB ? 'bg-primary-container' : 'bg-primary-container/45'
                      }`}
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>

          {/* Verdict Banner */}
          {weekA && weekB && (
            <div className="bg-background/60 border border-white/5 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {overallVerdict === 'improving' ? (
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                    <TrendingUp className="w-5 h-5" />
                  </div>
                ) : overallVerdict === 'backwards' ? (
                  <div className="w-10 h-10 rounded-xl bg-error/15 border border-error/30 flex items-center justify-center text-error shrink-0">
                    <TrendingDown className="w-5 h-5" />
                  </div>
                ) : (
                  <div className="w-10 h-10 rounded-xl bg-primary-container/15 border border-primary-container/30 flex items-center justify-center text-primary-container shrink-0">
                    <Minus className="w-5 h-5" />
                  </div>
                )}

                <div>
                  <div
                    className={`text-sm font-bold ${
                      overallVerdict === 'improving'
                        ? 'text-emerald-400'
                        : overallVerdict === 'backwards'
                          ? 'text-error'
                          : 'text-primary-container'
                    }`}
                  >
                    {overallVerdict === 'improving'
                      ? `Improving (${avgOverloadPct >= 0 ? '+' : ''}${avgOverloadPct.toFixed(1)}% avg overload)`
                      : overallVerdict === 'backwards'
                        ? `Going Backwards (${avgOverloadPct.toFixed(1)}% avg overload)`
                        : matched.length > 0
                          ? 'Maintained (0.0% change)'
                          : 'No shared exercises between these weeks'}
                  </div>
                  <div className="text-xs text-on-surface-variant mt-0.5 font-mono">
                    {weekA.label} ({Math.round(weekA.totalVolume).toLocaleString()} kg) → {weekB.label} (
                    {Math.round(weekB.totalVolume).toLocaleString()} kg)
                  </div>
                </div>
              </div>

              {matched.length > 0 && (
                <div className="flex items-center gap-3 text-xs font-mono">
                  <span className="text-emerald-400">{improvedCount} Up</span>
                  <span className="text-on-surface-variant/40">·</span>
                  <span className="text-on-surface-variant">{sameCount} Same</span>
                  <span className="text-on-surface-variant/40">·</span>
                  <span className="text-error">{backwardsCount} Down</span>
                </div>
              )}
            </div>
          )}

          {/* Exercise-by-Exercise Breakdown */}
          {comparisons.length > 0 && (
            <div className="divide-y divide-white/5 max-h-[340px] overflow-y-auto pr-1 custom-scrollbar">
              {comparisons.map((row) => (
                <div
                  key={row.key}
                  className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-on-surface truncate">
                      {row.name}
                    </div>
                    <div className="text-xs font-mono text-on-surface-variant mt-0.5 flex items-center gap-2 flex-wrap">
                      <span>
                        {weekA?.label}: <strong className="text-on-surface">{formatBest(row.a)}</strong>
                      </span>
                      <span className="text-on-surface-variant/40">→</span>
                      <span>
                        {weekB?.label}: <strong className="text-on-surface">{formatBest(row.b)}</strong>
                      </span>
                    </div>
                  </div>

                  <div className="shrink-0 font-mono text-xs font-bold flex items-center gap-1.5">
                    {row.status === 'improving' && (
                      <span className="text-emerald-400 flex items-center gap-1">
                        <TrendingUp className="w-3.5 h-3.5" />
                        Improving{row.pct !== 0 ? ` (+${Math.abs(row.pct).toFixed(1)}%)` : ''}
                      </span>
                    )}
                    {row.status === 'backwards' && (
                      <span className="text-error flex items-center gap-1">
                        <TrendingDown className="w-3.5 h-3.5" />
                        Backwards{row.pct !== 0 ? ` (${row.pct.toFixed(1)}%)` : ''}
                      </span>
                    )}
                    {row.status === 'same' && (
                      <span className="text-primary-container flex items-center gap-1">
                        <Minus className="w-3.5 h-3.5" />
                        Same
                      </span>
                    )}
                    {row.status === 'only-b' && (
                      <span className="text-on-surface-variant font-normal">
                        Only in {weekB?.label}
                      </span>
                    )}
                    {row.status === 'only-a' && (
                      <span className="text-on-surface-variant font-normal">
                        Not logged in {weekB?.label}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

