/** The currency mark — single source of truth for the token logo everywhere. Swap this one component
 *  to change the token/asset across all screens. Scales with surrounding text (≈1em). */
export function Coin({ size, title = "USDC" }: { size?: number; title?: string }) {
  return (
    <svg className="coin" viewBox="0 0 24 24" width={size} height={size} role="img" aria-label={title}>
      <title>{title}</title>
      <circle cx="12" cy="12" r="12" fill="#2775ca" />
      <circle cx="12" cy="12" r="8.6" fill="none" stroke="#fff" strokeWidth="1.1" opacity="0.9" />
      <text
        x="12"
        y="16.2"
        textAnchor="middle"
        fontFamily="'Poppins',Arial,sans-serif"
        fontWeight="800"
        fontSize="11"
        fill="#fff"
      >
        $
      </text>
    </svg>
  );
}
