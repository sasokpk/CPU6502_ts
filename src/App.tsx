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
CLA
OTT 66
BRK`

const INSTRUCTION_HELP = [
  {
    title: 'Регистры CPU',
    items: [
      'A (Accumulator) — главный регистр для арифметики и логики',
      'X, Y — индексные регистры для промежуточных вычислений',
      'PC — счетчик команд, адрес следующей инструкции',
      'SP — указатель стека',
      'P — регистр флагов состояния',
    ],
  },
  {
    title: 'Флаги',
    items: [
      'C (Carry) — перенос или заем после арифметики и сравнений',
      'Z (Zero) — устанавливается, если результат равен нулю',
      'N (Negative) — отражает старший бит результата',
      'V (Overflow) — переполнение знакового диапазона',
      'CLC — вручную сбрасывает Carry перед вычислениями',
    ],
  },
  {
    title: 'Загрузка',
    items: [
      'LDA nn — A <- nn',
      'LDX nn — X <- nn',
      'LDY nn — Y <- nn',
      'После загрузки пересчитываются Z и N',
    ],
  },
  {
    title: 'Арифметика',
    items: [
      'ADC nn — A <- A + nn + C',
      'SBC nn — A <- A - nn - (1 - C)',
      'MUL nn — A <- A * M[nn]',
      'MULM aa — M[aa] <- A * M[aa]',
    ],
  },
  {
    title: 'Сравнение',
    items: [
      'CMP nn — сравнение A и nn без изменения A',
      'CPX nn — сравнение X и nn',
      'CMPC aa — сравнение A и M[aa]',
      'Результат влияет на C, Z и N',
    ],
  },
  {
    title: 'Память',
    items: [
      'STA aa — M[aa] <- A',
      'LSA aa — A <- M[aa]',
      'STX aa — M[aa] <- X',
      'LSX aa — X <- M[aa]',
    ],
  },
  {
    title: 'Переходы',
    items: [
      'BEQ / BNE — переход по Zero',
      'BCS / BCC — переход по Carry',
      'BMI / BPL — переход по Negative',
      'BVS / BVC — переход по Overflow',
      'JMP — безусловный переход',
    ],
  },
  {
    title: 'Ввод и вывод',
    items: [
      'CTA — чтение следующего значения из input-очереди',
      'OTT aa — вывод значения M[aa] в консоль',
      'Если очередь пустая, используется 0',
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

const FEATURE_CARDS = [
  {
    title: 'Assembler Playground',
    text: 'Пишите код 6502 прямо в браузере, собирайте байткод и сразу проверяйте поведение программы.',
    meta: 'code -> bytes',
  },
  {
    title: 'Live Runtime Trace',
    text: 'Следите за регистрами, opcode и занятой памятью пошагово, как в интерактивном отладчике.',
    meta: 'step / memory / flags',
  },
  {
    title: 'Console I/O',
    text: 'Подавайте hex-входы в очередь, запускайте сценарии и забирайте результаты без переключения экранов.',
    meta: 'interactive queue',
  },
  {
    title: 'Educational Docs',
    text: 'Встроенная справка по регистрам, флагам, переходам и базовым инструкциям делает проект учебной платформой.',
    meta: 'learn while running',
  },
]

const resolveDefaultApiUrl = () => {
  const configured = import.meta.env.VITE_API_URL
  if (configured) return configured

  return '/api'
}

function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'dark'
    const stored = window.localStorage.getItem('cpu6502-theme')
    return stored === 'light' ? 'light' : 'dark'
  })
  const [apiUrl] = useState(resolveDefaultApiUrl)
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

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const connect = async () => {
    setStatus('connecting')
    setError(null)

    try {
      const response = await fetch(`${apiUrl}/health`)
      if (!response.ok) {
        throw new Error(`Backend healthcheck failed (${response.status})`)
      }
      setStatus('connected')
    } catch (err) {
      setStatus('disconnected')
      setError((err as Error).message)
    }
  }

  useEffect(() => {
    void connect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    window.localStorage.setItem('cpu6502-theme', theme)
    document.documentElement.dataset.theme = theme
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

  const request = async <T,>(path: 'assemble' | 'run', payload: Record<string, unknown>) => {
    const response = await fetch(`${apiUrl}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const data = (await response.json()) as T & { error?: string }
    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status})`)
    }
    return data
  }

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
      const response = await request<{ program: number[] }>('assemble', { source })
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
      const response = await request<RunResult>('run', {
        source,
        maxSteps,
        inputs: inputQueue,
      })
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
  const currentFlags = currentStep?.before.flags ?? {}

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
    setHintRange({
      start: lineStart + (tokenMatch?.[0].length ?? 0) - token.length,
      end: lineStart + (tokenMatch?.[0].length ?? 0),
    })

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

  const memoryView = currentStep?.memory_used?.length
    ? currentStep.memory_used.map((cell) => `${formatHex(cell.address)}:${formatHex(cell.value)}`).join('  ')
    : '-'

  return (
    <main className="siteShell" data-theme={theme}>
      <header className="topbar">
        <a className="brand" href="#hero">
          <span className="brandMark">6502</span>
          <span className="brandText">Theoretical CPU Lab</span>
        </a>
        <nav className="navLinks">
          <a href="#workspace">Workspace</a>
          <a href="#modules">Modules</a>
          <a href="#docs">Reference</a>
          <a href="#about">About</a>
        </nav>
        <div className="navActions">
          <button
            type="button"
            className="ghostButton"
            onClick={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}
          >
            {theme === 'light' ? 'Dark Mode' : 'Light Mode'}
          </button>
          <button type="button" className="ghostButton" onClick={connect}>
            Reconnect
          </button>
        </div>
      </header>

      <section className="hero" id="hero">
        <div className="heroCopy">
          <p className="eyebrow">Theoretical informatics meets full-stack engineering</p>
          <h1>Explore, assemble, and step through MOS 6502 programs in the browser.</h1>
          <p className="heroText">
            CPU6502_ts combines a Python-backed emulator, a React/TypeScript workspace, and a
            live execution trace into one educational platform for low-level programming.
          </p>
          <div className="heroActions">
            <a className="primaryLink" href="#workspace">
              Get Started
            </a>
            <a className="secondaryLink" href="#modules">
              View Modules
            </a>
          </div>
          <div className="heroMeta">
            <span className={`statusPill ${status}`}>{status}</span>
            <span>API: {apiUrl}</span>
          </div>
          <div className="metricStrip">
            <article className="metricCard">
              <span>Runtime</span>
              <strong>{result?.halted ? 'HALTED' : 'LIVE'}</strong>
            </article>
            <article className="metricCard">
              <span>Program bytes</span>
              <strong>{assembled.length || 0}</strong>
            </article>
            <article className="metricCard">
              <span>Trace steps</span>
              <strong>{result?.trace.length ?? 0}</strong>
            </article>
          </div>
        </div>

        <aside className="heroTerminal" aria-label="runtime preview">
          <div className="terminalBar">
            <span />
            <span />
            <span />
          </div>
          <div className="terminalBody">
            <p className="terminalFile">cpu6502-simulator.exe</p>
            <p>$ initialize_emulator</p>
            <p>Loading MOS 6502 core...</p>
            <p>$ attach_transport</p>
            <p>protocol = Django JSON API</p>
            <p>$ runtime_snapshot</p>
            <p>program_bytes = {assembled.length || DEFAULT_SOURCE.length}</p>
            <p>queued_inputs = {inputQueue.length}</p>
            <p>trace_steps = {result?.trace.length ?? 0}</p>
            <p>mode = {theme}</p>
          </div>
        </aside>
      </section>

      {error ? <p className="errorBanner">{error}</p> : null}

      <section className="featureSection" id="modules">
        <div className="sectionHeading">
          <p className="sectionKicker">Explore Computational Models</p>
          <h2>Everything important stays visible at the same time.</h2>
          <p>
            The interface is organized like a technical simulator: source on the left, runtime on
            the right, and docs close enough that you can learn while you experiment.
          </p>
        </div>
        <div className="featureGrid">
          {FEATURE_CARDS.map((card) => (
            <article key={card.title} className="featureCard">
              <p className="featureMeta">{card.meta}</p>
              <h3>{card.title}</h3>
              <p>{card.text}</p>
              <a href="#workspace">Explore</a>
            </article>
          ))}
        </div>
      </section>

      <section className="workspaceSection" id="workspace">
        <article className="panel editorPanel">
          <div className="panelHead">
            <div>
              <p className="panelKicker">Editor</p>
              <h2>Assembly Workspace</h2>
            </div>
            <span className="tag">assembler</span>
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

          <div className="editorFooter">
            <label className="fieldLabel compactField">
              Max steps
              <input
                type="number"
                min={1}
                value={maxSteps}
                onChange={(e) => setMaxSteps(Number(e.target.value) || 1000)}
              />
            </label>

            <div className="actionRow">
              <button type="button" className="primaryButton" onClick={onRun}>
                Run Simulation
              </button>
              <button type="button" className="ghostButton" onClick={onAssemble}>
                Assemble Bytes
              </button>
            </div>
          </div>
        </article>

        <article className="panel runtimePanel">
          <div className="panelHead">
            <div>
              <p className="panelKicker">Runtime</p>
              <h2>Execution Output</h2>
            </div>
            <span className="tag">monitor</span>
          </div>

          <section className="stackCard compact">
            <h3>Program bytes</h3>
            <pre>{assembled.map((value) => formatHex(value, 2)).join(' ') || '-'}</pre>
          </section>

          <section className="stackCard compact">
            <h3>Final state</h3>
            <pre>{formatStateLine(result?.final_state ?? null)}</pre>
          </section>

          <section className="stackCard consoleCard">
            <div className="consoleHead">
              <h3>Console</h3>
              <span>queue: {inputQueue.length}</span>
            </div>
            <div className="consoleLog">
              {consoleEntries.map((entry, index) => (
                <div key={`${entry.kind}-${index}`} className={`consoleLine ${entry.kind}`}>
                  {entry.kind.toUpperCase()}: {entry.text}
                </div>
              ))}
            </div>
            <div className="consoleControls">
              <input
                value={consoleInput}
                onChange={(e) => setConsoleInput(e.target.value)}
                placeholder="hex input (0A / 0x0A)"
              />
              <button type="button" className="ghostButton" onClick={addConsoleInput}>
                Add
              </button>
              <button type="button" className="ghostButton" onClick={() => setInputQueue([])}>
                Clear Queue
              </button>
              <button
                type="button"
                className="ghostButton"
                onClick={() => setConsoleEntries([{ kind: 'info', text: 'Console cleared.' }])}
              >
                Clear
              </button>
            </div>
          </section>
        </article>

        <section className="traceCard tracePanel">
          {currentStep ? (
            <div className="stepper">
              <div className="stepperTop">
                <button
                  type="button"
                  className="stepArrow ghostButton"
                  onClick={() => setStepIndex((prev) => Math.max(0, prev - 1))}
                  disabled={stepIndex === 0}
                >
                  ←
                </button>
                <h3>STEP {stepIndex + 1}/{result?.trace.length}</h3>
                <button
                  type="button"
                  className="stepArrow ghostButton"
                  onClick={() =>
                    setStepIndex((prev) => Math.min((result?.trace.length ?? 1) - 1, prev + 1))
                  }
                  disabled={stepIndex === (result?.trace.length ?? 1) - 1}
                >
                  →
                </button>
              </div>

              <p className="stepMeta">
                {currentStep.error
                  ? `ERROR: ${currentStep.error}`
                  : currentStep.halted
                    ? 'HALTED'
                    : 'RUNNING'}
              </p>

                <div className="traceLayout">
                  <div className="traceTopRow">
                    <div className="tracePrimary">
                      <div className="registerGrid registerGridPrimary">
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

                      <div className="registerGrid registerGridSecondary">
                        <div className="regBox">
                          <span>SP</span>
                          <strong>{formatHex(currentStep.before.SP, 2)}</strong>
                        </div>
                        <div className="regBox">
                          <span>P</span>
                          <strong>{formatHex(currentStep.before.P, 2)}</strong>
                        </div>
                        <div className="regBox">
                          <span>Cycles</span>
                          <strong>{currentStep.before.cycles}</strong>
                        </div>
                      </div>
                    </div>

                    <section className="flagPanel">
                      <h3>Flags</h3>
                      <div className="flagGrid">
                        {['C', 'Z', 'N', 'V', 'I', 'D', 'B'].map((flag) => (
                          <div key={flag} className={`flagBox ${currentFlags[flag] ? 'active' : ''}`}>
                            <span>{flag}</span>
                            <strong>{currentFlags[flag] ? '1' : '0'}</strong>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>

                <div className="traceBottomRow">
                  <section className="snapshotCard">
                    <h3>Before</h3>
                    <pre>{formatStateLine(currentStep.before)}</pre>
                  </section>
                  <section className="snapshotCard">
                    <h3>After</h3>
                    <pre>{formatStateLine(currentStep.after ?? null)}</pre>
                  </section>
                  <div className="memoryPanel">
                    <h3>Memory</h3>
                    <div className="memoryContent">{memoryView}</div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="traceEmpty">No trace yet. Click Run to execute program.</div>
          )}
        </section>
      </section>

      <section className="docsSection" id="docs">
        <div className="sectionHeading narrow">
          <p className="sectionKicker">Reference</p>
          <h2>Instruction guide for the current educational ISA.</h2>
        </div>
        <div className="docsGrid">
          {INSTRUCTION_HELP.map((group) => (
            <article key={group.title} className="docCard">
              <h3>{group.title}</h3>
              <ul>
                {group.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="ctaSection" id="about">
        <div>
          <p className="sectionKicker">Ready to explore 6502?</p>
          <h2>Use the platform as a classroom demo, a self-study lab, or a portfolio project.</h2>
          <p>
            The app keeps historical CPU ideas and modern web engineering in one place: Python
            backend, Django HTTP API, React runtime, and a browser-first workflow.
          </p>
        </div>
        <div className="ctaActions">
          <a className="primaryLink" href="#workspace">
            Launch Workspace
          </a>
          <a className="secondaryLink" href="#docs">
            Study Instructions
          </a>
        </div>
      </section>

      <footer className="footer">
        <div>
          <p className="footerBrand">CPU6502_ts</p>
          <p>An interactive educational platform for studying assembler, CPU state, and runtime behavior.</p>
        </div>
        <div className="footerLinks">
          <a href="#workspace">Workspace</a>
          <a href="#modules">Modules</a>
          <a href="#docs">Reference</a>
        </div>
      </footer>
    </main>
  )
}

export default App
