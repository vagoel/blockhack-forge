export default function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 48 48">
        <defs>
          <linearGradient id="khayaal-stem" x1="13" y1="8" x2="25" y2="40" gradientUnits="userSpaceOnUse">
            <stop stopColor="#F2F0FF" />
            <stop offset="0.42" stopColor="#B7ADFF" />
            <stop offset="1" stopColor="#7564F7" />
          </linearGradient>
          <linearGradient id="khayaal-wing" x1="23" y1="10" x2="42" y2="37" gradientUnits="userSpaceOnUse">
            <stop stopColor="#9EF1D0" />
            <stop offset="0.48" stopColor="#66DDB6" />
            <stop offset="1" stopColor="#30A987" />
          </linearGradient>
          <linearGradient id="khayaal-edge" x1="21" y1="8" x2="29" y2="37" gradientUnits="userSpaceOnUse">
            <stop stopColor="#6E5CEB" />
            <stop offset="1" stopColor="#39268E" />
          </linearGradient>
          <radialGradient id="khayaal-glow" cx="0" cy="0" r="1" gradientTransform="translate(24 22) rotate(90) scale(19)">
            <stop stopColor="#8B7DFF" stopOpacity=".3" />
            <stop offset="1" stopColor="#8B7DFF" stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle className="brand-aura" cx="24" cy="24" r="20" fill="url(#khayaal-glow)" />
        <g className="brand-orbit">
          <ellipse cx="24" cy="24" rx="19" ry="10.5" transform="rotate(-28 24 24)" />
          <circle cx="40.5" cy="15" r="1.75" />
        </g>
        <g className="brand-k">
          <path className="brand-k-shadow" d="M12.5 12 20.8 7.5 25 10v26l-8.2 4.5-4.3-2.6Z" />
          <path fill="url(#khayaal-stem)" d="M12.5 12 20.8 7.5v28.7l-8.3 4.4Z" />
          <path fill="url(#khayaal-edge)" d="m20.8 7.5 4.2 2.4v25.8l-4.2.5Z" />
          <path fill="url(#khayaal-wing)" d="m23.3 21.4 12-12.8 7 4.1-13.6 14.1Z" />
          <path className="brand-k-facet" d="m35.3 8.6 4.2-1.8 7 4-4.2 1.9Z" />
          <path fill="url(#khayaal-wing)" d="m27 22.9 15.7 13.4-7.5 4.1-12.7-13Z" />
          <path className="brand-k-facet" d="m42.7 36.3 4-2.2-7.5-12.5-4 2.3Z" />
          <path className="brand-edge-light" d="M14.2 12.9 19.5 10v24.9" />
        </g>
        <path className="brand-glint" d="M36.8 6.8c.28 1.7 1.25 2.67 2.95 2.95-1.7.28-2.67 1.25-2.95 2.95-.28-1.7-1.25-2.67-2.95-2.95 1.7-.28 2.67-1.25 2.95-2.95Z" />
      </svg>
    </span>
  );
}
