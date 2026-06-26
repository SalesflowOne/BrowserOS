/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { z } from 'zod'
import { DEFAULT_BROWSEROS_IMPORT_SOURCE_ID } from './onboarding-v2.helpers'

export const onboardingFormSchema = z.object({
  selectedSourceId: z.string().min(1, 'Pick an import source.'),
})

export type OnboardingFormValues = z.infer<typeof onboardingFormSchema>

export const onboardingFormDefaults: OnboardingFormValues = {
  selectedSourceId: DEFAULT_BROWSEROS_IMPORT_SOURCE_ID,
}
