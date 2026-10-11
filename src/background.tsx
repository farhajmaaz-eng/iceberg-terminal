import * as React from 'react';

/**
 * Ambient background.
 *
 * A single, static, very low-contrast radial wash. Deliberately restrained —
 * no animated gradients, no glassmorphism. It exists only to keep large dark
 * areas from reading as a flat void, and it never animates so it costs
 * nothing on low-power devices.
 */
export function AppBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      <div
        className="absolute -left-1/4 -top-1/3 h-[70vh] w-[70vh] opacity-[0.07]"
        style={{
          background: 'radial-gradient(circle, #22d3ee 0%, transparent 62%)',
          filter: 'blur(60px)',
        }}
      />
      <div
        className="absolute -bottom-1/3 -right-1/4 h-[60vh] w-[60vh] opacity-[0.05]"
        style={{
          background: 'radial-gradient(circle, #22c55e 0%, transparent 62%)',
          filter: 'blur(60px)',
        }}
      />
      <Scanlines />
    </div>
  );
}

/** Faint horizontal scanline texture — static, 1px, ~2% opacity. */
function Scanlines() {
  const [pattern, setPattern] = React.useState<string | null>(null);

  React.useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    ctx.fillRect(0, 0, 4, 1);
    setPattern(canvas.toDataURL());
  }, []);

  if (!pattern) return null;
  return (
    <div
      className="absolute inset-0 opacity-40"
      style={{ backgroundImage: `url(${pattern})`, backgroundRepeat: 'repeat' }}
    />
  );
}