import React from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import DataCatalog from '../pages/DataCatalog.jsx'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <DataCatalog />
  </React.StrictMode>,
)
