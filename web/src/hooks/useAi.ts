import { useEffect } from 'react'
import { chooseAiAction, type AiAction } from '../state/ai'
import { useGame } from '../state/gameStore'

const STEP_MS = 420

function applyAiAction(action: AiAction) {
  const game = useGame.getState()
  switch (action.type) {
    case 'claimOffer':
      game.claimOffer(action.id)
      return
    case 'declineOffer':
      game.declineOffer(action.id)
      return
    case 'claimFacility':
      game.claimFacility(action.hex)
      return
    case 'buildExtractor':
      game.buildExtractor(action.hex)
      return
    case 'abandonFacility':
      game.abandonFacility(action.hex)
      return
    case 'closeForUpkeep':
      game.closeForUpkeep(action.hex)
      return
    case 'moveShip':
      game.moveShip(action.hex)
      return
    case 'buildRoute':
      game.buildRoute(action.hex, action.dir, action.tier)
      return
    case 'upgradeRoute':
      game.upgradeRoute(action.hex, action.dir, action.tier)
      return
    case 'approveConsumer':
      game.approveConsumer(action.hex, action.meter)
      return
    case 'setSourceFee':
      game.setSourceFee(action.hex, action.fee)
      return
    case 'setFactoryFee':
      game.setFactoryFee(action.hex, action.fee)
      return
    case 'setImportFee':
      game.setImportFee(action.hex, action.fee)
      return
    case 'setRouteFee':
      game.setRouteFee(action.hex, action.dir, action.fee)
      return
    case 'recharge':
      game.rechargeTransformer(action.hex)
      return
    case 'endActions':
      game.endActions()
      return
    case 'nextPhase':
      game.nextPhase()
      return
    case 'takeSource':
      game.takeSourceChip(action.hex, action.index)
      return
    case 'releaseStorage':
      game.releaseStorage(action.hex)
      return
    case 'followRoute':
      game.followRoute(action.dir)
      return
    case 'triggerFactory':
      game.triggerFactoryEffect()
      return
    case 'deliver':
      game.deliverChip(action.payTariff)
      return
    case 'abort':
      game.abortChipTransport()
      return
    case 'pass':
      game.passSimulation()
      return
    case 'confirmHit':
      game.confirmFactoryHit()
      return
    case 'declineHit':
      game.declineFactoryHit()
      return
    case 'pickColor':
      game.pickNuclearColor(action.color)
      return
  }
}

/** Plays checked computer players one decision at a time. */
export function useAiDriver() {
  useEffect(() => {
    let timer = 0
    let stopped = false
    let last = ''
    let repeats = 0

    const arm = () => {
      if (stopped || timer) return
      timer = window.setTimeout(() => {
        timer = 0
        if (stopped) return
        const action = chooseAiAction(useGame.getState())
        if (!action) {
          last = ''
          repeats = 0
          return
        }
        const key = JSON.stringify(action)
        repeats = key === last ? repeats + 1 : 0
        last = key
        if (repeats >= 2) return
        applyAiAction(action)
      }, STEP_MS)
    }

    arm()
    const unsubscribe = useGame.subscribe(arm)
    return () => {
      stopped = true
      unsubscribe()
      window.clearTimeout(timer)
    }
  }, [])
}
