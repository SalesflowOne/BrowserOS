import type { BuildProductDescriptor } from '@browseros/build-server-tools'

export const CLAW_SERVER_BUNDLE_ENTRYPOINT = 'apps/claw-server/src/main.ts'

const INLINED_ENV_VARS = ['NODE_ENV'] as const
const CI_INLINE_ENV_DEFAULTS = {
  NODE_ENV: 'production',
}

export const clawServerBuildProduct: BuildProductDescriptor = {
  label: 'BrowserOS Claw server',
  packageDir: 'apps/claw-server',
  entrypoint: CLAW_SERVER_BUNDLE_ENTRYPOINT,
  distRoot: 'dist/prod/claw-server',
  rawBinaryBaseName: 'browseros-claw-server',
  stagedBinaryBaseName: 'browseros-claw-server',
  archiveBaseName: 'browseros-claw-server-resources',
  defaultManifestPath: 'scripts/build/config/claw-server-prod-resources.json',
  env: {
    prodEnvPath: 'apps/claw-server/.env.production',
    requireProdEnvFile: false,
    requiredInlineEnvKeys: [],
    inlineEnvKeys: INLINED_ENV_VARS,
    ciInlineEnvDefaults: CI_INLINE_ENV_DEFAULTS,
    defaultR2UploadPrefix: 'claw-server/prod-resources',
  },
}
