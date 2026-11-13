import React from 'react';

interface MemorizLogoProps {
  className?: string;
  size?: number;
}

export const MemorizLogo: React.FC<MemorizLogoProps> = ({
  className = "w-7 h-7 sm:w-8 sm:h-8",
  size = 32,
}) => {
  const rawId = React.useId();
  const clipId = `silenon-slit-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [peakY] = React.useState<string>(() => {
    const overshoot = 100 + Math.floor(Math.random() * 36);
    return `-${overshoot}px`;
  });

  return (
    <div
      className={`rounded-lg shrink-0 shadow-sm flex items-center justify-center relative ${className}`}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 512 512"
        width={size}
        height={size}
        aria-label="Silenon Logo"
        role="img"
        className="w-full h-full block rounded-lg"
        style={
          {
            overflow: 'visible',
            '--si-peak-y': peakY,
          } as React.CSSProperties
        }
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <clipPath id={clipId}>
            <rect x="-250" y="-250" width="1012" height="626" />
          </clipPath>
        </defs>
        <rect
          className="silenon-mark-rect"
          width="512"
          height="512"
          rx="112"
          fill="var(--silenon-mark-bg)"
          stroke="var(--theme-border-strong)"
        />
        <g clipPath={`url(#${clipId})`}>
          <path
            className="si-slit-piece si-slit-s-bottom"
            d="M 124 292 L 328 244 V 376 H 124 V 328 H 276 V 304 L 124 340 Z"
            fill="var(--silenon-mark-fg)"
          />
          <path
            className="si-slit-piece si-slit-i-stem"
            d="M 368 235 L 420 223 V 376 H 368 Z"
            fill="var(--silenon-mark-fg)"
          />
          <path
            className="si-slit-piece si-slit-s-top"
            d="M 328 136 H 124 V 264 L 328 216 V 168 L 176 204 V 184 H 328 Z"
            fill="var(--silenon-mark-fg)"
          />
          <path
            className="si-slit-piece si-slit-i-dot"
            d="M 382 136 H 434 L 420 195 L 368 207 Z"
            fill="var(--silenon-mark-dot)"
          />
        </g>
      </svg>
    </div>
  );
};
