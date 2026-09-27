import React from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import Dataset from '../pages/Dataset.jsx'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Dataset />
  </React.StrictMode>,
)
