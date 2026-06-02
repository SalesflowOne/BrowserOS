import type { FC } from 'react'
import { HashRouter, Navigate, Route, Routes, useParams } from 'react-router'
import { OnboardingDemo } from '../onboarding/demo/OnboardingDemo'
import { FeaturesPage } from '../onboarding/features/Features'
import { Onboarding } from '../onboarding/index/Onboarding'
import { StepsLayout } from '../onboarding/steps/StepsLayout'
import { AISettingsPage } from './ai-settings/AISettingsPage'
import { ConnectMCP } from './connect-mcp/ConnectMCP'
import { CustomizationPage } from './customization/CustomizationPage'
import { SurveyPage } from './jtbd-agent/SurveyPage'
import { AuthLayout } from './layout/AuthLayout'
import { SettingsSidebarLayout } from './layout/SettingsSidebarLayout'
import { SidebarLayout } from './layout/SidebarLayout'
import { LlmHubPage } from './llm-hub/LlmHubPage'
import { LoginPage } from './login/LoginPage'
import { LogoutPage } from './login/LogoutPage'
import { MagicLinkCallback } from './login/MagicLinkCallback'
import { MCPSettingsPage } from './mcp-settings/MCPSettingsPage'
import { ProfilePage } from './profile/ProfilePage'
import { ScheduledTasksPage } from './scheduled-tasks/ScheduledTasksPage'
import { UsagePage } from './usage/UsagePage'

function getSurveyParams(): { maxTurns?: number; experimentId?: string } {
  const params = new URLSearchParams(window.location.search)
  const maxTurnsStr = params.get('maxTurns')
  const experimentId = params.get('experimentId') ?? 'default'
  const maxTurns = maxTurnsStr ? Number.parseInt(maxTurnsStr, 10) : 7
  return { maxTurns, experimentId }
}

// The agent-company app (ported BrowserClaw) is a self-contained SPA with its
// own hash router, so we embed it in an iframe at /home rather than mounting
// it directly — two HashRouters in one document would fight over location.hash.
// The surrounding SidebarLayout keeps the BrowserOS sidebar (Home / Connect
// Apps / Scheduled Tasks / Settings), so LLM-provider and other settings stay
// reachable alongside the company workspace.
const CompanyHome: FC = () => (
  <iframe
    src="/company.html"
    title="Agent Company"
    className="h-full w-full border-0"
  />
)

const OptionsRedirect: FC = () => {
  const params = useParams()
  const path = params['*'] || ''

  const routeMap: Record<string, string> = {
    ai: '/settings/ai',
    chat: '/settings/chat',
    'connect-mcp': '/connect-apps',
    mcp: '/settings/mcp',
    customization: '/settings/customization',
    search: '/settings/ai',
    'jtbd-agent': '/settings/survey',
    scheduled: '/scheduled',
  }

  const newPath = routeMap[path] || '/settings/ai'
  return <Navigate to={newPath} replace />
}

export const App: FC = () => {
  const surveyParams = getSurveyParams()

  return (
    <HashRouter>
      <Routes>
        {/* Public auth routes */}
        <Route element={<AuthLayout />}>
          <Route path="login" element={<LoginPage />} />
          <Route path="logout" element={<LogoutPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="auth/magic-link" element={<MagicLinkCallback />} />
        </Route>

        {/* Main app with sidebar. Home is the embedded agent-company workspace. */}
        <Route element={<SidebarLayout />}>
          <Route path="home" element={<CompanyHome />} />
          <Route path="connect-apps" element={<ConnectMCP />} />
          <Route path="scheduled" element={<ScheduledTasksPage />} />
        </Route>

        {/* Settings with dedicated sidebar */}
        <Route element={<SettingsSidebarLayout />}>
          <Route path="settings">
            <Route index element={<Navigate to="/settings/ai" replace />} />
            <Route path="ai" element={<AISettingsPage key="ai" />} />
            <Route path="chat" element={<LlmHubPage />} />
            <Route path="mcp" element={<MCPSettingsPage />} />
            <Route path="customization" element={<CustomizationPage />} />
            <Route
              path="search"
              element={<Navigate to="/settings/ai" replace />}
            />
            <Route path="survey" element={<SurveyPage {...surveyParams} />} />
            <Route path="usage" element={<UsagePage />} />
            <Route path="*" element={<Navigate to="/settings/ai" replace />} />
          </Route>
        </Route>

        {/* Onboarding routes - no sidebar, no auth required */}
        <Route path="onboarding">
          <Route index element={<Onboarding />} />
          <Route path="steps/:stepId" element={<StepsLayout />} />
          <Route path="demo" element={<OnboardingDemo />} />
          <Route path="features" element={<FeaturesPage />} />
        </Route>

        {/* Backward compatibility redirects */}
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/personalize" element={<Navigate to="/home" replace />} />
        <Route
          path="/settings/connect-mcp"
          element={<Navigate to="/connect-apps" replace />}
        />
        <Route path="/audit" element={<Navigate to="/home" replace />} />
        <Route
          path="/observability"
          element={<Navigate to="/home" replace />}
        />
        <Route path="/executions" element={<Navigate to="/home" replace />} />
        <Route
          path="/agents"
          element={<Navigate to="/settings/ai?section=claude" replace />}
        />
        <Route
          path="/agents/:agentId"
          element={<Navigate to="/home" replace />}
        />
        <Route path="/options/*" element={<OptionsRedirect />} />

        {/* Fallback to home */}
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </HashRouter>
  )
}
