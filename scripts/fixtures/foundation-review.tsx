import { createRoot } from 'react-dom/client'
import { Workspace } from '../../src/workspace'
import '../../src/styles.css'

createRoot(document.getElementById('root')!).render(
  <>
    <div
      style={{
        position: 'fixed',
        right: 12,
        bottom: 10,
        zIndex: 100,
        background: '#fff5db',
        color: '#5d4310',
        border: '1px solid #b28b38',
        padding: '8px 12px',
        borderRadius: 5,
        font: '12px system-ui',
        maxWidth: '80vw',
      }}
    >
      Synthetic visual review · read-only · no production connection
    </div>
    <Workspace />
  </>,
)
