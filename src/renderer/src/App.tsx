import { useLocation } from 'react-router-dom'
import KeyboardPage from './components/KeyboardPage'

function App(): JSX.Element {
  const location = useLocation()

  if (location.pathname === '/keyboard') {
    return <KeyboardPage />
  }

  return <div />
}

export default App
