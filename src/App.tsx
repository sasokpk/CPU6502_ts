import { useEffect, useRef, useState } from 'react'
import './App.css'

type CpuState = {
  PC: number
  A: number
  X: number
  Y: number
  SP: number
  P: number
  cycles: number
  flags: Record<string, boolean>
}

type TraceEntry = {
  step: number
  opcode: number
  before: CpuState
  after?: CpuState
  halted?: boolean
  error?: string
}

type RunResult = {
  program: number[]
  trace: TraceEntry[]
  halted: boolean
  error: string | null
  outputs: Array<{ value: number; address: number }>
  final_state: CpuState
}

const DEFAULT_SOURCE = `CTA
STA 60
ADC 1
STA 62
LDA 1
STA 64
STA 66
CLC
loop:
LSA 66
MUL 64
STA 66
LSA 64
ADC 1
STA 64
CMPC 62
BNE loop
OTT 66
BRK`

const resolveDefaultWsUrl = () => {
  const configured = import.meta.env.VITE_WS_URL
  if (configured) return configured

  if (typeof window !== 'undefined') {
    const isHttps = window.location.protocol === 'https:'
    const protocol = isHttps ? 'wss' : 'ws'
    return `${protocol}://${window.location.host}/ws`
  }

  return 'ws://127.0.0.1:8765'
}

function App() {
  const [wsUrl, setWsUrl] = useState(resolveDefaultWsUrl)
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>(
    'disconnected',
  )
  const [source, setSource] = useState(DEFAULT_SOURCE)
  const [inputs, setInputs] = useState('5')
  const [maxSteps, setMaxSteps] = useState(1000)
  const [assembled, setAssembled] = useState<number[]>([])
  const [result, setResult] = useState<RunResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const socketRef = useRef<WebSocket | null>(null)
  const pendingRef = useRef(new Map<string, (data: any) => void>())

  const connect = () => {
    socketRef.current?.close()
    setStatus('connecting')
    setError(null)

    const socket = new WebSocket(wsUrl)
    socketRef.current = socket

    socket.onopen = () => setStatus('connected')
    socket.onclose = () => setStatus('disconnected')
    socket.onerror = () => setError('WebSocket connection failed')
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data)
        const requestId = payload.id as string | undefined
        if (requestId && pendingRef.current.has(requestId)) {
          const resolve = pendingRef.current.get(requestId)!
          pendingRef.current.delete(requestId)
          resolve(payload)
          return
        }
      } catch {
        setError('Failed to parse server response')
      }
    }
  }

  useEffect(() => {
    connect()
    return () => socketRef.current?.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const request = (type: string, payload: Record<string, unknown>) =>
    new Promise<any>((resolve, reject) => {
      const socket = socketRef.current
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket is not connected'))
        return
      }

      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
      pendingRef.current.set(id, resolve)
      socket.send(JSON.stringify({ id, type, ...payload }))

      setTimeout(() => {
        if (pendingRef.current.has(id)) {
          pendingRef.current.delete(id)
          reject(new Error(`Request timeout for '${type}'`))
        }
      }, 10000)
    })

  const parseInputs = () =>
    inputs
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => Number.parseInt(v, 16))

  const onAssemble = async () => {
    setError(null)
    try {
      const response = await request('assemble', { source })
      if (response.type === 'error') throw new Error(response.error)
      setAssembled(response.program ?? [])
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const onRun = async () => {
    setError(null)
    setResult(null)
    try {
      const response = await request('run', {
        source,
        maxSteps,
        inputs: parseInputs(),
      })
      if (response.type === 'error') throw new Error(response.error)
      setResult(response as RunResult)
      setAssembled(response.program ?? [])
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const formatHex = (value: number, width = 4) => value.toString(16).toUpperCase().padStart(width, '0')

  return (
    <main className="ide">
      <header className="ideHeader">
        <div>
          <p className="kicker">6502 online workspace</p>
          <h1>CPU6502 Assembly Runner</h1>
        </div>
        <div className="headerActions">
          <button type="button" className="ghostButton" onClick={connect}>
            Reconnect
          </button>
          <span className={`status ${status}`}>{status}</span>
        </div>
      </header>

      {error ? <p className="errorBanner">{error}</p> : null}

      <section className="workspace">
        <article className="pane editorPane">
          <div className="paneHead">
            <h2>Editor</h2>
            <span className="chip">assembly</span>
          </div>

          <label className="fieldLabel">
            WS endpoint
            <input value={wsUrl} onChange={(e) => setWsUrl(e.target.value)} />
          </label>

          <label className="fieldLabel">
            Source code
            <textarea value={source} onChange={(e) => setSource(e.target.value)} rows={20} />
          </label>

          <div className="controlRow">
            <label className="fieldLabel compact">
              Inputs (hex)
              <input value={inputs} onChange={(e) => setInputs(e.target.value)} />
            </label>
            <label className="fieldLabel compact">
              Max steps
              <input
                type="number"
                min={1}
                value={maxSteps}
                onChange={(e) => setMaxSteps(Number(e.target.value) || 1000)}
              />
            </label>
          </div>

          <div className="actionRow">
            <button type="button" className="primaryButton" onClick={onRun}>
              Run
            </button>
            <button type="button" className="ghostButton" onClick={onAssemble}>
              Assemble
            </button>
          </div>
        </article>

        <article className="pane outputPane">
          <div className="paneHead">
            <h2>Output</h2>
            <span className="chip">runtime</span>
          </div>

          <div className="cardGrid">
            <section className="miniCard">
              <h3>Program bytes</h3>
              <pre>{assembled.map((x) => formatHex(x, 2)).join(' ') || '-'}</pre>
            </section>

            <section className="miniCard">
              <h3>Outputs</h3>
              <pre>
                {result?.outputs.length
                  ? result.outputs
                      .map((o) => `addr=${formatHex(o.address)} value=${formatHex(o.value)} (${o.value})`)
                      .join('\n')
                  : '-'}
              </pre>
            </section>

            <section className="miniCard">
              <h3>Final state</h3>
              <pre>{result ? JSON.stringify(result.final_state, null, 2) : '-'}</pre>
            </section>
          </div>

          <section className="traceBlock">
            <h3>Execution trace {result ? `(${result.trace.length} steps)` : ''}</h3>
            <div className="trace">
              {result?.trace.length ? (
                result.trace.slice(0, 300).map((entry) => (
                  <div key={entry.step} className="traceRow">
                    <strong>#{entry.step}</strong> op:{formatHex(entry.opcode, 2)} PC:
                    {formatHex(entry.before.PC)} A:{formatHex(entry.before.A)} X:
                    {formatHex(entry.before.X)} Y:{formatHex(entry.before.Y)}
                    {entry.error ? ` ERROR: ${entry.error}` : ''}
                    {entry.halted ? ' HALTED' : ''}
                  </div>
                ))
              ) : (
                <div className="traceEmpty">No trace yet. Click Run to execute program.</div>
              )}
            </div>
          </section>
        </article>
      </section>
    </main>
  )
}

export default App
