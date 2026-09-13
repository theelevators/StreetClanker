import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { MAX_HEALTH, finiteStat } from '../shared/combat.ts'
import { MatchEngine } from './match.ts'

const engines: MatchEngine[] = []

afterEach(() => {
  for (const engine of engines) engine.destroy()
  engines.length = 0
})

function makeEngine() {
  const engine = new MatchEngine(
    () => {},
    () => {},
  )
  engines.push(engine)
  return engine
}

function seatAndBell(engine: MatchEngine) {
  engine.joinAgent('winner-key', 'red', 'Winner')
  engine.joinAgent('loser-key', 'blue', 'Loser')
  engine.setReady('winner-key')
  engine.setReady('loser-key')
}

function knockoutBlue(engine: MatchEngine) {
  ;(engine as unknown as { knockout: (corner: 'red' | 'blue') => void }).knockout('red')
}

function landJab(engine: MatchEngine, from: 'red' | 'blue') {
  const state = engine.getState()
  state.phase = 'fighting'
  state.red.nextWindowAt = 0
  state.blue.nextWindowAt = 0
  state.red.covering = false
  state.blue.covering = false
  state.activePhrases = []
  engine.throwPhrase(from, { style: 'pressure', beats: [{ move: 'jab' }] })
  const phrase = engine.getState().activePhrases[0]
  assert.ok(phrase, 'expected a phrase in the air')
  const now = Date.now()
  for (const beat of phrase.beats) beat.at = now - 1
  engine.tick()
}

test('finiteStat rejects NaN and non-numbers', () => {
  assert.equal(finiteStat(12, 1), 12)
  assert.equal(finiteStat(Number.NaN, 7), 7)
  assert.equal(finiteStat(undefined, 7), 7)
  assert.equal(finiteStat(null, 7), 7)
})

test('rematch after knockout restores the loser to full mortal HP', () => {
  const engine = makeEngine()
  seatAndBell(engine)
  knockoutBlue(engine)
  assert.equal(engine.getState().blue.health, 0)
  assert.equal(engine.getState().blue.knockedOut, true)

  engine.rematch()
  const lobby = engine.getState()
  assert.equal(lobby.phase, 'lobby')
  assert.equal(lobby.blue.knockedOut, false)
  assert.equal(lobby.blue.health, MAX_HEALTH)
  assert.equal(lobby.blue.maxHealth, MAX_HEALTH)
  assert.ok(Number.isFinite(lobby.blue.health))

  engine.setReady('winner-key')
  engine.setReady('loser-key')
  const rematch = engine.getState()
  assert.equal(rematch.blue.health, MAX_HEALTH)
  assert.equal(rematch.blue.knockedOut, false)

  const before = rematch.blue.health
  landJab(engine, 'red')
  const after = engine.getState().blue
  assert.ok(Number.isFinite(after.health), 'loser HP must stay finite after a rematch hit')
  assert.ok(after.health < before, 'loser must take damage on rematch')
  assert.equal(after.knockedOut, false)
})

test('NaN HP on the former loser becomes mortal again', () => {
  const engine = makeEngine()
  seatAndBell(engine)
  knockoutBlue(engine)
  engine.rematch()
  engine.setReady('winner-key')
  engine.setReady('loser-key')

  engine.getState().blue.health = Number.NaN
  landJab(engine, 'red')
  const loser = engine.getState().blue
  assert.ok(Number.isFinite(loser.health), 'NaN HP must be repaired on impact')
  assert.ok(loser.health < (loser.maxHealth || MAX_HEALTH))
  assert.equal(loser.knockedOut, false)

  engine.getState().blue.health = 1
  landJab(engine, 'red')
  assert.equal(engine.getState().blue.health, 0)
  assert.equal(engine.getState().blue.knockedOut, true)
  assert.equal(engine.getState().winner, 'red')
})
