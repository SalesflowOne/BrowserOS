/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/** Returns no root SOUL.md context because the root Soul feature is unshipped. */
export async function readSoulPrompt(): Promise<string | undefined> {
  return undefined
}
