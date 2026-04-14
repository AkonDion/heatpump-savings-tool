import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/opsz.css'
import './index.css'
import { AuthProvider } from './auth'
import { Boot } from './Boot'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <Boot />
    </AuthProvider>
  </StrictMode>,
)
