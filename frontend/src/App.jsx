import { useMemo, useState } from 'react'
import './App.css'

const emptyForm = {
  name: '',
  email: '',
  password: '',
}

function App() {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState(emptyForm)
  const [tokens, setTokens] = useState(() => readStoredAuth())
  const [ollamaUrl, setOllamaUrl] = useState('')
  const [status, setStatus] = useState({ tone: 'idle', message: 'Ready' })
  const loggedIn = Boolean(tokens?.accessToken || tokens?.refreshToken)
  const apiOrigin = useMemo(() => window.location.origin, [])

  async function authenticate(event) {
    event.preventDefault()
    setStatus({ tone: 'busy', message: mode === 'login' ? 'Signing in...' : 'Creating account...' })

    try {
      const payload = mode === 'register'
        ? form
        : { email: form.email, password: form.password }
      const response = await apiFetch(`/api/auth/${mode}`, {
        method: 'POST',
        body: payload,
      })
      const nextTokens = {
        accessToken: response.data.accessToken || response.data.token,
        refreshToken: response.data.refreshToken || response.data.token,
        user: response.data.user,
      }

      localStorage.setItem('jarvisAuth', JSON.stringify(nextTokens))
      setTokens(nextTokens)
      setStatus({ tone: 'ok', message: 'Authenticated. Use this same account in the Jarvis CLI.' })
    } catch (error) {
      setStatus({ tone: 'error', message: error.message })
    }
  }

  async function refreshAccessToken() {
    if (!tokens?.refreshToken) {
      throw new Error('Login first so a refresh token is available.')
    }

    const response = await apiFetch('/api/auth/refresh', {
      method: 'POST',
      body: { refreshToken: tokens.refreshToken },
    })
    const nextTokens = {
      ...tokens,
      accessToken: response.data.accessToken,
    }

    localStorage.setItem('jarvisAuth', JSON.stringify(nextTokens))
    setTokens(nextTokens)
    return nextTokens.accessToken
  }

  async function publishUrl(event) {
    event.preventDefault()
    setStatus({ tone: 'busy', message: 'Publishing host URL...' })

    try {
      const accessToken = tokens?.accessToken || await refreshAccessToken()
      await apiFetch('/api/ollama-url', {
        method: 'POST',
        accessToken,
        body: { url: ollamaUrl },
      })
      setStatus({ tone: 'ok', message: 'Host URL published. The next client claim will receive it once.' })
    } catch (error) {
      setStatus({ tone: 'error', message: error.message })
    }
  }

  async function claimUrl() {
    setStatus({ tone: 'busy', message: 'Checking for a host URL...' })

    try {
      const accessToken = tokens?.accessToken || await refreshAccessToken()
      const response = await apiFetch('/api/ollama-url/claim', {
        method: 'POST',
        accessToken,
      })

      if (!response.data.available) {
        setStatus({ tone: 'idle', message: 'URL not available. Waiting for the host to provide one.' })
        return
      }

      setOllamaUrl(response.data.url)
      setStatus({ tone: 'ok', message: `Claimed temporary URL: ${response.data.url}` })
    } catch (error) {
      setStatus({ tone: 'error', message: error.message })
    }
  }

  function signOut() {
    localStorage.removeItem('jarvisAuth')
    setTokens(null)
    setStatus({ tone: 'idle', message: 'Signed out locally.' })
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Jarvis signaling</p>
          <h1>Jarvis Link</h1>
          <p className="lede">
            Login from the same hosted URL on host and client machines, then hand off the temporary Ollama tunnel through the server.
          </p>
        </div>
        <div className={`status ${status.tone}`}>{status.message}</div>
      </section>

      <section className="grid">
        <form className="panel" onSubmit={authenticate}>
          <div className="panelHeader">
            <h2>{mode === 'login' ? 'Login' : 'Register'}</h2>
            <div className="segmented">
              <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Login</button>
              <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Register</button>
            </div>
          </div>

          {mode === 'register' && (
            <label>
              Name
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} minLength={2} required />
            </label>
          )}
          <label>
            Email
            <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
          </label>
          <label>
            Password
            <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} minLength={mode === 'register' ? 6 : 1} required />
          </label>
          <button className="primary" type="submit">{mode === 'login' ? 'Login' : 'Create account'}</button>
          {loggedIn && (
            <button className="secondary" type="button" onClick={signOut}>Sign out</button>
          )}
        </form>

        <section className="panel">
          <div className="panelHeader">
            <h2>Runtime URL</h2>
            <span className={loggedIn ? 'pill ok' : 'pill'}>{loggedIn ? 'Authenticated' : 'Login required'}</span>
          </div>
          <form className="stack" onSubmit={publishUrl}>
            <label>
              Ollama tunnel URL
              <input type="url" placeholder="https://example.trycloudflare.com" value={ollamaUrl} onChange={(event) => setOllamaUrl(event.target.value)} required />
            </label>
            <button className="primary" type="submit" disabled={!loggedIn}>Publish as host</button>
          </form>
          <button className="secondary" type="button" onClick={claimUrl} disabled={!loggedIn}>Claim as client</button>
        </section>
      </section>

      <section className="details">
        <div>
          <h2>Hosted URL</h2>
          <p>{apiOrigin}</p>
        </div>
        <div>
          <h2>CLI setup</h2>
          <p>Use this origin as the Auth/server URL in both `jarvis setup` host and client mode.</p>
        </div>
      </section>
    </main>
  )
}

async function apiFetch(path, { method = 'GET', accessToken, body } = {}) {
  const response = await fetch(path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || `Request failed: ${response.status}`)
  }

  return payload
}

function readStoredAuth() {
  try {
    return JSON.parse(localStorage.getItem('jarvisAuth'))
  } catch {
    return null
  }
}

export default App
