import { useState, useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const supabase = createClient(
  'https://omkbvddqcojspbabibac.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ta2J2ZGRxY29qc3BiYWJpYmFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1ODA4MTUsImV4cCI6MjA4OTE1NjgxNX0.jnUgSoAoLQswCeHzn8aKpsKtSWIHn1iG27J2FC4xuSM'
)

const STATUS_CONFIG = {
  pending: { label: 'Order Received', sub: 'We\'ve received your order', icon: '📋', color: '#f59e0b' },
  preparing: { label: 'Preparing Your Order', sub: 'Your items are being packed', icon: '🧊', color: '#4A7BF7' },
  out_for_delivery: { label: 'On The Way', sub: 'Your driver is heading to you', icon: '🚗', color: '#4A7BF7' },
  arrived: { label: 'Driver Arrived', sub: 'Your driver is outside', icon: '📍', color: '#22c55e' },
  delivered: { label: 'Delivered', sub: 'Enjoy your order!', icon: '✅', color: '#22c55e' },
}

const STEPS = ['pending', 'preparing', 'out_for_delivery', 'arrived', 'delivered']

const pinIcon = L.divIcon({
  html: '<div style="font-size:28px;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.6))">📍</div>',
  iconSize: [32, 32],
  iconAnchor: [16, 28],
  className: '',
})

function MapFitter({ pos }) {
  const map = useMap()
  const fitted = useRef(false)
  useEffect(() => {
    if (!fitted.current && pos) {
      map.setView([pos.lat, pos.lng], 15)
      fitted.current = true
    }
  }, [pos, map])
  return null
}

export default function App() {
  const [order, setOrder] = useState(null)
  const [driverPos, setDriverPos] = useState(null)
  const [eta, setEta] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const orderId = new URLSearchParams(window.location.search).get('order_id')

  useEffect(() => {
    if (!orderId) { setError('No order ID provided'); setLoading(false); return }

    // Tracking-page polling.
    //
    // The Adelaide Whip customer is anonymous to Supabase (no Creamers
    // account), so:
    //  - A direct `from('orders').select` is blocked by RLS (no owner match).
    //  - A Realtime `postgres_changes` subscription is ALSO blocked by RLS —
    //    Supabase Realtime applies SELECT policies before delivering events
    //    to subscribers. Anon never receives the events.
    //
    // Replacing both with a single polling loop against the
    // `get_tracking_order` SECURITY DEFINER RPC. Re-fetches every 10s while
    // the page is open; cleans up on unmount. driver_lat/lng come along in
    // the same row so we don't need a separate driver_locations channel.
    let cancelled = false

    const fetchOrder = async () => {
      const { data: rows, error: err } = await supabase.rpc('get_tracking_order', { p_order_id: orderId })
      if (cancelled) return
      const data = Array.isArray(rows) ? rows[0] : rows
      if (err || !data) { setError('Order not found'); } else {
        setOrder(data)
        if (data.driver_lat && data.driver_lng) setDriverPos({ lat: data.driver_lat, lng: data.driver_lng })
      }
      setLoading(false)
    }

    fetchOrder()
    const interval = setInterval(fetchOrder, 10000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [orderId])

  // Calculate ETA using Google Distance Matrix via Supabase edge function
  const etaTimerRef = useRef(null)
  useEffect(() => {
    if (!driverPos || !order?.delivery_lat || !order?.delivery_lng) { setEta(null); return }
    if (order.status === 'delivered' || order.status === 'arrived') { setEta(null); return }

    const fetchEta = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('getETA', {
          body: {
            originLat: driverPos.lat,
            originLng: driverPos.lng,
            destLat: order.delivery_lat,
            destLng: order.delivery_lng,
          },
        })
        if (data?.minutes) {
          setEta(data.minutes)
        }
      } catch {
        // Fallback to haversine if API fails
        const R = 6371
        const dLat = (order.delivery_lat - driverPos.lat) * Math.PI / 180
        const dLon = (order.delivery_lng - driverPos.lng) * Math.PI / 180
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(driverPos.lat * Math.PI / 180) * Math.cos(order.delivery_lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2
        const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        setEta(Math.max(1, Math.round((dist / 40) * 60)))
      }
    }

    fetchEta()
    // Refresh ETA every 30 seconds
    if (etaTimerRef.current) clearInterval(etaTimerRef.current)
    etaTimerRef.current = setInterval(fetchEta, 30000)

    return () => { if (etaTimerRef.current) clearInterval(etaTimerRef.current) }
  }, [driverPos, order])

  if (loading) return (
    <div className="page-wrap center-content">
      <div className="spinner" />
      <p style={{ color: '#666', marginTop: 12 }}>Loading your order...</p>
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
  const deliveryPos = order.delivery_lat && order.delivery_lng
    ? { lat: order.delivery_lat, lng: order.delivery_lng }
    : null

  return (
    <div className="page-wrap">
      {/* Announcement Bar */}
      <div className="announcement-bar">
        Adelaide Whip &middot; Live Order Tracking
      </div>

      {/* Header */}
      <header className="header">
        <h1 className="logo">Adelaide<span>Whip</span></h1>
        <span className="header-badge">TRACKING</span>
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
      {eta && ['out_for_delivery', 'preparing'].includes(order.status) && (
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

      {/* Map — delivery pinpoint only */}
      {deliveryPos && (
        <div className="map-container">
          <MapContainer
            center={[deliveryPos.lat, deliveryPos.lng]}
            zoom={15}
            style={{ height: '100%', width: '100%' }}
            zoomControl={false}
            attributionControl={false}
          >
            <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
            <Marker position={[deliveryPos.lat, deliveryPos.lng]} icon={pinIcon}>
              <Popup>Delivery Location</Popup>
            </Marker>
            <MapFitter pos={deliveryPos} />
          </MapContainer>
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
      <div className="detail-card" style={{ marginBottom: 20 }}>
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
