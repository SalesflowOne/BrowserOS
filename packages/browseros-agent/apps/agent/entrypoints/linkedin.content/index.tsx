import ReactDOM from 'react-dom/client'
import './content-script.styles.css'
import { ContentChatApp } from './ContentChatApp'

export default defineContentScript({
  matches: ['*://*.linkedin.com/*'],
  cssInjectionMode: 'ui',
  runAt: 'document_idle',
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'browseros-linkedin-chat',
      mode: 'closed',
      position: 'overlay',
      anchor: 'html',
      onMount(uiContainer) {
        const app = document.createElement('div')
        app.className = 'root'
        uiContainer.append(app)
        const root = ReactDOM.createRoot(app)
        root.render(<ContentChatApp />)
        return root
      },
      onRemove(root) {
        root?.unmount()
      },
    })
    ui.mount()
  },
})
