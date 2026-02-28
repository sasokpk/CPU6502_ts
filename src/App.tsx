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

const INSTRUCTION_HELP = [
  {
    title: 'Загрузка регистров',
    items: ['LDA nn — A <- nn', 'LDX nn — X <- nn', 'LDY nn — Y <- nn'],
  },
  {
    title: 'Арифметика',
    items: ['ADC nn — A <- A + nn + C', 'SBC nn — A <- A - nn - (1 - C)', 'MUL nn — A <- A * nn'],
  },
  {
    title: 'Сравнение',
    items: ['CMP nn — flags from A - nn', 'CPX nn — flags from X - nn', 'CMPC aa — flags from A - M[aa]'],
  },
  {
    title: 'Логика',
    items: ['AND nn — A <- A AND nn', 'ORA nn — A <- A OR nn', 'EOR nn — A <- A XOR nn'],
  },
  {
    title: 'Память',
    items: ['STA aa — M[aa] <- A', 'LSA aa — A <- M[aa]', 'STX aa — M[aa] <- X', 'LSX aa — X <- M[aa]'],
  },
  {
    title: 'Ввод/вывод',
    items: ['CTA — A <- input', 'OTT aa — output M[aa]'],
  },
  {
    title: 'Переходы и служебные',
    items: [
      'BEQ/BNE/BCS/BCC/BMI/BPL/BVS/BVC label',
      'JMP label/aa',
      'CLC, NOP, BRK, TAX, label:',
    ],
  },
]

const OPCODE_HINTS = [
  'LDA',
  'LDX',
  'LDY',
  'ADC',
  'SBC',
  'CMP',
  'CPX',
  'CMPC',
  'AND',
  'ORA',
  'EOR',
  'STA',
  'LSA',
  'STX',
  'LSX',
  'CTA',
  'OTT',
  'CLC',
  'BEQ',
  'BNE',
  'BCS',
  'BCC',
  'BMI',
  'BPL',
  'BVS',
  'BVC',
  'JMP',
  'NOP',
  'BRK',
  'TAX',
  'XTA',
  'MUL',
  'MULM',
]

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
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light'
    const stored = window.localStorage.getItem('cpu6502-theme')
    return stored === 'dark' ? 'dark' : 'light'
  })
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
  const [hints, setHints] = useState<string[]>([])
  const [hintIndex, setHintIndex] = useState(0)
  const [hintRange, setHintRange] = useState<{ start: number; end: number } | null>(null)

  const socketRef = useRef<WebSocket | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
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

  useEffect(() => {
    window.localStorage.setItem('cpu6502-theme', theme)
  }, [theme])

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

  const updateHints = (text: string, caret: number) => {
    const lineStart = text.lastIndexOf('\n', Math.max(0, caret - 1)) + 1
    const lineEndIndex = text.indexOf('\n', caret)
    const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex
    const line = text.slice(lineStart, lineEnd)
    const tokenMatch = /^\s*([A-Za-z]*)/.exec(line)
    const token = (tokenMatch?.[1] ?? '').toUpperCase()

    if (!token) {
      setHints([])
      setHintRange(null)
      return
    }

    const found = OPCODE_HINTS.filter((op) => op.startsWith(token)).slice(0, 8)
    if (!found.length) {
      setHints([])
      setHintRange(null)
      return
    }

    setHints(found)
    setHintIndex(0)
    setHintRange({ start: lineStart + (tokenMatch?.[0].length ?? 0) - token.length, end: lineStart + (tokenMatch?.[0].length ?? 0) })
  }

  const applyHint = (hint: string) => {
    if (!hintRange) return
    const before = source.slice(0, hintRange.start)
    const after = source.slice(hintRange.end)
    const next = `${before}${hint} ${after}`
    setSource(next)
    setHints([])
    setHintRange(null)

    requestAnimationFrame(() => {
      const pos = hintRange.start + hint.length + 1
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(pos, pos)
    })
  }

  return (
    <main className="ide" data-theme={theme}>
      <header className="ideHeader">
        <div>
          <p className="kicker">6502 online workspace</p>
          <h1>CPU6502 Assembly Runner</h1>
        </div>
        <div className="headerActions">
          <button
            type="button"
            className="ghostButton"
            onClick={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}
          >
            {theme === 'light' ? 'Dark theme' : 'Light theme'}
          </button>
          <button type="button" className="ghostButton" onClick={connect}>
            Reconnect
          </button>
          <span className={`status ${status}`}>{status}</span>
        </div>
      </header>

      {error ? <p className="errorBanner">{error}</p> : null}

      <details className="helpPanel">
        <summary>Instruction reference (ASEMBLY.MD)</summary>
        <div className="instructionGrid">
          {INSTRUCTION_HELP.map((group) => (
            <section key={group.title} className="instructionGroup">
              <h3>{group.title}</h3>
              <ul>
                {group.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </details>

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
            <div className="editorWrap">
              <textarea
                ref={textareaRef}
                value={source}
                onChange={(e) => {
                  const next = e.target.value
                  setSource(next)
                  updateHints(next, e.target.selectionStart)
                }}
                onClick={(e) => {
                  const target = e.currentTarget
                  updateHints(target.value, target.selectionStart)
                }}
                onKeyDown={(e) => {
                  if (!hints.length) return
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setHintIndex((idx) => (idx + 1) % hints.length)
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setHintIndex((idx) => (idx - 1 + hints.length) % hints.length)
                  } else if (e.key === 'Tab' || e.key === 'Enter') {
                    e.preventDefault()
                    applyHint(hints[hintIndex])
                  } else if (e.key === 'Escape') {
                    setHints([])
                  }
                }}
                rows={20}
              />
              {hints.length ? (
                <div className="hintBox">
                  {hints.map((hint, idx) => (
                    <button
                      key={hint}
                      type="button"
                      className={`hintItem ${idx === hintIndex ? 'active' : ''}`}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        applyHint(hint)
                      }}
                    >
                      {hint}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
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
                      .map((o) => `addr=${formatHex(o.address)} \n value=${formatHex(o.value)} (${o.value})`)
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
