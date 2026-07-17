import type { ReactNode, SVGProps } from 'react'

/**
 * Hand-drawn inline SVG icon set for the CoNote demo. Stroke-based, 24px
 * viewBox, inherits `currentColor`. Purely decorative — every icon-only control
 * carries its own aria-label/title, so these are marked aria-hidden.
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Glyph({ size = 16, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export function IconSparkles(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 3.5l1.7 4.4 4.4 1.7-4.4 1.7L12 15.7l-1.7-4.4L5.9 9.6l4.4-1.7z" />
      <path d="M18.5 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
    </Glyph>
  )
}

export function IconContinue(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 6.5h11" />
      <path d="M4 11h7" />
      <path d="M4 15.5h5" />
      <path d="M13 15.5h7" />
      <path d="M17 12.5l3 3-3 3" />
    </Glyph>
  )
}

export function IconRewrite(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 20l1-4 9.5-9.5 3 3L8 19z" />
      <path d="M13 7.5l3 3" />
    </Glyph>
  )
}

export function IconSummarize(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4.5 7h.01M4.5 12h.01M4.5 17h.01" />
      <path d="M8 7h11" />
      <path d="M8 12h11" />
      <path d="M8 17h7" />
    </Glyph>
  )
}

export function IconTone(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M6 4v5" />
      <path d="M6 13v7" />
      <circle cx="6" cy="11" r="2" />
      <path d="M12 4v9" />
      <path d="M12 17v3" />
      <circle cx="12" cy="15" r="2" />
      <path d="M18 4v3" />
      <path d="M18 11v9" />
      <circle cx="18" cy="9" r="2" />
    </Glyph>
  )
}

export function IconTranslate(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.6 2.5 2.6 14.5 0 17" />
      <path d="M12 3.5c-2.6 2.5-2.6 14.5 0 17" />
    </Glyph>
  )
}

export function IconStop(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" />
    </Glyph>
  )
}

export function IconSend(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4.5 11.8L19.5 5l-6.2 14.5-2.7-6.1z" />
      <path d="M10.6 13.4L19.5 5" />
    </Glyph>
  )
}

export function IconReset(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4.5 8.5V4.5h4" />
      <path d="M4.9 9.2A8 8 0 1 1 4.5 13.5" />
    </Glyph>
  )
}

export function IconCheck(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M5 12.5l4.2 4.2L19 6.5" />
    </Glyph>
  )
}

export function IconX(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M6.5 6.5l11 11" />
      <path d="M17.5 6.5l-11 11" />
    </Glyph>
  )
}

export function IconChat(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4.5 6.5A2 2 0 0 1 6.5 4.5h11a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3.5V6.5z" />
      <path d="M9 9.7h.01M12 9.7h.01M15 9.7h.01" />
    </Glyph>
  )
}

export function IconWand(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4.5 19.5L14 10" />
      <path d="M13 6.2l1.4 1.4" />
      <path d="M17.5 4.5l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9z" />
    </Glyph>
  )
}

export function IconProofread(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 13.5l3 3 5.5-6" />
      <path d="M13 17.5c1-1.2 2-1.2 3 0s2 1.2 3 0" />
      <path d="M9.5 8.5L12 3.5l2.5 5" />
      <path d="M10.4 6.7h3.2" />
    </Glyph>
  )
}

export function IconDiff(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M6 4.5v6" />
      <path d="M3 7.5h6" />
      <path d="M15 16.5h6" />
      <path d="M7.5 15l-3 3 3 3" fill="none" transform="translate(0 -2)" />
    </Glyph>
  )
}

/** The CoNote brand mark: two linked note leaves forming a "C" opening. */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="brand-mark-svg"
    >
      <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#cn-g)" />
      <path
        d="M21.5 11.2a6.4 6.4 0 1 0 0 9.6"
        fill="none"
        stroke="#04140f"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="21.2" cy="16" r="2.1" fill="#04140f" />
      <defs>
        <linearGradient id="cn-g" x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#43e8c4" />
          <stop offset="1" stopColor="#1fb59a" />
        </linearGradient>
      </defs>
    </svg>
  )
}
