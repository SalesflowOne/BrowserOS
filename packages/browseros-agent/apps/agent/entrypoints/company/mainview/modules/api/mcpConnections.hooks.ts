import type { InferRequestType, InferResponseType } from 'hono/client'
import { createMutation } from 'react-query-kit'
import { api } from './client'
import { parseResponse } from './parseResponse'

const $connect = api.api.mcp.connect.$post
const $submitApiKey = api.api.mcp['submit-api-key'].$post

type ConnectResponse = Exclude<
  InferResponseType<typeof $connect>,
  { error: string }
>
type ConnectInput = InferRequestType<typeof $connect>['json']
type SubmitApiKeyResponse = Exclude<
  InferResponseType<typeof $submitApiKey>,
  { error: string }
>
type SubmitApiKeyInput = InferRequestType<typeof $submitApiKey>['json']

// Both mutations hit the main-process Hono proxy at /api/mcp/*; that
// route forwards to BrowserOS's /klavis/servers/* on the user's
// configured BrowserOS base URL. See main/routes/mcp-connections.ts.

export const useConnectToolkit = createMutation<ConnectResponse, ConnectInput>({
  mutationFn: (json) => $connect({ json }).then(parseResponse<ConnectResponse>),
})

export const useSubmitToolkitApiKey = createMutation<
  SubmitApiKeyResponse,
  SubmitApiKeyInput
>({
  mutationFn: (json) =>
    $submitApiKey({ json }).then(parseResponse<SubmitApiKeyResponse>),
})
