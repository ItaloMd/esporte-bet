import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { captureUtmParams } from '@/lib/utmCapture'

captureUtmParams()

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)