type IconProps = { className?: string };

export function DropIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 2.5c3.5 4.6 7 8.9 7 12.8a7 7 0 1 1-14 0c0-3.9 3.5-8.2 7-12.8Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WaveIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M2 9c1.6-1.6 3.4-1.6 5 0s3.4 1.6 5 0 3.4-1.6 5 0 3.4 1.6 5 0"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M2 14.5c1.6-1.6 3.4-1.6 5 0s3.4 1.6 5 0 3.4-1.6 5 0 3.4 1.6 5 0"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M2 20c1.6-1.6 3.4-1.6 5 0s3.4 1.6 5 0 3.4-1.6 5 0 3.4 1.6 5 0"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.5"
      />
    </svg>
  );
}

export function RainIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M7 11a4.5 4.5 0 0 1 .8-8.9A5.5 5.5 0 0 1 18.4 4 4 4 0 0 1 18 12H7Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M8 15.5 6.5 19" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M12.5 15.5 11 19" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M17 15.5 15.5 19" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function HeartIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 20.5s-7.5-4.6-9.8-9.4C.7 7.6 2.5 4 6.2 4c2 0 3.6 1.1 4.5 2.6C11.6 5.1 13.2 4 15.2 4c3.7 0 5.5 3.6 4 7.1-2.3 4.8-9.8 9.4-9.8 9.4Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
