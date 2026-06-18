import { ChevronDown, Mic, Send, Sparkles } from 'lucide-react'
import type { FC } from 'react'
import type { Scenario } from '../types'
import type { DemoViewModel } from '../viewModel'
import { AssistantPanel } from './AssistantPanel'

interface HomeSceneProps {
  scenario: Scenario
  vm: DemoViewModel
}

export const HomeScene: FC<HomeSceneProps> = ({ scenario, vm }) => (
  <>
    <div
      style={{ flex: 1, minWidth: 0, overflowY: 'auto', position: 'relative' }}
    >
      <div
        style={{
          minHeight: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 30px',
        }}
      >
        <div style={{ width: '100%', maxWidth: 560 }}>
          <h1
            style={{
              textAlign: 'center',
              fontSize: 33,
              fontWeight: 800,
              letterSpacing: '-.025em',
              lineHeight: 1.14,
              margin: '0 0 12px',
            }}
          >
            What should your
            <br />
            agent{' '}
            <span style={{ fontStyle: 'italic', color: '#E8703A' }}>
              work on
            </span>{' '}
            next?
          </h1>
          <p
            style={{
              textAlign: 'center',
              fontSize: 14,
              color: '#6A6E73',
              margin: '0 0 22px',
              lineHeight: 1.5,
            }}
          >
            Pick BrowserOS AI or any agent, then start a task — all without
            leaving this tab.
          </p>
          <div
            style={{
              border: '1px solid #DADCDF',
              borderRadius: 18,
              background: '#fff',
              boxShadow: '0 10px 30px rgba(20,20,25,.07)',
              padding: '14px 15px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: '#FBEDE5',
                  display: 'grid',
                  placeItems: 'center',
                  flex: 'none',
                }}
              >
                <Sparkles size={14} color="#E8703A" />
              </span>
              <span style={{ flex: 1, color: '#9AA0A6', fontSize: 14 }}>
                Ask BrowserOS to handle a task…
              </span>
              <Mic size={15} color="#B6BABF" />
              <button
                type="button"
                style={{
                  width: 33,
                  height: 33,
                  border: 'none',
                  borderRadius: '50%',
                  background: '#EC8253',
                  color: '#fff',
                  display: 'grid',
                  placeItems: 'center',
                  boxShadow: '0 4px 12px rgba(232,112,58,.35)',
                }}
              >
                <Send size={14} />
              </button>
            </div>
            <div
              style={{ borderTop: '1px solid #EDEEF0', margin: '12px -15px 0' }}
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '11px 2px 1px',
                flexWrap: 'wrap',
                fontSize: 11.5,
              }}
            >
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: '#F2F3F4',
                  borderRadius: 9,
                  padding: '5px 10px',
                  fontWeight: 600,
                }}
              >
                <span
                  style={{
                    width: 13,
                    height: 13,
                    borderRadius: 4,
                    background: '#E8703A',
                    color: '#fff',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 8,
                    fontWeight: 700,
                  }}
                >
                  {scenario.agentName.charAt(0)}
                </span>
                {scenario.agentName}
                <ChevronDown size={11} color="#9AA0A6" />
              </span>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  color: '#6A6E73',
                  fontWeight: 500,
                }}
              >
                ▦ Workspace{' '}
                <span style={{ color: '#9AA0A6' }}>{scenario.workspace}</span>
              </span>
              <span style={{ marginLeft: 'auto', color: '#A6ABB0' }}>
                ↵ to run
              </span>
            </div>
          </div>
          <div
            style={{
              textAlign: 'center',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '.08em',
              color: '#9AA0A6',
              margin: '30px 0 14px',
            }}
          >
            RECENT SITES
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'center',
              gap: 14,
            }}
          >
            {scenario.recentSites.map((site) => (
              <div
                key={site.name}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 7,
                  width: 64,
                }}
              >
                <span
                  style={{
                    width: 50,
                    height: 50,
                    borderRadius: 13,
                    border: '1px solid #E7E8EA',
                    background: '#fff',
                    display: 'grid',
                    placeItems: 'center',
                    boxShadow: '0 2px 6px rgba(0,0,0,.04)',
                  }}
                >
                  <span
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      display: 'grid',
                      placeItems: 'center',
                      color: '#fff',
                      fontSize: 13,
                      fontWeight: 700,
                      background: site.color,
                    }}
                  >
                    {site.tag}
                  </span>
                </span>
                <span
                  style={{
                    fontSize: 10.5,
                    color: '#6A6E73',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: '100%',
                  }}
                >
                  {site.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>

    <AssistantPanel scenario={scenario} vm={vm} />
  </>
)
