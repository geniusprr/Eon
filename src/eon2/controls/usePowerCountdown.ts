import { useEffect, useState } from 'react'

export function usePowerCountdown(targetAt: number | undefined) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (targetAt === undefined) return
    let timeout: number | undefined
    const schedule = () => {
      const remaining = targetAt - Date.now()
      if (remaining <= 0) return
      timeout = window.setTimeout(() => {
        setTick(value => value + 1)
        schedule()
      }, remaining % 1000 || 1000)
    }
    schedule()
    return () => window.clearTimeout(timeout)
  }, [targetAt])

  const seconds = Math.ceil(((targetAt ?? 0) - Date.now()) / 1000)
  if (seconds <= 0) return null
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const clock = `${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  return hours ? `${hours}:${clock}` : clock
}
