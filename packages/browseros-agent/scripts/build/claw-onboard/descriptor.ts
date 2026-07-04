import type { AssetBuildProductDescriptor } from '@browseros/build-server-tools'

// build:chromium runs tsc, vite --mode chromium, and the WebUI contract
// verification, so the staged dist is always contract-checked before upload.
export const clawOnboardBuildProduct: AssetBuildProductDescriptor = {
  label: 'BrowserOS Claw onboarding',
  packageDir: 'apps/claw-onboard',
  buildCommand: ['bun', 'run', 'build:chromium'],
  assetsDir: 'apps/claw-onboard/dist/chromium',
  distRoot: 'dist/prod/claw-onboard',
  archiveBaseName: 'browseros-claw-onboard-resources',
  env: {
    prodEnvPath: 'apps/claw-onboard/.env.production',
    requireProdEnvFile: false,
    requiredInlineEnvKeys: [],
    inlineEnvKeys: [],
    defaultR2UploadPrefix: 'claw-onboard/prod-resources',
  },
}
