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
  session_id?: string
  program: number[]
  trace: TraceEntry[]
  halted: boolean
  waiting_input?: boolean
  error: string | null
  outputs: Array<{ value: number; address: number }>
  final_state: CpuState
}

type ConsoleEntry = {
  kind: 'input' | 'output' | 'info' | 'error'
  text: string
}

type HintItem = {
  label: string
  value: string
  detail: string
  kind: 'opcode' | 'label' | 'value'
}

const DEFAULT_SOURCE = `CTA
STA 60
LDA 2
STA 62
LDA 1
loop:
MUL 62
STAL 70
LSA 62
CMPC 60
BEQ done
CLC
ADC 1
STA 62
LSAL 70
JMP loop
done:
LSAL 70
OTTL 70
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
      'MUL nn — A <- A * M[nn], результат сохраняется как 32-битное число',
      'MULL aa — A <- A * M[aa..aa+3], умножение на длинное число',
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
      'STAL aa — M[aa..aa+3] <- A (32-bit)',
      'LSAL aa — A <- M[aa..aa+3] (32-bit)',
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
      'CTA — выполнение ставится на паузу и приложение просит 32-битное число в консоли',
      'OTT aa — вывод значения M[aa] в консоль',
      'OTTL aa — вывод длинного 32-битного значения M[aa..aa+3]',
      'После ввода программа продолжает выполнение с того же места',
    ],
  },
]

const OPCODE_HINTS: HintItem[] = [
  { label: 'LDA', value: 'LDA', detail: 'Load accumulator with immediate 16-bit value', kind: 'opcode' },
  { label: 'LDX', value: 'LDX', detail: 'Load X register with immediate 16-bit value', kind: 'opcode' },
  { label: 'LDY', value: 'LDY', detail: 'Load Y register with immediate 16-bit value', kind: 'opcode' },
  { label: 'ADC', value: 'ADC', detail: 'Add immediate value to A with Carry', kind: 'opcode' },
  { label: 'SBC', value: 'SBC', detail: 'Subtract immediate value from A', kind: 'opcode' },
  { label: 'CMP', value: 'CMP', detail: 'Compare A with immediate value', kind: 'opcode' },
  { label: 'CPX', value: 'CPX', detail: 'Compare X with immediate value', kind: 'opcode' },
  { label: 'CMPC', value: 'CMPC', detail: 'Compare A with 16-bit value in memory', kind: 'opcode' },
  { label: 'AND', value: 'AND', detail: 'Bitwise AND with A', kind: 'opcode' },
  { label: 'ORA', value: 'ORA', detail: 'Bitwise OR with A', kind: 'opcode' },
  { label: 'EOR', value: 'EOR', detail: 'Bitwise XOR with A', kind: 'opcode' },
  { label: 'STA', value: 'STA', detail: 'Store A into 16-bit memory cell', kind: 'opcode' },
  { label: 'LSA', value: 'LSA', detail: 'Load A from 16-bit memory cell', kind: 'opcode' },
  { label: 'STAL', value: 'STAL', detail: 'Store 32-bit A into 4 memory bytes', kind: 'opcode' },
  { label: 'LSAL', value: 'LSAL', detail: 'Load 32-bit A from 4 memory bytes', kind: 'opcode' },
  { label: 'STX', value: 'STX', detail: 'Store X into memory', kind: 'opcode' },
  { label: 'LSX', value: 'LSX', detail: 'Load X from memory', kind: 'opcode' },
  { label: 'CTA', value: 'CTA', detail: 'Pause and request console input into A', kind: 'opcode' },
  { label: 'OTT', value: 'OTT', detail: 'Output a 16-bit value from memory', kind: 'opcode' },
  { label: 'OTTL', value: 'OTTL', detail: 'Output a 32-bit value from memory', kind: 'opcode' },
  { label: 'CLC', value: 'CLC', detail: 'Clear Carry flag', kind: 'opcode' },
  { label: 'CLA', value: 'CLA', detail: 'Clear all flags', kind: 'opcode' },
  { label: 'BEQ', value: 'BEQ', detail: 'Branch if Zero flag is set', kind: 'opcode' },
  { label: 'BNE', value: 'BNE', detail: 'Branch if Zero flag is clear', kind: 'opcode' },
  { label: 'BCS', value: 'BCS', detail: 'Branch if Carry flag is set', kind: 'opcode' },
  { label: 'BCC', value: 'BCC', detail: 'Branch if Carry flag is clear', kind: 'opcode' },
  { label: 'BMI', value: 'BMI', detail: 'Branch if Negative flag is set', kind: 'opcode' },
  { label: 'BPL', value: 'BPL', detail: 'Branch if Negative flag is clear', kind: 'opcode' },
  { label: 'BVS', value: 'BVS', detail: 'Branch if Overflow flag is set', kind: 'opcode' },
  { label: 'BVC', value: 'BVC', detail: 'Branch if Overflow flag is clear', kind: 'opcode' },
  { label: 'JMP', value: 'JMP', detail: 'Jump to label or absolute address', kind: 'opcode' },
  { label: 'NOP', value: 'NOP', detail: 'No operation', kind: 'opcode' },
  { label: 'BRK', value: 'BRK', detail: 'Stop program execution', kind: 'opcode' },
  { label: 'TAX', value: 'TAX', detail: 'Copy A into X', kind: 'opcode' },
  { label: 'XTA', value: 'XTA', detail: 'Copy X into A', kind: 'opcode' },
  { label: 'MUL', value: 'MUL', detail: 'Multiply A by 16-bit memory value and keep 32-bit result', kind: 'opcode' },
  { label: 'MULL', value: 'MULL', detail: 'Multiply A by 32-bit memory value', kind: 'opcode' },
  { label: 'MULM', value: 'MULM', detail: 'Multiply A and memory, write back to memory', kind: 'opcode' },
]

const BRANCH_OPS = new Set(['BEQ', 'BNE', 'BCS', 'BCC', 'BMI', 'BPL', 'BVS', 'BVC', 'JMP'])
const ADDRESS_OPS = new Set(['STA', 'LSA', 'STAL', 'LSAL', 'STX', 'LSX', 'OTT', 'OTTL', 'MUL', 'MULL', 'MULM', 'CMPC'])
const IMMEDIATE_OPS = new Set(['LDA', 'LDX', 'LDY', 'ADC', 'SBC', 'CMP', 'CPX', 'AND', 'ORA', 'EOR'])
const COMMON_ADDRESS_HINTS: HintItem[] = [
  { label: '60', value: '60', detail: 'Hex memory address example', kind: 'value' },
  { label: '62', value: '62', detail: 'Hex memory address example', kind: 'value' },
  { label: '64', value: '64', detail: 'Hex memory address example', kind: 'value' },
  { label: '66', value: '66', detail: 'Hex memory address example', kind: 'value' },
]
const COMMON_IMMEDIATE_HINTS: HintItem[] = [
  { label: '1', value: '1', detail: 'Hex immediate value example', kind: 'value' },
  { label: '5', value: '5', detail: 'Hex immediate value example', kind: 'value' },
  { label: '0A', value: '0A', detail: 'Hex immediate value example', kind: 'value' },
  { label: '10', value: '10', detail: 'Hex immediate value example', kind: 'value' },
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
    text: 'Во время CTA программа сама ставится на паузу и просит следующий hex-ввод прямо в консоли.',
    meta: 'interactive input',
  },
  {
    title: 'Educational Docs',
    text: 'Встроенная справка по регистрам, флагам, переходам и базовым инструкциям делает проект учебной платформой.',
    meta: 'learn while running',
  },
]

const HERO_SIGNALS = [
  'Python emulator core',
  'React + TypeScript workspace',
  'Interactive runtime trace',
  'Long integer support',
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
  const [maxSteps, setMaxSteps] = useState(1000)
  const [assembled, setAssembled] = useState<number[]>([])
  const [result, setResult] = useState<RunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([
    { kind: 'info', text: 'Console ready. Run the program; when CTA is reached, enter a hex value here.' },
  ])
  const [stepIndex, setStepIndex] = useState(0)
  const [hints, setHints] = useState<HintItem[]>([])
  const [hintIndex, setHintIndex] = useState(0)
  const [hintRange, setHintRange] = useState<{ start: number; end: number } | null>(null)
  const [hintPos, setHintPos] = useState<{ top: number; left: number } | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [waitingInput, setWaitingInput] = useState(false)
  const [seenOutputCount, setSeenOutputCount] = useState(0)

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

  const request = async <T,>(
    path: 'assemble' | 'run' | 'session/start' | 'session/input',
    payload: Record<string, unknown>,
  ) => {
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
    const parsed = Number.parseInt(normalized, 16)
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0xffffffff) return null
    return parsed
  }

  const pushConsoleEntry = (entry: ConsoleEntry) => {
    setConsoleEntries((prev) => [...prev, entry].slice(-400))
  }

  const addConsoleInput = () => {
    const parsed = parseConsoleNumber(consoleInput)
    if (parsed === null) {
      pushConsoleEntry({ kind: 'error', text: `Invalid input '${consoleInput}'. Use 32-bit hex: 0A, 0x0A, 1C8CFC00.` })
      return
    }

    if (!waitingInput || !sessionId) {
      pushConsoleEntry({ kind: 'info', text: 'Program is not waiting for input right now.' })
      return
    }

    void sendInteractiveInput(parsed)
  }

  const applyRunResponse = (runResult: RunResult, mode: 'start' | 'resume') => {
    setResult(runResult)
    setAssembled(runResult.program ?? [])
    setSessionId(runResult.session_id ?? null)
    setWaitingInput(Boolean(runResult.waiting_input))

    const newOutputs = runResult.outputs.slice(seenOutputCount)
    if (newOutputs.length) {
      newOutputs.forEach((output) => {
        pushConsoleEntry({
          kind: 'output',
          text: `${output.value.toString(16).toUpperCase()} (${output.value}) from ${output.address.toString(16).toUpperCase()}`,
        })
      })
    }
    setSeenOutputCount(runResult.outputs.length)

    if (runResult.waiting_input) {
      pushConsoleEntry({
        kind: 'info',
        text: mode === 'start' ? 'Program paused: enter a hex number to continue.' : 'Input consumed. Enter next value if requested.',
      })
    } else if (runResult.halted) {
      pushConsoleEntry({ kind: 'info', text: 'Run finished.' })
      setSessionId(null)
    } else if (!runResult.outputs.length && mode === 'start') {
      pushConsoleEntry({ kind: 'info', text: 'Run finished with no output.' })
    }
  }

  const sendInteractiveInput = async (value: number) => {
    try {
      pushConsoleEntry({ kind: 'input', text: `${value.toString(16).toUpperCase()} (${value})` })
      setConsoleInput('')
      const response = await request<RunResult>('session/input', {
        sessionId,
        value,
      })
      applyRunResponse(response, 'resume')
    } catch (e) {
      setError((e as Error).message)
      pushConsoleEntry({ kind: 'error', text: (e as Error).message })
    }
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
    setSessionId(null)
    setWaitingInput(false)
    setSeenOutputCount(0)
    try {
      pushConsoleEntry({ kind: 'info', text: 'Run started.' })
      const response = await request<RunResult>('session/start', {
        source,
        maxSteps,
      })
      applyRunResponse(response, 'start')
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

  const rankHints = (items: HintItem[], token: string) => {
    const normalized = token.toUpperCase()
    return items
      .map((item) => {
        const candidate = item.value.toUpperCase()
        let score = 1000
        if (!normalized) score = 0
        else if (candidate === normalized) score = 0
        else if (candidate.startsWith(normalized)) score = 1
        else if (candidate.includes(normalized)) score = 2
        else {
          let pos = 0
          let matched = true
          for (const char of normalized) {
            pos = candidate.indexOf(char, pos)
            if (pos === -1) {
              matched = false
              break
            }
            pos += 1
          }
          if (!matched) return null
          score = 3
        }
        return { item, score }
      })
      .filter((entry): entry is { item: HintItem; score: number } => entry !== null)
      .sort((a, b) => a.score - b.score || a.item.value.localeCompare(b.item.value))
      .map((entry) => entry.item)
      .slice(0, 10)
  }

  const extractLabels = (text: string): HintItem[] => {
    const labels = new Set<string>()
    text.split('\n').forEach((rawLine) => {
      const line = rawLine.split(';', 1)[0].split('#', 1)[0].trim()
      if (!line.includes(':')) return
      const label = line.split(':', 1)[0].trim()
      if (label) labels.add(label)
    })

    return Array.from(labels).map((label) => ({
      label,
      value: label,
      detail: 'Label defined in current source',
      kind: 'label',
    }))
  }

  const updateHints = (text: string, caret: number) => {
    const lineStart = text.lastIndexOf('\n', Math.max(0, caret - 1)) + 1
    const prefix = text.slice(lineStart, caret)
    const tokenStart = prefix.search(/[^\s]*$/)
    const activeToken = prefix.slice(tokenStart === -1 ? prefix.length : tokenStart)
    const leading = prefix.slice(0, tokenStart === -1 ? prefix.length : tokenStart)
    const partsBeforeToken = leading.trim().split(/\s+/).filter(Boolean)
    const opcode = (partsBeforeToken[0] ?? '').toUpperCase()
    const token = activeToken.trim()

    const isOpcodePosition = partsBeforeToken.length === 0 && !leading.includes(':')
    const labels = extractLabels(text)
    let candidateHints: HintItem[] = []

    if (isOpcodePosition) {
      candidateHints = OPCODE_HINTS
    } else if (BRANCH_OPS.has(opcode)) {
      candidateHints = labels
    } else if (ADDRESS_OPS.has(opcode)) {
      candidateHints = [...labels, ...COMMON_ADDRESS_HINTS]
    } else if (IMMEDIATE_OPS.has(opcode)) {
      candidateHints = COMMON_IMMEDIATE_HINTS
    } else if (!opcode && leading.includes(':')) {
      candidateHints = OPCODE_HINTS
    }

    const found = rankHints(candidateHints, token)

    if (!found.length) {
      setHints([])
      setHintRange(null)
      setHintPos(null)
      return
    }

    setHints(found)
    setHintIndex(0)
    setHintRange({
      start: lineStart + (tokenStart === -1 ? prefix.length : tokenStart),
      end: caret,
    })

    if (textareaRef.current) {
      const caretPos = getCaretPositionInTextarea(textareaRef.current, caret)
      const editorWidth = textareaRef.current.clientWidth
      const nextLeft = Math.min(editorWidth - 250, caretPos.left + 24)
      setHintPos({ top: Math.max(8, caretPos.top - 10), left: Math.max(8, nextLeft) })
    }
  }

  const applyHint = (hint: HintItem) => {
    if (!hintRange) return
    const before = source.slice(0, hintRange.start)
    const after = source.slice(hintRange.end)
    const needsTrailingSpace = hint.kind === 'opcode'
    const next = `${before}${hint.value}${needsTrailingSpace ? ' ' : ''}${after}`
    setSource(next)
    setHints([])
    setHintRange(null)
    setHintPos(null)

    requestAnimationFrame(() => {
      const pos = hintRange.start + hint.value.length + (needsTrailingSpace ? 1 : 0)
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(pos, pos)
    })
  }

  const memoryView = currentStep?.memory_used?.length
    ? currentStep.memory_used.map((cell) => `${formatHex(cell.address)}:${formatHex(cell.value)}`).join('  ')
    : '-'

  const bytesPreview = assembled.map((value) => formatHex(value, 2)).join(' ') || '—'
  const outputPreview = result?.outputs.length
    ? result.outputs
        .map((output) => `${formatHex(output.address)} -> ${output.value.toString(16).toUpperCase()} (${output.value})`)
        .join('\n')
    : 'No runtime output yet.'
  const activeFlags = currentStep
    ? Object.entries(currentStep.before.flags).filter(([, active]) => active).map(([flag]) => flag)
    : []

  return (
    <main className="siteShell" data-theme={theme}>
      <header className="utilityBar">
        <div className="utilityBrand">
          <span className="utilityStamp">6502</span>
          <div>
            <p className="utilityKicker">Interactive emulator studio</p>
            <h1>Assembly Workbench</h1>
          </div>
        </div>
        <div className="utilityActions">
          <span className={`statusPill ${status}`}>{status}</span>
          <button
            type="button"
            className="ghostButton"
            onClick={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}
          >
            {theme === 'light' ? 'Dark mode' : 'Light mode'}
          </button>
          <button type="button" className="ghostButton" onClick={connect}>
            Reconnect
          </button>
        </div>
      </header>

      <section className="overviewSection">
        <div className="overviewIntro">
          <p className="overviewEyebrow">MOS 6502 emulator / long integer mode / browser runtime</p>
          <h2>Write assembler like a lab experiment, not like a form.</h2>
          <p className="overviewText">
            The interface is now built as a focused workstation: code on the left, live machine
            state on the right, and the trace spread wide enough that you can actually read what
            the CPU is doing step by step.
          </p>
          <div className="heroSignals" aria-label="platform capabilities">
            {HERO_SIGNALS.map((signal) => (
              <span key={signal} className="heroSignal">
                {signal}
              </span>
            ))}
          </div>
          <div className="overviewMeta">
            <span>API {apiUrl}</span>
            <span>{waitingInput ? 'Input requested by CTA' : 'Console idle'}</span>
            <span>{result?.trace.length ?? 0} trace steps</span>
          </div>
        </div>

        <aside className="overviewTelemetry">
          <div className="telemetryGrid">
            <article className="telemetryCard">
              <span>Runtime</span>
              <strong>{result?.halted ? 'HALTED' : 'LIVE'}</strong>
            </article>
            <article className="telemetryCard">
              <span>Program bytes</span>
              <strong>{assembled.length || 0}</strong>
            </article>
            <article className="telemetryCard">
              <span>Flags</span>
              <strong>{activeFlags.join(' ') || '—'}</strong>
            </article>
          </div>
          <div className="signalBoard">
            <div className="signalBoardHeader">
              <span className="signalBoardLabel">Runtime memo</span>
              <span className="signalBoardMode">{theme}</span>
            </div>
            <pre className="signalBoardBody">
{`$ boot monitor
transport = django http api
mode = ${theme}
trace = ${result?.trace.length ?? 0} steps
waiting_input = ${waitingInput ? 'yes' : 'no'}
current_step = ${currentStep ? `${stepIndex + 1}/${result?.trace.length}` : 'idle'}

${outputPreview}`}
            </pre>
          </div>
        </aside>
      </section>

      {error ? <p className="errorBanner">{error}</p> : null}

      <section className="layoutGrid">
        <article className="workCard editorCard">
          <div className="cardHeader">
            <div>
              <p className="cardKicker">Program bay</p>
              <h3>Source editor</h3>
            </div>
            <div className="cardBadges">
              <span className="chip">autocomplete</span>
              <span className="chip">assembly</span>
            </div>
          </div>

          <div className="editorFrame">
            <div className="editorFrameBar">
              <span>program.asm</span>
              <span>{assembled.length || DEFAULT_SOURCE.length} bytes in view</span>
            </div>
            <label className="fieldLabel editorLabel">
              <span>Source code</span>
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
                onKeyUp={(e) => {
                  const target = e.currentTarget
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    updateHints(target.value, target.selectionStart)
                  }
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
                  } else if (e.key === ' ') {
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
                      key={`${hint.kind}-${hint.value}`}
                      type="button"
                      className={`hintItem ${idx === hintIndex ? 'active' : ''}`}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        applyHint(hint)
                      }}
                    >
                      <span className="hintLabel">{hint.label}</span>
                      <span className="hintDetail">{hint.detail}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </label>
          </div>

          <div className="controlBar">
            <label className="fieldLabel compactField">
              <span>Max steps</span>
              <input
                type="number"
                min={1}
                value={maxSteps}
                onChange={(e) => setMaxSteps(Number(e.target.value) || 1000)}
              />
            </label>

            <div className="actionRow">
              <button type="button" className="primaryButton" onClick={onRun}>
                Run simulation
              </button>
              <button type="button" className="ghostButton" onClick={onAssemble}>
                Assemble only
              </button>
            </div>
          </div>
        </article>

        <article className="workCard runtimeCard">
          <div className="cardHeader">
            <div>
              <p className="cardKicker">Machine side</p>
              <h3>Runtime monitor</h3>
            </div>
            <div className="cardBadges">
              <span className="chip">live state</span>
              <span className="chip">console</span>
            </div>
          </div>

          <div className="monitorGrid">
            <section className="monitorCard">
              <span className="monitorLabel">Program bytes</span>
              <pre className="monitorPre">{bytesPreview}</pre>
            </section>
            <section className="monitorCard">
              <span className="monitorLabel">Final state</span>
              <pre className="monitorPre">{formatStateLine(result?.final_state ?? null)}</pre>
            </section>
          </div>

          <section className="consoleDeck">
            <div className="consoleDeckHead">
              <div>
                <p className="cardKicker">Machine I/O</p>
                <h3>Interactive console</h3>
              </div>
              <span className={`consoleStatus ${waitingInput ? 'pending' : 'idle'}`}>
                {waitingInput ? 'awaiting input' : 'idle'}
              </span>
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
                placeholder={waitingInput ? 'enter hex input (0A / 0x0A)' : 'console waits until CTA asks for input'}
              />
              <button type="button" className="ghostButton" onClick={addConsoleInput}>
                Send
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

        <section className="workCard traceDeck">
          <div className="cardHeader">
            <div>
              <p className="cardKicker">Step inspector</p>
              <h3>Trace + occupied memory</h3>
            </div>
            <div className="traceNav">
              <button
                type="button"
                className="ghostButton traceArrow"
                onClick={() => setStepIndex((prev) => Math.max(0, prev - 1))}
                disabled={stepIndex === 0}
              >
                ←
              </button>
              <span className="traceCounter">
                {currentStep ? `step ${stepIndex + 1}/${result?.trace.length}` : 'trace idle'}
              </span>
              <button
                type="button"
                className="ghostButton traceArrow"
                onClick={() =>
                  setStepIndex((prev) => Math.min((result?.trace.length ?? 1) - 1, prev + 1))
                }
                disabled={stepIndex === (result?.trace.length ?? 1) - 1}
              >
                →
              </button>
            </div>
          </div>

          {currentStep ? (
            <div className="traceWorkspace">
              <p className="traceStatusLine">
                {currentStep.error
                  ? `ERROR: ${currentStep.error}`
                  : currentStep.halted
                    ? 'HALTED'
                    : 'RUNNING'}
              </p>

              <div className="registerWall">
                <div className="registerCard emphasis">
                  <span>A</span>
                  <strong>{formatHex(currentStep.before.A)}</strong>
                </div>
                <div className="registerCard">
                  <span>X</span>
                  <strong>{formatHex(currentStep.before.X)}</strong>
                </div>
                <div className="registerCard">
                  <span>Y</span>
                  <strong>{formatHex(currentStep.before.Y)}</strong>
                </div>
                <div className="registerCard">
                  <span>PC</span>
                  <strong>{formatHex(currentStep.before.PC)}</strong>
                </div>
                <div className="registerCard">
                  <span>OP</span>
                  <strong>{formatHex(currentStep.opcode, 2)}</strong>
                </div>
                <div className="registerCard">
                  <span>SP</span>
                  <strong>{formatHex(currentStep.before.SP, 2)}</strong>
                </div>
                <div className="registerCard">
                  <span>P</span>
                  <strong>{formatHex(currentStep.before.P, 2)}</strong>
                </div>
                <div className="registerCard">
                  <span>Cycles</span>
                  <strong>{currentStep.before.cycles}</strong>
                </div>
              </div>

              <div className="tracePanelGrid">
                <section className="tracePanelCard">
                  <h4>Flags</h4>
                  <div className="flagRail">
                    {['C', 'Z', 'N', 'V', 'I', 'D', 'B'].map((flag) => (
                      <div key={flag} className={`flagChip ${currentFlags[flag] ? 'active' : ''}`}>
                        <span>{flag}</span>
                        <strong>{currentFlags[flag] ? '1' : '0'}</strong>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="tracePanelCard">
                  <h4>Before</h4>
                  <pre>{formatStateLine(currentStep.before)}</pre>
                </section>

                <section className="tracePanelCard">
                  <h4>After</h4>
                  <pre>{formatStateLine(currentStep.after ?? null)}</pre>
                </section>

                <section className="tracePanelCard tracePanelWide">
                  <h4>Occupied memory</h4>
                  <div className="memoryContent">{memoryView}</div>
                </section>
              </div>
            </div>
          ) : (
            <div className="traceEmpty">No trace yet. Click Run to execute the current program.</div>
          )}
        </section>

        <section className="manualDeck">
          <div className="cardHeader">
            <div>
              <p className="cardKicker">Manual</p>
              <h3>Instruction reference</h3>
            </div>
            <div className="cardBadges">
              {FEATURE_CARDS.map((card) => (
                <span key={card.title} className="chip muted">
                  {card.meta}
                </span>
              ))}
            </div>
          </div>

          <div className="manualGrid">
            {INSTRUCTION_HELP.map((group) => (
              <article key={group.title} className="manualCard">
                <h4>{group.title}</h4>
                <ul>
                  {group.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  )
}

export default App
