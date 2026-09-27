import React from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import Contribute from '../pages/Contribute.jsx'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Contribute />
  </React.StrictMode>,
)
