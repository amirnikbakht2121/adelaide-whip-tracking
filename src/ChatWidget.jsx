import { useState, useEffect, useRef } from 'react'

// Anonymous, order-scoped live chat for the AdelaideWhip tracking page.
//
// The visitor has NO Supabase auth (publishable key only), so this never
// touches PostgREST or Realtime — it talks ONLY to two SECURITY DEFINER RPCs
// (mirroring how the order itself is read via get_tracking_order):
//   - post_tracking_message(order_id, body)  -> send a message (lazily creates
//                                                the thread on first send)
//   - get_tracking_messages(order_id)         -> read the masked thread
//                                                (sender shown as 'you'/'support')
//
// Replies arrive by polling every 5s WHILE THE PANEL IS OPEN (Realtime is
// anon-blocked). Staff are notified of new messages through the existing
// chat_messages webhook — no Creamers branding ever reaches this customer.
export default function ChatWidget({ supabase, orderId, active = false }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const scrollRef = useRef(null)

  // "Seen up to" timestamp, persisted per order so a returning visitor isn't
  // re-alerted to messages they've already read. Drives the launcher unread dot.
  const seenKey = orderId ? `aw_chat_seen_${orderId}` : null
  const [seenAt, setSeenAt] = useState(() => {
    try { return seenKey ? localStorage.getItem(seenKey) : null } catch { return null }
  })

  const fetchMessages = async () => {
    const { data, error: err } = await supabase.rpc('get_tracking_messages', { p_order_id: orderId })
    if (err || !Array.isArray(data)) return
    setMessages(data)
  }

  // Poll for replies. Fast (5s) while the panel is open; slower (15s) in the
  // background while it's closed, so the launcher can show an unread dot when a
  // driver messages — the visitor is anonymous, so there's no push to rely on.
  useEffect(() => {
    if (!orderId || !active) return
    let cancelled = false
    const tick = async () => { if (!cancelled) await fetchMessages() }
    tick()
    const interval = setInterval(tick, open ? 5000 : 15000)
    return () => { cancelled = true; clearInterval(interval) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderId, active])

  // Keep pinned to the newest message.
  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, open])

  // While the panel is open, everything is "seen" — advance the marker to the
  // newest message so the unread dot clears and stays clear.
  useEffect(() => {
    if (!open || messages.length === 0) return
    const latest = messages.reduce((max, m) => (m.created_at > max ? m.created_at : max), '')
    if (latest && latest !== seenAt) {
      setSeenAt(latest)
      try { if (seenKey) localStorage.setItem(seenKey, latest) } catch { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, messages])

  // Unread = any SUPPORT message newer than what we've seen (the visitor's own
  // 'you' messages never count). Drives the launcher dot while the panel is closed.
  const hasUnread = messages.some(
    m => m.role === 'support' && (!seenAt || m.created_at > seenAt)
  )

  const send = async () => {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setError(null)
    const { error: err } = await supabase.rpc('post_tracking_message', { p_order_id: orderId, p_body: body })
    setSending(false)
    if (err) { setError("Couldn't send — please try again."); return }
    setDraft('')
    fetchMessages()
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  // Only render while the order is active — hide the launcher + panel entirely
  // once the order is delivered/cancelled (requirement: chat only whilst active).
  if (!orderId || !active) return null

  return (
    <>
      {/* Launcher */}
      <button
        className="chat-launcher"
        aria-label={open ? 'Close chat' : 'Chat with us'}
        onClick={() => setOpen(o => !o)}
      >
        {open ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />
          </svg>
        )}
        {!open && hasUnread && <span className="chat-unread-dot" aria-label="New message" />}
      </button>

      {/* Panel */}
      {open && (
        <div className="chat-panel" role="dialog" aria-label="Chat with Adelaide Whip">
          <div className="chat-head">
            <div>
              <p className="chat-head-title">Chat with us</p>
              <p className="chat-head-sub">Adelaide Whip · usually replies quickly</p>
            </div>
            <button className="chat-head-close" aria-label="Close" onClick={() => setOpen(false)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <div className="chat-body" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="chat-empty">
                <p>Questions about your order?</p>
                <span>Send us a message and we'll help you out.</span>
              </div>
            ) : (
              messages.map(m => (
                <div key={m.id} className={`chat-msg ${m.role === 'you' ? 'mine' : 'theirs'}`}>
                  {m.image_url && (
                    <a href={m.image_url} target="_blank" rel="noopener noreferrer">
                      <img src={m.image_url} alt="" className="chat-msg-img" />
                    </a>
                  )}
                  {m.message && <p>{m.message}</p>}
                </div>
              ))
            )}
          </div>

          {error && <p className="chat-error">{error}</p>}

          <div className="chat-input">
            <input
              type="text"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Type a message…"
              maxLength={2000}
            />
            <button onClick={send} disabled={!draft.trim() || sending} aria-label="Send">
              {sending ? (
                <span className="chat-send-spinner" />
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
