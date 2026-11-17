import type { CSSProperties } from 'react';

export const DEFAULT_UNIFORM_PRIMARY = '#1e3a8a';
export const DEFAULT_UNIFORM_SECONDARY = '#b45309';

export interface UniformColorPreset {
  id: string;
  label: string;
  primary: string;
  secondary: string;
}

export const UNIFORM_COLOR_PRESETS: UniformColorPreset[] = [
  { id: 'navy-gold', label: 'Royal Navy & Gold', primary: '#1e3a8a', secondary: '#b45309' },
  { id: 'forest-gold', label: 'Forest Green & Gold', primary: '#065f46', secondary: '#d97706' },
  { id: 'maroon-cream', label: 'Maroon & Gold', primary: '#881337', secondary: '#ca8a04' },
  { id: 'sky-navy', label: 'Sky Blue & Navy', primary: '#0369a1', secondary: '#1e293b' },
  { id: 'emerald-slate', label: 'Emerald & Charcoal', primary: '#047857', secondary: '#334155' },
  { id: 'indigo-amber', label: 'Indigo & Amber', primary: '#3730a3', secondary: '#d97706' },
  { id: 'purple-gold', label: 'Royal Purple & Gold', primary: '#5b21b6', secondary: '#d97706' },
  { id: 'charcoal-crimson', label: 'Charcoal & Crimson', primary: '#0f172a', secondary: '#b91c1c' },
];

export function normalizeHexColor(value: string | undefined | null, fallback: string): string {
  if (!value) return fallback;
  const trimmed = value.trim();
  const match = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(trimmed);
  if (!match) return fallback;
  const hex = match[1];
  if (hex.length === 3) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`.toLowerCase();
  }
  return `#${hex.toLowerCase()}`;
}

function parseHexRgb(hex: string): [number, number, number] {
  const clean = normalizeHexColor(hex, DEFAULT_UNIFORM_PRIMARY).slice(1);
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHexRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function getContrastTextColor(hex: string): '#ffffff' | '#0f172a' {
  return relativeLuminance(hex) > 0.36 ? '#0f172a' : '#ffffff';
}

export function mixHex(hexA: string, hexB: string, weightB: number): string {
  const [r1, g1, b1] = parseHexRgb(hexA);
  const [r2, g2, b2] = parseHexRgb(hexB);
  const w = Math.max(0, Math.min(1, weightB));
  const r = Math.round(r1 * (1 - w) + r2 * w);
  const g = Math.round(g1 * (1 - w) + g2 * w);
  const b = Math.round(b1 * (1 - w) + b2 * w);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = parseHexRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function buildSchoolThemeVars(
  primaryColor?: string | null,
  secondaryColor?: string | null
): CSSProperties {
  const primary = normalizeHexColor(primaryColor, DEFAULT_UNIFORM_PRIMARY);
  const secondary = normalizeHexColor(secondaryColor, DEFAULT_UNIFORM_SECONDARY);
  const primaryContrast = getContrastTextColor(primary);
  const secondaryContrast = getContrastTextColor(secondary);
  const primaryHover =
    relativeLuminance(primary) > 0.36
      ? mixHex(primary, '#0f172a', 0.14)
      : mixHex(primary, '#020617', 0.22);
  const primaryInk =
    relativeLuminance(primary) > 0.28 ? mixHex(primary, '#0f172a', 0.52) : primary;

  return {
    ['--school-primary' as string]: primary,
    ['--school-primary-hover' as string]: primaryHover,
    ['--school-primary-contrast' as string]: primaryContrast,
    ['--school-primary-ink' as string]: primaryInk,
    ['--school-primary-soft' as string]: hexToRgba(primary, 0.08),
    ['--school-primary-border' as string]: hexToRgba(primary, 0.3),
    ['--school-secondary' as string]: secondary,
    ['--school-secondary-contrast' as string]: secondaryContrast,
    ['--school-secondary-soft' as string]: hexToRgba(secondary, 0.12),
  };
}
