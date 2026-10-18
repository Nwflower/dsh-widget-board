import { createRoot } from 'react-dom/client'
import { App } from './App'

const root = document.getElementById('app')
if (root === null) throw new Error('index.html 里没有 #app')
createRoot(root).render(<App />)
