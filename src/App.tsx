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
  memory_used?: Array<{ address: number; value: number }>
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

type ConsoleEntry = {
  kind: 'input' | 'output' | 'info' | 'error'
  text: string
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
    title: 'Регистры CPU',
    items: [
      'A (Accumulator) — главный регистр для арифметики/логики',
      'X, Y — индексные регистры для промежуточных значений',
      'PC — счетчик команд (адрес следующей инструкции)',
      'SP — указатель стека (в этом учебном наборе почти не используется)',
      'P — флаговый регистр состояния',
    ],
  },
  {
    title: 'Флаги (P)',
    items: [
      'C (Carry) — перенос/заем после ADC/SBC/CMP/CPX/CMPC',
      'Z (Zero) — 1, если результат операции равен 0',
      'N (Negative) — 1, если установлен старший бит результата',
      'V (Overflow) — переполнение знакового диапазона',
      'I, D, B — служебные флаги (в учебной версии вторичны)',
      'CLC — принудительно сбрасывает Carry (C=0)',
    ],
  },
  {
    title: 'Загрузка регистров',
    items: [
      'LDA nn — A <- nn (16-bit immediate)',
      'LDX nn — X <- nn',
      'LDY nn — Y <- nn',
      'После загрузки обновляются Z и N',
    ],
  },
  {
    title: 'Арифметика',
    items: [
      'ADC nn — A <- A + nn + C (учитывает Carry как +1)',
      'SBC nn — A <- A - nn - (1 - C)',
      'MUL nn — A <- A * M[nn] (16-битный результат)',
      'MULM aa — M[aa] <- A * M[aa], запись обратно в память',
    ],
  },
  {
    title: 'Сравнение',
    items: [
      'CMP nn — сравнение A и nn (через A - nn, без изменения A)',
      'CPX nn — сравнение X и nn',
      'CMPC aa — сравнение A и значения из памяти M[aa]',
      'Эти команды обновляют C/Z/N и влияют на ветвления',
    ],
  },
  {
    title: 'Логика',
    items: [
      'AND nn — A <- A AND nn',
      'ORA nn — A <- A OR nn',
      'EOR nn — A <- A XOR nn',
      'После логики обновляются Z/N',
    ],
  },
  {
    title: 'Память',
    items: [
      'STA aa — M[aa] <- A (запись 16-bit значения в память)',
      'LSA aa — A <- M[aa] (чтение 16-bit из памяти)',
      'STX aa — M[aa] <- X',
      'LSX aa — X <- M[aa]',
    ],
  },
  {
    title: 'Ввод/вывод',
    items: [
      'CTA — A <- input из очереди консоли',
      'OTT aa — вывод значения M[aa] в консоль',
      'Если очередь input пуста, берется 0',
    ],
  },
  {
    title: 'Переходы (branch/jump)',
    items: [
      'BEQ label — переход если Z=1 (результат был ноль)',
      'BNE label — переход если Z=0',
      'BCS/BCC — переход по Carry (C=1/C=0)',
      'BMI/BPL — переход по знаку (N=1/N=0)',
      'BVS/BVC — переход по Overflow (V=1/V=0)',
      'JMP label/aa — безусловный переход',
      'Branch использует относительное смещение (диапазон -128..127)',
    ],
  },
  {
    title: 'Служебные и синтаксис',
    items: [
      'NOP — пустая операция (ничего не делает)',
      'BRK — завершение программы',
      'TAX / XTA — перенос между A и X',
      'label: — объявление метки',
      'Комментарии: строки с # или ; игнорируются',
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
  const [wsUrl] = useState(resolveDefaultWsUrl)
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>(
    'disconnected',
  )
  const [source, setSource] = useState(DEFAULT_SOURCE)
  const [consoleInput, setConsoleInput] = useState('')
  const [inputQueue, setInputQueue] = useState<number[]>([0x5])
  const [maxSteps, setMaxSteps] = useState(1000)
  const [assembled, setAssembled] = useState<number[]>([])
  const [result, setResult] = useState<RunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([
    { kind: 'info', text: 'Console ready. Add hex input values and press Run.' },
  ])
  const [stepIndex, setStepIndex] = useState(0)
  const [hints, setHints] = useState<string[]>([])
  const [hintIndex, setHintIndex] = useState(0)
  const [hintRange, setHintRange] = useState<{ start: number; end: number } | null>(null)
  const [hintPos, setHintPos] = useState<{ top: number; left: number } | null>(null)

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

  useEffect(() => {
    setStepIndex(0)
  }, [result?.trace.length])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!result?.trace.length) return
      if (event.key === 'ArrowLeft') {
        setStepIndex((prev) => Math.max(0, prev - 1))
      } else if (event.key === 'ArrowRight') {
        setStepIndex((prev) => Math.min(result.trace.length - 1, prev + 1))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [result?.trace.length])

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

  const parseConsoleNumber = (value: string) => {
    const raw = value.trim()
    if (!raw) return null
    const normalized = raw.toLowerCase().startsWith('0x') ? raw.slice(2) : raw
    if (!/^[0-9a-f]+$/i.test(normalized)) return null
    return Number.parseInt(normalized, 16)
  }

  const pushConsoleEntry = (entry: ConsoleEntry) => {
    setConsoleEntries((prev) => [...prev, entry].slice(-400))
  }

  const addConsoleInput = () => {
    const parsed = parseConsoleNumber(consoleInput)
    if (parsed === null) {
      pushConsoleEntry({ kind: 'error', text: `Invalid input '${consoleInput}'. Use hex: 0A or 0x0A.` })
      return
    }
    setInputQueue((prev) => [...prev, parsed & 0xffff])
    pushConsoleEntry({ kind: 'input', text: `queued ${parsed.toString(16).toUpperCase()} (${parsed})` })
    setConsoleInput('')
  }

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
      pushConsoleEntry({ kind: 'info', text: `Run started, queued inputs: ${inputQueue.length}` })
      const response = await request('run', {
        source,
        maxSteps,
        inputs: inputQueue,
      })
      if (response.type === 'error') throw new Error(response.error)
      const runResult = response as RunResult
      setResult(runResult)
      setAssembled(runResult.program ?? [])
      if (runResult.outputs.length) {
        runResult.outputs.forEach((output) => {
          pushConsoleEntry({
            kind: 'output',
            text: `${output.value.toString(16).toUpperCase()} (${output.value}) from ${output.address.toString(16).toUpperCase()}`,
          })
        })
      } else {
        pushConsoleEntry({ kind: 'info', text: 'Run finished with no output.' })
      }
    } catch (e) {
      setError((e as Error).message)
      pushConsoleEntry({ kind: 'error', text: (e as Error).message })
    }
  }

  const formatHex = (value: number, width = 4) => value.toString(16).toUpperCase().padStart(width, '0')
  const formatStateLine = (state: CpuState | null) => {
    if (!state) return '-'
    const flags = Object.entries(state.flags)
      .filter(([, active]) => active)
      .map(([flag]) => flag)
      .join('') || '-'
    return `PC:${formatHex(state.PC)} A:${formatHex(state.A)} X:${formatHex(state.X)} Y:${formatHex(state.Y)} SP:${formatHex(state.SP, 2)} P:${formatHex(state.P, 2)} CYC:${state.cycles} FL:${flags}`
  }

  const currentStep = result?.trace.length ? result.trace[stepIndex] : null

  const getCaretPositionInTextarea = (textarea: HTMLTextAreaElement, pos: number) => {
    const mirror = document.createElement('div')
    const style = window.getComputedStyle(textarea)
    const copied = [
      'fontFamily',
      'fontSize',
      'fontWeight',
      'lineHeight',
      'letterSpacing',
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
      'borderTopWidth',
      'borderRightWidth',
      'borderBottomWidth',
      'borderLeftWidth',
      'boxSizing',
      'textTransform',
      'textIndent',
      'whiteSpace',
      'wordBreak',
      'overflowWrap',
    ] as const

    mirror.style.position = 'absolute'
    mirror.style.visibility = 'hidden'
    mirror.style.whiteSpace = 'pre-wrap'
    mirror.style.wordBreak = 'break-word'
    mirror.style.overflowWrap = 'break-word'
    mirror.style.width = `${textarea.clientWidth}px`

    copied.forEach((key) => {
      mirror.style[key] = style[key]
    })

    mirror.textContent = textarea.value.slice(0, pos)
    const span = document.createElement('span')
    span.textContent = textarea.value.slice(pos) || ' '
    mirror.appendChild(span)
    document.body.appendChild(mirror)

    const coords = {
      top: span.offsetTop - textarea.scrollTop,
      left: span.offsetLeft - textarea.scrollLeft,
    }
    document.body.removeChild(mirror)
    return coords
  }

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
      setHintPos(null)
      return
    }

    const found = OPCODE_HINTS.filter((op) => op.startsWith(token)).slice(0, 8)
    if (!found.length) {
      setHints([])
      setHintRange(null)
      setHintPos(null)
      return
    }

    setHints(found)
    setHintIndex(0)
    setHintRange({ start: lineStart + (tokenMatch?.[0].length ?? 0) - token.length, end: lineStart + (tokenMatch?.[0].length ?? 0) })

    if (textareaRef.current) {
      const caretPos = getCaretPositionInTextarea(textareaRef.current, caret)
      const editorWidth = textareaRef.current.clientWidth
      const nextLeft = Math.min(editorWidth - 250, caretPos.left + 24)
      setHintPos({ top: Math.max(8, caretPos.top - 10), left: Math.max(8, nextLeft) })
    }
  }

  const applyHint = (hint: string) => {
    if (!hintRange) return
    const before = source.slice(0, hintRange.start)
    const after = source.slice(hintRange.end)
    const next = `${before}${hint} ${after}`
    setSource(next)
    setHints([])
    setHintRange(null)
    setHintPos(null)

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
                  } else if (e.key === 'Tab') {
                    e.preventDefault()
                    applyHint(hints[hintIndex])
                  } else if (e.key === 'Escape') {
                    setHints([])
                    setHintPos(null)
                  }
                }}
                rows={20}
              />
              {hints.length ? (
                <div className="hintBox" style={{ top: hintPos?.top ?? 8, left: hintPos?.left ?? 8 }}>
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

          <section className="miniCard fullWidthCard">
            <h3>Program bytes</h3>
            <pre>{assembled.map((x) => formatHex(x, 2)).join(' ') || '-'}</pre>
          </section>

          <section className="miniCard fullWidthCard slimCard">
            <h3>Final state</h3>
            <pre>{formatStateLine(result?.final_state ?? null)}</pre>
          </section>

          <section className="miniCard fullWidthCard consoleCard">
            <div className="consoleHeader">
              <h3>Console</h3>
              <span>queue: {inputQueue.length}</span>
            </div>
            <div className="consoleLog">
              {consoleEntries.map((entry, idx) => (
                <div key={`${entry.kind}-${idx}`} className={`consoleLine ${entry.kind}`}>
                  {entry.kind.toUpperCase()}: {entry.text}
                </div>
              ))}
            </div>
            <div className="consoleControls">
              <input
                value={consoleInput}
                onChange={(e) => setConsoleInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addConsoleInput()
                  }
                }}
                placeholder="hex input (0A / 0x0A)"
              />
              <button type="button" className="ghostButton" onClick={addConsoleInput}>
                Add
              </button>
              <button type="button" className="ghostButton" onClick={() => setInputQueue([])}>
                Clear Queue
              </button>
              <button type="button" className="ghostButton" onClick={() => setConsoleEntries([])}>
                Clear
              </button>
            </div>
          </section>

          <section className="traceBlock">
            {result?.trace.length && currentStep ? (
              <div className="stepper">
                <div className="stepperTop">
                  <button
                    type="button"
                    className="stepArrow"
                    onClick={() => setStepIndex((prev) => Math.max(0, prev - 1))}
                    disabled={stepIndex === 0}
                  >
                    ←
                  </button>
                  <h3>
                    STEP {stepIndex + 1}/{result.trace.length}
                  </h3>
                  <button
                    type="button"
                    className="stepArrow"
                    onClick={() => setStepIndex((prev) => Math.min(result.trace.length - 1, prev + 1))}
                    disabled={stepIndex === result.trace.length - 1}
                  >
                    →
                  </button>
                </div>

                <div className="registerGrid">
                  <div className="regBox">
                    <span>A</span>
                    <strong>{formatHex(currentStep.before.A)}</strong>
                  </div>
                  <div className="regBox">
                    <span>X</span>
                    <strong>{formatHex(currentStep.before.X)}</strong>
                  </div>
                  <div className="regBox">
                    <span>Y</span>
                    <strong>{formatHex(currentStep.before.Y)}</strong>
                  </div>
                  <div className="regBox">
                    <span>PC</span>
                    <strong>{formatHex(currentStep.before.PC)}</strong>
                  </div>
                  <div className="regBox">
                    <span>OP</span>
                    <strong>{formatHex(currentStep.opcode, 2)}</strong>
                  </div>
                </div>

                <div className="stepMeta">
                  {currentStep.halted ? 'HALTED' : 'RUNNING'}
                  {currentStep.error ? ` | ERROR: ${currentStep.error}` : ''}
                </div>

                <div className="memoryPanel">
                  <h3>MEMORY</h3>
                  <div className="memoryContent">
                    {currentStep.memory_used?.length
                      ? currentStep.memory_used
                          .map((m) => `${formatHex(m.address)}:${formatHex(m.value, 2)}`)
                          .join('  ')
                      : '-'}
                  </div>
                </div>
              </div>
            ) : (
              <div className="traceEmpty">No trace yet. Click Run to execute program.</div>
            )}
          </section>
        </article>
      </section>
    </main>
  )
}

export default App
