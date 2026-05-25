import { useState, useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// New Supabase publishable key — the legacy `anon` JWT (eyJ...jnUgSo...)
// that used to be here was disabled in Supabase Dashboard on 2026-05-15
// after the original .env leak, so every request was returning 401. The
// rest of the Creamers stack moved to this key on 2026-04-24; this repo
// was missed until the 2026-05-25 Shopify-customer tracking debug surfaced it.
const supabase = createClient(
  'https://omkbvddqcojspbabibac.supabase.co',
  'sb_publishable_COK1H9rVbgURqiJf-Dwkhg_Nd9jd72d'
)

// Editorial copy + Fraunces-italic-friendly headlines. The <em> portion of
// the headline renders in blue-deep italic, matching the Shopify hero treatment.
const STATUS_CONFIG = {
  pending:          { label: 'Order Received',     sub: 'We\'ve received your order',     icon: '📋', headline: ['Your order is ', 'received'] },
  preparing:        { label: 'Preparing Your Order', sub: 'Your items are being packed',  icon: '🧊', headline: ['Your order is being ', 'prepared'] },
  out_for_delivery: { label: 'On The Way',         sub: 'Your driver is heading to you',  icon: '🚗', headline: ['Your driver is ', 'on the way'] },
  arrived:          { label: 'Driver Arrived',     sub: 'Your driver is outside',          icon: '📍', headline: ['Your driver has ', 'arrived'] },
  delivered:        { label: 'Delivered',          sub: 'Enjoy your order',                icon: '✅', headline: ['Your order has been ', 'delivered'] },
}

const STEPS = ['pending', 'preparing', 'out_for_delivery', 'arrived', 'delivered']
const STEP_LABELS = {
  pending: 'Received',
  preparing: 'Preparing',
  out_for_delivery: 'On the Way',
  arrived: 'Arrived',
  delivered: 'Delivered',
}

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

// Background drifting clouds — matches the Shopify hero's atmospheric layer.
// Soft blurred ovals, slow drift loop, fixed behind everything.
function CloudBackground() {
  return (
    <div className="cloud-bg" aria-hidden="true">
      <div className="cloud c1" />
      <div className="cloud c2" />
      <div className="cloud c3" />
    </div>
  )
}

export default function App() {
  const [order, setOrder] = useState(null)
  // No driverPos state — driver coordinates are never sent to the client.
  // ETA comes from getTrackingEta which does the route calc server-side.
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
      }
      setLoading(false)
    }

    fetchOrder()
    const interval = setInterval(fetchOrder, 10000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [orderId])

  // Live ETA via the server-side `getTrackingEta` edge function. The fn
  // resolves driver position internally (from driver_locations), falls
  // back to warehouse position when the driver isn't out yet, and returns
  // just the minutes — driver coordinates never reach this page.
  const etaTimerRef = useRef(null)
  useEffect(() => {
    if (!order?.id) { setEta(null); return }
    // No ETA on terminal / arrived states
    if (['delivered', 'cancelled', 'arrived'].includes(order.status)) { setEta(null); return }

    const fetchEta = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('getTrackingEta', {
          body: { order_id: order.id },
        })
        if (!error && data?.minutes) {
          setEta(data.minutes)
        }
      } catch { /* network blip — keep last ETA */ }
    }

    fetchEta()
    // Refresh ETA every 30s — slow enough to be polite to Google's
    // Distance Matrix billing, fast enough to feel live.
    if (etaTimerRef.current) clearInterval(etaTimerRef.current)
    etaTimerRef.current = setInterval(fetchEta, 30000)

    return () => { if (etaTimerRef.current) clearInterval(etaTimerRef.current) }
  }, [order?.id, order?.status])

  if (loading) return (
    <div className="page-wrap center-content">
      <CloudBackground />
      <div className="spinner" />
      <p style={{ color: 'var(--ink-soft)', marginTop: 16, fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
        Loading your order
      </p>
    </div>
  )

  if (error) return (
    <div className="page-wrap center-content">
      <CloudBackground />
      <p style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', fontSize: 32, fontWeight: 300, color: 'var(--ink)', marginBottom: 12 }}>
        Sorry —
      </p>
      <p style={{ color: 'var(--ink-soft)', fontSize: 14, maxWidth: 280, textAlign: 'center', lineHeight: 1.5 }}>
        {error}
      </p>
    </div>
  )

  const currentStep = STEPS.indexOf(order.status)
  const status = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending
  const deliveryPos = order.delivery_lat && order.delivery_lng
    ? { lat: order.delivery_lat, lng: order.delivery_lng }
    : null
  const isArrived = order.status === 'arrived'
  const isTerminal = order.status === 'delivered' || order.status === 'cancelled'

  return (
    <div className="page-wrap">
      <CloudBackground />

      <div className="announcement-bar">
        Adelaide Whip <span className="dot">·</span> Live Tracking
      </div>

      <header className="header">
        {/* Brand logo PNG ("Let's get adelaide whip" cursive) — file is in
            public/logo.png; Vite serves it at the site root. */}
        <img src="/logo.png" alt="Adelaide Whip" className="logo-img" />
        <span className="header-badge">Order</span>
      </header>

      {/* Editorial hero — eyebrow, Fraunces headline with italic emphasis */}
      <section className="hero">
        <div className="eyebrow">
          Your Order <span className="d">·</span> {STEP_LABELS[order.status] || 'Tracking'}
        </div>
        <h1>
          {status.headline[0]}<em>{status.headline[1]}</em>
        </h1>
        <p className="subhead">{status.sub}</p>
      </section>

      {/* ETA card — only while pre-arrival */}
      {eta && !isArrived && !isTerminal && (
        <div className="eta-card">
          <div className="eta-number">{eta}</div>
          <div className="eta-label">
            <span className="unit">min</span>
            <span className="sub">Estimated Arrival</span>
          </div>
        </div>
      )}

      {/* Arrived card — dark ink with banner-accent yellow text */}
      {isArrived && (
        <div className="eta-card arrived">
          <span className="arrived-icon">📍</span>
          <p className="arrived-text">Your driver is <em>outside</em></p>
        </div>
      )}

      {/* Status row */}
      <div className="status-card">
        <span className="status-icon">{status.icon}</span>
        <div>
          <div className="status-title">{status.label}</div>
          <p className="status-sub">{status.sub}</p>
        </div>
      </div>

      {/* Progress steps */}
      <div className="progress-section">
        <div className="progress-bar-bg">
          <div className="progress-bar-fill" style={{ width: `${(currentStep / (STEPS.length - 1)) * 100}%` }} />
        </div>
        <div className="progress-labels">
          {STEPS.map((step, i) => {
            const done = i <= currentStep
            return (
              <div key={step} className={`progress-step ${done ? 'done' : ''}`}>
                <div className="step-dot">{done && '✓'}</div>
                <span className="step-label">{STEP_LABELS[step]}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Map — delivery pinpoint only. Light-themed Carto tiles match the
          sky/cream palette; dark map clashed visually. */}
      {deliveryPos && (
        <div className="map-container">
          <MapContainer
            center={[deliveryPos.lat, deliveryPos.lng]}
            zoom={15}
            style={{ height: '100%', width: '100%' }}
            zoomControl={false}
            attributionControl={false}
          >
            <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
            <Marker position={[deliveryPos.lat, deliveryPos.lng]} icon={pinIcon}>
              <Popup>Delivery Location</Popup>
            </Marker>
            <MapFitter pos={deliveryPos} />
          </MapContainer>
        </div>
      )}

      {/* Delivery Address */}
      {order.delivery_address && (
        <div className="detail-card">
          <p className="detail-title">Delivery To</p>
          <p className="detail-value">{order.delivery_address}</p>
        </div>
      )}

      {/* Order Items — no prices on tracking. Customer already paid; the
          confirmation email/Shopify receipt has the financial detail. The
          tracking page is for delivery progress, not re-litigating spend. */}
      <div className="detail-card">
        <p className="detail-title">Your Order</p>
        {(order.items || []).map((item, i) => (
          <div key={i} className="item-row">
            <span className="item-qty">{item.quantity}×</span>
            <span className="item-name">{item.name}</span>
          </div>
        ))}
      </div>

      <footer className="footer">
        <p>Adelaide Whip <span className="d">·</span> Fast Delivery Adelaide</p>
      </footer>
    </div>
  )
}
