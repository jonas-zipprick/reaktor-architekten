import { useEffect } from 'react'
import { useGame } from '../state/gameStore'

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

/** Global playtest hotkeys. */
export function useHotkeys() {
  const nextPhase = useGame((s) => s.nextPhase)
  const undo = useGame((s) => s.undo)
  const setTool = useGame((s) => s.setTool)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
        return
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return

      const key = e.key.toLowerCase()
      if (key === 'a') {
        e.preventDefault()
        setTool('select')
        return
      }
      if (key === 'b') {
        e.preventDefault()
        setTool('place')
        return
      }
      if (key === 'e') {
        e.preventDefault()
        setTool('remove')
        return
      }
      if (key === 'g') {
        e.preventDefault()
        setTool('fee')
        return
      }

      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        nextPhase()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [nextPhase, undo, setTool])
}
