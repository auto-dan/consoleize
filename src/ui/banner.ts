import pc from 'picocolors';
import { terminalWidth } from './format.ts';

const TITLE = [
  '  ██████╗ ██████╗ ███╗   ██╗███████╗ ██████╗ ██╗     ██╗███████╗███████╗',
  ' ██╔════╝██╔═══██╗████╗  ██║██╔════╝██╔═══██╗██║     ██║╚══███╔╝██╔════╝',
  ' ██║     ██║   ██║██╔██╗ ██║███████╗██║   ██║██║     ██║  ███╔╝ █████╗  ',
  ' ██║     ██║   ██║██║╚██╗██║╚════██║██║   ██║██║     ██║ ███╔╝  ██╔══╝  ',
  ' ╚██████╗╚██████╔╝██║ ╚████║███████║╚██████╔╝███████╗██║███████╗███████╗',
  '  ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚══════╝ ╚═════╝ ╚══════╝╚═╝╚══════╝╚══════╝',
];

const ART_WIDTH = Math.max(...TITLE.map((line) => line.length));
const TAGLINE = '  world of warcraft, controller-ified';

/** True when the full ASCII-art banner fits in the given width. */
export function bannerFits(width: number): boolean {
  return width >= ART_WIDTH + 2;
}

/** Convert HSL (h: 0-360, s/l: 0-1) to 8-bit RGB. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - chroma / 2;

  let rgb: [number, number, number];
  if (hue < 60) rgb = [chroma, x, 0];
  else if (hue < 120) rgb = [x, chroma, 0];
  else if (hue < 180) rgb = [0, chroma, x];
  else if (hue < 240) rgb = [0, x, chroma];
  else if (hue < 300) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];

  return [
    Math.round((rgb[0] + m) * 255),
    Math.round((rgb[1] + m) * 255),
    Math.round((rgb[2] + m) * 255),
  ];
}

/** Wrap text in a truecolor ANSI escape. */
function trueColor(text: string, r: number, g: number, b: number): string {
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

/** Degrees of hue swept across the banner from left to right. */
const RAINBOW_SPAN = 270;

/**
 * Render one banner frame: the ASCII art with a horizontal rainbow gradient
 * (truecolor), phase-shifted by `phase` degrees for animation.
 */
function rainbowFrame(phase: number): string {
  const lines = TITLE.map((line) => {
    let rendered = '';
    for (let i = 0; i < line.length; i++) {
      const char = line[i]!;
      if (char === ' ') {
        rendered += char;
        continue;
      }
      const hue = (i / ART_WIDTH) * RAINBOW_SPAN + phase;
      const [r, g, b] = hslToRgb(hue, 0.85, 0.6);
      rendered += trueColor(char, r, g, b);
    }
    return rendered;
  });
  lines.push(pc.dim(TAGLINE));
  return lines.join('\n');
}

/**
 * The app banner. Wide terminals get the rainbow-gradient ASCII art;
 * narrow ones get a compact gradient wordmark that fits any window.
 */
export function renderBanner(width = terminalWidth()): string {
  if (!bannerFits(width)) {
    const wordmark = 'C O N S O L E I Z E';
    let rendered = '  ';
    for (let i = 0; i < wordmark.length; i++) {
      const char = wordmark[i]!;
      if (char === ' ') {
        rendered += char;
        continue;
      }
      const [r, g, b] = hslToRgb((i / wordmark.length) * RAINBOW_SPAN, 0.85, 0.6);
      rendered += trueColor(char, r, g, b);
    }
    return `${rendered}\n${pc.dim(TAGLINE)}`;
  }

  return rainbowFrame(0);
}

/** Welcome line greeting the configured username. */
export function renderWelcome(username: string): string {
  return `Welcome back, ${pc.bold(pc.cyan(username))}.`;
}

const ANIMATION_FRAMES = 14;
const ANIMATION_FRAME_MS = 35;
const ANIMATION_SWEEP_DEGREES = 240;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One-shot rainbow sweep across the banner: colors rush in from the left
 * over ~0.5s, then settle into the static gradient. No continuous strobing.
 * Falls back to printing the static banner when not a TTY or when the
 * terminal is narrow.
 */
export async function animateBannerOnce(width = terminalWidth()): Promise<void> {
  if (!process.stdout.isTTY || !bannerFits(width)) {
    console.log(renderBanner(width));
    return;
  }

  const frameCount = TITLE.length + 1; // art + tagline
  for (let frame = ANIMATION_FRAMES; frame >= 0; frame--) {
    const phase = (frame / ANIMATION_FRAMES) * ANIMATION_SWEEP_DEGREES;
    if (frame < ANIMATION_FRAMES) {
      // Move the cursor back to the first banner line and repaint.
      process.stdout.write(`\x1b[${frameCount}F`);
    }
    process.stdout.write(`${rainbowFrame(phase)}\n`);
    if (frame > 0) await sleep(ANIMATION_FRAME_MS);
  }
}
