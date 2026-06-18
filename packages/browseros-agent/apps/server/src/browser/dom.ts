import type { Node as CdpNode } from '@browseros/cdp-protocol/domains/dom'

export interface DomSearchResult {
  tag: string
  nodeId: number
  backendNodeId: number
  attributes: Record<string, string>
}

export function parseNodeAttributes(node: CdpNode): Record<string, string> {
  const attrs: Record<string, string> = {}
  if (!node.attributes) return attrs
  for (let i = 0; i < node.attributes.length; i += 2) {
    attrs[node.attributes[i]] = node.attributes[i + 1]
  }
  return attrs
}
