/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export class VmError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

export class VmNotReadyError extends VmError {}

export class VmStateCorruptedError extends VmError {}

export class LimaCommandError extends VmError {
  constructor(
    command: string,
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(`${command} failed with exit code ${exitCode}: ${stderr}`)
  }
}

export class PodmanCommandError extends VmError {
  constructor(
    command: string,
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(`${command} failed with exit code ${exitCode}: ${stderr}`)
  }
}

export class ImageLoadError extends VmError {
  constructor(
    public readonly imageRef: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`failed to load image ${imageRef}: ${message}`)
  }
}

export class ManifestMissingError extends VmError {
  constructor(public readonly manifestPath: string) {
    super(
      `VM manifest is missing at ${manifestPath}; run bun run cache:sync before starting the server`,
    )
  }
}
