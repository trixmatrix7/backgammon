/** The CHAIN GAMMON wordmark — "GAMMON" in the house accent colours. */
export function Wordmark() {
  return (
    <>
      CHAIN{" "}
      <span className="ludo-mark">
        <span className="ludo-l">G</span>
        <span className="ludo-u">A</span>
        <span className="ludo-d">M</span>
        <span className="ludo-o">M</span>
        <span className="ludo-l">O</span>
        <span className="ludo-u">N</span>
      </span>
    </>
  );
}

/** Small board-and-cube logo mark for the lobby masthead. */
export function GammonLogo() {
  return (
    <svg className="floor-mark" viewBox="0 0 48 48" fill="none">
      <rect x="4" y="6" width="40" height="36" rx="7" fill="#17140f" stroke="#ffe168" strokeWidth="2.2" />
      <path d="M9 11 L15 11 L12 25 Z" fill="#4aa8ff" />
      <path d="M17 11 L23 11 L20 25 Z" fill="#f4e6cd" opacity="0.85" />
      <path d="M25 37 L31 37 L28 23 Z" fill="#ff5a4e" />
      <path d="M33 37 L39 37 L36 23 Z" fill="#f4e6cd" opacity="0.85" />
      <rect x="19.5" y="17.5" width="13" height="13" rx="3" fill="#ffe168" stroke="#0d0b07" strokeWidth="1.6" />
      <text
        x="26"
        y="27.4"
        textAnchor="middle"
        fontFamily="'Poppins',Arial,sans-serif"
        fontWeight="900"
        fontSize="10"
        fill="#0d0b07"
      >
        2
      </text>
    </svg>
  );
}
