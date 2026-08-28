import { AuthProvider }   from '@/context/AuthContext'
import { SocketProvider } from '@/context/SocketContext'
import { AlertsProvider } from '@/context/AlertsContext'
import { AppRouter }      from '@/router'

export default function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <AlertsProvider>
          <AppRouter />
        </AlertsProvider>
      </SocketProvider>
    </AuthProvider>
  )
}
