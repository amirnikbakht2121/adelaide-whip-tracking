import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://omkbvddqcojspbabibac.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ta2J2ZGRxY29qc3BiYWJpYmFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1ODA4MTUsImV4cCI6MjA4OTE1NjgxNX0.jnUgSoAoLQswCeHzn8aKpsKtSWIHn1iG27J2FC4xuSM'
)

const STATUS_CONFIG = {
  pending: { label: 'Order Received', sub: 'We\'ve received your order', icon: '📋', color: '#f59e0b' },
  preparing: { label: 'Preparing Your Order', sub: 'Your items are being packed', icon: '🧊', color: '#334FB4' },
  out_for_delivery: { label: 'On The Way', sub: 'Your driver is heading to you', icon: '🚗', color: '#334FB4' },
  arrived: { label: 'Driver Arrived', sub: 'Your driver is outside', icon: '📍', color: '#22c55e' },
  delivered: { label: 'Delivered', sub: 'Enjoy your order!', icon: '✅', color: '#22c55e' },
}

const STEPS = ['pending', 'preparing', 'out_for_delivery', 'arrived', 'delivered']

export default function App() {
  const [order, setOrder] = useState(null)
  const [driverPos, setDriverPos] = useState(null)
  const [eta, setEta] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const orderId = new URLSearchParams(window.location.search).get('order_id')

  useEffect(() => {
    if (!orderId) { setError('No order ID provided'); setLoading(false); return }

    const fetchOrder = async () => {
      const { data, error: err } = await supabase.from('orders').select('*').eq('id', orderId).single()
      if (err || !data) { setError('Order not found'); } else {
        setOrder(data)
        if (data.driver_lat && data.driver_lng) setDriverPos({ lat: data.driver_lat, lng: data.driver_lng })
      }
      setLoading(false)
    }
    fetchOrder()

    const channel = supabase
      .channel(`order-${orderId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` }, (payload) => {
        setOrder(payload.new)
        if (payload.new.driver_lat && payload.new.driver_lng) setDriverPos({ lat: payload.new.driver_lat, lng: payload.new.driver_lng })
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [orderId])

  // Realtime driver location
  useEffect(() => {
    if (!order?.assigned_driver) return
    const channel = supabase
      .channel(`driver-loc-${order.assigned_driver}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'driver_locations', filter: `email=eq.${order.assigned_driver}` }, (payload) => {
        if (payload.new.lat && payload.new.lng) setDriverPos({ lat: payload.new.lat, lng: payload.new.lng })
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [order?.assigned_driver])

  // Calculate ETA
  useEffect(() => {
    if (!driverPos || !order?.delivery_lat || !order?.delivery_lng) return
    if (order.status === 'delivered' || order.status === 'arrived') { setEta(null); return }
    const R = 6371
    const dLat = (order.delivery_lat - driverPos.lat) * Math.PI / 180
    const dLon = (order.delivery_lng - driverPos.lng) * Math.PI / 180
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(driverPos.lat * Math.PI / 180) * Math.cos(order.delivery_lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2
    const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    setEta(Math.max(1, Math.round((dist / 40) * 60)))
  }, [driverPos, order])

  if (loading) return (
    <div className="page-wrap center-content">
      <div className="spinner" />
      <p style={{ color: '#999', marginTop: 12 }}>Loading your order...</p>
    </div>
  )

  if (error) return (
    <div className="page-wrap center-content">
      <p style={{ fontSize: 48, marginBottom: 8 }}>😕</p>
      <p style={{ color: '#666', fontSize: 16 }}>{error}</p>
    </div>
  )

  const currentStep = STEPS.indexOf(order.status)
  const status = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending

  return (
    <div className="page-wrap">
      {/* Header */}
      <header className="header">
        <h1 className="logo">Adelaide Whip</h1>
        <span className="header-badge">Live Tracking</span>
      </header>

      {/* Status Card */}
      <div className="status-card" style={{ borderLeftColor: status.color }}>
        <span className="status-icon">{status.icon}</span>
        <div>
          <h2 className="status-title">{status.label}</h2>
          <p className="status-sub">{status.sub}</p>
        </div>
      </div>

      {/* ETA Card */}
      {eta && order.status === 'out_for_delivery' && (
        <div className="eta-card">
          <div className="eta-number">{eta}</div>
          <div className="eta-label">
            <span>min</span>
            <span className="eta-sub">estimated arrival</span>
          </div>
        </div>
      )}

      {order.status === 'arrived' && (
        <div className="eta-card arrived">
          <span style={{ fontSize: 28 }}>📍</span>
          <p className="arrived-text">Your driver is waiting outside</p>
        </div>
      )}

      {/* Progress Bar */}
      <div className="progress-section">
        <div className="progress-bar-bg">
          <div className="progress-bar-fill" style={{ width: `${(currentStep / (STEPS.length - 1)) * 100}%` }} />
        </div>
        <div className="progress-labels">
          {STEPS.map((step, i) => {
            const done = i <= currentStep
            const info = STATUS_CONFIG[step]
            return (
              <div key={step} className={`progress-step ${done ? 'done' : ''}`}>
                <div className="step-dot" style={done ? { background: info.color, borderColor: info.color } : {}}>
                  {done && '✓'}
                </div>
                <span className="step-label">{info.label}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Delivery Address */}
      {order.delivery_address && (
        <div className="detail-card">
          <p className="detail-title">Delivery Address</p>
          <p className="detail-value">{order.delivery_address}</p>
        </div>
      )}

      {/* Order Items */}
      <div className="detail-card">
        <p className="detail-title">Order Summary</p>
        {(order.items || []).map((item, i) => (
          <div key={i} className="item-row">
            <span className="item-qty">{item.quantity}x</span>
            <span className="item-name">{item.name}</span>
            <span className="item-price">${(item.price * item.quantity).toFixed(2)}</span>
          </div>
        ))}
        <div className="total-row">
          <span>Total</span>
          <span>${(order.total_price || order.total || 0).toFixed(2)}</span>
        </div>
      </div>

      {/* Footer */}
      <footer className="footer">
        <p>Adelaide Whip &middot; Fast Delivery Adelaide</p>
      </footer>
    </div>
  )
}
