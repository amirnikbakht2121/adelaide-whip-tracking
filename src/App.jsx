import { useState, useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const supabase = createClient(
  'https://omkbvddqcojspbabibac.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ta2J2ZGRxY29qc3BiYWJpYmFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc3MDkxODUsImV4cCI6MjA1MzI4NTE4NX0.qC9OIKI4a6bCkNFSpG0n1s0m0J3IcrhXshTAVnZbcdk'
)

const STATUS_LABELS = {
  pending: { label: 'Order Received', color: '#f59e0b', icon: '📋' },
  preparing: { label: 'Preparing', color: '#3b82f6', icon: '🧊' },
  out_for_delivery: { label: 'On The Way', color: '#8b5cf6', icon: '🚗' },
  arrived: { label: 'Driver Arrived', color: '#10b981', icon: '📍' },
  delivered: { label: 'Delivered', color: '#22c55e', icon: '✅' },
}

const STEPS = ['pending', 'preparing', 'out_for_delivery', 'arrived', 'delivered']

const carIcon = L.divIcon({
  html: '<div style="font-size:28px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))">🚗</div>',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
  className: '',
})

const pinIcon = L.divIcon({
  html: '<div style="font-size:28px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))">📍</div>',
  iconSize: [32, 32],
  iconAnchor: [16, 28],
  className: '',
})

function MapUpdater({ driverPos, deliveryPos }) {
  const map = useMap()
  const fitted = useRef(false)

  useEffect(() => {
    if (!fitted.current && driverPos && deliveryPos) {
      const bounds = L.latLngBounds([
        [driverPos.lat, driverPos.lng],
        [deliveryPos.lat, deliveryPos.lng],
      ])
      map.fitBounds(bounds, { padding: [60, 60] })
      fitted.current = true
    } else if (!fitted.current && deliveryPos) {
      map.setView([deliveryPos.lat, deliveryPos.lng], 14)
      fitted.current = true
    }
  }, [driverPos, deliveryPos, map])

  return null
}

export default function App() {
  const [order, setOrder] = useState(null)
  const [driverPos, setDriverPos] = useState(null)
  const [eta, setEta] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const orderId = new URLSearchParams(window.location.search).get('order_id')

  // Fetch order
  useEffect(() => {
    if (!orderId) {
      setError('No order ID provided')
      setLoading(false)
      return
    }

    const fetchOrder = async () => {
      const { data, error: err } = await supabase
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .single()

      if (err || !data) {
        setError('Order not found')
      } else {
        setOrder(data)
        if (data.driver_lat && data.driver_lng) {
          setDriverPos({ lat: data.driver_lat, lng: data.driver_lng })
        }
      }
      setLoading(false)
    }

    fetchOrder()

    // Realtime subscription for order updates
    const channel = supabase
      .channel(`order-${orderId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
        filter: `id=eq.${orderId}`,
      }, (payload) => {
        setOrder(payload.new)
        if (payload.new.driver_lat && payload.new.driver_lng) {
          setDriverPos({ lat: payload.new.driver_lat, lng: payload.new.driver_lng })
        }
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [orderId])

  // Realtime driver location from driver_locations table
  useEffect(() => {
    if (!order?.assigned_driver) return

    const channel = supabase
      .channel(`driver-loc-${order.assigned_driver}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'driver_locations',
        filter: `email=eq.${order.assigned_driver}`,
      }, (payload) => {
        if (payload.new.lat && payload.new.lng) {
          setDriverPos({ lat: payload.new.lat, lng: payload.new.lng })
        }
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [order?.assigned_driver])

  // Calculate ETA
  useEffect(() => {
    if (!driverPos || !order?.delivery_lat || !order?.delivery_lng) return
    if (order.status === 'delivered' || order.status === 'arrived') return

    const R = 6371
    const dLat = (order.delivery_lat - driverPos.lat) * Math.PI / 180
    const dLon = (order.delivery_lng - driverPos.lng) * Math.PI / 180
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(driverPos.lat * Math.PI / 180) * Math.cos(order.delivery_lat * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2
    const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    const mins = Math.max(1, Math.round((dist / 40) * 60)) // ~40km/h avg
    setEta(mins)
  }, [driverPos, order])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', flexDirection: 'column', gap: 16 }}>
        <div style={{ width: 40, height: 40, border: '3px solid #333', borderTopColor: '#8b5cf6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <p style={{ color: '#888' }}>Loading order...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 48 }}>😕</p>
        <p style={{ color: '#888', fontSize: 18 }}>{error}</p>
      </div>
    )
  }

  const currentStep = STEPS.indexOf(order.status)
  const statusInfo = STATUS_LABELS[order.status] || STATUS_LABELS.pending
  const deliveryPos = order.delivery_lat && order.delivery_lng
    ? { lat: order.delivery_lat, lng: order.delivery_lng }
    : null
  const showMap = deliveryPos && ['out_for_delivery', 'arrived'].includes(order.status)

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid #222' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Adelaide Whip</h1>
        <p style={{ fontSize: 13, color: '#888' }}>Order Tracking</p>
      </div>

      {/* Status Banner */}
      <div style={{
        margin: '16px 20px',
        padding: '16px 20px',
        borderRadius: 16,
        background: `${statusInfo.color}15`,
        border: `1px solid ${statusInfo.color}30`,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
      }}>
        <span style={{ fontSize: 32 }}>{statusInfo.icon}</span>
        <div>
          <p style={{ fontSize: 18, fontWeight: 700, color: statusInfo.color }}>{statusInfo.label}</p>
          {eta && order.status === 'out_for_delivery' && (
            <p style={{ fontSize: 13, color: '#aaa', marginTop: 2 }}>Estimated arrival: ~{eta} min</p>
          )}
          {order.status === 'arrived' && (
            <p style={{ fontSize: 13, color: '#aaa', marginTop: 2 }}>Your driver is waiting outside</p>
          )}
        </div>
      </div>

      {/* Progress Steps */}
      <div style={{ padding: '0 20px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
          {STEPS.map((step, i) => {
            const done = i <= currentStep
            const info = STATUS_LABELS[step]
            return (
              <div key={step} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                {i > 0 && (
                  <div style={{
                    position: 'absolute',
                    top: 12,
                    left: '-50%',
                    right: '50%',
                    height: 3,
                    borderRadius: 2,
                    background: done ? info.color : '#333',
                    transition: 'background 0.5s',
                  }} />
                )}
                <div style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: done ? info.color : '#222',
                  border: `2px solid ${done ? info.color : '#444'}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  color: done ? '#fff' : '#666',
                  position: 'relative',
                  zIndex: 1,
                  transition: 'all 0.5s',
                }}>
                  {done ? '✓' : i + 1}
                </div>
                <p style={{ fontSize: 9, color: done ? '#ccc' : '#555', marginTop: 6, textAlign: 'center', lineHeight: 1.2 }}>
                  {info.label}
                </p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Map */}
      {showMap && (
        <div style={{ margin: '0 20px 16px', borderRadius: 16, overflow: 'hidden', height: 280, border: '1px solid #222' }}>
          <MapContainer
            center={deliveryPos ? [deliveryPos.lat, deliveryPos.lng] : [-34.9285, 138.6007]}
            zoom={14}
            style={{ height: '100%', width: '100%' }}
            zoomControl={false}
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution=""
            />
            {driverPos && (
              <Marker position={[driverPos.lat, driverPos.lng]} icon={carIcon}>
                <Popup>Driver</Popup>
              </Marker>
            )}
            {deliveryPos && (
              <Marker position={[deliveryPos.lat, deliveryPos.lng]} icon={pinIcon}>
                <Popup>Delivery Location</Popup>
              </Marker>
            )}
            <MapUpdater driverPos={driverPos} deliveryPos={deliveryPos} />
          </MapContainer>
        </div>
      )}

      {/* Order Details */}
      <div style={{ padding: '0 20px', marginBottom: 20 }}>
        <div style={{
          padding: '16px',
          borderRadius: 16,
          background: '#111',
          border: '1px solid #222',
        }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#888', marginBottom: 12 }}>Order Details</p>

          {order.delivery_address && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 14 }}>📍</span>
              <p style={{ fontSize: 13, color: '#ccc', lineHeight: 1.4 }}>{order.delivery_address}</p>
            </div>
          )}

          {(order.items || []).map((item, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: i > 0 ? '1px solid #1a1a1a' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: '#666', minWidth: 20 }}>{item.quantity}x</span>
                <p style={{ fontSize: 13, color: '#ddd' }}>{item.name}</p>
              </div>
              <p style={{ fontSize: 13, color: '#888' }}>${(item.price * item.quantity).toFixed(2)}</p>
            </div>
          ))}

          <div style={{ borderTop: '1px solid #222', marginTop: 8, paddingTop: 10, display: 'flex', justifyContent: 'space-between' }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Total</p>
            <p style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>${(order.total_price || order.total || 0).toFixed(2)}</p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ marginTop: 'auto', padding: '16px 20px', borderTop: '1px solid #1a1a1a', textAlign: 'center' }}>
        <p style={{ fontSize: 11, color: '#444' }}>Adelaide Whip · Fast Delivery Adelaide</p>
      </div>
    </div>
  )
}
