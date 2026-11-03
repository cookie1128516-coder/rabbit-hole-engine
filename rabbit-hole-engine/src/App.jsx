import { useRef, useState } from 'react'
import './App.css'

// The backend is local to Junior. Never put an API key in the frontend.
const API_URL = '/api/engine'

const paths = [
  { id: 'elaborate', title: 'Elaborate', subtitle: 'Learn more', description: 'Go deeper into the same subject.' },
  { id: 'discover', title: 'Discover', subtitle: 'Find something interesting', description: 'Explore a related but different idea.' },
  { id: 'resee', title: 'Re-see', subtitle: 'See it differently', description: 'Explore through a new perspective.' },
]

function checkReply(data) {
  if (!data || typeof data.answer !== 'string' || !data.answer.trim() ||
      typeof data.current_topic !== 'string' || !data.current_topic.trim() ||
      typeof data.trail_label !== 'string' || !data.trail_label.trim() ||
      !Array.isArray(data.doors) || data.doors.length !== 3 ||
      !paths.every((p) => data.doors.some((d) => d.type === p.id && typeof d.text === 'string' && d.text.trim() && typeof d.topic === 'string' && d.topic.trim()))) {
    throw new Error('The engine returned an unexpected answer format. Please retry.')
  }
  return data
}

async function askEngine(payload, signal) {
  let response
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error('Cannot reach the local engine. Check that the backend is running and that browser access is allowed.')
  }
  let data
  try {
    data = await response.json()
  } catch {
    throw new Error(`The engine returned an unreadable response (HTTP ${response.status}).`)
  }
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Engine request failed (HTTP ${response.status}).`)
  return checkReply(data)
}

function App() {
  const [question, setQuestion] = useState('')
  const [steps, setSteps] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(null)
  const requestRef = useRef(null)
  const busyRef = useRef(false)

  const current = steps.at(-1)
  const journey = steps.map((step) => ({ topic: step.topic, door: step.door }))
  const stylesUsed = steps.filter((step) => step.door === 'resee').map((step) => step.topic).slice(-20)

  async function runRequest(payload, nextStep, retryInfo) {
    if (busyRef.current) return
    busyRef.current = true
    const controller = new AbortController()
    requestRef.current = controller
    setBusy(true)
    setError('')
    setPending(retryInfo)
    try {
      const reply = await askEngine(payload, controller.signal)
      if (!controller.signal.aborted) {
        setSteps((previous) => [...previous, { ...nextStep, ...reply, topic: reply.current_topic }])
        setPending(null)
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(err.message || 'Something went wrong. Please retry.')
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null
        busyRef.current = false
        setBusy(false)
      }
    }
  }

  function startJourney(event) {
    event.preventDefault()
    const text = question.trim()
    if (!text || busyRef.current) return
    // A new question starts a fresh journey.
    setSteps([])
    const payload = { question: text, door: null, selected_prompt: null, current_topic: null, journey: [], styles_used: [] }
    runRequest(payload, { question: text, door: null }, { payload, nextStep: { question: text, door: null } })
  }

  function choosePath(path) {
    if (!current || busyRef.current) return
    const selected = current.doors.find((door) => door.type === path.id)
    if (!selected) return
    const payload = {
      question: null,
      door: selected.type,
      selected_prompt: selected.text,
      current_topic: current.current_topic,
      journey,
      styles_used: stylesUsed,
    }
    const nextStep = { question: selected.text, door: selected.type }
    runRequest(payload, nextStep, { payload, nextStep })
  }

  function restart() {
    requestRef.current?.abort()
    requestRef.current = null
    busyRef.current = false
    setBusy(false)
    setQuestion('')
    setSteps([])
    setPending(null)
    setError('')
  }

  function retry() {
    if (pending && !busyRef.current) runRequest(pending.payload, pending.nextStep, pending)
  }

  return (
    <main className="engine">
      <header>
        <p className="eyebrow">FOLLOW YOUR CURIOSITY</p>
        <h1>Rabbit Hole Engine</h1>
        <p>One question. Three doors. Endless possibilities.</p>
      </header>

      <section className="panel">
        <h2>Where shall we begin?</h2>
        <form onSubmit={startJourney}>
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask anything you're curious about..."
            rows={3}
            maxLength={500}
            aria-label="Your starting question"
            disabled={busy}
          />
          <button type="submit" disabled={busy || !question.trim()}>
            {busy && !current ? 'Exploring…' : 'Start exploring'}
          </button>
        </form>
      </section>

      {busy && <section className="panel" role="status"><p>Following your curiosity…</p></section>}
      {error && (
        <section className="panel" role="alert">
          <p className="notice">{error}</p>
          <button type="button" onClick={retry} disabled={busy || !pending}>Retry</button>
        </section>
      )}

      {current && (
        <>
          <section className="panel">
            <h2>{steps.length === 1 ? 'Your question' : current.trail_label}</h2>
            <p><strong>{current.question}</strong></p>
            <p style={{ whiteSpace: 'pre-wrap' }}>{current.answer}</p>
          </section>

          <section className="panel">
            <h2>Choose your next path</h2>
            <div className="doors">
              {paths.map((path) => {
                const door = current.doors.find((item) => item.type === path.id)
                return (
                  <button
                    key={path.id}
                    type="button"
                    className="door"
                    onClick={() => choosePath(path)}
                    disabled={busy || !door || !!error}
                  >
                    <strong>{path.title}</strong>
                    <span>{path.subtitle}</span>
                    <small>{door?.text || path.description}</small>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="panel">
            <h2>Your journey</h2>
            <ol>
              {steps.map((step, index) => (
                <li key={index}>
                  {index === 0 ? 'Start' : paths.find((p) => p.id === step.door)?.title || step.door}: {step.trail_label}
                </li>
              ))}
            </ol>
            <button type="button" onClick={restart}>Start over</button>
          </section>
        </>
      )}
    </main>
  )
}

export default App
