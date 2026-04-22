import { describe, expect, test } from 'bun:test'
import { DEBIAN_BASE_IMAGES } from '../src/build/base-image'

describe('DEBIAN_BASE_IMAGES', () => {
  test('pins valid SHA-512 digests for each arch', () => {
    for (const image of Object.values(DEBIAN_BASE_IMAGES)) {
      expect(image.sha512).toMatch(/^[a-f0-9]{128}$/)
    }
  })
})
