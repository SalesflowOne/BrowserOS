/**
 * @public
 */
export interface GlowMessage {
  conversationId: string
  isActive: boolean
  showConfetti?: boolean
}

/**
 * @public
 */
export interface ClickMarkerMessage {
  type: 'click-marker'
  x: number
  y: number
}

/**
 * @public
 */
export type GlowContentMessage = GlowMessage | ClickMarkerMessage
