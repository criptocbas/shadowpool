"use client";

/**
 * Vertical (desktop) / horizontal (mobile) divider between the encrypted
 * and revealed panels. Three dots + two connecting lines animate to
 * suggest MPC rounds are happening between the two sides.
 */
export function MPCDivider() {
  return (
    <div className="vault-mpc-divider flex flex-row md:flex-col items-center justify-center gap-2 py-3 md:py-0 px-4 md:px-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="contents">
          <div
            className="mpc-node w-[6px] h-[6px] rounded-full shrink-0"
            style={{
              background: "var(--accent-encrypted)",
              animationDelay: `${i * 0.5}s`,
            }}
          />
          {i < 2 && (
            <div
              className="mpc-line w-4 md:w-px h-px md:h-5 shrink-0"
              style={{
                background: "var(--accent-encrypted-dim)",
                animationDelay: `${i * 0.5 + 0.25}s`,
              }}
            />
          )}
        </div>
      ))}
      <div
        className="text-[7px] font-mono uppercase tracking-[0.2em] md:[writing-mode:vertical-rl] md:rotate-180 mt-1 md:mt-2 whitespace-nowrap"
        style={{ color: "var(--accent-encrypted-dim)" }}
      >
        MPC
      </div>
    </div>
  );
}

/** Small locked-padlock icon used as an inline indicator for encrypted fields. */
export function LockIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="inline-block mr-1 opacity-60"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  );
}
