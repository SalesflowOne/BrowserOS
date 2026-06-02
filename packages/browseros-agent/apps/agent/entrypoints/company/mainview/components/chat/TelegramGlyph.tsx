import type { SVGProps } from 'react'

// Inline monochrome paperplane in the Telegram silhouette. Uses
// currentColor so callers can tone it down with text-muted-foreground
// or recolour via className. Size is driven entirely by the parent —
// no width / height defaults, only viewBox.
export function TelegramGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <path d="M21.426 2.193a1.2 1.2 0 0 0-1.244-.197L2.382 9.49c-.781.323-.78 1.43.001 1.751l4.215 1.74 2.04 6.318a1.2 1.2 0 0 0 2.022.45l2.69-2.755 4.503 3.302a1.2 1.2 0 0 0 1.886-.728l3.121-15.71a1.2 1.2 0 0 0-.434-1.165Zm-3.06 3.184-8.62 7.643a.6.6 0 0 0-.198.371l-.319 2.853-1.488-4.605 10.625-6.262Z" />
    </svg>
  )
}
