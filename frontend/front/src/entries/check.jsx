import React from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import Check from '../pages/Check.jsx'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Check />
  </React.StrictMode>,
)
