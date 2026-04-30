/**
 * Minimal client for the MolmoPoint-GUI-8B FastAPI server we run on RunPod.
 * See `molmopoint-local/molmopoint.ipynb` for the server side.
 *
 * URL is taken from BROWSEROS_MOLMOPOINT_URL (e.g.
 * https://xxxsxc97715bpw-8000.proxy.runpod.net). When unset, getClient()
 * returns null and callers should fall back.
 */

const TIMEOUT_MS = 60_000

export interface MolmoPoint {
  object_id: number
  image_num: number
  x: number
  y: number
}

export interface MolmoPredictResponse {
  points: MolmoPoint[]
  text: string
  image_size: [number, number]
}

export class MolmoPointClient {
  constructor(private readonly baseUrl: string) {}

  async predict(
    imageB64: string,
    prompt: string,
    maxNewTokens = 32,
  ): Promise<MolmoPredictResponse> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/predict`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        image_b64: imageB64,
        prompt,
        max_new_tokens: maxNewTokens,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`MolmoPoint ${res.status}: ${body.slice(0, 200)}`)
    }
    return (await res.json()) as MolmoPredictResponse
  }
}

let cached: MolmoPointClient | null | undefined

export function getMolmoPointClient(): MolmoPointClient | null {
  if (cached !== undefined) return cached
  const url = process.env.BROWSEROS_MOLMOPOINT_URL?.trim()
  cached = url ? new MolmoPointClient(url) : null
  return cached
}
